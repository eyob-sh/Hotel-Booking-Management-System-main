import { db, notifications } from "../db";
import { desc, eq, inArray } from "drizzle-orm";
import { getSettings } from "./settings";

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
}
