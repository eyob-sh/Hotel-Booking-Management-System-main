import express, { Request, Response } from "express";
import { processUpdate, webhookSecretValid, type TelegramUpdate } from "../services/telegram-bot";

const router = express.Router();

// ---------------------------------------------------------------------------
// Telegram webhook (Phase 5). Telegram POSTs updates here. The secret lives in
// the URL path (set on the bot side via setWebhook). We always ack quickly so
// Telegram doesn't retry storms; handling happens after the response.
// ---------------------------------------------------------------------------

router.post("/:secret", async (req: Request, res: Response) => {
  const secret = String(req.params.secret || "");
  if (!(await webhookSecretValid(secret))) {
    return res.status(403).json({ ok: false });
  }

  // Ack immediately, then process asynchronously.
  res.status(200).json({ ok: true });

  const update = req.body as TelegramUpdate;
  if (!update || typeof update !== "object") return;
  processUpdate(update).catch((error) => {
    console.error("telegram: failed to process update:", error);
  });
});

export default router;
