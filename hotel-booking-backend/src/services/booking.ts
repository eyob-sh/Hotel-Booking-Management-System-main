import { db, bookings, hotels, users, payments, roomTypes } from "../db";
import { Hotel, Booking } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  checkCapacity,
  reserveRoomTypeNights,
  releaseRoomTypeNights,
  type AvailabilityResult,
} from "./availability";

// ---------------------------------------------------------------------------
// Booking service — the only code path that writes bookings. Guarantees:
//   * one DB transaction (booking row + inventory reservation + ledger row +
//     analytics counters commit together),
//   * an advisory lock per hotel+dates so concurrent requests serialize,
//   * availability enforced inside that lock: room-type inventory reserved
//     atomically per night (no double-booking), or the legacy capacity check,
//   * totals are always computed by the caller via services/pricing (the
//     client's numbers are never accepted here),
//   * a human-readable `reference` (HB-XXXXXXXXXX) for every booking.
// Routes (and later the Telegram bot) all go through this function.
// ---------------------------------------------------------------------------

export class BookingConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "BookingConflictError";
  }
}

export type LedgerEntry = {
  providerId: string;
  type: "deposit" | "balance" | "refund" | "charge";
  amount: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  providerRef?: string | null;
  /** Override when the money moves in a different currency than the booking. */
  currency?: string;
  raw?: unknown;
};

export type CreateBookingArgs = {
  /** Null for guest checkout (no account) — user stats are then skipped. */
  userId?: string | null;
  hotel: Hotel;
  guest: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  };
  adultCount: number;
  childCount: number;
  /** Calendar dates YYYY-MM-DD in the property timezone (checkOut exclusive). */
  checkIn: string;
  checkOut: string;
  /** Server-computed total in the stored currency. */
  totalStored: number;
  /** Amount due up front (online charge or transfer) — 0 for pay at arrival. */
  depositAmount?: number;
  /** Remainder due at the property. */
  balanceAmount?: number;
  /** Stored currency at booking time (settings.currency). */
  currency?: string;
  source?: Booking["source"];
  status: Booking["status"];
  paymentStatus: Booking["paymentStatus"];
  paymentMethod?: string | null;
  specialRequests?: string | null;
  /** When set, the stay is booked against room-type inventory. */
  roomTypeId?: string | null;
  /** Payment ledger row written in the same transaction. */
  ledger?: LedgerEntry;
};

const STAFF_HOLDING_STATUSES: Booking["status"][] = ["pending", "confirmed"];

/** HB- + 10 hex chars — derived from the booking uuid, unique by construction. */
const referenceFor = (id: string) =>
  `HB-${id.replace(/-/g, "").slice(0, 10).toUpperCase()}`;

const isUniqueViolation = (error: any) => error?.code === "23505";

