// ---------------------------------------------------------------------------
// Phone helpers — phone is a first-class identity (Phase 2). We normalise to
// E.164 so the same number in any local format maps to one account.
// Ethiopia-first: a bare 0XXXXXXXXX or 9XXXXXXXX becomes +251XXXXXXXXX.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

export const isEmail = (value: unknown): boolean =>
  EMAIL_RE.test(String(value ?? "").trim());

/**
 * Normalise a phone number to E.164 (`+` + up to 15 digits), applying the
 * Ethiopia (+251) convention for local formats. Returns null when the input
 * cannot be interpreted as a phone number.
 */
export const normalizePhone = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const input = String(raw).trim();
  if (!input) return null;

  const compact = input.replace(/[\s\-().]/g, "");
  if (!/^\+?\d{6,15}$/.test(compact)) return null;

  const digits = compact.replace(/\D/g, "");

  let e164: string;
  if (compact.startsWith("+")) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("251")) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("0") && digits.length === 10) {
    e164 = `+251${digits.slice(1)}`;
  } else if (digits.length === 9) {
    e164 = `+251${digits}`;
  } else {
    e164 = `+${digits}`;
  }

  return E164_RE.test(e164) ? e164 : null;
};

/** Digits-only form, handy for lenient last-N comparison. */
export const phoneDigits = (value: unknown): string =>
  String(value ?? "").replace(/\D/g, "");
