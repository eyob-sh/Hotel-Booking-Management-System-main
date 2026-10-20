import { db, hotels, roomTypes } from "../db";
import { and, eq } from "drizzle-orm";
import {
  getSettings,
  propertyTimeZone,
  calendarDateOf,
  diffNights,
  formatMoney,
  type Settings,
} from "./settings";
import { checkRoomTypeAvailability } from "./availability";
import { quoteNights } from "./pricing";
import { createBooking } from "./booking";
import {
  contactMatches,
  lookupBooking,
  cancelBookingByReference,
  normalizeRef,
} from "./guest-booking";
import {
  sendMessage,
  answerCallbackQuery,
  secretMatches,
  type ReplyMarkup,
} from "./telegram";

// ---------------------------------------------------------------------------
// Telegram bot (Phase 5) — guest booking, lookup/cancel and owner alerts.
//
// All booking logic is delegated to the existing services (availability,
// pricing, booking, guest-booking); this module ONLY handles Telegram syntax
// (commands, inline keyboards, conversation state). Both the webhook route and
// the test harness call `processUpdate` with a raw Telegram update.
//
// Scope: single property. Currency/times/policies read from settings.
// ---------------------------------------------------------------------------

type TelegramUser = { id: number; first_name?: string; username?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
};
type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: { chat: TelegramChat };
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type SessionStage = "await_dates" | "await_guests" | "await_room" | "await_phone" | "await_name";
type Session = {
  stage: SessionStage;
  chatId: number;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  roomTypeId?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  updatedAt: number;
};

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map<number, Session>();

function getSession(chatId: number): Session | undefined {
  const s = sessions.get(chatId);
  if (!s) return undefined;
  if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
    sessions.delete(chatId);
    return undefined;
  }
  return s;
}

function setSession(chatId: number, patch: Partial<Session>) {
  const current = getSession(chatId) ?? { stage: "await_dates", chatId, updatedAt: Date.now() };
  sessions.set(chatId, { ...current, ...patch, updatedAt: Date.now() });
}

function clearSession(chatId: number) {
  sessions.delete(chatId);
}

const addDays = (dateOnly: string, days: number): string => {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mainMenu(): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "🛏 Book a room", callback_data: "menu:book" }],
      [
        { text: "🔎 My booking", callback_data: "menu:mybooking" },
        { text: "❌ Cancel booking", callback_data: "menu:cancel" },
      ],
      [{ text: "🛏 Rooms & prices", callback_data: "menu:rooms" }],
      [{ text: "ℹ️ Help", callback_data: "menu:help" }],
    ],
  };
}

async function hotelAndSettings(): Promise<{ hotel: typeof hotels.$inferSelect; settings: Settings } | null> {
  const [hotel] = await db.select().from(hotels).orderBy(hotels.createdAt).limit(1);
  if (!hotel) return null;
  const settings = await getSettings();
  return { hotel, settings };
}

async function roomsText(): Promise<string> {
  const ctx = await hotelAndSettings();
  if (!ctx) return "No property is configured yet.";
  const { hotel, settings } = ctx;
  const rooms = await db
    .select()
    .from(roomTypes)
    .where(and(eq(roomTypes.hotelId, hotel._id), eq(roomTypes.active, true)))
    .orderBy(roomTypes.sortOrder);
  if (rooms.length === 0) return "No room types are available right now.";
  const lines = rooms.map(
    (r) =>
      `• <b>${r.name}</b> — ${formatMoney(r.basePrice, settings.currency)}/night ` +
      `(up to ${r.maxAdults} adults${r.maxChildren ? `, ${r.maxChildren} children` : ""})`
  );
  return `<b>${hotel.name}</b> rooms:\n\n${lines.join("\n")}\n\nType /book to make a reservation.`;
}

function helpText(settings: Settings): string {
  return (
    "How can I help?\n\n" +
    "/book — start a reservation\n" +
    "/rooms — see room types and prices\n" +
    "/mybooking &lt;reference&gt; — check a booking\n" +
    "/cancel &lt;reference&gt; — cancel a booking\n" +
    "/help — this message\n\n" +
    `Check-in ${settings.checkInTime} · Check-out ${settings.checkOutTime} · ${settings.currency}`
  );
}

// ---------------------------------------------------------------------------
// Booking conversation
// ---------------------------------------------------------------------------

