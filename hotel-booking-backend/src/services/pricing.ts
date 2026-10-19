import {
  Settings,
  assertNightsAllowed,
  toDisplayAmount,
} from "./settings";

// ---------------------------------------------------------------------------
// Pricing — always server-authoritative. Clients never send totals we trust;
// every quote/booking total is computed here from DB rates + settings.
// ---------------------------------------------------------------------------

export type Quote = {
  nights: number;
  /** Stored currency (settings.currency, ETB by default). */
  currency: string;
  /** Total in stored currency (nightly base + fees). */
  totalStored: number;
  /** Optional guest-facing conversion, null when not configured. */
  display: { currency: string; total: number } | null;
  /** Amount due up front when paying online (stored currency). */
  deposit: number;
  /** Remaining balance due at the property (stored currency). */
  balance: number;
  /** Per-fee breakdown actually applied (empty with default settings). */
  fees: { name: string; amount: number }[];
};

/** Amount due up front, per the prepayment policy. */
export function depositFor(totalStored: number, s: Settings): number {
  const mode = s.prepayment?.mode ?? "full";
  const value = Number(s.prepayment?.value ?? 100);

  let deposit = 0;
  switch (mode) {
    case "none":
      deposit = 0;
      break;
    case "percent":
      deposit = totalStored * (Math.max(0, Math.min(100, value)) / 100);
      break;
    case "fixed":
      deposit = Math.max(0, value);
      break;
    case "full":
    default:
      deposit = totalStored;
      break;
  }
  // Never demand more than the total, never negative.
  deposit = Math.max(0, Math.min(totalStored, deposit));
  return Math.round(deposit * 100) / 100;
}

/**
 * Configured fees from settings (`fees[]`: {name?, type: percent|fixed,
 * value, active?}). Defensive: unknown shapes are skipped, so an empty or
 * legacy fees array changes nothing. Discounts don't exist yet.
 */
function applyFees(
  baseTotal: number,
  settings: Settings
): { feeTotal: number; breakdown: { name: string; amount: number }[] } {
  const breakdown: { name: string; amount: number }[] = [];
  let feeTotal = 0;

  for (const fee of settings.fees ?? []) {
    if (!fee || fee.active === false) continue;
    const value = Number(fee.value);
    if (!Number.isFinite(value) || value <= 0) continue;

    const amount = fee.type === "percent" ? (baseTotal * value) / 100 : value;
    const rounded = Math.round(amount * 100) / 100;
    if (rounded <= 0) continue;

    feeTotal += rounded;
    breakdown.push({ name: fee.name || "Fee", amount: rounded });
  }

  return { feeTotal: Math.round(feeTotal * 100) / 100, breakdown };
}

/**
 * Quote a stay at a nightly rate — hotel.pricePerNight for legacy bookings,
 * roomType.basePrice once a room type is selected (same shape either way).
 */
export function quoteNights(opts: {
  pricePerNight: number;
  nights: number;
  settings: Settings;
  displayCurrency?: string;
  validateStayLength?: boolean;
}): Quote {
  const { pricePerNight, nights, settings } = opts;

  if (!Number.isFinite(pricePerNight) || pricePerNight < 0) {
    throw new Error("Invalid nightly rate");
  }
  if (!Number.isInteger(nights) || nights < 1) {
    throw new Error("Booking must be at least 1 night");
  }
  if (opts.validateStayLength !== false) {
    assertNightsAllowed(nights, settings);
  }

  const baseTotal = Math.round(pricePerNight * nights * 100) / 100;
  const { feeTotal, breakdown } = applyFees(baseTotal, settings);
  const totalStored = Math.round((baseTotal + feeTotal) * 100) / 100;
  const deposit = depositFor(totalStored, settings);

  let display: Quote["display"] = null;
  if (opts.displayCurrency) {
    const converted = toDisplayAmount(
      totalStored,
      opts.displayCurrency,
      settings
    );
    if (converted) display = { currency: converted.currency, total: converted.amount };
  } else if (
    settings.displayCurrencies?.length &&
    !settings.displayCurrencies.includes(settings.currency)
  ) {
    const alt = settings.displayCurrencies.find(
      (c) => c !== settings.currency
    );
    if (alt) {
      const converted = toDisplayAmount(totalStored, alt, settings);
      if (converted)
        display = { currency: converted.currency, total: converted.amount };
    }
  }

  return {
    nights,
    currency: settings.currency,
    totalStored,
    display,
    deposit,
    balance: Math.round((totalStored - deposit) * 100) / 100,
    fees: breakdown,
  };
}
