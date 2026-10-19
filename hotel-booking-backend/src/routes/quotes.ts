import express, { Request, Response } from "express";
import { db, hotels, roomTypes } from "../db";
import { and, eq } from "drizzle-orm";
import { body, validationResult } from "express-validator";
import type { RoomType } from "../db/schema";
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
import rateLimit from "express-rate-limit";

const router = express.Router();

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many quote requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * tags:
 *   - name: Quotes
 *     description: Availability + server-side price quotes (no booking side effects)
 */

/**
 * @swagger
 * /api/quotes:
 *   post:
 *     summary: Quote a stay (availability + price breakdown)
 *     description: >
 *       Server-authoritative pricing. Returns availability plus the total,
 *       deposit and balance for the requested dates, room type and guests.
 *       Nothing is written to the database.
 *     tags: [Quotes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hotelId, checkIn, checkOut, adultCount, childCount]
 *             properties:
 *               hotelId: { type: string }
 *               roomTypeId: { type: string }
 *               checkIn: { type: string, format: date }
 *               checkOut: { type: string, format: date }
 *               adultCount: { type: integer }
 *               childCount: { type: integer }
 *               displayCurrency: { type: string }
 *     responses:
 *       200:
 *         description: Availability result (available true/false) with quote.
 *       400:
 *         description: Validation error.
 *       404:
 *         description: Hotel or room type not found.
 */
router.post(
  "/",
  quoteLimiter,
  [
    body("hotelId").notEmpty().withMessage("hotelId is required"),
    body("roomTypeId").optional({ values: "falsy" }).isUUID().withMessage("roomTypeId must be a UUID"),
    body("checkIn")
      .notEmpty().withMessage("checkIn is required")
      .isISO8601().withMessage("checkIn must be a valid ISO date"),
    body("checkOut")
      .notEmpty().withMessage("checkOut is required")
      .isISO8601().withMessage("checkOut must be a valid ISO date"),
    body("adultCount")
      .isInt({ min: 1, max: 100 }).withMessage("adultCount must be between 1 and 100")
      .toInt(),
    body("childCount")
      .isInt({ min: 0, max: 100 }).withMessage("childCount must be between 0 and 100")
      .toInt(),
    body("displayCurrency")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 8 }).withMessage("displayCurrency is too long"),
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

      // Optional room type — must belong to this property.
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
        return res.status(200).json({
          available: false,
          message: availability.message,
          nights,
          currency: settings.currency,
        });
      }

      let quote;
      try {
        quote = quoteNights({
          pricePerNight: roomType ? roomType.basePrice : hotel.pricePerNight,
          nights,
          settings,
          displayCurrency: req.body.displayCurrency
            ? String(req.body.displayCurrency)
            : undefined,
        });
      } catch (error) {
        return res.status(400).json({
          message: error instanceof Error ? error.message : "Invalid stay",
        });
      }

      return res.status(200).json({
        available: true,
        nights,
        currency: settings.currency,
        quote,
        roomType: roomType
          ? {
              _id: roomType._id,
              name: roomType.name,
              maxAdults: roomType.maxAdults,
              maxChildren: roomType.maxChildren,
              basePrice: roomType.basePrice,
            }
          : null,
        hotel: {
          _id: hotel._id,
          name: hotel.name,
          currency: settings.currency,
          checkInTime: settings.checkInTime,
          checkOutTime: settings.checkOutTime,
        },
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to quote this stay" });
    }
  }
);

export default router;
