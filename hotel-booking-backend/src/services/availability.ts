import { db, bookings, roomTypes, roomInventory } from "../db";
import { RoomType } from "../db/schema";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Availability.
//
// Two models coexist:
//
//  1. Room types (Phase 1 — the real model): `room_inventory` rows track how
//     many rooms of a type are reserved per date. Booking path reserves
//     atomically (UPDATE ... SET reserved+1 WHERE reserved < totalRooms);
//     any failure rolls the whole booking back. Quote path is read-only.
//     Rows are created lazily for any night a booking touches — a missing
//     row means nothing is reserved yet, so it falls back to roomCount.
//
//  2. Property capacity (legacy fallback): bookings without a roomTypeId
//     (old rows, tests, pre-room-type flows) are checked against the
//     property's adultCount+childCount pool over overlapping nights.
// ---------------------------------------------------------------------------

/** Accepts the drizzle database or an open transaction (same query API). */
type Executor = typeof db;

export type AvailabilityResult =
  | { ok: true }
  | { ok: false; message: string };

/** Calendar nights covered by a stay, YYYY-MM-DD, checkOut exclusive. */
export function listNights(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return nights;
  }
  // Defensive cap — callers validate stay length against settings.maxNights.
  for (let guard = 0; cursor < end && guard < 400; guard++) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

// ---------------------------------------------------------------------------
// Room-type availability (read-only — quote path)
// ---------------------------------------------------------------------------

export async function checkRoomTypeAvailability(opts: {
  roomType: Pick<
    RoomType,
    "_id" | "name" | "roomCount" | "maxAdults" | "maxChildren" | "active"
  >;
  /** Calendar dates YYYY-MM-DD in the property timezone (checkOut exclusive). */
  checkIn: string;
  checkOut: string;
  guestAdults: number;
  guestChildren: number;
  executor?: Executor;
}): Promise<AvailabilityResult> {
  const { roomType, checkIn, checkOut } = opts;

  if (!roomType.active) {
    return {
      ok: false,
      message: `"${roomType.name}" is not accepting bookings`,
    };
  }
  if (opts.guestAdults > roomType.maxAdults) {
    return {
      ok: false,
      message: `"${roomType.name}" sleeps at most ${roomType.maxAdults} adults`,
    };
  }
  if (opts.guestChildren > roomType.maxChildren) {
    return {
      ok: false,
      message: `"${roomType.name}" allows at most ${roomType.maxChildren} children`,
    };
  }

  const nights = listNights(checkIn, checkOut);
  if (nights.length === 0) {
    return { ok: false, message: "Invalid date range" };
  }

  const executor: Executor = opts.executor ?? db;
  const rows = await executor
    .select({ date: roomInventory.date, totalRooms: roomInventory.totalRooms, reserved: roomInventory.reserved })
    .from(roomInventory)
    .where(
      and(
        eq(roomInventory.roomTypeId, roomType._id),
        inArray(roomInventory.date, nights)
      )
    );
  const byDate = new Map(rows.map((row) => [row.date, row]));

  for (const night of nights) {
    const row = byDate.get(night);
    const total = row ? row.totalRooms : roomType.roomCount;
    const reserved = row ? row.reserved : 0;
    if (reserved >= total) {
      return {
        ok: false,
        message: `No "${roomType.name}" rooms left on ${night}`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Room-type reservation (write — booking path, must run inside the booking
// transaction so a conflict rolls everything back)
// ---------------------------------------------------------------------------

export async function reserveRoomTypeNights(opts: {
  tx: Executor;
  roomType: Pick<RoomType, "_id" | "name" | "roomCount">;
  checkIn: string;
  checkOut: string;
}): Promise<AvailabilityResult> {
  const { tx, roomType, checkIn, checkOut } = opts;
  const nights = listNights(checkIn, checkOut);
  if (nights.length === 0) {
    return { ok: false, message: "Invalid date range" };
  }

  // Lazily create inventory rows for nights we haven't seen yet.
  const existing = await tx
    .select({ date: roomInventory.date })
    .from(roomInventory)
    .where(
      and(
        eq(roomInventory.roomTypeId, roomType._id),
        inArray(roomInventory.date, nights)
      )
    );
  const have = new Set(existing.map((row) => row.date));
  const missing = nights.filter((night) => !have.has(night));
  if (missing.length > 0) {
    await tx
      .insert(roomInventory)
      .values(
        missing.map((night) => ({
          roomTypeId: roomType._id,
          date: night,
          totalRooms: roomType.roomCount,
          reserved: 0,
        }))
      )
      .onConflictDoNothing();
  }

  // THE double-booking fix: one atomic guarded UPDATE per night. Concurrent
  // transactions serialize on the row lock; a full night returns no row.
  for (const night of nights) {
    const updated = await tx
      .update(roomInventory)
      .set({
        reserved: sql`${roomInventory.reserved} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(roomInventory.roomTypeId, roomType._id),
          eq(roomInventory.date, night),
          sql`${roomInventory.reserved} < ${roomInventory.totalRooms}`
        )
      )
      .returning({ date: roomInventory.date });

    if (updated.length === 0) {
      return {
        ok: false,
        message: `No "${roomType.name}" rooms left on ${night}`,
      };
    }
  }

  return { ok: true };
}

/** Give a reserved night back (cancellation / failed payment / delete). */
export async function releaseRoomTypeNights(opts: {
  tx: Executor;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
}): Promise<void> {
  const { tx, roomTypeId, checkIn, checkOut } = opts;
  const nights = listNights(checkIn, checkOut);
  if (nights.length === 0) return;

  await tx
    .update(roomInventory)
    .set({
      reserved: sql`GREATEST(${roomInventory.reserved} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(roomInventory.roomTypeId, roomTypeId),
        inArray(roomInventory.date, nights)
      )
    );
}

// ---------------------------------------------------------------------------
// Legacy property-capacity model (bookings without a roomTypeId)
// ---------------------------------------------------------------------------

export async function checkCapacity(opts: {
  hotel: { _id: string; adultCount: number; childCount: number };
  /** Calendar dates YYYY-MM-DD in the property timezone (checkOut exclusive). */
  checkIn: string;
  checkOut: string;
  guestAdults: number;
  guestChildren: number;
  executor?: Executor;
}): Promise<AvailabilityResult> {
  const { hotel, checkIn, checkOut } = opts;
  const capacity = (hotel.adultCount || 0) + (hotel.childCount || 0);
  const requested = (opts.guestAdults || 0) + (opts.guestChildren || 0);

  // Capacity not configured — cannot judge, allow the booking.
  if (capacity <= 0) return { ok: true };
  if (requested <= 0) return { ok: false, message: "At least one guest is required" };

  const executor: Executor = opts.executor ?? db;

  const [row] = await executor
    .select({
      used: sql<number>`coalesce(sum(${bookings.adultCount} + ${bookings.childCount}), 0)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.hotelId, hotel._id),
        inArray(bookings.status, ["pending", "confirmed"]),
        // [checkIn, checkOut) intervals overlap:
        lt(bookings.checkIn, checkOut),
        gt(bookings.checkOut, checkIn)
      )
    );

  const used = Number(row?.used ?? 0);

  if (used + requested > capacity) {
    return {
      ok: false,
      message: `Not enough capacity for these dates: ${used} of ${capacity} guest spots already booked`,
    };
  }

  return { ok: true };
}
