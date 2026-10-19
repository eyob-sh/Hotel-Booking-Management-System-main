import { randomUUID } from "crypto";
import {
  PaymentProvider,
  ProviderConfig,
  ConfirmResult,
  CreateIntentResult,
  RefundResult,
  WebhookEvent,
} from "../types";

/**
 * Pay at arrival (onsite). Nothing is collected up front — the whole balance
 * is due when the guest checks in. The booking is confirmed immediately and
 * the ledger records the amount owed.
 */
export class PayAtArrivalProvider implements PaymentProvider {
  id = "pay-at-arrival";
  displayName = "Pay at arrival";
  kind = "onsite" as const;

  isConfigured(): boolean {
    return true;
  }

  quote(): { amountDue: number } {
    return { amountDue: 0 };
  }

  async createIntent(opts: {
    amount: number;
    currency: string;
  }): Promise<CreateIntentResult> {
    return {
      intentId: `arrival_${randomUUID()}`,
      raw: { amountOwed: opts.amount, currency: opts.currency, when: "at_the_property" },
    };
  }

  async confirm(intentId: string): Promise<ConfirmResult> {
    return {
      status: "pending",
      providerRef: intentId,
      message: "Payment due at the property",
    };
  }

  async refund(intentId: string, amount: number): Promise<RefundResult> {
    // Money never passed through a gateway — refunds happen at the desk.
    return { status: "succeeded", raw: { note: "manual refund at the property", amount } };
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    return { type: "ignored" };
  }

  publicDetails(config?: ProviderConfig): Record<string, unknown> {
    return { instructions: config?.instructions ?? "Pay at the property on arrival." };
  }
}
