import { db, bookings, payments } from "../db";
import { and, eq } from "drizzle-orm";
import type { Booking, PaymentRow } from "../db/schema";
import { releaseBookingInventory } from "../services/booking";

// ---------------------------------------------------------------------------
// Payment ledger transitions — shared by the checkout flow (client-driven
// confirm) and the webhook endpoint (server-driven), so both paths apply the
// exact same booking/payment state changes and stay idempotent.
// ---------------------------------------------------------------------------

export type LedgerOutcome = {
  payment: PaymentRow | null;
  booking: Booking | null;
  /** True when the ledger row was already in the target state. */
  duplicate: boolean;
};

async function findRow(providerId: string, intentId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.providerId, providerId),
        eq(payments.providerRef, intentId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Mark the ledger row (and its booking) paid. Idempotent: replayed webhooks
 * report `duplicate: true` without touching state again.
 */
export async function markPaymentSucceeded(opts: {
  providerId: string;
  intentId: string;
  raw?: unknown;
}): Promise<LedgerOutcome | null> {
  const row = await findRow(opts.providerId, opts.intentId);
  if (!row) return null;

  if (row.status === "succeeded") {
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings._id, row.bookingId))
      .limit(1);
    return { payment: row, booking: booking ?? null, duplicate: true };
  }

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(payments)
      .set({ status: "succeeded", raw: (opts.raw ?? null) as any, updatedAt: new Date() })
      .where(eq(payments._id, row._id))
      .returning();

    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings._id, row.bookingId))
      .limit(1);
    if (!booking) {
      return { payment: payment ?? row, booking: null, duplicate: false };
    }

    // Amounts in the booking are stored-currency: balance 0 means the stay is
    // fully covered, otherwise the prepayment only (deposit_paid).
    const fullyPaid = Number(booking.balanceAmount) <= 0.01;
    const nextPaymentStatus = fullyPaid ? "paid" : "deposit_paid";
    const nextStatus = booking.status === "pending" ? "confirmed" : booking.status;

    const [updated] = await tx
      .update(bookings)
      .set({
        paymentStatus: nextPaymentStatus,
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(bookings._id, booking._id))
      .returning();

    return { payment: payment ?? row, booking: updated ?? booking, duplicate: false };
  });
}

/**
 * Mark the ledger row failed. `cancelBooking` also cancels a still-pending
 * booking and releases its inventory (checkout failure path).
 */
export async function markPaymentFailed(opts: {
  providerId: string;
  intentId: string;
  raw?: unknown;
  cancelBooking?: boolean;
}): Promise<LedgerOutcome | null> {
  const row = await findRow(opts.providerId, opts.intentId);
  if (!row) return null;

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(payments)
      .set({ status: "failed", raw: (opts.raw ?? null) as any, updatedAt: new Date() })
      .where(eq(payments._id, row._id))
      .returning();

    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings._id, row.bookingId))
      .limit(1);
    if (!booking) {
      return { payment: payment ?? row, booking: null, duplicate: false };
    }

    let updated: Booking | undefined;
    if (opts.cancelBooking && booking.status === "pending") {
      await releaseBookingInventory({
        executor: tx as unknown as typeof db,
        booking,
      });
      [updated] = await tx
        .update(bookings)
        .set({
          status: "cancelled",
          paymentStatus: "failed",
          cancellationReason: "Payment failed",
          updatedAt: new Date(),
        })
        .where(eq(bookings._id, booking._id))
        .returning();
    } else {
      [updated] = await tx
        .update(bookings)
        .set({ paymentStatus: "failed", updatedAt: new Date() })
        .where(eq(bookings._id, booking._id))
        .returning();
    }

    return { payment: payment ?? row, booking: updated ?? booking, duplicate: false };
  });
}
