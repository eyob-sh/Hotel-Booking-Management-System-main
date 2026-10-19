import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, bookings, hotels, payments, paymentProviders, roomTypes } from "../db";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { getProvider } from "../payments/registry";
import type { ProviderConfig } from "../payments/types";

// ---------------------------------------------------------------------------
// Booking management (Phase 3) � what a single-property owner actually needs
// at the desk:
//
//   GET  /api/management/hotels/:hotelId/bookings   list w/ room + payments
//   POST /api/management/bookings/:id/payments      record money received
//   POST /api/management/bookings/:id/refunds       issue a refund
//
// RBAC: the owner of that hotel, or an admin. Guests never get here � the
// guest-facing paths stay on /api/bookings/lookup.
//
// Recording a payment writes a real ledger row (payments table) and then
// re-derives the booking's paymentStatus/balanceAmount from the ledger, so
// the truth always lives in the ledger, never in a hand-set flag.
// ---------------------------------------------------------------------------

const router = express.Router();

const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "refunded",
  "checked_in",
  "checked_out",
  "no_show",
] as const;
type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Owner of the hotel (or an admin). */
async function managerAccess(req: Request, hotelId: string) {
  if (!/^[0-9a-fA-F-]{36}$/.test(hotelId)) {
    return { ok: false as const, status: 400, message: "Invalid hotel id" };
  }
  const [hotel] = await db.select().from(hotels).where(eq(hotels._id, hotelId)).limit(1);
  if (!hotel) return { ok: false as const, status: 404, message: "Hotel not found" };
  if (req.userRole === "admin") return { ok: true as const, hotel };
  if (hotel.userId !== req.userId) {
    return { ok: false as const, status: 403, message: "Access denied" };
  }
  return { ok: true as const, hotel };
}

/** Owner of the booking's hotel (or an admin). */
async function bookingManagerAccess(req: Request, booking: { hotelId: string }): Promise<boolean> {
  if (req.userRole === "admin") return true;
  const [hotel] = await db
    .select({ userId: hotels.userId })
    .from(hotels)
    .where(eq(hotels._id, booking.hotelId))
    .limit(1);
  return Boolean(hotel && hotel.userId === req.userId);
}

/** Ledger totals for a booking, in booking currency. */
async function ledgerTotals(bookingId: string) {
  const rows = await db
    .select({ type: payments.type, amount: payments.amount, status: payments.status })
    .from(payments)
    .where(eq(payments.bookingId, bookingId));

  const sum = (types: string[]) =>
    rows
      .filter((r) => r.status === "succeeded" && types.includes(r.type))
      .reduce((total, r) => total + Number(r.amount || 0), 0);

  const collected = sum(["deposit", "balance", "charge"]);
  const refunded = sum(["refund"]);
  const netPaid = collected - refunded;

  return { collected, refunded, netPaid, rows };
}

/** paymentStatus implied by the ledger for a given total. */
function derivePaymentStatus(totalCost: number, netPaid: number, refunded: number) {
  if (totalCost > 0 && netPaid >= totalCost - 0.01) return "paid";
  if (refunded > 0 && netPaid < 0.01) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (netPaid > 0.01) return "deposit_paid";
  return "pending";
}

/** Load the provider row (config + enabled) for a provider id. */
async function providerConfig(providerId: string) {
  const [row] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, providerId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    enabled: row.enabled,
    displayName: row.displayName,
    kind: row.kind,
    config: (row.config ?? {}) as ProviderConfig,
  };
}

