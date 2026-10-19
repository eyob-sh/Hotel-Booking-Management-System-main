import express, { Request, Response } from "express";
import { db, hotels, bookings, users, roomTypes } from "../db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { RoomType } from "../db/schema";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { body, param, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import {
  BookingConflictError,
  createBooking,
  releaseBookingInventory,
  revalidateBookingInventory,
} from "../services/booking";
import {
  checkCapacity,
  checkRoomTypeAvailability,
} from "../services/availability";
import {
  calendarDateOf,
  diffNights,
  getSettings,
  propertyTimeZone,
} from "../services/settings";
import { quoteNights } from "../services/pricing";
import { PaymentConfigError } from "../services/payments";
import {
  DEFAULT_PROVIDER_ID,
  chargedAmountFor,
  getProviderRuntime,
} from "../payments/registry";
import { ProviderError } from "../payments/types";
import { markPaymentFailed, markPaymentSucceeded } from "../payments/ledger";

const router = express.Router();

// Same tight window as the legacy checkout route: bookings move money.
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many booking attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const populateHotel = async (rows: any[], hotelFields: string[]) => {
  const hotelIds = [...new Set(rows.map((row) => row.hotelId))];
  if (hotelIds.length === 0) return rows;

  const hotelRows = await db
    .select()
    .from(hotels)
    .where(inArray(hotels._id, hotelIds as string[]));
  const hotelMap = new Map(hotelRows.map((hotel) => [hotel._id, hotel]));

  return rows.map((row) => {
    const hotel = hotelMap.get(row.hotelId);
    if (!hotel) return { ...row, hotelId: null };
    const projected: any = { _id: hotel._id };
    for (const field of hotelFields) {
      projected[field] = (hotel as any)[field];
    }
    return { ...row, hotelId: projected };
  });
};

const populateUser = async (rows: any[], userFields: string[]) => {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  if (userIds.length === 0) return rows;

  const userRows = await db
    .select()
    .from(users)
    .where(inArray(users._id, userIds as string[]));
  const userMap = new Map(userRows.map((user) => [user._id, user]));

  return rows.map((row) => {
    const user = userMap.get(row.userId);
    if (!user) return { ...row, userId: null };
    const projected: any = { _id: user._id };
    for (const field of userFields) {
      projected[field] = (user as any)[field];
    }
    return { ...row, userId: projected };
  });
};

/**
 * @swagger
 * tags:
 *   name: Bookings
 *   description: Booking management and administration
 */

// Access levels for a booking, derived from the caller's identity/role:
//   full  – admin (everything)
//   hotel – owner of the hotel this booking belongs to (manage the stay)
//   self  – the guest who made the booking (view / cancel own)
//   none  – no access at all
type BookingAccess = "full" | "hotel" | "self" | "none";

const getBookingAccess = async (
  booking: { userId: string; hotelId: string },
  userId: string,
  role: string
): Promise<BookingAccess> => {
  if (role === "admin") return "full";
  if (booking.userId === userId) return "self";

  const [hotel] = await db
    .select({ userId: hotels.userId })
    .from(hotels)
    .where(eq(hotels._id, booking.hotelId))
    .limit(1);
  if (hotel && hotel.userId === userId) return "hotel";

  return "none";
};

// Statuses a hotel owner may set (everything else needs an admin).
const OWNER_STATUSES = [
  "confirmed",
  "cancelled",
  "completed",
  "checked_in",
  "checked_out",
  "no_show",
];

// A booking holds inventory while in these statuses.
const INVENTORY_HOLDING_STATUSES = ["pending", "confirmed"];

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     summary: Create a booking (server-priced, provider-aware checkout)
 *     description: >
 *       The v2 checkout: quote + availability on the server, atomic
 *       inventory reservation, payment-provider selection
 *       (pay-at-arrival | bank-transfer | telebirr | ...). Totals are never
 *       trusted from the client (optional totalCost is cross-checked).
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Booking created (with payment status/intent).
 *       400:
 *         description: Validation or pricing/payment configuration error.
 *       402:
 *         description: Online payment failed — booking not confirmed.
 *       404:
 *         description: Hotel or room type not found.
 *       409:
 *         description: No availability for the requested dates.
 */
