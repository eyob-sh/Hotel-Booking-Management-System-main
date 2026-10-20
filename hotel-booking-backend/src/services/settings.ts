import { db, settings as settingsTable } from "../db";
import { desc, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Settings — singleton row (id = "main") holding all site configuration.
// Cached for a short TTL so booking/search hot paths don't hit the DB on
// every request; invalidation happens on every update.
// ---------------------------------------------------------------------------

export type PrepaymentMode = "none" | "percent" | "fixed" | "full";

export type FeeConfig = {
  id: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  active: boolean;
};

export type Settings = {
  deployMode: "single" | "multi";
  property: {
    name: string;
    phone: string;
    email: string;
    address: string;
    telegramHandle: string;
  };
  /** Currency all amounts are stored and computed in. */
  currency: string;
  /** Currencies guests may *view* prices in (conversion of display only). */
  displayCurrencies: string[];
  /** Exchange rate: how many units of `currency` equal 1 USD (0 = unset). */
  usdRate: number;
  /** IANA timezone the property operates in — nights are counted here. */
  timezone: string;
  prepayment: { mode: PrepaymentMode; value: number };
  allowPayAtProperty: boolean;
  freeCancellationHours: number;
  checkInTime: string;
  checkOutTime: string;
  minNights: number;
  maxNights: number;
  fees: FeeConfig[];
  features: {
    phoneLogin: boolean;
    otpEnabled: boolean;
    reviewsEnabled: boolean;
    telegramEnabled: boolean;
  };
  /** Secrets — never exposed by public endpoints. */
  telegram: { botToken: string; chatId: string; webhookSecret: string };
  /** Public base URL used to register the Telegram webhook (e.g. https://hotel.example.com). */
  publicBaseUrl: string;
};

/** What GET /api/settings/public returns (no secrets). */
export type PublicSettings = Omit<Settings, "telegram">;

export const SETTINGS_ROW_ID = "main";
const CACHE_TTL_MS = 30_000;

export const defaultSettings: Settings = {
  deployMode: "single",
  property: {
    name: "",
    phone: "",
    email: "",
    address: "",
    telegramHandle: "",
  },
  currency: "ETB",
  displayCurrencies: ["ETB", "USD"],
  usdRate: 0,
  timezone: "Africa/Addis_Ababa",
  prepayment: { mode: "full", value: 100 },
  allowPayAtProperty: true,
  freeCancellationHours: 48,
  checkInTime: "14:00",
  checkOutTime: "11:00",
  minNights: 1,
  maxNights: 30,
  fees: [],
  features: {
    phoneLogin: true,
    otpEnabled: false,
    reviewsEnabled: true,
    telegramEnabled: false,
  },
  telegram: { botToken: "", chatId: "", webhookSecret: "" },
  publicBaseUrl: "",
};

let cache: { value: Settings; at: number } | null = null;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Merge a partial update over existing settings (nested objects merged, arrays replaced). */
export function mergeSettings(
  base: Settings,
  patch: Partial<Settings> | Record<string, unknown>
): Settings {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (base as Record<string, unknown>)[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = { ...current, ...value };
    } else {
      out[key] = value;
    }
  }
  return out as Settings;
}

function normalize(raw: unknown): Settings {
  if (!isPlainObject(raw)) return { ...defaultSettings };
  return mergeSettings(defaultSettings, raw as Partial<Settings>);
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Insert the singleton row if it doesn't exist yet (idempotent, called on boot). */
export async function ensureSettingsRow(): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ id: SETTINGS_ROW_ID, data: defaultSettings })
    .onConflictDoNothing({ target: settingsTable.id });
  invalidateSettingsCache();
}

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, SETTINGS_ROW_ID))
      .limit(1);

    if (row) {
      const value = normalize(row.data);
      cache = { value, at: Date.now() };
      return value;
    }
  } catch (error) {
    console.error("settings: failed to read settings row:", error);
  }

  // Fall back to last known value, then to defaults — never block bookings.
  if (cache) return cache.value;
  return { ...defaultSettings };
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const full = await getSettings();
  const { telegram: _telegram, ...pub } = full;
  return pub;
}

