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
// PayPal — kept registered but DISABLED (Ethiopian accounts can't receive
// PayPal payouts). Kept so re-enabling later is a one-line settings toggle.
// ---------------------------------------------------------------------------

const DISABLED =
  "PayPal is disabled for this property. Choose Telebirr, bank transfer or pay at arrival.";

export class PaypalProvider implements PaymentProvider {
  id = "paypal";
  displayName = "PayPal";
  kind = "online" as const;

  isConfigured(): boolean {
    return false;
  }

  quote(amount: number): { amountDue: number } {
    return { amountDue: amount };
  }

  async createIntent(_opts: CreateIntentOpts): Promise<CreateIntentResult> {
    throw new ProviderError(DISABLED, 400);
  }

  async confirm(_intentId: string): Promise<ConfirmResult> {
    throw new ProviderError(DISABLED, 400);
  }

  async refund(_intentId: string, _amount: number): Promise<RefundResult> {
    throw new ProviderError(DISABLED, 400);
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    throw new ProviderError(DISABLED, 400);
  }

  publicDetails(_config?: ProviderConfig): Record<string, unknown> {
    return { disabled: true };
  }
}