async function promptDates(chatId: number) {
  setSession(chatId, { stage: "await_dates", checkIn: undefined, checkOut: undefined });
  const today = calendarDateOf(new Date().toISOString());
  await sendMessage(
    chatId,
    "Let's book your stay.\n\nSend your dates as <b>check-in check-out</b> " +
      `(YYYY-MM-DD YYYY-MM-DD), e.g. ${addDays(today, 1)} ${addDays(today, 3)}.\n\n` +
      "Or tap tonight:",
    {
      inline_keyboard: [
        [
          { text: "Tonight (1 night)", callback_data: `book:dates:${today}:${addDays(today, 1)}` },
          { text: "Tomorrow (1 night)", callback_data: `book:dates:${addDays(today, 1)}:${addDays(today, 2)}` },
        ],
        [{ text: "Cancel", callback_data: "menu:cancel_flow" }],
      ],
    }
  );
}

async function parseDatesAndAskGuests(chatId: number, text: string) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || !DATE_RE.test(parts[0]) || !DATE_RE.test(parts[1])) {
    await sendMessage(
      chatId,
      "Please send two dates as YYYY-MM-DD YYYY-MM-DD (check-in then check-out)."
    );
    return;
  }
  await continueWithDates(chatId, parts[0], parts[1]);
}

async function continueWithDates(chatId: number, checkIn: string, checkOut: string) {
  const settings = await getSettings();
  const tz = propertyTimeZone(settings);
  const ci = calendarDateOf(checkIn, tz);
  const co = calendarDateOf(checkOut, tz);
  const nights = diffNights(ci, co);
  if (nights < 1) {
    await sendMessage(chatId, "Check-out must be at least one night after check-in. Try again with /book.");
    return;
  }
  setSession(chatId, { stage: "await_guests", checkIn: ci, checkOut: co });
  await sendMessage(
    chatId,
    `Dates: <b>${ci} → ${co}</b> (${nights} night${nights === 1 ? "" : "s"}).\n\nHow many guests? Tap below or send e.g. <code>2</code> or <code>2 1</code> (adults children).`,
    {
      inline_keyboard: [
        [
          { text: "1 adult", callback_data: "book:guests:1:0" },
          { text: "2 adults", callback_data: "book:guests:2:0" },
        ],
        [
          { text: "2 + 1 child", callback_data: "book:guests:2:1" },
          { text: "Cancel", callback_data: "menu:cancel_flow" },
        ],
      ],
    }
  );
}

async function parseGuestsAndAskRoom(chatId: number, text: string) {
  const parts = text.trim().split(/\s+/).map(Number);
  const adults = parts[0];
  const children = parts[1] ?? 0;
  if (!Number.isInteger(adults) || adults < 1) {
    await sendMessage(chatId, "Please send at least 1 adult, e.g. <code>2</code> or <code>2 1</code>.");
    return;
  }
  await continueWithGuests(chatId, adults, Number.isInteger(children) ? children : 0);
}

async function continueWithGuests(chatId: number, adults: number, children: number) {
  const session = getSession(chatId);
  if (!session?.checkIn || !session.checkOut) {
    await promptDates(chatId);
    return;
  }
  const ctx = await hotelAndSettings();
  if (!ctx) {
    await sendMessage(chatId, "No property is configured yet.");
    return;
  }
  const { hotel } = ctx;
  const rooms = await db
    .select()
    .from(roomTypes)
    .where(and(eq(roomTypes.hotelId, hotel._id), eq(roomTypes.active, true)))
    .orderBy(roomTypes.sortOrder);

  // Only show room types that can actually host these guests.
  const feasible = rooms.filter((r) => adults <= r.maxAdults && children <= r.maxChildren);
  if (feasible.length === 0) {
    await sendMessage(chatId, "Sorry, no room type fits that many guests. Try /book again.");
    return;
  }
  setSession(chatId, { stage: "await_room", adults, children });
  const keyboard = feasible.map((r) => [
    { text: `${r.name}`, callback_data: `book:room:${r._id}` },
  ]);
  keyboard.push([{ text: "Cancel", callback_data: "menu:cancel_flow" }]);
  await sendMessage(chatId, "Pick a room type:", { inline_keyboard: keyboard });
}

