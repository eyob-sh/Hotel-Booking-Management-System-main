CREATE TABLE IF NOT EXISTS "settings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "checkIn" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "checkOut" SET DATA TYPE date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settings_updatedAt_idx" ON "settings" USING btree ("updatedAt");