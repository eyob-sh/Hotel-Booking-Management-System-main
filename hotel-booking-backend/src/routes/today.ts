import express, { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, bookings, hotels } from "../db";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { calendarDateOf, getSettings, propertyTimeZone } from "../services/settings";

const router = express.Router();

router.get(
  "/hotels/:hotelId/today",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId);
      const [hotel] = await db.select().from(hotels).where(eq(hotels._id, hotelId)).limit(1);
      if (!hotel) return res.status(404).json({ message: "Hotel not found" });
      if (req.userRole !== "admin" && hotel.userId !== req.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const settings = await getSettings();
      const tz = propertyTimeZone(settings);
      const today = calendarDateOf(new Date().toISOString(), tz);

      const rows = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.hotelId, hotelId), inArray(bookings.status, ["confirmed", "checked_in", "checked_out", "pending"])));

      const arrivals = rows.filter((b: any) => b.checkIn === today);
      const departures = rows.filter((b: any) => b.checkOut === today);

      res.status(200).json({ today, arrivals, departures });
    } catch (error) {
      res.status(500).json({ message: "Unable to load today summary" });
    }
  }
);

export default router;