router.post(
  "/",
  verifyToken,
  bookingLimiter,
  [
    body("hotelId").notEmpty().withMessage("hotelId is required"),
    body("roomTypeId")
      .optional({ values: "falsy" })
      .isUUID()
      .withMessage("roomTypeId must be a UUID"),
    body("checkIn")
      .notEmpty().withMessage("checkIn is required")
      .isISO8601().withMessage("checkIn must be a valid ISO date"),
    body("checkOut")
      .notEmpty().withMessage("checkOut is required")
      .isISO8601().withMessage("checkOut must be a valid ISO date"),
    body("adultCount")
      .isInt({ min: 1, max: 100 })
      .withMessage("adultCount must be between 1 and 100")
      .toInt(),
    body("childCount")
      .isInt({ min: 0, max: 100 })
      .withMessage("childCount must be between 0 and 100")
      .toInt(),
    body("firstName").trim().notEmpty().withMessage("firstName is required"),
    body("lastName").trim().notEmpty().withMessage("lastName is required"),
    body("email")
      .optional({ values: "falsy" })
      .trim()
      .isEmail()
      .withMessage("email must be a valid email"),
    body("phone")
      .trim()
      .notEmpty().withMessage("phone is required")
      .matches(/^\+?[0-9][0-9\s\-()]{5,19}$/)
      .withMessage("phone must be a valid phone number"),
    body("specialRequests")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 2000 })
      .withMessage("specialRequests is too long"),
    body("providerId")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 64 })
      .withMessage("providerId is too long"),
    body("source")
      .optional({ values: "falsy" })
      .isIn(["web", "phone", "walkin"])
      .withMessage("Invalid source"),
    body("totalCost")
      .optional({ values: "falsy" })
      .isFloat({ min: 0 })
      .withMessage("totalCost must be a non-negative number"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const hotelId = String(req.body.hotelId);
      const [hotel] = await db
        .select()
        .from(hotels)
        .where(eq(hotels._id, hotelId))
        .limit(1);
      if (!hotel) {
        return res.status(404).json({ message: "Hotel not found" });
      }

      const settings = await getSettings();
      const timeZone = propertyTimeZone(settings);
      const checkIn = calendarDateOf(req.body.checkIn, timeZone);
      const checkOut = calendarDateOf(req.body.checkOut, timeZone);
      const nights = diffNights(checkIn, checkOut);
      if (nights < 1) {
        return res.status(400).json({
          message: "checkOut must be at least one night after checkIn",
        });
      }

      const adultCount = Number(req.body.adultCount);
      const childCount = Number(req.body.childCount);

      let roomType: RoomType | null = null;
      if (req.body.roomTypeId) {
        const [row] = await db
          .select()
          .from(roomTypes)
          .where(
            and(
              eq(roomTypes._id, String(req.body.roomTypeId)),
              eq(roomTypes.hotelId, hotelId)
            )
          )
          .limit(1);
        if (!row) {
          return res.status(404).json({ message: "Room type not found" });
        }
        roomType = row;
      }

      // Read-only availability check for a fast, friendly failure; the
      // booking transaction re-checks atomically (that's the real gate).
      const availability = roomType
        ? await checkRoomTypeAvailability({
            roomType,
            checkIn,
            checkOut,
            guestAdults: adultCount,
            guestChildren: childCount,
          })
        : await checkCapacity({
            hotel,
            checkIn,
            checkOut,
            guestAdults: adultCount,
            guestChildren: childCount,
          });
      if (!availability.ok) {
        return res.status(409).json({ message: availability.message });
      }

      let quote;
      try {
        quote = quoteNights({
          pricePerNight: roomType ? roomType.basePrice : hotel.pricePerNight,
          nights,
          settings,
        });
      } catch (error) {
        return res.status(400).json({
          message: error instanceof Error ? error.message : "Invalid stay",
        });
      }

      // Optional client cross-check — never the source of truth.
      if (req.body.totalCost !== undefined && req.body.totalCost !== null && req.body.totalCost !== "") {
        const clientTotal = Number(req.body.totalCost);
        if (
          Number.isFinite(clientTotal) &&
          Math.abs(clientTotal - quote.totalStored) > 0.01
        ) {
          return res.status(400).json({
            message:
              "The price changed since the page was loaded. Please refresh and try again.",
          });
        }
      }

      const providerId = req.body.providerId
        ? String(req.body.providerId)
        : DEFAULT_PROVIDER_ID;
      const runtime = await getProviderRuntime(providerId);
      if (!runtime) {
        return res.status(400).json({ message: "Unknown payment method" });
      }
      if (!runtime.enabled) {
        return res.status(400).json({
          message: `${runtime.provider.displayName} is not available for this property`,
        });
      }
      if (!runtime.provider.isConfigured(runtime.config)) {
        return res.status(503).json({
          message: `${runtime.provider.displayName} is not configured`,
        });
      }

      const guest = {
        firstName: String(req.body.firstName).trim(),
        lastName: String(req.body.lastName).trim(),
        email: req.body.email ? String(req.body.email).trim() : "",
        phone: req.body.phone ? String(req.body.phone).trim() : null,
      };
      const source = (req.body.source as any) || "web";

      // How much is due up front per the prepayment policy.
      const prepayStored = Math.min(
        quote.totalStored,
        Math.max(0, quote.deposit)
      );

      // --- Pay at arrival: nothing up front, booking confirmed -------------
      if (providerId === "pay-at-arrival") {
        const booking = await createBooking({
          userId: req.userId,
          hotel,
          guest,
          adultCount,
          childCount,
          checkIn,
          checkOut,
          roomTypeId: roomType?._id ?? null,
          totalStored: quote.totalStored,
          depositAmount: 0,
          balanceAmount: quote.totalStored,
          currency: settings.currency,
          source,
          status: "confirmed",
          paymentStatus: "pending",
          paymentMethod: providerId,
          specialRequests: req.body.specialRequests ?? null,
          ledger:
            quote.totalStored > 0
              ? {
                  providerId,
                  type: "balance",
                  amount: quote.totalStored,
                  status: "pending",
                }
              : undefined,
        });
        return res.status(201).json({
          booking,
          payment: {
            providerId,
            status: "pending",
            message: "Payment is due at the property.",
          },
        });
      }

      // --- Everything else: create the intent, then the booking ------------
      const charged = chargedAmountFor(providerId, prepayStored, settings);
      if (runtime.provider.kind === "online" && charged.amount <= 0) {
        return res.status(400).json({
          message:
            "Nothing is due online for this stay — choose pay at arrival instead.",
        });
      }

      const intent = await runtime.provider.createIntent({
        amount: charged.amount,
        currency: charged.currency,
        metadata: {
          hotelId,
          userId: req.userId,
          providerId,
          nights: String(nights),
          totalStored: String(quote.totalStored),
        },
        config: runtime.config,
      });

      // --- Bank transfer: booking pending until a manager confirms ---------
      if (runtime.provider.kind === "onsite") {
        const booking = await createBooking({
          userId: req.userId,
          hotel,
          guest,
          adultCount,
          childCount,
          checkIn,
          checkOut,
          roomTypeId: roomType?._id ?? null,
          totalStored: quote.totalStored,
          depositAmount: prepayStored,
          balanceAmount: Math.max(0, quote.totalStored - prepayStored),
          currency: settings.currency,
          source,
          status: prepayStored > 0 ? "pending" : "confirmed",
          paymentStatus: "pending",
          paymentMethod: providerId,
          specialRequests: req.body.specialRequests ?? null,
          ledger:
            prepayStored > 0
              ? {
                  providerId,
                  type: "deposit",
                  amount: prepayStored,
                  status: "pending",
                  providerRef: intent.intentId,
                  currency: charged.currency,
                  raw: { instructions: runtime.provider.publicDetails?.(runtime.config) },
                }
              : undefined,
        });
        return res.status(201).json({
          booking,
          payment: {
            providerId,
            status: "pending",
            intentId: intent.intentId,
            message:
              "Awaiting bank transfer confirmation — the property will confirm your booking once the transfer arrives.",
            details: runtime.provider.publicDetails?.(runtime.config),
          },
        });
      }

      // --- Online: hold the booking, then capture the payment --------------
      const booking = await createBooking({
        userId: req.userId,
        hotel,
        guest,
        adultCount,
        childCount,
        checkIn,
        checkOut,
        roomTypeId: roomType?._id ?? null,
        totalStored: quote.totalStored,
        depositAmount: prepayStored,
        balanceAmount: Math.max(0, quote.totalStored - prepayStored),
        currency: settings.currency,
        source,
        status: "pending",
        paymentStatus: "pending",
        paymentMethod: providerId,
        specialRequests: req.body.specialRequests ?? null,
        ledger: {
          providerId,
          type: "charge",
          amount: charged.amount,
          currency: charged.currency,
          status: "pending",
          providerRef: intent.intentId,
          raw: { intent: intent.raw ?? null },
        },
      });

      const confirmed = await runtime.provider.confirm(intent.intentId, {
        amount: charged.amount,
        currency: charged.currency,
        config: runtime.config,
      });

      if (confirmed.status === "failed") {
        await markPaymentFailed({
          providerId,
          intentId: intent.intentId,
          raw: confirmed.raw ?? confirmed.message,
          cancelBooking: true,
        });
        return res.status(402).json({
          message: confirmed.message || "Payment failed. Please try again.",
        });
      }

      if (confirmed.status === "pending") {
        // Awaiting an asynchronous confirmation (webhook) — booking is held.
        return res.status(201).json({
          booking,
          payment: {
            providerId,
            status: "pending",
            intentId: intent.intentId,
            clientSecret: intent.clientSecret,
            message:
              confirmed.message ||
              "Payment is being processed — you'll be notified once confirmed.",
          },
        });
      }

      const outcome = await markPaymentSucceeded({
        providerId,
        intentId: intent.intentId,
        raw: confirmed.raw ?? { mode: "confirm" },
      });

      return res.status(201).json({
        booking: outcome?.booking ?? booking,
        payment: {
          providerId,
          status: "succeeded",
          intentId: intent.intentId,
        },
      });
    } catch (error) {
      if (error instanceof BookingConflictError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof PaymentConfigError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ProviderError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ message: "Unable to create booking" });
    }
  }
);

