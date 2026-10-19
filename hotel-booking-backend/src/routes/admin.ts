import express, { Request, Response } from "express";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";

import { db, users, hotels, bookings, favorites } from "../db";
import {
  and,
  avg,
  count,
  eq,
  gt,
  gte,
  inArray,
  sql,
  sum,
} from "drizzle-orm";
import {
  calendarDateOf,
  getSettings,
  propertyTimeZone,
} from "../services/settings";

const router = express.Router();

const rowsOf = async (query: any): Promise<any[]> => {
  const result: any = await db.execute(query);
  return result.rows ?? result;
};

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Admin dashboard overview (KPIs + charts)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/dashboard",
  verifyToken,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const now = new Date();
      // "Still active" is judged against today's calendar date in the
      // property timezone, not the server's UTC/local clock.
      const settings = await getSettings();
      const today = calendarDateOf(now, propertyTimeZone(settings));

      const [
        totalUsersRow,
        totalHotelsRow,
        totalFavoritesRow,
        activeBookingsRow,
        revenueRow,
        avgRatingRow,
      ] = await Promise.all([
        db.select({ value: count() }).from(users),
        db.select({ value: count() }).from(hotels),
        db.select({ value: count() }).from(favorites),
        db
          .select({ value: count() })
          .from(bookings)
          .where(
            and(
              gte(bookings.checkOut, today),
              inArray(bookings.status, ["pending", "confirmed"])
            )
          ),
        db
          .select({ value: sum(bookings.totalCost) })
          .from(bookings)
          .where(eq(bookings.paymentStatus, "paid")),
        db
          .select({ value: avg(hotels.averageRating) })
          .from(hotels)
          .where(gt(hotels.averageRating, 0)),
      ]);

      const totalUsers = Number(totalUsersRow[0]?.value ?? 0);
      const totalHotels = Number(totalHotelsRow[0]?.value ?? 0);
      const totalFavorites = Number(totalFavoritesRow[0]?.value ?? 0);
      const activeBookings = Number(activeBookingsRow[0]?.value ?? 0);
      const totalRevenue = Number(revenueRow[0]?.value ?? 0);
      const avgHotelRating = Number(avgRatingRow[0]?.value ?? 0);

      const twelveMonthsAgo = new Date(
        new Date().setMonth(new Date().getMonth() - 11)
      );

      const bookingsByMonthRows = await rowsOf(sql`
        SELECT to_char(${bookings.createdAt}, 'YYYY-MM') AS month,
               count(*) AS value
        FROM bookings
        WHERE ${bookings.createdAt} >= ${twelveMonthsAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      const revenueByMonthRows = await rowsOf(sql`
        SELECT to_char(${bookings.createdAt}, 'YYYY-MM') AS month,
               coalesce(sum(${bookings.totalCost}), 0) AS value
        FROM bookings
        WHERE ${bookings.createdAt} >= ${twelveMonthsAgo}
          AND ${bookings.paymentStatus} = 'paid'
        GROUP BY 1
        ORDER BY 1 ASC
      `);

      const topRevenueRows = await rowsOf(sql`
        SELECT b."hotelId" AS "hotelId", h."name" AS "name",
               h."city" AS "city",
               sum(b."totalCost") AS revenue, count(*) AS bookings
        FROM bookings b
        LEFT JOIN hotels h ON h."_id" = b."hotelId"
        WHERE b."paymentStatus" = 'paid'
        GROUP BY b."hotelId", h."name", h."city"
        ORDER BY sum(b."totalCost") DESC
        LIMIT 5
      `);

      const topBookingsRows = await rowsOf(sql`
        SELECT b."hotelId" AS "hotelId", h."name" AS "name",
               h."city" AS "city",
               count(*) AS bookings,
               coalesce(sum(b."totalCost"), 0) AS revenue
        FROM bookings b
        LEFT JOIN hotels h ON h."_id" = b."hotelId"
        GROUP BY b."hotelId", h."name", h."city"
        ORDER BY count(*) DESC
        LIMIT 5
      `);

      res.json({
        kpis: {
          totalUsers,
          totalHotels,
          activeBookings,
          totalRevenue,
          avgHotelRating,
          totalFavorites,
        },
        charts: {
          bookingsByMonth: bookingsByMonthRows.map((x) => ({
            month: x.month,
            value: Number(x.value),
          })),
          revenueByMonth: revenueByMonthRows.map((x) => ({
            month: x.month,
            value: Number(x.value),
          })),
          topHotelsByRevenue: topRevenueRows.map((x) => ({
            hotelId: x.hotelId,
            name: x.name,
            city: x.city,
            revenue: Number(x.revenue),
            bookings: Number(x.bookings),
          })),
          topHotelsByBookings: topBookingsRows.map((x) => ({
            hotelId: x.hotelId,
            name: x.name,
            city: x.city,
            bookings: Number(x.bookings),
            revenue: Number(x.revenue),
          })),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ message: "Failed to load admin dashboard" });
    }
  }
);

export default router;