async function quoteAndConfirm(chatId: number, roomTypeId: string) {
  const session = getSession(chatId);
  if (!session?.checkIn || !session.checkOut || !session.adults) {
    await promptDates(chatId);
    return;
  }
  const ctx = await hotelAndSettings();
  if (!ctx) {
    await sendMessage(chatId, "No property is configured yet.");
    return;
  }
  const { hotel, settings } = ctx;
  const [roomType] = await db
    .select()
    .from(roomTypes)
    .where(and(eq(roomTypes._id, roomTypeId), eq(roomTypes.hotelId, hotel._id)))
    .limit(1);
  if (!roomType || !roomType.active) {
    await sendMessage(chatId, "That room type is no longer available. Try /book again.");
    return;
  }

  const availability = await checkRoomTypeAvailability({
    roomType,
    checkIn: session.checkIn,
    checkOut: session.checkOut,
    guestAdults: session.adults,
    guestChildren: session.children ?? 0,
  });
  if (!availability.ok) {
    await sendMessage(chatId, `⚠️ ${availability.message}\n\nTry different dates with /book.`);
    return;
  }

  const nights = diffNights(session.checkIn, session.checkOut);
  const quote = quoteNights({ pricePerNight: roomType.basePrice, nights, settings });

  setSession(chatId, { stage: "await_phone", roomTypeId });
  await sendMessage(
    chatId,
    `Great — here's your quote:\n\n` +
      `<b>${roomType.name}</b>\n` +
      `${session.checkIn} → ${session.checkOut} (${nights} night${nights === 1 ? "" : "s"})\n` +
      `${session.adults} adult${session.adults === 1 ? "" : "s"}${session.children ? `, ${session.children} child` : ""}\n` +
      `Total: <b>${formatMoney(quote.totalStored, settings.currency)}</b>\n\n` +
      "To confirm, send the <b>phone number</b> for this booking (e.g. +2519...).",
    { inline_keyboard: [[{ text: "Cancel", callback_data: "menu:cancel_flow" }]] }
  );
}

async function createFromSession(chatId: number, phone: string, name?: { firstName: string; lastName: string }) {
  const session = getSession(chatId);
  if (!session?.checkIn || !session.checkOut || !session.roomTypeId || !session.adults) {
    await promptDates(chatId);
    return;
  }
  const ctx = await hotelAndSettings();
  if (!ctx) {
    await sendMessage(chatId, "No property is configured yet.");
    return;
  }
  const { hotel, settings } = ctx;
  const [roomType] = await db
    .select()
    .from(roomTypes)
    .where(eq(roomTypes._id, session.roomTypeId))
    .limit(1);
  if (!roomType) {
    await sendMessage(chatId, "Room type no longer exists. Try /book again.");
    return;
  }

  const nights = diffNights(session.checkIn, session.checkOut);
  const quote = quoteNights({ pricePerNight: roomType.basePrice, nights, settings });

  try {
    const booking = await createBooking({
      userId: null,
      hotel,
      guest: {
        firstName: name?.firstName ?? "Telegram",
        lastName: name?.lastName ?? "Guest",
        email: "",
        phone,
      },
      adultCount: session.adults,
      childCount: session.children ?? 0,
      checkIn: session.checkIn,
      checkOut: session.checkOut,
      roomTypeId: roomType._id,
      totalStored: quote.totalStored,
      depositAmount: 0,
      balanceAmount: quote.totalStored,
      currency: settings.currency,
      source: "telegram",
      status: "confirmed",
      paymentStatus: "pending",
      paymentMethod: "pay-at-arrival",
      specialRequests: `Booked via Telegram by chat ${chatId}`,
      telegramId: String(chatId),
      ledger:
        quote.totalStored > 0
          ? { providerId: "pay-at-arrival", type: "balance", amount: quote.totalStored, status: "pending" }
          : undefined,
    });

    clearSession(chatId);
    await sendMessage(
      chatId,
      `✅ <b>Booking confirmed!</b>\n\n` +
        `Reference: <code>${booking.reference}</code>\n` +
        `${roomType.name} · ${booking.checkIn} → ${booking.checkOut}\n` +
        `Total: <b>${formatMoney(booking.totalCost, booking.currency)}</b>\n\n` +
        `Payment is due at the property. Save your reference to check or cancel later with /mybooking.`
    );
    await notifyOwner(
      `🆕 <b>New Telegram booking</b>\n${booking.reference}\n${booking.firstName} ${booking.lastName}\n` +
        `${roomType.name} · ${booking.checkIn} → ${booking.checkOut}\n${formatMoney(booking.totalCost, booking.currency)}`
    );
  } catch (error) {
    await sendMessage(
      chatId,
      error instanceof Error ? `⚠️ ${error.message}` : "⚠️ Could not create the booking. Try /book again."
    );
  }
}

// ---------------------------------------------------------------------------
// Lookup / cancel
// ---------------------------------------------------------------------------