/**
 * @swagger
 * /api/bookings:
 *   get:
 *     summary: Get all bookings (admin only)
 *     description: Returns all bookings in the system. Admin role is required.
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of bookings returned successfully.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user is not an admin.
 *       500:
 *         description: Unable to fetch bookings.
 */
// Get all bookings (admin only)
router.get(
  "/",
  verifyToken,
  requireRole("admin"),
  async (req: any, res: Response) => {
    try {
      const rows = await db
        .select()
        .from(bookings)
        .orderBy(desc(bookings.createdAt));

      const populated = await populateHotel(rows, ["name", "city", "country"]);

      res.status(200).json(populated);
    } catch (error) {
      res.status(500).json({ message: "Unable to fetch bookings" });
    }
  }
);


/**
 * @swagger
 * /api/bookings/hotel/{hotelId}:
 *   get:
 *     summary: Get bookings for a specific hotel (hotel owner only)
 *     description: Returns all bookings for a given hotel. Only the owner of the hotel (or admin, ako dodaš) može pristupiti.
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: hotelId
 *         required: true
 *         description: ID of the hotel.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of bookings for the hotel.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user is not the owner of this hotel.
 *       404:
 *         description: Hotel not found.
 *       500:
 *         description: Unable to fetch hotel bookings.
 */
