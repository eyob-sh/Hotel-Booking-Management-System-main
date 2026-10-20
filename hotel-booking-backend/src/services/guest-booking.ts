import { db, bookings } from "../db";
import { eq } from "drizzle-orm";
import { releaseBookingInventory } from "./booking";
import { enqueueNotification } from "./notifications";

// ---------------------------------------------------------------------------
// Shared guest-booking helpers (Phase 5) — reference + phone/email lookup and
// self-service cancellation. Extracted so the HTTP lookup routes and the
// Telegram bot behave identically (same matching rules, same cancel semantics).
// ---------------------------------------------------------------------------

export const INVENTORY_HOLDING_STATUSES = ["pending", "confirmed"];

export const normalizeRef = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const digitsOnly = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");

const normalizeEmail = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const phoneMatches = (a: unknown, b: unknown): boolean => {
  const da = digitsOnly(a);
  const dbDigits = digitsOnly(b);
  if (!da || !dbDigits) return false;
  if (da === dbDigits) return true;
  const n = Math.min(9, da.length, dbDigits.length);
  return n >= 7 && da.slice(-n) === dbDigits.slice(-n);
};

/** True when the supplied contact details match the booking's. */
export const contactMatches = (
  booking: { email: string | null; phone: string | null },
  contact: { phone?: unknown; email?: unknown }
): boolean => {
  const emailOk =
    !!contact.email &&
    !!booking.email &&
    normalizeEmail(contact.email) === normalizeEmail(booking.email);
  const phoneOk = phoneMatches(booking.phone, contact.phone);
  return emailOk || phoneOk;
};

export type LookupInput = {
  reference: string;
  phone?: string | null;
  email?: string | null;
};

/** Find a booking by reference, verified by phone or email. Null when no match. */
export async function lookupBooking(input: LookupInput) {
  if (!input.phone && !input.email) {
    throw new Error("Provide the phone or email used for the booking");
  }
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.reference, normalizeRef(input.reference)))
    .limit(1);
  if (!booking || !contactMatches(booking, { phone: input.phone, email: input.email })) {
    return null;
  }
  return booking;
}

export type CancelResult =
  | { ok: true; booking: typeof bookings.$inferSelect }
  | { ok: false; status: number; message: string };

/** Self-service cancellation (reference + verified contact). */
export async function cancelBookingByReference(
  input: LookupInput & { reason?: string }
): Promise<CancelResult> {
  const booking = await lookupBooking(input);
  if (!booking) {
    return { ok: false, status: 404, message: "No matching booking found" };
  }
  if (!INVENTORY_HOLDING_STATUSES.includes(booking.status)) {
    return {
      ok: false,
      status: 409,
      message: `Booking cannot be cancelled while "${booking.status}"`,
    };
  }

  const cancelled = await db.transaction(async (tx) => {
    await releaseBookingInventory({
      executor: tx as unknown as typeof db,
      booking,
    });
    const [updated] = await tx
      .update(bookings)
      .set({
        status: "cancelled",
        cancellationReason: input.reason || "Cancelled by guest (self-service)",
      })
      .where(eq(bookings._id, booking._id))
      .returning();
    return updated;
  });

  try {
    await enqueueNotification({
      bookingId: booking._id,
      type: "booking_cancelled",
      to: booking.email || booking.phone || undefined,
      subject: `Booking ${booking.reference ?? ""} cancelled`,
      body: `Your booking ${booking.reference ?? booking._id} has been cancelled.`,
      channel: "email",
    });
  } catch {}

  return { ok: true, booking: cancelled };
}