async function promptMyBooking(chatId: number, presetRef?: string) {
  if (presetRef) {
    setSession(chatId, { stage: "await_phone" });
    sessions.set(chatId, { ...(getSession(chatId) as Session), checkIn: undefined });
    // store pending action via a synthetic flag
    pendingActions.set(chatId, { action: "lookup", reference: normalizeRef(presetRef) });
    await sendMessage(chatId, `Send the <b>phone number</b> used for booking <code>${normalizeRef(presetRef)}</code>.`);
    return;
  }
  await sendMessage(
    chatId,
    "Send your booking reference and phone, e.g.\n<code>/mybooking HB-XXXXXX +2519...</code>"
  );
}

async function promptCancel(chatId: number, presetRef?: string) {
  if (presetRef) {
    pendingActions.set(chatId, { action: "cancel", reference: normalizeRef(presetRef) });
    await sendMessage(chatId, `Send the <b>phone number</b> used for booking <code>${normalizeRef(presetRef)}</code> to cancel.`);
    return;
  }
  await sendMessage(
    chatId,
    "Send your booking reference and phone, e.g.\n<code>/cancel HB-XXXXXX +2519...</code>"
  );
}

// Pending lookup/cancel actions (reference captured, awaiting phone).
type PendingAction = { action: "lookup" | "cancel"; reference: string };
const pendingActions = new Map<number, PendingAction>();

async function doLookup(chatId: number, reference: string, contact: { phone?: string; email?: string }) {
  const booking = await lookupBooking({ reference, phone: contact.phone, email: contact.email });
  if (!booking) {
    await sendMessage(chatId, "No matching booking found. Check the reference and phone number.");
    return;
  }
  await sendMessage(
    chatId,
    `📋 <b>${booking.reference}</b>\n` +
      `Status: <b>${booking.status}</b>\n` +
      `${booking.checkIn} → ${booking.checkOut}\n` +
      `${booking.adultCount} adult${booking.adultCount === 1 ? "" : "s"}${booking.childCount ? `, ${booking.childCount} child` : ""}\n` +
      `Total: ${formatMoney(booking.totalCost, booking.currency)} · Paid: ${formatMoney(
        Math.max(0, booking.totalCost - booking.balanceAmount),
        booking.currency
      )} · Balance: ${formatMoney(booking.balanceAmount, booking.currency)}`
  );
}

async function doCancel(chatId: number, reference: string, contact: { phone?: string; email?: string }) {
  const result = await cancelBookingByReference({ reference, phone: contact.phone, email: contact.email });
  if (!result.ok) {
    await sendMessage(chatId, result.message);
    return;
  }
  await sendMessage(chatId, `✅ Booking <code>${result.booking.reference}</code> cancelled.`);
  await notifyOwner(`❌ <b>Booking cancelled via Telegram</b>\n${result.booking.reference}`);
}

// ---------------------------------------------------------------------------
// Owner alerts
// ---------------------------------------------------------------------------

async function notifyOwner(text: string) {
  try {
    const s = await getSettings();
    const ownerChat = s.telegram?.chatId;
    if (!ownerChat) return;
    await sendMessage(ownerChat, text);
  } catch {}
}

async function ownerToday(chatId: number) {
  const ctx = await hotelAndSettings();
  if (!ctx) return;
  const { hotel, settings } = ctx;
  const today = calendarDateOf(new Date().toISOString(), propertyTimeZone(settings));
  const { bookings } = await import("../db");
  const { and: andOp, eq: eqOp, inArray } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(bookings)
    .where(
      andOp(eqOp(bookings.hotelId, hotel._id), inArray(bookings.status, ["confirmed", "checked_in"]))
    );
  const arrivals = rows.filter((b) => b.checkIn === today);
  const departures = rows.filter((b) => b.checkOut === today);
  const fmt = (b: (typeof rows)[number]) =>
    `${b.reference} · ${b.firstName} ${b.lastName}${b.phone ? ` · ${b.phone}` : ""}`;
  await sendMessage(
    chatId,
    `<b>Today (${today})</b>\n\n` +
      `Arrivals (${arrivals.length}):\n${arrivals.length ? arrivals.map(fmt).join("\n") : "—"}\n\n` +
      `Departures (${departures.length}):\n${departures.length ? departures.map(fmt).join("\n") : "—"}`
  );
}

// ---------------------------------------------------------------------------
// Update router
// ---------------------------------------------------------------------------