// Get bookings by hotel ID (for hotel owners)
router.get(
  "/hotel/:hotelId",
  verifyToken,
  requireRole("hotel_owner"),
  async (req: Request, res: Response) => {
    try {
      const { hotelId } = req.params;

      // Verify the hotel belongs to the authenticated user
      const [hotel] = await db
        .select()
        .from(hotels)
        .where(eq(hotels._id, hotelId))
        .limit(1);
      if (!hotel) {
        return res.status(404).json({ message: "Hotel not found" });
      }

      // preporuka: hotel.userId.toString() === req.userId
      if (hotel.userId !== req.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const rows = await db
        .select()
        .from(bookings)
        .where(eq(bookings.hotelId, hotelId))
        .orderBy(desc(bookings.createdAt));

      const populated = await populateUser(rows, [
        "firstName",
        "lastName",
        "email",
      ]);

      res.status(200).json(populated);
    } catch (error) {
      res.status(500).json({ message: "Unable to fetch hotel bookings" });
    }
  }
);

/**
 * @swagger
 * /api/bookings/{id}:
 *   get:
 *     summary: Get booking by ID
 *     description: Returns booking details by its ID. RBAC logika treba da odluči ko smije vidjeti (user, hotel_owner, admin).
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking ID.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking details.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user has no access to this booking.
 *       404:
 *         description: Booking not found.
 *       500:
 *         description: Unable to fetch booking.
 */
// Get booking by ID
router.get(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const [row] = await db
        .select()
        .from(bookings)
        .where(eq(bookings._id, req.params.id))
        .limit(1);

      if (!row) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const access = await getBookingAccess(row, req.userId, req.userRole);
      if (access === "none") {
        return res.status(403).json({ message: "Access denied" });
      }

      const populated = await populateHotel([row], [
        "name",
        "city",
        "country",
        "imageUrls",
      ]);

      res.status(200).json(populated[0]);
    } catch (error) {
      res.status(500).json({ message: "Unable to fetch booking" });
    }
  }
);

