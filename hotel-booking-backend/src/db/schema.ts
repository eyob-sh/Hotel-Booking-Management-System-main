import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  date,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums (mirror the Mongoose string enums)
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "user",
  "admin",
  "hotel_owner",
]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "refunded",
  "checked_in",
  "checked_out",
  "no_show",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
  "deposit_paid",
  "partially_refunded",
]);

export const bookingSourceEnum = pgEnum("booking_source", [
  "web",
  "phone",
  "telegram",
  "walkin",
]);

export const paymentKindEnum = pgEnum("payment_kind", [
  "deposit",
  "balance",
  "refund",
  "charge",
]);

export const paymentProviderKindEnum = pgEnum("payment_provider_kind", [
  "online",
  "onsite",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "sms",
  "telegram",
  "log",
]);

export const paymentRecordStatusEnum = pgEnum("payment_record_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    // Nullable: phone-only accounts (Phase 2) have no email.
    email: varchar("email", { length: 255 }),
    password: varchar("password", { length: 255 }).notNull(),
    firstName: varchar("firstName", { length: 255 }).notNull(),
    lastName: varchar("lastName", { length: 255 }).notNull(),
    role: userRoleEnum("role").notNull().default("user"),
    // E.164 phone — first-class identity for phone-only accounts (Phase 2).
    phone: varchar("phone", { length: 50 }),
    phoneVerified: boolean("phoneVerified").notNull().default(false),
    address: jsonb("address"),
    preferences: jsonb("preferences"),
    totalBookings: integer("totalBookings").notNull().default(0),
    totalSpent: doublePrecision("totalSpent").notNull().default(0),
    lastLogin: timestamp("lastLogin", { withTimezone: true }),
    isActive: boolean("isActive").notNull().default(true),
    emailVerified: boolean("emailVerified").notNull().default(false),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    phoneIdx: uniqueIndex("users_phone_idx").on(t.phone),
  })
);

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export const hotels = pgTable(
  "hotels",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    // stored as a plain UUID reference (no FK) to mirror Mongo's loose refs
    userId: uuid("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    city: varchar("city", { length: 255 }).notNull(),
    country: varchar("country", { length: 255 }).notNull(),
    description: text("description").notNull(),
    type: text("type").array().notNull(),
    adultCount: integer("adultCount").notNull(),
    childCount: integer("childCount").notNull(),
    facilities: text("facilities").array().notNull(),
    pricePerNight: doublePrecision("pricePerNight").notNull(),
    starRating: integer("starRating").notNull(),
    imageUrls: text("imageUrls").array().notNull(),
    lastUpdated: timestamp("lastUpdated", { withTimezone: true }).notNull(),

    // nested / JSONB fields (kept as-is for a fast, faithful migration)
    location: jsonb("location"),
    contact: jsonb("contact"),
    policies: jsonb("policies"),
    amenities: jsonb("amenities"),

    // analytics aggregates
    totalBookings: integer("totalBookings").notNull().default(0),
    totalRevenue: doublePrecision("totalRevenue").notNull().default(0),
    averageRating: doublePrecision("averageRating").notNull().default(0),
    reviewCount: integer("reviewCount").notNull().default(0),
    occupancyRate: doublePrecision("occupancyRate").notNull().default(0),
    isActive: boolean("isActive").notNull().default(true),
    isFeatured: boolean("isFeatured").notNull().default(false),

    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("hotels_userId_idx").on(t.userId),
    cityIdx: index("hotels_city_idx").on(t.city),
    countryIdx: index("hotels_country_idx").on(t.country),
    priceIdx: index("hotels_price_idx").on(t.pricePerNight),
    starIdx: index("hotels_star_idx").on(t.starRating),
    cityStarIdx: index("hotels_city_star_idx").on(t.city, t.starRating),
    priceStarIdx: index("hotels_price_star_idx").on(
      t.pricePerNight,
      t.starRating
    ),
    userIdCreatedIdx: index("hotels_userId_created_idx").on(
      t.userId,
      t.createdAt
    ),
  })
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const bookings = pgTable(
  "bookings",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    // Nullable: guest checkout (Phase 2) creates bookings with no account.
    userId: uuid("userId"),
    hotelId: uuid("hotelId").notNull(),
    firstName: varchar("firstName", { length: 255 }).notNull(),
    lastName: varchar("lastName", { length: 255 }).notNull(),
    // Nullable: phone-only guests land here from Phase 2 on; API validation
    // decides which of email/phone is required per booking source.
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    /** Telegram user id when a booking originated from the bot (Phase 5). */
    telegramId: varchar("telegramId", { length: 32 }),
    adultCount: integer("adultCount").notNull(),
    childCount: integer("childCount").notNull(),
    // Stored as plain calendar dates (YYYY-MM-DD) interpreted in the
    // property timezone (settings.timezone) — never as instants.
    checkIn: date("checkIn").notNull(),
    checkOut: date("checkOut").notNull(),
    // Set when booked against a room type (Phase 1); null = legacy
    // property-capacity booking.
    roomTypeId: uuid("roomTypeId"),
    // Human-readable confirmation code derived from _id (e.g. HB-3F2A9C11).
    reference: varchar("reference", { length: 32 }),
    /** Server-computed stay total in `currency` (settings.currency at book time). */
    totalCost: doublePrecision("totalCost").notNull(),
    /** Prepayment amount charged (online) or owed (transfer) up front. */
    depositAmount: doublePrecision("depositAmount").notNull().default(0),
    /** Remainder due at the property. */
    balanceAmount: doublePrecision("balanceAmount").notNull().default(0),
    /** Stored currency at booking time (ETB by default). */
    currency: varchar("currency", { length: 8 }).notNull().default("ETB"),
    source: bookingSourceEnum("source").notNull().default("web"),
    status: bookingStatusEnum("status").notNull().default("pending"),
    paymentStatus: paymentStatusEnum("paymentStatus")
      .notNull()
      .default("pending"),
    paymentMethod: varchar("paymentMethod", { length: 100 }),
    specialRequests: text("specialRequests"),
    cancellationReason: text("cancellationReason"),
    refundAmount: doublePrecision("refundAmount").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("bookings_userId_idx").on(t.userId),
    hotelIdIdx: index("bookings_hotelId_idx").on(t.hotelId),
    emailIdx: index("bookings_email_idx").on(t.email),
    checkInIdx: index("bookings_checkIn_idx").on(t.checkIn),
    statusIdx: index("bookings_status_idx").on(t.status),
    paymentStatusIdx: index("bookings_paymentStatus_idx").on(t.paymentStatus),
    userIdCreatedIdx: index("bookings_userId_created_idx").on(
      t.userId,
      t.createdAt
    ),
    hotelCheckInIdx: index("bookings_hotelId_checkIn_idx").on(
      t.hotelId,
      t.checkIn
    ),
    statusCreatedIdx: index("bookings_status_created_idx").on(
      t.status,
      t.createdAt
    ),
    paymentCreatedIdx: index("bookings_paymentStatus_created_idx").on(
      t.paymentStatus,
      t.createdAt
    ),
    checkInStatusIdx: index("bookings_checkIn_status_idx").on(
      t.checkIn,
      t.status
    ),
    roomTypeIdIdx: index("bookings_roomTypeId_idx").on(t.roomTypeId),
    referenceIdx: uniqueIndex("bookings_reference_idx").on(t.reference),
  })
);

