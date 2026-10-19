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
 * Bank transfer (onsite). The guest is told the property's bank details and
 * owes the prepayment amount via transfer; the booking stays `pending` until
 * a manager confirms the money arrived (Phase 3 records the actual payment).
 */
export class BankTransferProvider implements PaymentProvider {
  id = "bank-transfer";
  displayName = "Bank transfer";
  kind = "onsite" as const;

  isConfigured(): boolean {
    return true;
  }

  quote(amount: number): { amountDue: number } {
    return { amountDue: amount };
  }

  async createIntent(opts: {
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<CreateIntentResult> {
    return {
      intentId: `transfer_${randomUUID()}`,
      raw: { amountDue: opts.amount, currency: opts.currency, metadata: opts.metadata },
    };
  }

  async confirm(intentId: string): Promise<ConfirmResult> {
    return {
      status: "pending",
      providerRef: intentId,
      message: "Awaiting bank transfer confirmation",
    };
  }

  async refund(intentId: string, amount: number): Promise<RefundResult> {
    return { status: "succeeded", raw: { note: "refund recorded for manual payout", amount } };
  }

  async verifyWebhook(): Promise<WebhookEvent> {
    // No automated hook — managers confirm transfers in the dashboard.
    return { type: "ignored" };
  }

  publicDetails(config?: ProviderConfig): Record<string, unknown> {
    return {
      instructions:
        config?.instructions ??
        "Transfer to the property bank account and use your booking reference as the payment reference.",
      bankName: config?.bankName,
      accountName: config?.accountName,
      accountNumber: config?.accountNumber,
    };
  }
}
