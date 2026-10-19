import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { and, eq } from "drizzle-orm";
import { db, hotels, roomTypes } from "../db";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { createBooking } from "../services/booking";
import {
  calendarDateOf,
  diffNights,
  getSettings,
  propertyTimeZone,
} from "../services/settings";
import { quoteNights } from "../services/pricing";
import {
  checkCapacity,
  checkRoomTypeAvailability,
} from "../services/availability";

const router = express.Router();

/** Manual booking for owners/admins at the desk (walk-in/phone). */
router.post(
  "/manual",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  [
    body("hotelId").notEmpty().withMessage("hotelId is required"),
    body("roomTypeId")
      .optional({ values: "falsy" })
      .isUUID()
      .withMessage("roomTypeId must be a UUID"),
    body("checkIn").notEmpty().withMessage("checkIn is required").isISO8601(),
    body("checkOut").notEmpty().withMessage("checkOut is required").isISO8601(),
    body("adultCount").isInt({ min: 1, max: 100 }).withMessage("adultCount invalid").toInt(),
    body("childCount").isInt({ min: 0, max: 100 }).withMessage("childCount invalid").toInt(),
    body("firstName").trim().notEmpty().withMessage("firstName is required"),
    body("lastName").trim().notEmpty().withMessage("lastName is required"),
    body("phone")
      .trim()
      .notEmpty()
      .withMessage("phone is required")
      .matches(/^\+?[0-9][0-9\s\-()]{5,19}$/),
    body("email").optional({ values: "falsy" }).trim().isEmail(),
    body("source")
      .optional({ values: "falsy" })
      .isIn(["web", "phone", "walkin", "telegram"]),
    body("paymentMethod")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 64 }),
    body("totalCost").optional({ values: "falsy" }).isFloat({ min: 0 }),
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
      if (!hotel) return res.status(404).json({ message: "Hotel not found" });

      // Only admin or owner of the hotel may create manual bookings.
      if (req.userRole !== "admin") {
        if (hotel.userId !== req.userId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const settings = await getSettings();
      const timeZone = propertyTimeZone(settings);
      const checkIn = calendarDateOf(req.body.checkIn, timeZone);
      const checkOut = calendarDateOf(req.body.checkOut, timeZone);
      const nights = diffNights(checkIn, checkOut);
      if (nights < 1) {
        return res.status(400).json({ message: "checkOut must be at least one night after checkIn" });
      }

      const adultCount = Number(req.body.adultCount);
      const childCount = Number(req.body.childCount);

      let roomType: any = null;
      if (req.body.roomTypeId) {
        const [row] = await db
          .select()
          .from(roomTypes)
          .where(and(eq(roomTypes._id, String(req.body.roomTypeId)), eq(roomTypes.hotelId, hotelId)))
          .limit(1);
        if (!row) return res.status(404).json({ message: "Room type not found" });
        roomType = row;
      }

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

      if (req.body.totalCost !== undefined && req.body.totalCost !== null && req.body.totalCost !== "") {
        const clientTotal = Number(req.body.totalCost);
        if (Number.isFinite(clientTotal) && Math.abs(clientTotal - quote.totalStored) > 0.01) {
          return res.status(400).json({
            message: "The price changed. Please verify the total.",
          });
        }
      }

      const providerId = String(req.body.paymentMethod ?? "pay-at-arrival");
      const prepayStored = Math.min(quote.totalStored, Math.max(0, quote.deposit));

      const booking = await createBooking({
        userId: req.userId ?? null,
        hotel,
        guest: {
          firstName: String(req.body.firstName).trim(),
          lastName: String(req.body.lastName).trim(),
          email: req.body.email ? String(req.body.email).trim() : "",
          phone: String(req.body.phone).trim(),
        },
        adultCount,
        childCount,
        checkIn,
        checkOut,
        roomTypeId: roomType?._id ?? null,
        totalStored: quote.totalStored,
        depositAmount: 0,
        balanceAmount: quote.totalStored,
        currency: settings.currency,
        source: (req.body.source as any) || "walkin",
        status: "confirmed",
        paymentStatus: "pending",
        paymentMethod: providerId,
        specialRequests: req.body.specialRequests ?? null,
        ledger:
          providerId === "pay-at-arrival" && quote.totalStored > 0
            ? {
                providerId,
                type: "balance",
                amount: quote.totalStored,
                status: "pending",
              }
            : prepayStored > 0
            ? {
                providerId,
                type: "deposit",
                amount: prepayStored,
                status: "pending",
                providerRef: `manual_${Date.now()}`,
              }
            : undefined,
      });

      res.status(201).json({ booking });
    } catch (error) {
      const { BookingConflictError } = await import("../services/booking");
      const { PaymentConfigError } = await import("../services/payments");
      const { ProviderError } = await import("../payments/types");
      if (error instanceof BookingConflictError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof PaymentConfigError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ProviderError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ message: "Unable to create manual booking" });
    }
  }
);

export default router;
