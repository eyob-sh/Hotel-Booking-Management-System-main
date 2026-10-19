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
import { getStripe } from "../../services/payments";

// ---------------------------------------------------------------------------
// Stripe (international cards). Kept in the registry but DISABLED in
// `payment_providers` — Ethiopian merchant accounts aren't available, so the
// live path is only useful once a foreign entity/aggregator is set up.
//
// `services/payments.resolveChargePlan` converts the stored ETB amount into
// a Stripe-chargeable currency before createIntent is called.
// ---------------------------------------------------------------------------

const NOT_CONFIGURED =
  "Stripe is not configured — add STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET) to enable card payments.";

export class StripeProvider implements PaymentProvider {
  id = "stripe";
  displayName = "Credit / debit card (Stripe)";
  kind = "online" as const;

  isConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  quote(amount: number): { amountDue: number } {
    return { amountDue: amount };
  }

  async createIntent(opts: CreateIntentOpts): Promise<CreateIntentResult> {
    const stripe = getStripe();
    if (!stripe) throw new ProviderError(NOT_CONFIGURED, 503);

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(opts.amount * 100),
      currency: opts.currency.toLowerCase(),
      metadata: opts.metadata ?? {},
      automatic_payment_methods: { enabled: true },
    });

    return {
      intentId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
      raw: { status: intent.status },
    };
  }

  async confirm(intentId: string): Promise<ConfirmResult> {
    const stripe = getStripe();
    if (!stripe) throw new ProviderError(NOT_CONFIGURED, 503);

    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status === "succeeded") {
      return { status: "succeeded", providerRef: intent.id, raw: { status: intent.status } };
    }
    if (intent.status === "canceled" || intent.last_payment_error) {
      return {
        status: "failed",
        providerRef: intent.id,
        message: intent.last_payment_error?.message ?? "Payment failed",
        raw: { status: intent.status },
      };
    }
    return { status: "pending", providerRef: intent.id, raw: { status: intent.status } };
  }

  async refund(
    intentId: string,
    amount: number
  ): Promise<RefundResult> {
    const stripe = getStripe();
    if (!stripe) throw new ProviderError(NOT_CONFIGURED, 503);

    const refund = await stripe.refunds.create({
      payment_intent: intentId,
      amount: Math.round(amount * 100),
    });
    return {
      status: refund.status === "succeeded" ? "succeeded" : "pending",
      raw: { id: refund.id, status: refund.status },
    };
  }

  async verifyWebhook(
    rawBody: unknown,
    headers: Record<string, any>
  ): Promise<WebhookEvent> {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) throw new ProviderError(NOT_CONFIGURED, 503);

    const signature = headers["stripe-signature"];
    if (!signature) throw new ProviderError("Missing stripe-signature header", 400);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        Buffer.isBuffer(rawBody) ? rawBody : String(rawBody),
        signature,
        secret
      );
    } catch (error) {
      throw new ProviderError(
        `Invalid Stripe webhook signature: ${error instanceof Error ? error.message : "unknown"}`,
        401
      );
    }

    const intent = event.data?.object as any;
    if (event.type === "payment_intent.succeeded" && intent?.id) {
      return {
        type: "payment_succeeded",
        intentId: intent.id,
        amount: typeof intent.amount === "number" ? intent.amount / 100 : undefined,
        currency: intent.currency,
        raw: event,
      };
    }
    if (event.type === "payment_intent.payment_failed" && intent?.id) {
      return {
        type: "payment_failed",
        intentId: intent.id,
        message: intent.last_payment_error?.message,
        raw: event,
      };
    }
    return { type: "ignored", raw: event };
  }
}