async function activeSettingsOrEnabled(): Promise<Settings | null> {
  const s = await getSettings();
  if (!s.features.telegramEnabled) return null;
  return s;
}

/**
 * Handle one Telegram update. Returns true when handled (so the webhook can
 * ack with 200) regardless of whether delivery succeeded.
 */
export async function processUpdate(update: TelegramUpdate): Promise<boolean> {
  const settings = await activeSettingsOrEnabled();
  if (!settings) return false;

  const cb = update.callback_query;
  if (cb) {
    const chatId = cb.message?.chat.id;
    if (chatId) {
      await answerCallbackQuery(cb.id);
      await handleData(chatId, cb.data || "", cb.from);
    }
    return true;
  }

  const msg = update.message;
  if (!msg || !msg.text) return !!msg;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start") || text === "/menu") {
    clearSession(chatId);
    pendingActions.delete(chatId);
    await sendMessage(chatId, `<b>${settings.property.name || "Welcome"}!</b>\n\nBook a room or manage your reservation.`, mainMenu());
    return true;
  }
  if (text.startsWith("/help")) {
    await sendMessage(chatId, helpText(settings), mainMenu());
    return true;
  }
  if (text.startsWith("/rooms")) {
    await sendMessage(chatId, await roomsText());
    return true;
  }
  if (text.startsWith("/book")) {
    await promptDates(chatId);
    return true;
  }
  if (text.startsWith("/today")) {
    if (String(chatId) === String(settings.telegram?.chatId)) await ownerToday(chatId);
    else await sendMessage(chatId, "Not authorised.");
    return true;
  }
  if (text.startsWith("/mybooking")) {
    const ref = text.split(/\s+/)[1];
    await promptMyBooking(chatId, ref);
    return true;
  }
  if (text.startsWith("/cancel")) {
    const ref = text.split(/\s+/)[1];
    await promptCancel(chatId, ref);
    return true;
  }

  await handleConversationText(chatId, text);
  return true;
}

async function handleData(chatId: number, data: string, from?: TelegramUser) {
  const [ns, action, ...rest] = data.split(":");

  if (ns === "menu") {
    if (action === "book") return promptDates(chatId);
    if (action === "rooms") return void (await sendMessage(chatId, await roomsText()));
    if (action === "help") return void (await sendMessage(chatId, helpText(await getSettings())));
    if (action === "mybooking") return promptMyBooking(chatId);
    if (action === "cancel") return promptCancel(chatId);
    if (action === "cancel_flow") {
      clearSession(chatId);
      pendingActions.delete(chatId);
      return void (await sendMessage(chatId, "Cancelled. What next?", mainMenu()));
    }
  }

  if (ns === "book") {
    if (action === "dates") return continueWithDates(chatId, rest[0], rest[1]);
    if (action === "guests") return continueWithGuests(chatId, Number(rest[0]), Number(rest[1] ?? 0));
    if (action === "room") return quoteAndConfirm(chatId, rest[0]);
  }
  void from;
}

async function handleConversationText(chatId: number, text: string) {
  const pending = pendingActions.get(chatId);
  if (pending) {
    pendingActions.delete(chatId);
    const contact = { phone: text };
    if (pending.action === "lookup") return doLookup(chatId, pending.reference, contact);
    return doCancel(chatId, pending.reference, contact);
  }

  const session = getSession(chatId);
  if (!session) {
    await sendMessage(chatId, "Type /start to see what I can do.", mainMenu());
    return;
  }

  if (session.stage === "await_dates") return parseDatesAndAskGuests(chatId, text);
  if (session.stage === "await_guests") return parseGuestsAndAskRoom(chatId, text);
  if (session.stage === "await_room") {
    await sendMessage(chatId, "Please tap one of the room-type buttons above, or /book to restart.");
    return;
  }
  if (session.stage === "await_phone") {
    const phoneMatch = text.match(/^\+?[0-9][0-9\s\-()]{5,19}$/);
    if (!phoneMatch) {
      await sendMessage(chatId, "That doesn't look like a phone number. Send it again, e.g. +2519...");
      return;
    }
    // If a booking already exists with this phone, confirm identity for a
    // in-progress booking; otherwise proceed to create with a name step.
    return createFromSession(chatId, text.trim());
  }
}

/** Validate the webhook secret from the URL path against settings. */
export async function webhookSecretValid(provided: string): Promise<boolean> {
  const s = await getSettings();
  if (!s.telegram?.webhookSecret) return false;
  return secretMatches(provided, s.telegram.webhookSecret);
}

export { contactMatches };
