import express, { Request, Response } from "express";
import { db, hotels, roomTypes } from "../db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { HotelSearchResponse, HotelType } from "../../../shared/types";
import { body, param, validationResult } from "express-validator";
import verifyToken from "../middleware/auth";
import {
  calendarDateOf,
  diffNights,
  getSettings,
  propertyTimeZone,
} from "../services/settings";
import { quoteNights } from "../services/pricing";
import { createBooking, BookingConflictError } from "../services/booking";
import {
  PaymentConfigError,
  getStripe,
  resolveChargePlan,
} from "../services/payments";
import rateLimit from "express-rate-limit";

const router = express.Router();

// Creating bookings is expensive (transaction + money): keep the abuse window
// tight. General API limiting (200/15min) still applies on top of this.
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many booking attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * tags:
 *   - name: Hotels
 *     description: Public hotel search & details
 *   - name: HotelBookings
 *     description: Payment and booking operations for a selected hotel
 */

/**
 * @swagger
 * /api/hotels/search:
 *   get:
 *     summary: Search hotels using various filters
 *     tags: [Hotels]
 *     parameters:
 *       - name: destination
 *         in: query
 *         schema:
 *           type: string
 *         description: City or country
 *       - name: facilities
 *         in: query
 *         schema:
 *           type: array
 *           items: { type: string }
 *         description: Facility filter (array or single)
 *       - name: types
 *         in: query
 *         schema:
 *           type: array
 *           items: { type: string }
 *         description: Hotel types
 *       - name: stars
 *         in: query
 *         schema:
 *           type: array
 *           items: { type: number }
 *       - name: maxPrice
 *         in: query
 *         schema:
 *           type: number
 *       - name: sortOption
 *         in: query
 *         schema:
 *           type: string
 *           enum: [starRating, pricePerNightAsc, pricePerNightDesc]
 *       - name: page
 *         in: query
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of filtered hotels with pagination metadata
 *       500:
 *         description: Something went wrong
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const where = constructSearchQuery(req.query);

    let orderBy;
    switch (req.query.sortOption) {
      case "starRating":
        orderBy = desc(hotels.starRating);
        break;
      case "pricePerNightAsc":
        orderBy = asc(hotels.pricePerNight);
        break;
      case "pricePerNightDesc":
        orderBy = desc(hotels.pricePerNight);
        break;
    }

    const pageSize = 5;
    const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1");
    const skip = (pageNumber - 1) * pageSize;

    let searchQuery = db.select().from(hotels).$dynamic();
    if (where) {
      searchQuery = searchQuery.where(where);
    }
    if (orderBy) {
      searchQuery = searchQuery.orderBy(orderBy);
    }
    const data = await searchQuery.limit(pageSize).offset(skip);

    let countQuery = db.select({ value: count() }).from(hotels).$dynamic();
    if (where) {
      countQuery = countQuery.where(where);
    }
    const countResult = await countQuery;
    const total = Number(countResult[0].value);

    const response: HotelSearchResponse = {
      data: data as unknown as HotelType[],
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: "Something went wrong" });
  }
});

/**
 * @swagger
 * /api/hotels:
 *   get:
 *     summary: Get all hotels (public)
 *     tags: [Hotels]
 *     responses:
 *       200:
 *         description: Successfully retrieved hotel list
 *       500:
 *         description: Error fetching hotels
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(hotels)
      .orderBy(desc(hotels.lastUpdated));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Error fetching hotels" });
  }
});

/**
 * @swagger
 * /api/hotels/{id}:
 *   get:
 *     summary: Get hotel details by ID
 *     tags: [Hotels]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Hotel ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Hotel details returned
 *       400:
 *         description: Validation error
 *       500:
 *         description: Something went wrong
 */
router.get(
  "/:id",
  [param("id").notEmpty().withMessage("Hotel ID is required")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const id = req.params.id.toString();

    try {
      const [hotel] = await db
        .select()
        .from(hotels)
        .where(eq(hotels._id, id))
        .limit(1);
      if (!hotel) {
        return res.json(null);
      }

      // Room types make the property bookable (Phase 1 checkout). Only active
      // ones are public; owners manage the full list via /api/my-hotels.
      const rooms = await db
        .select({
          _id: roomTypes._id,
          name: roomTypes.name,
          description: roomTypes.description,
          maxAdults: roomTypes.maxAdults,
          maxChildren: roomTypes.maxChildren,
          basePrice: roomTypes.basePrice,
          roomCount: roomTypes.roomCount,
          photos: roomTypes.photos,
          sortOrder: roomTypes.sortOrder,
        })
        .from(roomTypes)
        .where(and(eq(roomTypes.hotelId, id), eq(roomTypes.active, true)))
        .orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));

      res.json({ ...hotel, roomTypes: rooms });
    } catch (error) {
      res.status(500).json({ message: "Error fetching hotel" });
    }
  }
);