export async function createBooking(args: CreateBookingArgs): Promise<Booking> {
  const { hotel, guest } = args;
  const currency = args.currency || "ETB";
  const depositAmount = args.depositAmount ?? 0;
  const balanceAmount = args.balanceAmount ?? Math.max(0, args.totalStored - depositAmount);

  // Unique-violation retries (reference/uuid collision — astronomically
  // unlikely) rebuild the whole transaction with fresh ids, since a failed
  // statement aborts the current transaction.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        // Serialize competing bookings for the same hotel + dates. The lock
        // is released automatically at commit/rollback (xact lock).
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`booking:${hotel._id}:${args.checkIn}:${args.checkOut}`}))`
        );

        if (args.roomTypeId) {
          const [roomType] = await tx
            .select()
            .from(roomTypes)
            .where(
              and(
                eq(roomTypes._id, args.roomTypeId),
                eq(roomTypes.hotelId, hotel._id)
              )
            )
            .limit(1);
          if (!roomType) {
            throw new BookingConflictError(
              "Room type not found for this property"
            );
          }
          if (!roomType.active) {
            throw new BookingConflictError(
              `"${roomType.name}" is not accepting bookings`
            );
          }
          if (args.adultCount > roomType.maxAdults) {
            throw new BookingConflictError(
              `"${roomType.name}" sleeps at most ${roomType.maxAdults} adults`
            );
          }
          if (args.childCount > roomType.maxChildren) {
            throw new BookingConflictError(
              `"${roomType.name}" allows at most ${roomType.maxChildren} children`
            );
          }

          const reserved = await reserveRoomTypeNights({
            tx: tx as unknown as typeof db,
            roomType,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
          });
          if (!reserved.ok) {
            throw new BookingConflictError(reserved.message);
          }
        } else {
          const availability = await checkCapacity({
            hotel,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
            guestAdults: args.adultCount,
            guestChildren: args.childCount,
            executor: tx as unknown as typeof db,
          });
          if (!availability.ok) {
            throw new BookingConflictError(availability.message);
          }
        }

        const bookingId = randomUUID();
        const [booking] = await tx
          .insert(bookings)
          .values({
            _id: bookingId,
            userId: args.userId ?? null,
            hotelId: hotel._id,
            firstName: guest.firstName,
            lastName: guest.lastName,
            email: guest.email,
            phone: guest.phone ?? null,
            adultCount: args.adultCount,
            childCount: args.childCount,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
            roomTypeId: args.roomTypeId ?? null,
            reference: referenceFor(bookingId),
            totalCost: args.totalStored,
            depositAmount,
            balanceAmount,
            currency,
            source: args.source ?? "web",
            status: args.status,
            paymentStatus: args.paymentStatus,
            paymentMethod: args.paymentMethod ?? null,
            specialRequests: args.specialRequests ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        if (!booking) {
          throw new Error("Failed to insert booking");
        }

        // Payment ledger row (owed or received) in the same transaction.
        if (args.ledger) {
          await tx.insert(payments).values({
            bookingId: booking._id,
            providerId: args.ledger.providerId,
            type: args.ledger.type,
            amount: args.ledger.amount,
            currency: args.ledger.currency ?? currency,
            status: args.ledger.status,
            providerRef: args.ledger.providerRef ?? null,
            raw: (args.ledger.raw ?? null) as any,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        // Keep denormalized analytics counters in sync in the same transaction.
        await tx
          .update(hotels)
          .set({
            totalBookings: sql`${hotels.totalBookings} + 1`,
            totalRevenue: sql`${hotels.totalRevenue} + ${args.totalStored}`,
          })
          .where(eq(hotels._id, hotel._id));

        // Guests have no account — nothing to denormalize.
        if (args.userId) {
          await tx
            .update(users)
            .set({
              totalBookings: sql`${users.totalBookings} + 1`,
              totalSpent: sql`${users.totalSpent} + ${args.totalStored}`,
            })
            .where(eq(users._id, args.userId));
        }

        return booking;
      });
    } catch (error) {
      if (isUniqueViolation(error) && !(error instanceof BookingConflictError) && attempt < 3) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Inventory release / revalidation — used by status changes and deletes.
// ---------------------------------------------------------------------------

type Executor = typeof db;

/** Give reserved nights back when a pending/confirmed booking is cancelled. */
export async function releaseBookingInventory(opts: {
  executor: Executor;
  booking: Pick<Booking, "roomTypeId" | "checkIn" | "checkOut" | "status">;
}): Promise<void> {
  const { executor, booking } = opts;
  if (!booking.roomTypeId) return;
  if (!STAFF_HOLDING_STATUSES.includes(booking.status)) return;

  await releaseRoomTypeNights({
    tx: executor,
    roomTypeId: booking.roomTypeId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
  });
}

/**
 * Re-reserve inventory when a cancelled booking is restored to
 * pending/confirmed. Legacy bookings (no roomTypeId) are left alone.
 */
export async function revalidateBookingInventory(opts: {
  executor: Executor;
  booking: Pick<Booking, "roomTypeId" | "checkIn" | "checkOut" | "hotelId">;
}): Promise<AvailabilityResult> {
  const { executor, booking } = opts;
  if (!booking.roomTypeId) return { ok: true };

  const [roomType] = await executor
    .select()
    .from(roomTypes)
    .where(
      and(
        eq(roomTypes._id, booking.roomTypeId),
        eq(roomTypes.hotelId, booking.hotelId)
      )
    )
    .limit(1);
  if (!roomType || !roomType.active) {
    return { ok: false, message: "Room type is no longer available" };
  }

  return reserveRoomTypeNights({
    tx: executor,
    roomType,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
  });
}
