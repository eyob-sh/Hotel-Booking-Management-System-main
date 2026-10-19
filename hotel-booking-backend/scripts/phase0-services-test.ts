// Phase 0 service-level checks (settings/timezone/pricing/booking services).
// Run from the backend directory:  npx ts-node --transpile-only scripts/phase0-services-test.ts
// (Excluded from tsc build via tsconfig "exclude".)
import "dotenv/config";
import {
  calendarDateOf,
  defaultSettings,
  diffNights,
  ensureSettingsRow,
  getSettings,
  getPublicSettings,
  mergeSettings,
  toDisplayAmount,
} from "../src/services/settings";
import { depositFor, quoteNights } from "../src/services/pricing";
import { BookingConflictError, createBooking } from "../src/services/booking";
import { db, hotels, bookings, users } from "../src/db";
import { eq } from "drizzle-orm";

let passed = 0;
let failed = 0;
const failures: string[] = [];

const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail !== undefined ? JSON.stringify(detail) : ""}`);
  }
};

const TZ = "Africa/Addis_Ababa";

const expectThrow = async (name: string, fn: () => Promise<unknown>, match: RegExp) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e: any) {
    check(name, match.test(e?.message || ""), e?.message);
  }
};

(async () => {
  // ---- settings ----
  await ensureSettingsRow();
  const settings = await getSettings();
  check("settings: ETB + Addis default", settings.currency === "ETB" && settings.timezone === TZ);
  check("settings: prepayment full/100", settings.prepayment.mode === "full" && settings.prepayment.value === 100);

  const pub = await getPublicSettings();
  check("public settings strips telegram", !("telegram" in pub));

  // ---- timezone / calendar ----
  check(
    "calendarDateOf: ISO instant in Addis",
    calendarDateOf("2026-11-30T22:30:00.000Z", TZ) === "2026-12-01",
    calendarDateOf("2026-11-30T22:30:00.000Z", TZ)
  );
  check(
    "calendarDateOf: date-only passes through",
    calendarDateOf("2026-12-01", TZ) === "2026-12-01"
  );
  check("diffNights basic", diffNights("2026-12-01", "2026-12-04") === 3);
  check("diffNights same day", diffNights("2026-12-01", "2026-12-01") === 0);
  check("diffNights across leap Feb", diffNights("2028-02-28", "2028-03-01") === 2);

  // ---- pricing ----
  const full = quoteNights({ pricePerNight: 1000, nights: 3, settings });
  check("quote full prepay", full.totalStored === 3000 && full.deposit === 3000 && full.balance === 0);

  const pct = mergeSettings(settings, { prepayment: { mode: "percent", value: 50 } });
  check("deposit 50%", depositFor(3000, pct) === 1500);

  const fixed = mergeSettings(settings, { prepayment: { mode: "fixed", value: 700 } });
  check("deposit fixed 700", depositFor(3000, fixed) === 700);

  const none = mergeSettings(settings, { prepayment: { mode: "none", value: 0 } });
  check("deposit none", depositFor(3000, none) === 0);

  check("deposit clamps over total", depositFor(3000, fixed) <= 3000 && depositFor(3000, fixed) >= 0);

  const withRate = mergeSettings(settings, { usdRate: 130 });
  const usd = toDisplayAmount(2600, "USD", withRate);
  check("USD display conversion 2600/130 = 20", usd?.amount === 20 && usd.currency === "USD", usd);
  check("USD display without rate -> null", toDisplayAmount(2600, "USD", settings) === null);
  check("same-currency display -> null", toDisplayAmount(1000, "ETB", settings) === null);

  await expectThrow(
    "quote rejects 0 nights",
    async () => quoteNights({ pricePerNight: 1000, nights: 0, settings }),
    /at least 1 night/i
  );
  await expectThrow(
    "quote enforces maxNights",
    async () =>
      quoteNights({
        pricePerNight: 1000,
        nights: settings.maxNights + 1,
        settings,
      }),
    /Maximum stay/
  );

  // ---- booking service: double-booking protection ----
  const marker = "p0-svc@test.com";
  await db.delete(users).where(eq(users.email, marker));
  await db.delete(hotels).where(eq(hotels.name, "P0 Svc Hotel"));

  const [user] = await db
    .insert(users)
    .values({
      email: marker,
      password: "x",
      firstName: "P0",
      lastName: "Svc",
      role: "user",
    })
    .returning();

  const [hotel] = await db
    .insert(hotels)
    .values({
      userId: user._id,
      name: "P0 Svc Hotel",
      city: "Addis Ababa",
      country: "Ethiopia",
      description: "svc fixture",
      type: ["hotel"],
      adultCount: 2,
      childCount: 0,
      facilities: ["wifi"],
      pricePerNight: 1000,
      starRating: 4,
      imageUrls: ["https://example.com/a.jpg"],
      lastUpdated: new Date(),
    })
    .returning();

  const base = {
    userId: user._id,
    hotel,
    guest: { firstName: "A", lastName: "B", email: marker },
    adultCount: 2,
    childCount: 0,
    totalStored: 2000,
    status: "confirmed" as const,
    paymentStatus: "paid" as const,
    paymentMethod: "test",
  };

  const b1 = await createBooking({ ...base, checkIn: "2027-01-10", checkOut: "2027-01-12" });
  check("createBooking first stay ok", b1.checkIn === "2027-01-10" && b1.checkOut === "2027-01-12");

  await expectThrow(
    "createBooking rejects overlapping (double-booking)",
    () =>
      createBooking({
        ...base,
        adultCount: 1,
        checkIn: "2027-01-11",
        checkOut: "2027-01-13",
      }),
    /Not enough capacity/
  );

  await expectThrow(
    "createBooking rejects same dates, too many guests",
    () =>
      createBooking({
        ...base,
        adultCount: 1,
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
      }),
    /Not enough capacity/
  );

  const b2 = await createBooking({ ...base, checkIn: "2027-01-12", checkOut: "2027-01-14" });
  check("createBooking adjacent stay ok (no overlap)", Boolean(b2._id));

  const b3 = await createBooking({ ...base, adultCount: 1, checkIn: "2027-01-15", checkOut: "2027-01-16" });
  check("createBooking separate stay ok", Boolean(b3._id));

  const [hotelRow] = await db.select().from(hotels).where(eq(hotels._id, hotel._id));
  check(
    "analytics counters incremented inside tx",
    hotelRow.totalBookings === 3 && Number(hotelRow.totalRevenue) === 6000,
    { totalBookings: hotelRow.totalBookings, totalRevenue: hotelRow.totalRevenue }
  );

  // cleanup
  await db.delete(bookings).where(eq(bookings.userId, user._id));
  await db.delete(hotels).where(eq(hotels._id, hotel._id));
  await db.delete(users).where(eq(users._id, user._id));

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failed:", failures.join(" | "));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
