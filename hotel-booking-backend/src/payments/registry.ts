import { db, paymentProviders } from "../db";
import { asc, eq } from "drizzle-orm";
import { Settings } from "../services/settings";
import { resolveChargePlan } from "../services/payments";
import { PaymentProvider, ProviderConfig } from "./types";
import { PayAtArrivalProvider } from "./providers/pay-at-arrival";
import { BankTransferProvider } from "./providers/bank-transfer";
import { TelebirrProvider } from "./providers/telebirr";
import { StripeProvider } from "./providers/stripe";
import { PaypalProvider } from "./providers/paypal";

// ---------------------------------------------------------------------------
// Provider registry. Adding a payment method:
//   1. write the class implementing PaymentProvider,
//   2. add one register(...) line below,
//   3. seed/allow a `payment_providers` row (enabled toggle + config JSONB).
// Nothing else — booking and pricing code are provider-agnostic.
// ---------------------------------------------------------------------------

const registry = new Map<string, PaymentProvider>();

export function register(provider: PaymentProvider): void {
  registry.set(provider.id, provider);
}

register(new PayAtArrivalProvider());
register(new BankTransferProvider());
register(new TelebirrProvider());
register(new StripeProvider());
register(new PaypalProvider());

/** Provider class by id (undefined when unknown). */
export function getProvider(id: string): PaymentProvider | undefined {
  return registry.get(id);
}

export const DEFAULT_PROVIDER_ID = "pay-at-arrival";

export type ProviderRow = typeof paymentProviders.$inferSelect;

export type AvailableProvider = {
  id: string;
  displayName: string;
  kind: PaymentProvider["kind"];
  /** Toggle from the DB row. */
  enabled: boolean;
  /** Whether the provider can actually charge right now (keys/config present). */
  available: boolean;
  details?: Record<string, unknown>;
};

export type ProviderRuntime = {
  provider: PaymentProvider;
  row: ProviderRow | null;
  config: ProviderConfig;
  enabled: boolean;
};

/** DB row + class for a provider id, or null when the id is unknown. */
export async function getProviderRuntime(
  id: string
): Promise<ProviderRuntime | null> {
  const provider = getProvider(id);
  if (!provider) return null;

  const [row] = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.id, id))
    .limit(1);

  const config = (row?.config as ProviderConfig) ?? {};
  return {
    provider,
    row: row ?? null,
    config,
    enabled: row ? row.enabled : false,
  };
}

/** Enabled providers for the checkout page (public info only). */
export async function listEnabledProviders(): Promise<AvailableProvider[]> {
  const rows = await db
    .select()
    .from(paymentProviders)
    .where(eq(paymentProviders.enabled, true))
    .orderBy(asc(paymentProviders.sortOrder));

  const result: AvailableProvider[] = [];
  for (const row of rows) {
    const provider = getProvider(row.id);
    if (!provider) continue; // DB row for a provider not compiled in
    const config = (row.config as ProviderConfig) ?? {};
    result.push({
      id: row.id,
      displayName: row.displayName || provider.displayName,
      kind: provider.kind,
      enabled: true,
      available: provider.isConfigured(config),
      details: provider.publicDetails?.(config),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Charged amount/currency per provider.
//
// Onsite providers and Telebirr charge in the stored currency (ETB). Card
// providers (Stripe/PayPal) can't charge ETB, so the amount is converted via
// settings.usdRate — resolveChargePlan throws PaymentConfigError with a clear
// message when that's impossible.
// ---------------------------------------------------------------------------

const CONVERTING_PROVIDERS = new Set(["stripe", "paypal"]);

export function chargedAmountFor(
  providerId: string,
  amountStored: number,
  settings: Settings
): { amount: number; currency: string } {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  if (!CONVERTING_PROVIDERS.has(providerId)) {
    return { amount: round2(amountStored), currency: settings.currency };
  }

  const plan = resolveChargePlan(settings);
  return { amount: plan.toCharge(amountStored), currency: plan.currency };
}