/**
 * @swagger
 * /api/bookings/{id}/status:
 *   patch:
 *     summary: Update booking status
 *     description: Updates the status of a booking (pending, confirmed, cancelled, completed, refunded). Dozvole zavise od uloge (user/owner/admin).
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking ID.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, confirmed, cancelled, completed, refunded]
 *               cancellationReason:
 *                 type: string
 *               refundAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Booking status updated.
 *       400:
 *         description: Validation error.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user has no access to update this booking.
 *       404:
 *         description: Booking not found.
 *       500:
 *         description: Unable to update booking status.
 */
// Update booking status
router.patch(
  "/:id/status",
  verifyToken,
  [
    body("status")
      .isIn([
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "refunded",
        "checked_in",
        "checked_out",
        "no_show",
      ])
      .withMessage("Invalid status"),
    body("refundAmount")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("refundAmount must be a non-negative number"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { status, cancellationReason } = req.body;

      const [existing] = await db
        .select()
        .from(bookings)
        .where(eq(bookings._id, req.params.id))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const access = await getBookingAccess(existing, req.userId, req.userRole);
      if (access === "none") {
        return res.status(403).json({ message: "Access denied" });
      }
      if (access === "self" && status !== "cancelled") {
        return res
          .status(403)
          .json({ message: "You can only cancel your own bookings" });
      }
      if (access === "hotel" && !OWNER_STATUSES.includes(status)) {
        return res.status(403).json({
          message: `Not allowed to set status "${status}"`,
        });
      }

      const updateData: any = { status };
      if (status === "cancelled" && cancellationReason) {
        updateData.cancellationReason = cancellationReason;
      }
      if (status === "refunded") {
        updateData.refundAmount = req.body.refundAmount || 0;
      }

      // Inventory follows the status machine: cancelling a held booking
      // releases its nights; restoring a cancelled booking must re-reserve
      // them (and fails with 409 if someone else took the room meanwhile).
      const booking = await db.transaction(async (tx) => {
        const releasing =
          status === "cancelled" &&
          INVENTORY_HOLDING_STATUSES.includes(existing.status);

        const restoring =
          existing.status === "cancelled" &&
          INVENTORY_HOLDING_STATUSES.includes(status);

        if (releasing) {
          await releaseBookingInventory({
            executor: tx as unknown as typeof db,
            booking: existing,
          });
        }
        if (restoring) {
          const revalidated = await revalidateBookingInventory({
            executor: tx as unknown as typeof db,
            booking: existing,
          });
          if (!revalidated.ok) {
            throw new BookingConflictError(revalidated.message);
          }
        }

        const [updated] = await tx
          .update(bookings)
          .set(updateData)
          .where(eq(bookings._id, req.params.id))
          .returning();
        return updated;
      });

      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      res.status(200).json(booking);
    } catch (error) {
      if (error instanceof BookingConflictError) {
        return res.status(409).json({ message: error.message });
      }
      res.status(500).json({ message: "Unable to update booking" });
    }
  }
);