// ---------------------------------------------------------------------------
// Room types + inventory (Phase 1)
//
// The property sells room types ("Standard", "Deluxe", ...) with a fixed
// number of physical rooms each. `room_inventory` is the single source of
// truth for how many rooms of a type are already reserved on a date —
// bookings with a roomTypeId reserve rows here inside the booking
// transaction (atomic UPDATE ... WHERE reserved < totalRooms).
//
// Rows are created lazily (ensure) for any night a booking touches; a
// missing row means nothing is reserved yet, so availability falls back to
// `room_types.roomCount`.
// ---------------------------------------------------------------------------

export const roomTypes = pgTable(
  "room_types",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    hotelId: uuid("hotelId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    maxAdults: integer("maxAdults").notNull().default(2),
    maxChildren: integer("maxChildren").notNull().default(0),
    /** Nightly rate in the stored currency (ETB by default). */
    basePrice: doublePrecision("basePrice").notNull(),
    /** Physical rooms of this type. */
    roomCount: integer("roomCount").notNull().default(1),
    photos: text("photos").array().notNull().default(sql`'{}'`),
    sortOrder: integer("sortOrder").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    hotelIdx: index("room_types_hotelId_idx").on(t.hotelId),
    hotelActiveIdx: index("room_types_hotelId_active_idx").on(
      t.hotelId,
      t.active
    ),
  })
);

export const roomInventory = pgTable(
  "room_inventory",
  {
    roomTypeId: uuid("roomTypeId").notNull(),
    /** Calendar date YYYY-MM-DD (property timezone) this row covers. */
    date: date("date").notNull(),
    totalRooms: integer("totalRooms").notNull(),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roomTypeId, t.date] }),
    dateIdx: index("room_inventory_date_idx").on(t.date),
    reservedCk: check(
      "room_inventory_reserved_ck",
      sql`"reserved" >= 0 AND "reserved" <= "totalRooms"`
    ),
  })
);

// ---------------------------------------------------------------------------
// Payment providers (Phase 1) — rows seeded by migration 0002; `enabled` is
// the settings toggle, `config` holds per-provider options (telebirr mode,
// bank instructions, ...). Live code classes live in src/payments/.
// ---------------------------------------------------------------------------

