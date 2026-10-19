// ---------------------------------------------------------------------------
// Payment provider contract.
//
// Adding a method = 1 class implementing this interface + 1 line in
// registry.ts (+ an enabled row in `payment_providers` and, optionally, a
// checkout form). Booking/pricing code never changes.
//
// `config` is the provider's JSONB row from `payment_providers` (mode keys,
// bank instructions, secrets, ...) so providers stay stateless.
// ---------------------------------------------------------------------------

export type ProviderKind = "online" | "onsite";

export type ProviderConfig = Record<string, any>;

export type CreateIntentOpts = {
  /** Amount in `currency` (already converted to what this provider charges). */
  amount: number;
  currency: string;
  bookingId?: string;
  metadata?: Record<string, string>;
  config?: ProviderConfig;
};

export type CreateIntentResult = {
  intentId: string;
  /** Present when the client must complete the payment (e.g. card SDK). */
  clientSecret?: string;
  raw?: unknown;
};

export type ConfirmResult = {
  status: "succeeded" | "pending" | "failed";
  providerRef?: string;
  message?: string;
  raw?: unknown;
};

export type RefundResult = {
  status: "succeeded" | "pending" | "failed";
  raw?: unknown;
};

export type WebhookEvent = {
  type: "payment_succeeded" | "payment_failed" | "ignored";
  intentId?: string;
  amount?: number;
  currency?: string;
  message?: string;
  raw?: unknown;
};

export interface PaymentProvider {
  id: string;
  displayName: string;
  kind: ProviderKind;

  /** Can this provider actually move money right now (keys/config present)? */
  isConfigured(config?: ProviderConfig): boolean;

  /** Amount this provider will collect given the amount due. */
  quote(amount: number, currency: string, config?: ProviderConfig): { amountDue: number };

  createIntent(opts: CreateIntentOpts): Promise<CreateIntentResult>;
  confirm(
    intentId: string,
    opts?: { amount?: number; currency?: string; config?: ProviderConfig }
  ): Promise<ConfirmResult>;
  refund(
    intentId: string,
    amount: number,
    opts?: { config?: ProviderConfig }
  ): Promise<RefundResult>;
  verifyWebhook(
    rawBody: unknown,
    headers: Record<string, any>,
    config?: ProviderConfig
  ): Promise<WebhookEvent>;

  /**
   * Guest-facing details safe to publish (bank instructions, demo-mode
   * badges). Never include secrets here.
   */
  publicDetails?(config?: ProviderConfig): Record<string, unknown>;
}

/** Thrown for provider misconfiguration — routes map it to 400/503. */
export class ProviderError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ProviderError";
    this.statusCode = statusCode;
  }
}
