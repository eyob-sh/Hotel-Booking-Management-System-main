CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'hotel_owner');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"hotelId" uuid NOT NULL,
	"firstName" varchar(255) NOT NULL,
	"lastName" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(50),
	"adultCount" integer NOT NULL,
	"childCount" integer NOT NULL,
	"checkIn" timestamp with time zone NOT NULL,
	"checkOut" timestamp with time zone NOT NULL,
	"totalCost" double precision NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"paymentStatus" "payment_status" DEFAULT 'pending' NOT NULL,
	"paymentMethod" varchar(100),
	"specialRequests" text,
	"cancellationReason" text,
	"refundAmount" double precision DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "favorites" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"hotelId" uuid NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hotels" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"city" varchar(255) NOT NULL,
	"country" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"type" text[] NOT NULL,
	"adultCount" integer NOT NULL,
	"childCount" integer NOT NULL,
	"facilities" text[] NOT NULL,
	"pricePerNight" double precision NOT NULL,
	"starRating" integer NOT NULL,
	"imageUrls" text[] NOT NULL,
	"lastUpdated" timestamp with time zone NOT NULL,
	"location" jsonb,
	"contact" jsonb,
	"policies" jsonb,
	"amenities" jsonb,
	"totalBookings" integer DEFAULT 0 NOT NULL,
	"totalRevenue" double precision DEFAULT 0 NOT NULL,
	"averageRating" double precision DEFAULT 0 NOT NULL,
	"reviewCount" integer DEFAULT 0 NOT NULL,
	"occupancyRate" double precision DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"isFeatured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"hotelId" uuid NOT NULL,
	"bookingId" uuid,
	"rating" integer NOT NULL,
	"comment" text NOT NULL,
	"categories" jsonb NOT NULL,
	"isVerified" boolean DEFAULT false NOT NULL,
	"helpfulCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"firstName" varchar(255) NOT NULL,
	"lastName" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"phone" varchar(50),
	"address" jsonb,
	"preferences" jsonb,
	"totalBookings" integer DEFAULT 0 NOT NULL,
	"totalSpent" double precision DEFAULT 0 NOT NULL,
	"lastLogin" timestamp with time zone,
	"isActive" boolean DEFAULT true NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_date_idx" ON "analytics" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_userId_idx" ON "bookings" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_hotelId_idx" ON "bookings" USING btree ("hotelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_email_idx" ON "bookings" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_checkIn_idx" ON "bookings" USING btree ("checkIn");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_paymentStatus_idx" ON "bookings" USING btree ("paymentStatus");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_userId_created_idx" ON "bookings" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_hotelId_checkIn_idx" ON "bookings" USING btree ("hotelId","checkIn");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_status_created_idx" ON "bookings" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_paymentStatus_created_idx" ON "bookings" USING btree ("paymentStatus","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_checkIn_status_idx" ON "bookings" USING btree ("checkIn","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_userId_idx" ON "favorites" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_hotelId_idx" ON "favorites" USING btree ("hotelId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "favorites_userId_hotelId_idx" ON "favorites" USING btree ("userId","hotelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_userId_idx" ON "hotels" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_city_idx" ON "hotels" USING btree ("city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_country_idx" ON "hotels" USING btree ("country");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_price_idx" ON "hotels" USING btree ("pricePerNight");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_star_idx" ON "hotels" USING btree ("starRating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_city_star_idx" ON "hotels" USING btree ("city","starRating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_price_star_idx" ON "hotels" USING btree ("pricePerNight","starRating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hotels_userId_created_idx" ON "hotels" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_userId_idx" ON "reviews" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_hotelId_idx" ON "reviews" USING btree ("hotelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_bookingId_idx" ON "reviews" USING btree ("bookingId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_rating_idx" ON "reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_hotelId_rating_idx" ON "reviews" USING btree ("hotelId","rating");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_userId_created_idx" ON "reviews" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_hotelId_created_idx" ON "reviews" USING btree ("hotelId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");