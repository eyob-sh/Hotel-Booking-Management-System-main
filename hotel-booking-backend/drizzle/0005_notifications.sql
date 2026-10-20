-- Phase 4: notifications outbox -------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "notification_status" AS ENUM ('pending', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'telegram', 'log');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "notifications" (
  "_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bookingId" uuid,
  "userId" uuid,
  "channel" "notification_channel" DEFAULT 'log' NOT NULL,
  "type" varchar(64) NOT NULL,
  "to" varchar(255),
  "subject" varchar(255),
  "body" text NOT NULL,
  "status" "notification_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "lastAttemptAt" timestamp with time zone,
  "sentAt" timestamp with time zone,
  "error" text,
  "meta" jsonb,
  "createdAt" timestamp with time zone DEFAULT now(),
  "updatedAt" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notifications_bookingId_idx" ON "notifications" ("bookingId");
CREATE INDEX IF NOT EXISTS "notifications_userId_idx" ON "notifications" ("userId");
CREATE INDEX IF NOT EXISTS "notifications_status_idx" ON "notifications" ("status");
CREATE INDEX IF NOT EXISTS "notifications_channel_idx" ON "notifications" ("channel");
CREATE INDEX IF NOT EXISTS "notifications_createdAt_idx" ON "notifications" ("createdAt");
