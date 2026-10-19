import express, { Request, Response } from "express";
import {
  getProviderRuntime,
  listEnabledProviders,
} from "../payments/registry";
import { ProviderError } from "../payments/types";
import { markPaymentFailed, markPaymentSucceeded } from "../payments/ledger";

// ---------------------------------------------------------------------------
// Public provider list (checkout page) — no secrets, enabled only.
// ---------------------------------------------------------------------------

export const paymentsPublicRouter = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Payments
 *     description: Payment methods and provider webhooks
 */

/**
 * @swagger
 * /api/payment-providers:
 *   get:
 *     summary: List enabled payment methods
 *     description: Enabled providers with public details (bank instructions, demo-mode badges). Never includes secrets.
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Enabled providers.
 */
paymentsPublicRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const providers = await listEnabledProviders();
    res.status(200).json({ providers });
  } catch (error) {
    res.status(500).json({ message: "Unable to load payment methods" });
  }
});

// ---------------------------------------------------------------------------
// Webhooks. Mounted BEFORE express.json (see index.ts) so the raw body is
// preserved for signature verification.
// ---------------------------------------------------------------------------

export const paymentWebhookRouter = express.Router();

/**
 * @swagger
 * /api/webhooks/payment/{provider}:
 *   post:
 *     summary: Payment provider webhook
 *     description: >
 *       Provider callbacks (Telebirr mock: JSON {intentId, status} with an
 *       x-telebirr-secret header). Idempotent — replays are ignored.
 *     tags: [Payments]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Processed (or ignored).
 *       401:
 *         description: Invalid signature/secret.
 *       404:
 *         description: Unknown provider.
 */
paymentWebhookRouter.post(
  "/:provider",
  async (req: Request, res: Response) => {
    const providerId = String(req.params.provider || "");
    const runtime = await getProviderRuntime(providerId);
    if (!runtime) {
      return res.status(404).json({ message: "Unknown payment provider" });
    }

    let event;
    try {
      event = await runtime.provider.verifyWebhook(
        req.body,
        req.headers as Record<string, any>,
        runtime.config
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      return res.status(400).json({ message: "Invalid webhook payload" });
    }

    if (event.type === "ignored" || !event.intentId) {
      return res.status(200).json({ received: true, ignored: true });
    }

    try {
      if (event.type === "payment_failed") {
        const outcome = await markPaymentFailed({
          providerId,
          intentId: event.intentId,
          raw: event.raw,
        });
        return res.status(200).json({
          received: true,
          matched: Boolean(outcome),
          bookingId: outcome?.booking?._id ?? null,
          paymentStatus: outcome?.booking?.paymentStatus ?? null,
        });
      }

      const outcome = await markPaymentSucceeded({
        providerId,
        intentId: event.intentId,
        raw: event.raw,
      });
      return res.status(200).json({
        received: true,
        matched: Boolean(outcome),
        duplicate: outcome?.duplicate ?? false,
        bookingId: outcome?.booking?._id ?? null,
        status: outcome?.booking?.status ?? null,
        paymentStatus: outcome?.booking?.paymentStatus ?? null,
      });
    } catch (error) {
      return res.status(500).json({ message: "Unable to process webhook" });
    }
  }
);
