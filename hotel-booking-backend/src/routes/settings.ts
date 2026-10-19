import express, { Request, Response } from "express";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { validationResult } from "express-validator";
import {
  Settings,
  defaultSettings,
  getPublicSettings,
  getSettings,
  sanitizeForClient,
  updateSettings,
} from "../services/settings";

const router = express.Router();

// Only known top-level keys are accepted from the client — unknown keys are
// dropped instead of polluting the JSONB payload.
const ALLOWED_KEYS = Object.keys(defaultSettings) as (keyof Settings)[];

const pickAllowed = (body: unknown): Partial<Settings> => {
  const patch: Record<string, unknown> = {};
  if (typeof body !== "object" || body === null) return patch;
  for (const key of ALLOWED_KEYS) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined) patch[key] = value;
  }
  return patch as Partial<Settings>;
};

/**
 * @swagger
 * /api/settings/public:
 *   get:
 *     summary: Public site settings (branding, currency, policy — no secrets)
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Public settings
 */
router.get("/public", async (_req: Request, res: Response) => {
  try {
    res.status(200).json(await getPublicSettings());
  } catch (error) {
    res.status(500).json({ message: "Unable to load settings" });
  }
});

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Full site settings (owner/admin)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *   put:
 *     summary: Update site settings (owner/admin)
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (_req: Request, res: Response) => {
    try {
      res.status(200).json(sanitizeForClient(await getSettings()));
    } catch (error) {
      res.status(500).json({ message: "Unable to load settings" });
    }
  }
);

router.put(
  "/",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const patch = pickAllowed(req.body);

      // Telegram: only real fields are writable — the client never echoes the
      // bot token back (GET only reports whether one is configured).
      if (patch.telegram !== undefined) {
        const src =
          typeof patch.telegram === "object" && patch.telegram !== null
            ? (patch.telegram as Record<string, unknown>)
            : {};
        const telegram: Record<string, string> = {};
        if (typeof src.botToken === "string") telegram.botToken = src.botToken;
        if (typeof src.chatId === "string") telegram.chatId = src.chatId;
        patch.telegram = telegram as Settings["telegram"];
      }

      // Basic type sanity — reject obvious garbage instead of storing it.
      if (patch.timezone && typeof patch.timezone !== "string") {
        return res.status(400).json({ message: "timezone must be a string" });
      }
      if (patch.currency && typeof patch.currency !== "string") {
        return res.status(400).json({ message: "currency must be a string" });
      }
      if (
        patch.usdRate !== undefined &&
        (typeof patch.usdRate !== "number" || patch.usdRate < 0)
      ) {
        return res
          .status(400)
          .json({ message: "usdRate must be a non-negative number" });
      }
      if (patch.minNights !== undefined && typeof patch.minNights !== "number") {
        return res
          .status(400)
          .json({ message: "minNights must be a number" });
      }
      if (patch.maxNights !== undefined && typeof patch.maxNights !== "number") {
        return res
          .status(400)
          .json({ message: "maxNights must be a number" });
      }

      const updated = await updateSettings(patch);
      res.status(200).json(sanitizeForClient(updated));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update settings";
      res.status(500).json({ message });
    }
  }
);

export default router;