/** What GET /api/settings returns — Telegram secrets are never echoed back. */
export type SettingsView = Omit<Settings, "telegram"> & {
  telegram: { chatId: string; botTokenConfigured: boolean; webhookSecretConfigured: boolean };
};

export function sanitizeForClient(s: Settings): SettingsView {
  const { telegram, ...rest } = s;
  return {
    ...rest,
    telegram: {
      chatId: telegram?.chatId ?? "",
      botTokenConfigured: Boolean(telegram?.botToken),
      webhookSecretConfigured: Boolean(telegram?.webhookSecret),
    },
  };
}

export async function updateSettings(
  patch: Partial<Settings> | Record<string, unknown>
): Promise<Settings> {
  const current = await getSettings();
  const merged = mergeSettings(current, patch);

  const [row] = await db
    .insert(settingsTable)
    .values({ id: SETTINGS_ROW_ID, data: merged })
    .onConflictDoUpdate({
      target: settingsTable.id,
      set: { data: merged, updatedAt: new Date() },
    })
    .returning();

  const value = normalize(row.data);
  cache = { value, at: Date.now() };
  return value;
}

// ---------------------------------------------------------------------------
// Timezone / calendar helpers — the property's timezone is the single source
// of truth for what a "night" is. All availability and pricing math uses
// calendar dates (YYYY-MM-DD) in this zone, never UTC instants.
// ---------------------------------------------------------------------------

export function propertyTimeZone(s?: Settings): string {
  return s?.timezone || defaultSettings.timezone;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

const getDayFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt;
};

/**
 * Calendar date (YYYY-MM-DD) in the given timezone.
 * Strings that are already date-only pass through unchanged.
 */
export function calendarDateOf(
  value: Date | string,
  timeZone: string = defaultSettings.timezone
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (DATE_ONLY_RE.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date: ${value}`);
    }
    return getDayFormatter(timeZone).format(parsed);
  }
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid date");
  }
  return getDayFormatter(timeZone).format(value);
}

/** Whole nights between two calendar dates (checkOut is exclusive). */
export function diffNights(checkIn: string, checkOut: string): number {
  if (!DATE_ONLY_RE.test(checkIn) || !DATE_ONLY_RE.test(checkOut)) {
    throw new Error("diffNights expects YYYY-MM-DD dates");
  }
  const [y1, m1, d1] = checkIn.split("-").map(Number);
  const [y2, m2, d2] = checkOut.split("-").map(Number);
  const start = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function assertNightsAllowed(nights: number, s: Settings): void {
  const min = s.minNights > 0 ? s.minNights : 1;
  const max = s.maxNights > 0 ? s.maxNights : Number.POSITIVE_INFINITY;
  if (nights < min) {
    throw new Error(`Minimum stay is ${min} night${min === 1 ? "" : "s"}`);
  }
  if (nights > max) {
    throw new Error(`Maximum stay is ${max} nights`);
  }
}

// ---------------------------------------------------------------------------
// Money helpers — amounts are stored in `settings.currency` (ETB by default).
// USD is display-only: guests see converted prices at `settings.usdRate`.
// ---------------------------------------------------------------------------

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  let fmt = currencyFormatters.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      });
    } catch {
      fmt = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
      });
    }
    currencyFormatters.set(currency, fmt);
  }
  return fmt.format(amount);
}

/**
 * Convert a stored-currency amount into a guest-facing display currency.
 * Returns null when the display currency equals the stored currency or no
 * exchange rate is configured — callers should then show the stored amount.
 */
export function toDisplayAmount(
  amountStored: number,
  displayCurrency: string,
  s: Settings
): { currency: string; amount: number } | null {
  if (displayCurrency === s.currency) return null;
  if (displayCurrency.toUpperCase() === "USD") {
    if (!s.usdRate || s.usdRate <= 0) return null;
    const amount = amountStored / s.usdRate;
    return { currency: "USD", amount: Math.round(amount * 100) / 100 };
  }
  return null;
}