/**
 * @swagger
 * /api/hotels/{hotelId}/bookings/payment-intent:
 *   post:
 *     summary: Create a Stripe payment intent for a hotel booking
 *     tags: [HotelBookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hotelId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               numberOfNights:
 *                 type: number
 *                 example: 3
 *     responses:
 *       200:
 *         description: Payment intent created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paymentIntentId: { type: string }
 *                 clientSecret: { type: string }
 *                 totalCost: { type: number }
 *       400:
 *         description: Hotel not found
 *       500:
 *         description: Stripe error or server failure
 */
router.post(
  "/:hotelId/bookings/payment-intent",
  verifyToken,
  [
    body("numberOfNights")
      .optional()
      .isInt({ min: 1 })
      .withMessage("numberOfNights must be an integer >= 1"),

    body("checkIn").optional().isISO8601().withMessage("checkIn must be a valid ISO date"),
    body("checkOut").optional().isISO8601().withMessage("checkOut must be a valid ISO date"),

    body().custom((value) => {
      if (!value?.checkIn && !value?.checkOut && value?.numberOfNights === undefined) {
        throw new Error("Provide checkIn/checkOut (preferred) or numberOfNights");
      }
      if ((value?.checkIn && !value?.checkOut) || (!value?.checkIn && value?.checkOut)) {
        throw new Error("checkIn and checkOut must be provided together");
      }
      return true;
    }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const hotelId = req.params.hotelId;

      const [hotel] = await db
        .select()
        .from(hotels)
        .where(eq(hotels._id, hotelId))
        .limit(1);
      if (!hotel) {
        return res.status(400).json({ message: "Hotel not found" });
      }

      const settings = await getSettings();
      const timeZone = propertyTimeZone(settings);

      // Server-computed nights: from the actual dates when provided,
      // otherwise from numberOfNights (legacy client — the total is still
      // re-derived from the dates and re-verified at confirm time).
      let nights: number;
      if (req.body.checkIn && req.body.checkOut) {
        const checkIn = calendarDateOf(req.body.checkIn, timeZone);
        const checkOut = calendarDateOf(req.body.checkOut, timeZone);
        nights = diffNights(checkIn, checkOut);
        if (nights < 1) {
          return res
            .status(400)
            .json({ message: "checkOut must be at least one night after checkIn" });
        }
      } else {
        nights = Number(req.body.numberOfNights);
      }

      let quote;
      try {
        quote = quoteNights({
          pricePerNight: hotel.pricePerNight,
          nights,
          settings,
        });
      } catch (error) {
        return res.status(400).json({
          message: error instanceof Error ? error.message : "Invalid stay",
        });
      }

      const stripe = getStripe();
      if (!stripe) {
        return res.status(503).json({
          message:
            "Card payments are not configured. Choose pay-at-arrival or bank transfer.",
        });
      }

      const plan = resolveChargePlan(settings);
      const chargeAmount = plan.toCharge(quote.totalStored);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(chargeAmount * 100),
        currency: plan.currency,
        metadata: {
          hotelId,
          userId: req.userId,
          nights: String(nights),
          totalStored: String(quote.totalStored),
          currency: plan.currency,
        },
      });

      if (!paymentIntent.client_secret) {
        return res.status(500).json({ message: "Error creating payment intent" });
      }

      res.send({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret.toString(),
        totalCost: quote.totalStored,
        nights: quote.nights,
        deposit: quote.deposit,
        balance: quote.balance,
        currency: quote.currency,
      });
    } catch (error) {
      if (error instanceof PaymentConfigError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Something went wrong" });
    }
  }
);

/**
 * @swagger
 * /api/hotels/{hotelId}/bookings:
 *   post:
 *     summary: Confirm a booking after successful Stripe payment
 *     tags: [HotelBookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hotelId
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paymentIntentId:
 *                 type: string
 *               totalCost:
 *                 type: number
 *               startDate:
 *                 type: string
 *               endDate:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking confirmed
 *       400:
 *         description: Payment intent mismatch or unpaid
 *       500:
 *         description: Server error while saving booking
 */
