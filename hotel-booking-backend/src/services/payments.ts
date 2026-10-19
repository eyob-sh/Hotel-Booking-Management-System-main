import Stripe from "stripe";
import { Settings } from "./settings";

// ---------------------------------------------------------------------------
// Payment providers (Phase 0: Stripe behind a config guard).
//
// Phase 1 generalises this file into the PaymentProvider interface + registry
// (pay-at-arrival, bank-transfer, telebirr, stripe, paypal). Everything the
// routes need today lives behind these three functions, so swapping in the
// registry is a local change.
// ---------------------------------------------------------------------------

export class PaymentConfigError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigError";
  }
}

/**
 * Currencies Stripe can charge. Property currency (ETB) is not one of them,
 * so an ETB property charges in USD at settings.usdRate — that's why the
 * exchange rate exists. Extend this set freely.
 */
const STRIPE_CHARGEABLE = new Set(["usd", "eur", "gbp"]);

let stripeClient: Stripe | null | undefined;

/** Lazily construct the Stripe client; null when no key is configured. */
export function getStripe(): Stripe | null {
  if (stripeClient === undefined) {
    const key = process.env.STRIPE_SECRET_KEY;
    stripeClient = key ? new Stripe(key) : null;
  }
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type ChargePlan = {
  currency: string;
  /** Convert a stored-currency (ETB) amount into the charged amount. */
  toCharge: (amountStored: number) => number;
};

/**
 * Which currency an online card charge runs in, and how to convert the
 * stored total into it. Throws PaymentConfigError when impossible, so the
 * route can answer with a clear message instead of a broken 500.
 */
export function resolveChargePlan(settings: Settings): ChargePlan {
  const base = (settings.currency || "").toLowerCase();

  if (STRIPE_CHARGEABLE.has(base)) {
    return { currency: base, toCharge: (amount) => round2(amount) };
  }

  if (settings.usdRate && settings.usdRate > 0) {
    return {
      currency: "usd",
      toCharge: (amount) => round2(amount / settings.usdRate),
    };
  }

  throw new PaymentConfigError(
    `${settings.currency} cannot be charged online and no exchange rate is configured. ` +
      `Set a USD rate in Settings (ETB per 1 USD), or use pay-at-arrival / bank transfer.`
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