// ---------------------------------------------------------------------------
// GET /api/management/hotels/:hotelId/bookings
// ---------------------------------------------------------------------------
router.get(
  "/hotels/:hotelId/bookings",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (req: Request, res: Response) => {
    const access = await managerAccess(req, String(req.params.hotelId));
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    try {
      const filters = [eq(bookings.hotelId, access.hotel._id)];

      const statusParam = String(req.query.status ?? "").trim();
      if (statusParam) {
        const wanted = statusParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is BookingStatus => (BOOKING_STATUSES as readonly string[]).includes(s));
        if (wanted.length > 0) filters.push(inArray(bookings.status, wanted));
      }
      if (req.query.checkInFrom) filters.push(gte(bookings.checkIn, String(req.query.checkInFrom)));
      if (req.query.checkInTo) filters.push(lte(bookings.checkIn, String(req.query.checkInTo)));

      const rows = await db
        .select()
        .from(bookings)
        .where(and(...filters))
        .orderBy(desc(bookings.checkIn), desc(bookings.createdAt));

      // Room-type names for the list.
      const roomTypeIds = [...new Set(rows.map((r) => r.roomTypeId).filter(Boolean))] as string[];
      const roomTypeRows = roomTypeIds.length
        ? await db.select().from(roomTypes).where(inArray(roomTypes._id, roomTypeIds))
        : [];
      const roomTypeMap = new Map(roomTypeRows.map((rt) => [rt._id, rt.name]));

      // Ledger rows, grouped by booking.
      const allPayments = rows.length
        ? await db
            .select()
            .from(payments)
            .where(inArray(payments.bookingId, rows.map((r) => r._id)))
            .orderBy(desc(payments.createdAt))
        : [];
      const paymentsByBooking = new Map<string, typeof allPayments>();
      allPayments.forEach((p) => {
        const list = paymentsByBooking.get(p.bookingId) ?? [];
        list.push(p);
        paymentsByBooking.set(p.bookingId, list);
      });

      const result = rows.map((booking) => {
        const list = paymentsByBooking.get(booking._id) ?? [];
        const collected = list
          .filter((p) => p.status === "succeeded" && p.type !== "refund")
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const refunded = list
          .filter((p) => p.status === "succeeded" && p.type === "refund")
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        return {
          ...booking,
          roomTypeName: booking.roomTypeId ? roomTypeMap.get(booking.roomTypeId) ?? null : null,
          payments: list,
          paidAmount: collected,
          refundedAmount: refunded,
          netPaid: collected - refunded,
        };
      });

      res.status(200).json({ bookings: result });
    } catch (error) {
      res.status(500).json({ message: "Unable to load bookings" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/management/bookings/:id/payments � record money received
// ---------------------------------------------------------------------------
router.post(
  "/bookings/:id/payments",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  [
    body("amount").isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
    body("providerId").optional({ values: "falsy" }).trim().isLength({ max: 64 }),
    body("reference").optional({ values: "falsy" }).trim().isLength({ max: 255 }),
    body("note").optional({ values: "falsy" }).trim().isLength({ max: 1000 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings._id, String(req.params.id)))
        .limit(1);
      if (!booking) return res.status(404).json({ message: "Booking not found" });

      if (!(await bookingManagerAccess(req, booking))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (booking.status === "cancelled") {
        return res
          .status(409)
          .json({ message: "Cannot record a payment on a cancelled booking" });
      }

      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: "amount must be greater than 0" });
      }

      const totalCost = Number(booking.totalCost || 0);
      const totals = await ledgerTotals(booking._id);
      const remaining = totalCost - totals.netPaid;
      if (amount > remaining + 0.01) {
        return res.status(400).json({
          message: `Amount exceeds the remaining balance (ETB ${remaining.toFixed(2)})`,
          remaining,
        });
      }

      // Default to the method the booking was made with; "pay-at-arrival" is
      // the natural bucket for cash/card taken at the desk.
      const providerId =
        (req.body.providerId ? String(req.body.providerId) : booking.paymentMethod) ||
        "pay-at-arrival";

      const provider = await providerConfig(providerId);
      if (!provider) {
        return res.status(400).json({ message: `Unknown payment method "${providerId}"` });
      }

      // First money down is a deposit, anything after settles the balance.
      const kind = totals.netPaid > 0.01 ? "balance" : "deposit";
      const reference = req.body.reference
        ? String(req.body.reference)
        : `manual-${Date.now()}`;

      const [payment] = await db
        .insert(payments)
        .values({
          bookingId: booking._id,
          providerId,
          type: kind,
          amount,
          currency: booking.currency,
          status: "succeeded",
          providerRef: reference,
          raw: {
            recordedBy: "manager",
            note: req.body.note ?? null,
            method: req.body.method ?? null,
          } as any,
        })
        .returning();

      const after = await ledgerTotals(booking._id);
      const paymentStatus = derivePaymentStatus(totalCost, after.netPaid, after.refunded);
      const balanceAmount = Math.max(0, totalCost - after.netPaid);

      // Money arrived: a still-"pending" booking (bank transfer awaiting
      // confirmation) becomes confirmed. This is the "recorded on arrival
      // marks the booking paid" acceptance rule.
      const nextStatus = booking.status === "pending" ? "confirmed" : booking.status;

      const [updated] = await db
        .update(bookings)
        .set({ paymentStatus, balanceAmount, status: nextStatus, updatedAt: new Date() })
        .where(eq(bookings._id, booking._id))
        .returning();

      res.status(201).json({ payment, booking: updated ?? booking, remaining: balanceAmount });
    } catch (error) {
      res.status(500).json({ message: "Unable to record payment" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/management/bookings/:id/refunds � issue a refund
// ---------------------------------------------------------------------------
router.post(
  "/bookings/:id/refunds",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  [
    body("amount").isFloat({ gt: 0 }).withMessage("amount must be greater than 0"),
    body("reason").optional({ values: "falsy" }).trim().isLength({ max: 1000 }),
    body("reference").optional({ values: "falsy" }).trim().isLength({ max: 255 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const [booking] = await db
        .select()
        .from(bookings)
        .where(eq(bookings._id, String(req.params.id)))
        .limit(1);
      if (!booking) return res.status(404).json({ message: "Booking not found" });

      if (!(await bookingManagerAccess(req, booking))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: "amount must be greater than 0" });
      }

      const totals = await ledgerTotals(booking._id);
      if (amount > totals.netPaid + 0.01) {
        return res.status(400).json({
          message: `Refund exceeds the amount collected (ETB ${totals.netPaid.toFixed(2)})`,
          refundable: Math.max(0, totals.netPaid),
        });
      }

      // When the original charge went through a live online provider, push the
      // refund there too; offline methods (cash/transfer) are bookkeeping only.
      const lastCharge = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.bookingId, booking._id),
            eq(payments.status, "succeeded"),
            inArray(payments.type, ["deposit", "balance", "charge"]),
            sql`${payments.providerRef} IS NOT NULL`
          )
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      let providerRef: string | null = req.body.reference ? String(req.body.reference) : null;
      let providerStatus: "succeeded" | "pending" | "failed" = "succeeded";
      let providerRaw: unknown = null;

      const chargeProvider = lastCharge[0]?.providerId ?? booking.paymentMethod ?? null;
      if (chargeProvider) {
        const provider = await providerConfig(chargeProvider);
        const impl = provider ? getProvider(provider.id) : undefined;
        const live =
          provider &&
          provider.enabled &&
          provider.kind === "online" &&
          impl?.isConfigured(provider.config);

        if (live && lastCharge[0]?.providerRef && impl) {
          const result = await impl.refund(lastCharge[0].providerRef, amount, {
            config: provider.config,
          });
          providerStatus = result.status;
          providerRaw = result.raw ?? null;
          if (result.status === "failed") {
            return res.status(402).json({
              message: "The provider rejected the refund. Nothing was recorded.",
            });
          }
          if (!providerRef) providerRef = lastCharge[0].providerRef;
        }
      }

      const [refund] = await db
        .insert(payments)
        .values({
          bookingId: booking._id,
          providerId: chargeProvider || "pay-at-arrival",
          type: "refund",
          amount,
          currency: booking.currency,
          status: providerStatus,
          providerRef: providerRef ?? `refund-${Date.now()}`,
          raw: {
            recordedBy: "manager",
            reason: req.body.reason ?? null,
            provider: providerRaw,
          } as any,
        })
        .returning();

      const after = await ledgerTotals(booking._id);
      const paymentStatus = derivePaymentStatus(
        Number(booking.totalCost || 0),
        after.netPaid,
        after.refunded
      );
      const balanceAmount = Math.max(0, Number(booking.totalCost || 0) - after.netPaid);

      const [updated] = await db
        .update(bookings)
        .set({
          paymentStatus,
          balanceAmount,
          refundAmount: after.refunded,
          updatedAt: new Date(),
        })
        .where(eq(bookings._id, booking._id))
        .returning();

      res.status(201).json({
        refund,
        booking: updated ?? booking,
        refunded: after.refunded,
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to issue refund" });
    }
  }
);

export default router;
