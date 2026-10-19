CREATE TYPE "public"."booking_source" AS ENUM('web', 'phone', 'telegram', 'walkin');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('deposit', 'balance', 'refund', 'charge');--> statement-breakpoint
CREATE TYPE "public"."payment_provider_kind" AS ENUM('online', 'onsite');--> statement-breakpoint
CREATE TYPE "public"."payment_record_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'checked_in';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'checked_out';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'no_show';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'deposit_paid';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'partially_refunded';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_providers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"displayName" varchar(100) NOT NULL,
	"kind" "payment_provider_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bookingId" uuid NOT NULL,
	"providerId" varchar(64) NOT NULL,
	"type" "payment_kind" NOT NULL,
	"amount" double precision NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" "payment_record_status" DEFAULT 'pending' NOT NULL,
	"providerRef" varchar(255),
	"raw" jsonb,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_inventory" (
	"roomTypeId" uuid NOT NULL,
	"date" date NOT NULL,
	"totalRooms" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now(),
	CONSTRAINT "room_inventory_roomTypeId_date_pk" PRIMARY KEY("roomTypeId","date"),
	CONSTRAINT "room_inventory_reserved_ck" CHECK ("reserved" >= 0 AND "reserved" <= "totalRooms")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_types" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotelId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"maxAdults" integer DEFAULT 2 NOT NULL,
	"maxChildren" integer DEFAULT 0 NOT NULL,
	"basePrice" double precision NOT NULL,
	"roomCount" integer DEFAULT 1 NOT NULL,
	"photos" text[] DEFAULT '{}' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "roomTypeId" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reference" varchar(32);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "depositAmount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "balanceAmount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "currency" varchar(8) DEFAULT 'ETB' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source" "booking_source" DEFAULT 'web' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_bookingId_idx" ON "payments" USING btree ("bookingId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_providerId_idx" ON "payments" USING btree ("providerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_providerRef_idx" ON "payments" USING btree ("providerRef");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_type_idx" ON "payments" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_inventory_date_idx" ON "room_inventory" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_types_hotelId_idx" ON "room_types" USING btree ("hotelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_types_hotelId_active_idx" ON "room_types" USING btree ("hotelId","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_roomTypeId_idx" ON "bookings" USING btree ("roomTypeId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_reference_idx" ON "bookings" USING btree ("reference");
INSERT INTO "payment_providers" ("id", "displayName", "kind", "enabled", "sortOrder", "config") VALUES
('pay-at-arrival', 'Pay at arrival', 'onsite', true, 10, '{"instructions":"Pay in cash or by card when you arrive."}'),
('bank-transfer', 'Bank transfer', 'onsite', true, 20, '{"instructions":"Transfer to the property bank account and use your booking reference as the payment reference."}'),
('telebirr', 'Telebirr', 'online', true, 30, '{"mode":"mock","publicNote":"Demo mode - no real payment is taken."}'),
('stripe', 'Credit / debit card (Stripe)', 'online', false, 40, '{}'),
('paypal', 'PayPal', 'online', false, 50, '{}')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "room_types" ("_id", "hotelId", "name", "description", "maxAdults", "maxChildren", "basePrice", "roomCount")
SELECT gen_random_uuid(), h."_id", 'Standard Room', 'Standard room', 2, 0, h."pricePerNight", 1
FROM "hotels" h
WHERE NOT EXISTS (SELECT 1 FROM "room_types" rt WHERE rt."hotelId" = h."_id");