export const paymentProviders = pgTable("payment_providers", {
  id: varchar("id", { length: 64 }).primaryKey(),
  displayName: varchar("displayName", { length: 100 }).notNull(),
  kind: paymentProviderKindEnum("kind").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  sortOrder: integer("sortOrder").notNull().default(0),
  config: jsonb("config").notNull().default(sql`'{}'`),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// Payments ledger (Phase 1) — every money movement owed or received:
// deposit (prepayment owed), balance (due at property), charge (money in),
// refund (money out). `providerRef` links back to the provider intent and
// is what webhooks match on.
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    bookingId: uuid("bookingId").notNull(),
    providerId: varchar("providerId", { length: 64 }).notNull(),
    type: paymentKindEnum("type").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    status: paymentRecordStatusEnum("status").notNull().default("pending"),
    providerRef: varchar("providerRef", { length: 255 }),
    raw: jsonb("raw"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    bookingIdx: index("payments_bookingId_idx").on(t.bookingId),
    providerIdx: index("payments_providerId_idx").on(t.providerId),
    statusIdx: index("payments_status_idx").on(t.status),
    providerRefIdx: index("payments_providerRef_idx").on(t.providerRef),
    typeIdx: index("payments_type_idx").on(t.type),
  })
);

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  "reviews",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    userId: uuid("userId").notNull(),
    hotelId: uuid("hotelId").notNull(),
    bookingId: uuid("bookingId"),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull(),
    categories: jsonb("categories").notNull(),
    isVerified: boolean("isVerified").notNull().default(false),
    helpfulCount: integer("helpfulCount").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("reviews_userId_idx").on(t.userId),
    hotelIdIdx: index("reviews_hotelId_idx").on(t.hotelId),
    bookingIdIdx: index("reviews_bookingId_idx").on(t.bookingId),
    ratingIdx: index("reviews_rating_idx").on(t.rating),
    hotelRatingIdx: index("reviews_hotelId_rating_idx").on(
      t.hotelId,
      t.rating
    ),
    userIdCreatedIdx: index("reviews_userId_created_idx").on(
      t.userId,
      t.createdAt
    ),
    hotelCreatedIdx: index("reviews_hotelId_created_idx").on(
      t.hotelId,
      t.createdAt
    ),
  })
);

// ---------------------------------------------------------------------------
// Favorites (unique per user+hotel, as in Mongo)
// ---------------------------------------------------------------------------

export const favorites = pgTable(
  "favorites",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    userId: uuid("userId").notNull(),
    hotelId: uuid("hotelId").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdIdx: index("favorites_userId_idx").on(t.userId),
    hotelIdIdx: index("favorites_hotelId_idx").on(t.hotelId),
    userHotelIdx: uniqueIndex("favorites_userId_hotelId_idx").on(
      t.userId,
      t.hotelId
    ),
  })
);

// ---------------------------------------------------------------------------
// Analytics (defined in Mongo but not currently queried by any route;
// kept for parity / future use)
// ---------------------------------------------------------------------------

export const analytics = pgTable(
  "analytics",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    metrics: jsonb("metrics").notNull(),
    breakdown: jsonb("breakdown").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    dateIdx: index("analytics_date_idx").on(t.date),
  })
);

// ---------------------------------------------------------------------------
// Settings (singleton row, id = "main")
// Site-wide configuration: timezone, currency, prepayment policy, feature
// flags, branding and (secret) Telegram credentials. The JSONB payload is
// typed by `Settings` in src/services/settings.ts.
// ---------------------------------------------------------------------------

export const settings = pgTable(
  "settings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    updatedAtIdx: index("settings_updatedAt_idx").on(t.updatedAt),
  })
);

// ---------------------------------------------------------------------------
// Notifications outbox (Phase 4) — queued guest/staff messages. Rows are
// written by booking/payment events and drained by the notification worker
// (src/services/notifications.ts), which dispatches per `channel`.
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    _id: uuid("_id").primaryKey().defaultRandom(),
    bookingId: uuid("bookingId"),
    userId: uuid("userId"),
    channel: notificationChannelEnum("channel").notNull().default("log"),
    type: varchar("type", { length: 64 }).notNull(),
    to: varchar("to", { length: 255 }),
    subject: varchar("subject", { length: 255 }),
    body: text("body").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("lastAttemptAt", { withTimezone: true }),
    sentAt: timestamp("sentAt", { withTimezone: true }),
    error: text("error"),
    meta: jsonb("meta"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    bookingIdx: index("notifications_bookingId_idx").on(t.bookingId),
    userIdx: index("notifications_userId_idx").on(t.userId),
    statusIdx: index("notifications_status_idx").on(t.status),
    channelIdx: index("notifications_channel_idx").on(t.channel),
    createdIdx: index("notifications_createdAt_idx").on(t.createdAt),
  })
);

export type Notification = typeof notifications.$inferSelect;

// Convenience type aliases (rough equivalents of the old Mongoose docs)
export type User = typeof users.$inferSelect;
export type Hotel = typeof hotels.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type Analytics = typeof analytics.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type RoomType = typeof roomTypes.$inferSelect;
export type RoomInventoryRow = typeof roomInventory.$inferSelect;
export type PaymentProviderRow = typeof paymentProviders.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