router.post(
  "/:hotelId/bookings",
  verifyToken,
  bookingLimiter,
  [
    body("paymentIntentId")
      .notEmpty()
      .withMessage("paymentIntentId is required"),

    body("firstName")
      .trim()
      .notEmpty()
      .withMessage("firstName is required"),

    body("lastName")
      .trim()
      .notEmpty()
      .withMessage("lastName is required"),

    body("email")
      .isEmail()
      .withMessage("A valid email is required"),

    body("adultCount")
      .isInt({ min: 1, max: 100 })
      .withMessage("adultCount must be between 1 and 100")
      .toInt(),

    body("childCount")
      .isInt({ min: 0, max: 100 })
      .withMessage("childCount must be between 0 and 100")
      .toInt(),

    body("phone")
      .optional({ values: "falsy" })
      .trim()
      .matches(/^\+?[0-9][0-9\s\-()]{5,19}$/)
      .withMessage("phone must be a valid phone number"),

    body("specialRequests")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 2000 })
      .withMessage("specialRequests is too long"),

    body("checkIn")
      .notEmpty().withMessage("checkIn is required")
      .isISO8601().withMessage("checkIn must be a valid ISO date"),

    body("checkOut")
      .notEmpty().withMessage("checkOut is required")
      .isISO8601().withMessage("checkOut must be a valid ISO date"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const hotelId = req.params.hotelId;

      const [hotel] = await db
        .select()
        .from(hotels)
        .where(eq(hotels._id, hotelId))
        .limit(1);
      if (!hotel) {
        return res.status(400).json({ message: "Hotel not found" });
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

      // Server-side quote — the single source of truth for the total.
      let quote;
      try {
        quote = quoteNights({
          pricePerNight: hotel.pricePerNight,
          nights,
          settings,
        });
      } catch (error) {
        return res.status(400).json({
          message: error instanceof Error ? error.message : "Invalid stay",
        });
      }

      // The client's total is never trusted — at most it is cross-checked so
      // a stale page fails loudly instead of silently charging the wrong sum.
      if (
        req.body.totalCost !== undefined &&
        req.body.totalCost !== null &&
        req.body.totalCost !== ""
      ) {
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

      const stripe = getStripe();
      if (!stripe) {
        return res.status(503).json({
          message:
            "Card payments are not configured. Choose pay-at-arrival or bank transfer.",
        });
      }

      const plan = resolveChargePlan(settings);

      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(
          String(req.body.paymentIntentId)
        );
      } catch (error) {
        return res.status(400).json({ message: "payment intent not found" });
      }

      if (!paymentIntent) {
        return res.status(400).json({ message: "payment intent not found" });
      }

      if (
        paymentIntent.metadata.hotelId !== hotelId ||
        paymentIntent.metadata.userId !== req.userId
      ) {
        return res.status(400).json({ message: "payment intent mismatch" });
      }

      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({
          message: `payment intent not succeeded. Status: ${paymentIntent.status}`,
        });
      }

      // Authoritative amount check: what Stripe actually charged must equal
      // what the server computed from its own rates — regardless of anything
      // the client sent.
      const expectedChargeMinor = Math.round(
        plan.toCharge(quote.totalStored) * 100
      );
      if (paymentIntent.currency !== plan.currency) {
        return res.status(409).json({
          message: `Currency mismatch: charged ${paymentIntent.currency}, expected ${plan.currency}.`,
        });
      }
      if (paymentIntent.amount !== expectedChargeMinor) {
        return res.status(409).json({
          message:
            "Payment amount does not match the server-side quote. Please restart checkout.",
        });
      }

      await createBooking({
        userId: req.userId,
        hotel,
        guest: {
          firstName: String(req.body.firstName).trim(),
          lastName: String(req.body.lastName).trim(),
          email: String(req.body.email).trim(),
          phone: req.body.phone ? String(req.body.phone).trim() : null,
        },
        adultCount: Number(req.body.adultCount),
        childCount: Number(req.body.childCount),
        checkIn,
        checkOut,
        totalStored: quote.totalStored,
        status: "confirmed",
        paymentStatus: "paid",
        paymentMethod: "stripe",
        specialRequests: req.body.specialRequests ?? null,
      });

      res.status(200).send();
    } catch (error) {
      if (error instanceof BookingConflictError) {
        return res.status(409).json({ message: error.message });
      }
      if (error instanceof PaymentConfigError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "something went wrong" });
    }
  }
);

const constructSearchQuery = (queryParams: any) => {
  const conditions: any[] = [];

  if (queryParams.destination?.trim()) {
    const destination = `%${queryParams.destination.trim()}%`;
    conditions.push(
      or(ilike(hotels.city, destination), ilike(hotels.country, destination))
    );
  }

  if (queryParams.facilities) {
    const facilities = Array.isArray(queryParams.facilities)
      ? queryParams.facilities
      : [queryParams.facilities];
    conditions.push(sql`${hotels.facilities} @> ${facilities}::text[]`);
  }

  if (queryParams.types) {
    const types = Array.isArray(queryParams.types)
      ? queryParams.types
      : [queryParams.types];
    conditions.push(sql`${hotels.type} && ${types}::text[]`);
  }

  if (queryParams.stars) {
    const starRatings = Array.isArray(queryParams.stars)
      ? queryParams.stars.map((star: string) => parseInt(star))
      : [parseInt(queryParams.stars)];
    conditions.push(inArray(hotels.starRating, starRatings));
  }

  if (queryParams.maxPrice) {
    conditions.push(lte(hotels.pricePerNight, parseInt(queryParams.maxPrice)));
  }

  // Guests capacity filtering
  if (queryParams.adultCount) {
    const adults = parseInt(queryParams.adultCount);
    if (!isNaN(adults)) {
      conditions.push(gte(hotels.adultCount, adults));
    }
  }

  if (queryParams.childCount) {
    const children = parseInt(queryParams.childCount);
    if (!isNaN(children)) {
      conditions.push(gte(hotels.childCount, children));
    }
  }

  if (conditions.length === 0) {
    return undefined;
  }
  return and(...conditions);
};

export default router;