/**
 * @swagger
 * /api/bookings/{id}/payment:
 *   patch:
 *     summary: Update booking payment status
 *     description: Updates the payment status for a booking (pending, paid, failed, refunded).
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking ID.
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentStatus:
 *                 type: string
 *                 enum: [pending, paid, failed, refunded]
 *               paymentMethod:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment status updated.
 *       400:
 *         description: Validation error.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user has no access to update this payment.
 *       404:
 *         description: Booking not found.
 *       500:
 *         description: Unable to update payment status.
 */
// Update payment status
router.patch(
  "/:id/payment",
  verifyToken,
  [
    body("paymentStatus")
      .isIn([
        "pending",
        "paid",
        "failed",
        "refunded",
        "deposit_paid",
        "partially_refunded",
      ])
      .withMessage("Invalid payment status"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { paymentStatus, paymentMethod } = req.body;

      const [existing] = await db
        .select()
        .from(bookings)
        .where(eq(bookings._id, req.params.id))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // Recording a payment is strictly a management action — a guest can
      // never mark their own booking as paid.
      const access = await getBookingAccess(existing, req.userId, req.userRole);
      if (access !== "full" && access !== "hotel") {
        return res.status(403).json({
          message: "Only the property manager or an admin can record payments",
        });
      }

      const updateData: any = { paymentStatus };
      if (paymentMethod) {
        updateData.paymentMethod = paymentMethod;
      }

      const [booking] = await db
        .update(bookings)
        .set(updateData)
        .where(eq(bookings._id, req.params.id))
        .returning();

      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      res.status(200).json(booking);
    } catch (error) {
      res.status(500).json({ message: "Unable to update payment status" });
    }
  }
);

/**
 * @swagger
 * /api/bookings/{id}:
 *   delete:
 *     summary: Delete booking (admin only)
 *     description: Deletes a booking and updates related analytics. Only admin can delete bookings.
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking ID.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking deleted successfully.
 *       401:
 *         description: Unauthorized – missing or invalid token.
 *       403:
 *         description: Forbidden – user is not an admin.
 *       404:
 *         description: Booking not found.
 *       500:
 *         description: Unable to delete booking.
 */
// Delete booking (admin only)
router.delete(
  "/:id",
  verifyToken,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      // Booking row + both analytics counters move together or not at all.
      const result = await db.transaction(async (tx) => {
        const [booking] = await tx
          .delete(bookings)
          .where(eq(bookings._id, req.params.id))
          .returning();

        if (!booking) return null;

        // Held bookings (pending/confirmed) give their rooms back on delete.
        await releaseBookingInventory({
          executor: tx as unknown as typeof db,
          booking,
        });

        const totalCost = booking.totalCost || 0;

        await tx
          .update(hotels)
          .set({
            totalBookings: sql`${hotels.totalBookings} - 1`,
            totalRevenue: sql`${hotels.totalRevenue} - ${totalCost}`,
          })
          .where(eq(hotels._id, booking.hotelId));

        await tx
          .update(users)
          .set({
            totalBookings: sql`${users.totalBookings} - 1`,
            totalSpent: sql`${users.totalSpent} - ${totalCost}`,
          })
          .where(eq(users._id, booking.userId));

        return booking;
      });

      if (!result) {
        return res.status(404).json({ message: "Booking not found" });
      }

      res.status(200).json({ message: "Booking deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete booking" });
    }
  }
);

export default router;
