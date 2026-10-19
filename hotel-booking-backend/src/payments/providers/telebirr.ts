import { randomUUID } from "crypto";
import {
  PaymentProvider,
  ProviderConfig,
  ConfirmResult,
  CreateIntentOpts,
  CreateIntentResult,
  ProviderError,
  RefundResult,
  WebhookEvent,
} from "../types";

// ---------------------------------------------------------------------------
// Telebirr (Ethio Telecom mobile money).
//
// Ships in `mode: "mock"` so the whole checkout completes end-to-end with no
// merchant account. When the user has trial/live credentials, set
// config.mode = "live" and fill appId/appSecret/baseUrl (+ publicKey,
// webhookSecret); the `live*` methods are the only places that need to match
// the real API/aggregator docs — nothing else in the codebase changes.
//
// Live notes (to implement against Ethio Telecom's docs / a Chapa-style
// aggregator):
//   * createIntent → POST a pre-order, then return the H5 payment URL
//   * confirm     → query the order status endpoint
//   * refund      → call the refund endpoint
//   * verifyWebhook → verify the signed callback
// ---------------------------------------------------------------------------

const LIVE_NOT_CONFIGURED =
  "Live Telebirr is not configured yet — add appId/appSecret/baseUrl (and webhookSecret) in payment settings, or keep mode: mock.";

export class TelebirrProvider implements PaymentProvider {
  id = "telebirr";
  displayName = "Telebirr";
  kind = "online" as const;

  private mode(config?: ProviderConfig): "mock" | "live" {
    return config?.mode === "live" ? "live" : "mock";
  }

  isConfigured(config?: ProviderConfig): boolean {
    if (this.mode(config) === "mock") return true;
    return Boolean(config?.appId && config?.appSecret && config?.baseUrl);
  }

  quote(amount: number): { amountDue: number } {
    // Telebirr charges in ETB (the stored currency) — no conversion needed.
    return { amountDue: amount };
  }

  async createIntent(opts: CreateIntentOpts): Promise<CreateIntentResult> {
    if (this.mode(opts.config) === "live") {
      return this.liveCreateIntent(opts);
    }

    const intentId = `telebirr_mock_${randomUUID()}`;
    return {
      intentId,
      clientSecret: `mock_${intentId}`,
      raw: {
        mode: "mock",
        amount: opts.amount,
        currency: opts.currency,
        metadata: opts.metadata,
        note: "Demo payment — no real money moves.",
      },
    };
  }

  async confirm(
    intentId: string,
    opts?: { amount?: number; currency?: string; config?: ProviderConfig }
  ): Promise<ConfirmResult> {
    if (this.mode(opts?.config) === "live") {
      return this.liveConfirm(intentId, opts?.config);
    }

    if (!intentId.startsWith("telebirr_mock_")) {
      return { status: "failed", message: "Unknown Telebirr intent id" };
    }
    return {
      status: "succeeded",
      providerRef: intentId,
      message: "Mock Telebirr payment captured",
      raw: { mode: "mock" },
    };
  }

  async refund(
    intentId: string,
    amount: number,
    opts?: { config?: ProviderConfig }
  ): Promise<RefundResult> {
    if (this.mode(opts?.config) === "live") {
      throw new ProviderError(LIVE_NOT_CONFIGURED, 503);
    }
    return { status: "succeeded", raw: { mode: "mock", intentId, amount } };
  }

  async verifyWebhook(
    rawBody: unknown,
    headers: Record<string, any>,
    config?: ProviderConfig
  ): Promise<WebhookEvent> {
    if (this.mode(config) === "live") {
      throw new ProviderError(
        "Live Telebirr webhook verification is not configured yet — add webhookSecret and verify the signature.",
        503
      );
    }

    const secret = config?.webhookSecret || "mock-secret";
    const provided = headers["x-telebirr-secret"];
    if (provided !== secret) {
      throw new ProviderError("Invalid Telebirr webhook secret", 401);
    }

    let body: any = rawBody;
    if (Buffer.isBuffer(rawBody)) body = JSON.parse(rawBody.toString("utf8"));
    else if (typeof rawBody === "string") body = JSON.parse(rawBody);

    if (!body || typeof body.intentId !== "string") {
      throw new ProviderError("Missing intentId in webhook payload", 400);
    }

    return {
      type: body.status === "failed" ? "payment_failed" : "payment_succeeded",
      intentId: body.intentId,
      amount: typeof body.amount === "number" ? body.amount : undefined,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
      raw: body,
    };
  }

  publicDetails(config?: ProviderConfig): Record<string, unknown> {
    const mode = this.mode(config);
    return {
      mode,
      publicNote:
        mode === "mock"
          ? config?.publicNote ?? "Demo mode — no real payment is taken."
          : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Live mode — isolated seams for the real API. Implement against the
  // official docs; everything above stays the same.
  // -------------------------------------------------------------------------

  private async liveCreateIntent(_opts: CreateIntentOpts): Promise<CreateIntentResult> {
    throw new ProviderError(LIVE_NOT_CONFIGURED, 503);
  }

  private async liveConfirm(
    _intentId: string,
    _config?: ProviderConfig
  ): Promise<ConfirmResult> {
    throw new ProviderError(LIVE_NOT_CONFIGURED, 503);
  }
}
