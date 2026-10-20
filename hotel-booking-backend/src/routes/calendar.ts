import express, { Request, Response } from "express";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db, bookings, hotels, roomTypes, roomInventory } from "../db";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { calendarDateOf, getSettings, propertyTimeZone } from "../services/settings";

const router = express.Router();

router.get(
  "/hotels/:hotelId/calendar",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (req: Request, res: Response) => {
    try {
      const hotelId = String(req.params.hotelId);
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");

      const [hotel] = await db.select().from(hotels).where(eq(hotels._id, hotelId)).limit(1);
      if (!hotel) return res.status(404).json({ message: "Hotel not found" });
      if (req.userRole !== "admin" && hotel.userId !== req.userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const settings = await getSettings();
      const tz = propertyTimeZone(settings);
      const start = from || calendarDateOf(now.toISOString(), tz);
      const end = to || calendarDateOf(new Date(now.getTime() + 45 * 864e5).toISOString(), tz);

      const rtRows = await db.select().from(roomTypes).where(eq(roomTypes.hotelId, hotelId));
      const roomTypeIds = rtRows.map((r) => r._id);

      const nights: string[] = [];
      const c = new Date(`${start}T00:00:00.000Z`);
      const e = new Date(`${end}T00:00:00.000Z`);
      for (let i = 0; c <= e && i < 120; i++) {
        nights.push(c.toISOString().slice(0, 10));
        c.setUTCDate(c.getUTCDate() + 1);
      }

      const [inv, bks] = await Promise.all([
        roomTypeIds.length && nights.length
          ? db
              .select()
              .from(roomInventory)
              .where(
                and(
                  inArray(roomInventory.roomTypeId, roomTypeIds),
                  gte(roomInventory.date, start),
                  lte(roomInventory.date, end)
                )
              )
          : [],
        db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.hotelId, hotelId),
              lte(bookings.checkIn, end),
              gte(bookings.checkOut, start)
            )
          ),
      ]);

      const byInv = new Map<string, number>();
      inv.forEach((row: any) => {
        byInv.set(`${row.roomTypeId}:${row.date}`, Number(row.reserved));
      });

      res.status(200).json({
        hotelId,
        from: start,
        to: end,
        roomTypes: rtRows,
        nights,
        inventory: byInv,
        bookings: bks,
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load calendar" });
    }
  }
);

export default router;
