import { db, notifications, bookings, hotels } from "../db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSettings, calendarDateOf, propertyTimeZone } from "./settings";

export type NotificationType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_cancelled"
  | "payment_received"
  | "check_in_reminder"
  | "check_in"
  | "refund_issued";

type QueueInput = {
  bookingId?: string;
  userId?: string;
  type: NotificationType;
  to?: string;
  subject?: string;
  body: string;
  channel?: "email" | "sms" | "telegram" | "log";
  meta?: any;
};

export async function enqueueNotification(input: QueueInput) {
  const [row] = await db
    .insert(notifications)
    .values({
      bookingId: input.bookingId || null,
      userId: input.userId || null,
      channel: input.channel || "log",
      type: input.type,
      to: input.to || null,
      subject: input.subject || null,
      body: input.body,
      status: "pending",
      meta: input.meta || null,
    })
    .returning();
  return row;
}
async function sendEmail(to: string, subject: string, body: string) {
  try {
    const nodemailer = await import("nodemailer");
    const settings = await getSettings();
    const host = (settings as any).email?.host || process.env.SMTP_HOST;
    const port = (settings as any).email?.port || process.env.SMTP_PORT;
    const user = (settings as any).email?.user || process.env.SMTP_USER;
    const pass = (settings as any).email?.pass || process.env.SMTP_PASS;
    if (!host) return true;
    const transporter = nodemailer.createTransport({
      host,
      port: port ? Number(port) : 587,
      secure: false,
      auth: user && pass ? { user, pass } : undefined,
    });
    await transporter.sendMail({
      from: (settings as any).email?.from || process.env.EMAIL_FROM || user || "no-reply@hotel",
      to,
      subject,
      text: body,
    });
    return true;
  } catch (e) {
    console.log("[notify:email:fallback]", to, subject);
    return true;
  }
}

async function sendSms(to: string, body: string) {
  console.log('[notify:sms]', to, body);
  return true;
}
async function sendTelegram(body: string) {
  try {
    const settings = await getSettings();
    const token = settings.telegram?.botToken;
    const chatId = settings.telegram?.chatId;
    if (!token || !chatId) return true;
    const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: body }) });
    return true;
  } catch (e) { console.log('[notify:telegram:fallback]', body); return true; }
}
export async function processNotifications(limit = 20) {
  const pending = await db.select().from(notifications).where(inArray(notifications.status, ['pending'])).orderBy(desc(notifications.createdAt)).limit(limit);
  for (const n of pending) {
    try {
      await db.update(notifications).set({ attempts: (n.attempts || 0) + 1, lastAttemptAt: new Date() }).where(eq(notifications._id, n._id));
      if (n.channel === 'email' && n.to) await sendEmail(n.to, n.subject || n.type, n.body);
      else if (n.channel === 'sms' && n.to) await sendSms(n.to, n.body);
      else if (n.channel === 'telegram') await sendTelegram(n.body);
      await db.update(notifications).set({ status: 'sent', sentAt: new Date(), error: null }).where(eq(notifications._id, n._id));
    } catch (e: any) {
      await db.update(notifications).set({ status: 'failed', error: (e?.message || '').slice(0, 500) }).where(eq(notifications._id, n._id));
    }
  }
}
export function startNotificationWorker(intervalMs = 30000) {
  processNotifications().catch(() => {});
  setInterval(() => { processNotifications().catch(() => {}); }, intervalMs);
  // Check-in reminders are date-based, so a slower hourly scan is plenty.
  queueCheckInReminders().catch(() => {});
  setInterval(() => { queueCheckInReminders().catch(() => {}); }, 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Check-in reminders — queue one notification per confirmed booking whose
// check-in is tomorrow (property timezone). Idempotent: a booking already
// having a check_in_reminder notification is skipped, so re-running the scan
// (restarts, overlapping scans) never double-sends.
// ---------------------------------------------------------------------------

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export async function queueCheckInReminders(): Promise<number> {
  const settings = await getSettings();
  const today = calendarDateOf(new Date().toISOString(), propertyTimeZone(settings));
  const tomorrow = addDays(today, 1);

  const upcoming = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.checkIn, tomorrow), eq(bookings.status, "confirmed")));

  if (upcoming.length === 0) return 0;

  const existing = await db
    .select({ bookingId: notifications.bookingId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "check_in_reminder"),
        inArray(
          notifications.bookingId,
          upcoming.map((b) => b._id)
        )
      )
    );
  const alreadyQueued = new Set(existing.map((r) => r.bookingId));

  let queued = 0;
  for (const b of upcoming) {
    if (alreadyQueued.has(b._id)) continue;
    try {
      const [hotel] = await db
        .select({ name: hotels.name })
        .from(hotels)
        .where(eq(hotels._id, b.hotelId))
        .limit(1);
      await enqueueNotification({
        bookingId: b._id,
        userId: b.userId ?? undefined,
        type: "check_in_reminder",
        to: b.email || b.phone || undefined,
        subject: `Reminder: check-in tomorrow at ${hotel?.name ?? "the property"}`,
        body:
          `Hi ${b.firstName}, this is a reminder that your check-in is tomorrow ` +
          `(${b.checkIn}). Reference: ${b.reference ?? b._id}.`,
        channel: "email",
        meta: { hotelId: b.hotelId },
      });
      queued++;
    } catch (error) {
      console.error("notifications: failed to queue check-in reminder:", error);
    }
  }
  return queued;
}
