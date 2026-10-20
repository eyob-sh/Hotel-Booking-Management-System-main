-- Phase 5: Telegram bot -------------------------------------------------------
-- Capture the Telegram user id on bookings made via the bot (nullable: web and
-- staff bookings never set it). Used for owner alerts / guest follow-ups.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "telegramId" varchar(32);

CREATE INDEX IF NOT EXISTS "bookings_telegramId_idx" ON "bookings" ("telegramId");
