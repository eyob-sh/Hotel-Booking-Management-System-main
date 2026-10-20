import express, { Request, Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, notifications } from "../db";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { processNotifications, queueCheckInReminders } from "../services/notifications";

const router = express.Router();

router.get(
  "/notifications",
  verifyToken,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const base = db.select().from(notifications);
      const rows = status
        ? await base.where(eq(notifications.status, status as any)).orderBy(desc(notifications.createdAt)).limit(limit)
        : await base.orderBy(desc(notifications.createdAt)).limit(limit);
      res.status(200).json({ notifications: rows });
    } catch (error) {
      res.status(500).json({ message: "Unable to load notifications" });
    }
  }
);

router.post(
  "/notifications/process",
  verifyToken,
  requireRole("admin"),
  async (_req: Request, res: Response) => {
    try {
      await processNotifications(100);
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to process notifications" });
    }
  }
);

router.post(
  "/notifications/reminders",
  verifyToken,
  requireRole("admin"),
  async (_req: Request, res: Response) => {
    try {
      const queued = await queueCheckInReminders();
      res.status(200).json({ ok: true, queued });
    } catch (error) {
      res.status(500).json({ message: "Unable to queue reminders" });
    }
  }
);

export default router;
