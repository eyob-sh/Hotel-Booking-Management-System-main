import express from "express";
import { db, reviews, hotels, bookings } from "../db";
import { and, avg, count, desc, eq } from "drizzle-orm";
import verifyToken from "../middleware/auth";

const router = express.Router();

/**
 * @swagger
 * /api/reviews/{hotelId}:
 *   post:
 *     summary: Create a review for a hotel
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: hotelId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating, comment, categories]
 *             properties:
 *               rating:
 *                 type: number
 *                 example: 5
 *               comment:
 *                 type: string
 *               categories:
 *                 type: object
 *                 properties:
 *                   cleanliness: { type: number, example: 5 }
 *                   service: { type: number, example: 5 }
 *                   location: { type: number, example: 4 }
 *                   value: { type: number, example: 5 }
 *                   amenities: { type: number, example: 4 }
 *     responses:
 *       201:
 *         description: Review created
 *       401:
 *         description: Unauthorized
 */
router.post("/:hotelId", verifyToken, async (req, res) => {
  try {
    const { rating, comment, categories } = req.body;
    const userId = req.userId;
    const hotelId = req.params.hotelId;

    const [booking] = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, userId),
          eq(bookings.hotelId, hotelId),
          eq(bookings.paymentStatus, "paid")
        )
      )
      .limit(1);

    if (!booking) {
      return res.status(403).json({
        message: "You can only review hotels you have stayed in",
      });
    }

    const [existingReview] = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.hotelId, hotelId)))
      .limit(1);

    if (existingReview) {
      return res.status(400).json({
        message: "You already reviewed this hotel",
      });
    }

    const [review] = await db
      .insert(reviews)
      .values({
        userId,
        hotelId,
        bookingId: booking._id,
        rating,
        comment,
        categories,
        isVerified: true,
      })
      .returning();

    const stats = await db
      .select({
        avgRating: avg(reviews.rating),
        count: count(),
      })
      .from(reviews)
      .where(eq(reviews.hotelId, hotelId));

    await db
      .update(hotels)
      .set({
        averageRating: Number(stats[0]?.avgRating ?? 0),
        reviewCount: Number(stats[0]?.count ?? 0),
      })
      .where(eq(hotels._id, hotelId));

    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ message: "Unable to create review" });
  }
});

/**
 * @swagger
 * /api/reviews/{hotelId}:
 *   get:
 *     summary: Get all reviews for a hotel
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: hotelId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of reviews
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   userId:
 *                     type: string
 *                   rating:
 *                     type: number
 *                   comment:
 *                     type: string
 *                   categories:
 *                     type: object
 *                     properties:
 *                       cleanliness: { type: number }
 *                       service: { type: number }
 *                       location: { type: number }
 *                       value: { type: number }
 *                       amenities: { type: number }
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       404:
 *         description: No reviews found
 */
router.get("/:hotelId", async (req, res) => {
  try {
    const { hotelId } = req.params;

    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.hotelId, hotelId))
      .orderBy(desc(reviews.createdAt));

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Unable to fetch reviews" });
  }
});

export default router;
