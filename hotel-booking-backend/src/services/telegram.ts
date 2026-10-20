import { getSettings, type Settings } from "./settings";

// ---------------------------------------------------------------------------
// Telegram client (Phase 5) — a thin wrapper over the Bot API. The bot is one
// integration seam: guests book/lookup/cancel and owners get alerts. All bot
// logic lives in services/telegram-bot.ts; this module only talks to Telegram.
// ---------------------------------------------------------------------------

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type ReplyMarkup = { inline_keyboard: InlineButton[][] };

function apiBase(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

export function telegramConfigured(s: Settings): boolean {
  return Boolean(s.features.telegramEnabled && s.telegram?.botToken);
}

/** True when the bot can both send and receive (token + webhook secret). */
export function telegramWebhookReady(s: Settings): boolean {
  return telegramConfigured(s) && Boolean(s.telegram?.webhookSecret);
}

async function callApi(
  token: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<{ ok: boolean; result?: any; description?: string }> {
  try {
    const res = await fetch(`${apiBase(token)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok || !data?.ok) {
      return { ok: false, description: data?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: data.result };
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : "network error",
    };
  }
}

/** Send a text message; returns ok=false (never throws) when unconfigured. */
export async function sendMessage(
  chatId: string | number,
  text: string,
  markup?: ReplyMarkup
): Promise<boolean> {
  const s = await getSettings();
  const token = s.telegram?.botToken;
  if (!telegramConfigured(s) || !token || !chatId) {
    console.log("[telegram:fallback:send]", chatId, text);
    return false;
  }
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (markup) payload.reply_markup = markup;
  const out = await callApi(token, "sendMessage", payload);
  if (!out.ok) console.log("[telegram:error:send]", out.description);
  return out.ok;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const s = await getSettings();
  const token = s.telegram?.botToken;
  if (!token) return false;
  const out = await callApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
  return out.ok;
}

export async function getMe(): Promise<{ ok: boolean; username?: string; description?: string }> {
  const s = await getSettings();
  const token = s.telegram?.botToken;
  if (!token) return { ok: false, description: "bot token not configured" };
  const out = await callApi(token, "getMe");
  return { ok: out.ok, username: out.result?.username, description: out.description };
}

/** Register the webhook with Telegram using PUBLIC base URL + secret path. */
export async function setWebhook(baseUrlOverride?: string): Promise<{ ok: boolean; description?: string }> {
  const s = await getSettings();
  const token = s.telegram?.botToken;
  const secret = s.telegram?.webhookSecret;
  const base = (baseUrlOverride || s.publicBaseUrl || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!token || !secret) return { ok: false, description: "bot token or webhook secret not configured" };
  if (!base) return { ok: false, description: "public base URL not configured" };
  const out = await callApi(token, "setWebhook", {
    url: `${base}/api/webhooks/telegram/${secret}`,
    allowed_updates: ["message", "callback_query"],
  });
  return { ok: out.ok, description: out.description };
}

export async function deleteWebhook(): Promise<{ ok: boolean; description?: string }> {
  const s = await getSettings();
  const token = s.telegram?.botToken;
  if (!token) return { ok: false, description: "bot token not configured" };
  const out = await callApi(token, "deleteWebhook");
  return { ok: out.ok, description: out.description };
}

/**
 * Reconcile the webhook registration with current settings. Called on boot and
 * after settings updates: registers when enabled + token + secret + base URL
 * are present, otherwise removes any stale registration.
 */
export async function syncWebhook(): Promise<void> {
  try {
    const s = await getSettings();
    if (telegramWebhookReady(s) && (s.publicBaseUrl || process.env.PUBLIC_BASE_URL)) {
      const out = await setWebhook();
      if (!out.ok) console.log("[telegram:webhook]", out.description);
    } else if (telegramConfigured(s)) {
      await deleteWebhook();
    }
  } catch (error) {
    console.error("telegram: failed to sync webhook:", error);
  }
}

/**
 * Constant-time-ish comparison for the webhook secret in the URL path.
 * (Telegram sends it in the path; we never want a timing oracle.)
 */
export function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
