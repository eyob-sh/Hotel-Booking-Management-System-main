// Phase 0 HTTP contract checks (settings/RBAC/payment gates/ownership).
// Run from the backend directory (resolves .env + node_modules from cwd):
//   node scripts/phase0-http-test.cjs
// NOTE: register+login share a 10 req/15min IP limiter — restart the backend
// (or wait 15 min) between runs, or re-runs will 429 at register #3.
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const { Client } = require("pg");

const BASE = "http://localhost:7002/api";
let passed = 0;
let failed = 0;
const failures = [];

const check = (name, cond, detail) => {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail !== undefined ? JSON.stringify(detail) : ""}`);
  }
};

const req = async (method, url, opts = {}) => {
  const headers = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const setCookies =
    res.headers.getSetCookie && typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data, cookie };
};

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // ---- cleanup from any previous run ----
  await pg.query(`DELETE FROM bookings WHERE email LIKE 'p0-%@test.com'`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P0 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p0-%@test.com'`);

  // ---- register 4 users (auth limiter: 10 req/15min total -> 4 reg + 4 login = 8) ----
  const emails = {
    owner: "p0-owner@test.com",
    admin: "p0-admin@test.com",
    guest: "p0-guest@test.com",
    stranger: "p0-stranger@test.com",
  };
  const ids = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/users/register`, {
      body: { firstName: "P0", lastName: key, email, password: "password123" },
    });
    check(`register ${key}`, r.status === 200 && r.data?.userId, r);
    ids[key] = r.data.userId;
  }

  // ---- assign roles + create hotel fixture + booking fixture ----
  await pg.query(`UPDATE users SET role='hotel_owner' WHERE _id=$1`, [ids.owner]);
  await pg.query(`UPDATE users SET role='admin' WHERE _id=$1`, [ids.admin]);

  const hotelRes = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P0 Test Hotel','Addis Ababa','Ethiopia','Phase 0 fixture',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],1000,4,ARRAY['https://example.com/a.jpg']::text[], now())
     RETURNING "_id"`,
    [ids.owner]
  );
  const hotelId = hotelRes.rows[0]._id;

  const bookingRes = await pg.query(
    `INSERT INTO bookings ("userId","hotelId","firstName","lastName","email","phone","adultCount","childCount","checkIn","checkOut","totalCost","status","paymentStatus","paymentMethod")
     VALUES ($1,$2,'P0','Guest','p0-guest@test.com','+251911223344',2,0,'2026-12-01','2026-12-03',2000,'confirmed','paid','stripe')
     RETURNING "_id"`,
    [ids.guest, hotelId]
  );
  const bookingId = bookingRes.rows[0]._id;
  await pg.query(`UPDATE hotels SET "totalBookings"=1, "totalRevenue"=2000 WHERE "_id"=$1`, [hotelId]);
  await pg.query(`UPDATE users SET "totalBookings"=1, "totalSpent"=2000 WHERE "_id"=$1`, [ids.guest]);

  // ---- login (JWT now carries the roles assigned above) ----
  const cookies = {};
  const roles = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/auth/login`, {
      body: { email, password: "password123" },
    });
    check(`login ${key}`, r.status === 200 && r.cookie.includes("auth_token"), r.status);
    cookies[key] = r.cookie;
    roles[key] = r.data?.user?.role;
  }
  check("roles assigned (owner)", roles.owner === "hotel_owner", roles.owner);
  check("roles assigned (admin)", roles.admin === "admin", roles.admin);

  // ---- A. public settings ----
  const pub = await req("GET", `${BASE}/settings/public`);
  check("GET /settings/public 200", pub.status === 200, pub.status);
  check("public: currency ETB", pub.data?.currency === "ETB", pub.data?.currency);
  check("public: timezone Addis_Ababa", pub.data?.timezone === "Africa/Addis_Ababa", pub.data?.timezone);
  check("public: prepayment full/100", pub.data?.prepayment?.mode === "full" && pub.data?.prepayment?.value === 100, pub.data?.prepayment);
  check("public: freeCancellationHours 48", pub.data?.freeCancellationHours === 48, pub.data?.freeCancellationHours);
  check("public: allowPayAtProperty true", pub.data?.allowPayAtProperty === true, pub.data?.allowPayAtProperty);
  check("public: no telegram secrets", !("telegram" in (pub.data || {})), Object.keys(pub.data || {}));

  // ---- B/C. settings RBAC ----
  const guestGetSettings = await req("GET", `${BASE}/settings`, { cookie: cookies.guest });
  check("GET /settings as guest -> 403", guestGetSettings.status === 403, guestGetSettings.status);

  const guestPutSettings = await req("PUT", `${BASE}/settings`, {
    cookie: cookies.guest,
    body: { currency: "USD" },
  });
  check("PUT /settings as guest -> 403", guestPutSettings.status === 403, guestPutSettings.status);

  const ownerGetSettings = await req("GET", `${BASE}/settings`, { cookie: cookies.owner });
  check("GET /settings as owner -> 200", ownerGetSettings.status === 200, ownerGetSettings.status);

  const adminPut = await req("PUT", `${BASE}/settings`, {
    cookie: cookies.admin,
    body: { minNights: 1, junkKey: "should-be-dropped", currency: "ETB" },
  });
  check("PUT /settings as admin -> 200", adminPut.status === 200, adminPut);
  check("PUT drops unknown keys", !("junkKey" in (adminPut.data || {})), Object.keys(adminPut.data || {}));
  const adminGet = await req("GET", `${BASE}/settings`, { cookie: cookies.admin });
  check(
    "admin GET: bot token never echoed (write-only)",
    !("botToken" in (adminGet.data?.telegram || {})) &&
      typeof adminGet.data?.telegram?.botTokenConfigured === "boolean",
    adminGet.data?.telegram
  );

  // Telegram secret is write-only: setting it works, reading it back does not,
  // and a client round-tripping the sanitized object must not wipe the token.
  const tgSet = await req("PUT", `${BASE}/settings`, {
    cookie: cookies.admin,
    body: { telegram: { botToken: "p0-test-token", chatId: "4242" } },
  });
  check(
    "PUT telegram token -> 200 configured=true, token not echoed",
    tgSet.status === 200 &&
      tgSet.data?.telegram?.botTokenConfigured === true &&
      !("botToken" in (tgSet.data?.telegram || {})),
    tgSet.data?.telegram
  );

  const tgRoundTrip = await req("PUT", `${BASE}/settings`, {
    cookie: cookies.admin,
    body: { minNights: 1, telegram: { botTokenConfigured: true, chatId: "4242" } },
  });
  const tgAfter = await req("GET", `${BASE}/settings`, { cookie: cookies.admin });
  check(
    "round-tripped sanitized object does not wipe token",
    tgRoundTrip.status === 200 && tgAfter.data?.telegram?.botTokenConfigured === true,
    { roundTrip: tgRoundTrip.status, telegram: tgAfter.data?.telegram }
  );

  const tgClear = await req("PUT", `${BASE}/settings`, {
    cookie: cookies.admin,
    body: { telegram: { botToken: "" } },
  });
  const tgCleared = await req("GET", `${BASE}/settings`, { cookie: cookies.admin });
  check(
    "clearing token -> configured=false",
    tgClear.status === 200 && tgCleared.data?.telegram?.botTokenConfigured === false,
    tgCleared.data?.telegram
  );

  // ---- E. booking visibility ----
  const seeAs = async (who) => req("GET", `${BASE}/bookings/${bookingId}`, { cookie: cookies[who] });
  check("GET booking as guest(self) -> 200", (await seeAs("guest")).status === 200);
  check("GET booking as admin -> 200", (await seeAs("admin")).status === 200);
  check("GET booking as hotel owner -> 200", (await seeAs("owner")).status === 200);
  const strangerSee = await seeAs("stranger");
  check("GET booking as stranger -> 403", strangerSee.status === 403, strangerSee.status);

  // ---- F. status changes ----
  const patchStatus = (who, body) =>
    req("PATCH", `${BASE}/bookings/${bookingId}/status`, { cookie: cookies[who], body });

  const s1 = await patchStatus("stranger", { status: "cancelled" });
  check("stranger PATCH status -> 403", s1.status === 403, s1.status);

  const s2 = await patchStatus("guest", { status: "confirmed" });
  check("self PATCH status=confirmed -> 403", s2.status === 403, s2.status);

  const s3 = await patchStatus("guest", { status: "cancelled", cancellationReason: "changed plans" });
  check("self PATCH status=cancelled -> 200", s3.status === 200, s3);
  check("self-cancel stored reason", s3.data?.cancellationReason === "changed plans", s3.data?.cancellationReason);

  const s4 = await patchStatus("admin", { status: "confirmed" });
  check("admin restore -> confirmed 200", s4.status === 200 && s4.data?.status === "confirmed", s4);

  const s5 = await patchStatus("owner", { status: "refunded" });
  check("owner PATCH status=refunded -> 403", s5.status === 403, s5.status);

  const s6 = await patchStatus("owner", { status: "completed" });
  check("owner PATCH status=completed -> 200", s6.status === 200 && s6.data?.status === "completed", s6);

  const s7 = await patchStatus("admin", { status: "confirmed" });
  check("admin restore 2", s7.status === 200, s7.status);

  // ---- G. payment status ----
  const patchPayment = (who, body) =>
    req("PATCH", `${BASE}/bookings/${bookingId}/payment`, { cookie: cookies[who], body });

  const p1 = await patchPayment("guest", { paymentStatus: "paid" });
  check("self PATCH payment -> 403", p1.status === 403, p1.status);

  const p2 = await patchPayment("owner", { paymentStatus: "failed" });
  check("owner PATCH payment -> 200", p2.status === 200 && p2.data?.paymentStatus === "failed", p2);

  const p3 = await patchPayment("admin", { paymentStatus: "paid" });
  check("admin PATCH payment -> 200", p3.status === 200, p3.status);

  // ---- hotel-scoped listing ----
  const hotelListOwner = await req("GET", `${BASE}/bookings/hotel/${hotelId}`, { cookie: cookies.owner });
  check("owner GET hotel bookings -> 200", hotelListOwner.status === 200, hotelListOwner.status);
  const hotelListGuest = await req("GET", `${BASE}/bookings/hotel/${hotelId}`, { cookie: cookies.guest });
  check("guest GET hotel bookings -> 403", hotelListGuest.status === 403, hotelListGuest.status);

  // ---- my-bookings ----
  const mine = await req("GET", `${BASE}/my-bookings`, { cookie: cookies.guest });
  check("my-bookings contains fixture", mine.status === 200 && JSON.stringify(mine.data).includes(bookingId), mine.status);

  // ---- I/J/K/L. payment-intent + confirm (server-authoritative pricing) ----
  const iso = (d) => `${d}T00:00:00.000Z`;
  const intent = await req("POST", `${BASE}/hotels/${hotelId}/bookings/payment-intent`, {
    cookie: cookies.guest,
    body: { checkIn: iso("2026-12-05"), checkOut: iso("2026-12-08") },
  });
  check(
    "payment-intent: ETB w/o rate -> clear 400",
    intent.status === 400 && /cannot be charged online/.test(intent.data?.message || ""),
    intent
  );

  const intentNoNights = await req("POST", `${BASE}/hotels/${hotelId}/bookings/payment-intent`, {
    cookie: cookies.guest,
    body: {},
  });
  check("payment-intent: missing dates -> 400", intentNoNights.status === 400, intentNoNights.status);

  const intentBadNights = await req("POST", `${BASE}/hotels/${hotelId}/bookings/payment-intent`, {
    cookie: cookies.guest,
    body: { checkIn: iso("2026-12-08"), checkOut: iso("2026-12-05") },
  });
  check("payment-intent: reversed dates -> 400", intentBadNights.status === 400, intentBadNights.status);

  const confirmBody = {
    paymentIntentId: "pi_fake_123",
    firstName: "P0",
    lastName: "Guest",
    email: "p0-guest@test.com",
    phone: "+251911223344",
    adultCount: 2,
    childCount: 0,
    checkIn: iso("2026-12-10"),
    checkOut: iso("2026-12-12"),
    specialRequests: "",
  };

  const confirmWrongTotal = await req("POST", `${BASE}/hotels/${hotelId}/bookings`, {
    cookie: cookies.guest,
    body: { ...confirmBody, totalCost: 1 },
  });
  check(
    "confirm: client totalCost 1 rejected (server quote 2000)",
    confirmWrongTotal.status === 400 && /price changed/i.test(confirmWrongTotal.data?.message || ""),
    confirmWrongTotal
  );

  const confirmNoDates = await req("POST", `${BASE}/hotels/${hotelId}/bookings`, {
    cookie: cookies.guest,
    body: { ...confirmBody, checkIn: undefined, checkOut: undefined },
  });
  check("confirm: missing dates -> 400", confirmNoDates.status === 400, confirmNoDates.status);

  const confirmConfig = await req("POST", `${BASE}/hotels/${hotelId}/bookings`, {
    cookie: cookies.guest,
    body: { ...confirmBody, totalCost: 2000 },
  });
  check(
    "confirm: correct total -> ETB config gate (no Stripe call)",
    confirmConfig.status === 400 && /cannot be charged online/.test(confirmConfig.data?.message || ""),
    confirmConfig
  );

  const confirmBadEmail = await req("POST", `${BASE}/hotels/${hotelId}/bookings`, {
    cookie: cookies.guest,
    body: { ...confirmBody, email: "not-an-email" },
  });
  check("confirm: invalid email -> 400", confirmBadEmail.status === 400, confirmBadEmail.status);

  // ---- O. admin delete (last) ----
  const delOwner = await req("DELETE", `${BASE}/bookings/${bookingId}`, { cookie: cookies.owner });
  check("owner DELETE booking -> 403", delOwner.status === 403, delOwner.status);

  const delAdmin = await req("DELETE", `${BASE}/bookings/${bookingId}`, { cookie: cookies.admin });
  check("admin DELETE booking -> 200", delAdmin.status === 200, delAdmin);

  const gone = await pg.query(`SELECT * FROM bookings WHERE "_id"=$1`, [bookingId]);
  check("booking row gone", gone.rowCount === 0, gone.rowCount);
  const hotelCounters = await pg.query(
    `SELECT "totalBookings","totalRevenue" FROM hotels WHERE "_id"=$1`,
    [hotelId]
  );
  check(
    "hotel counters decremented to 0",
    hotelCounters.rows[0].totalBookings === 0 && Number(hotelCounters.rows[0].totalRevenue) === 0,
    hotelCounters.rows[0]
  );

  // ---- cleanup ----
  await pg.query(`DELETE FROM hotels WHERE "_id"=$1`, [hotelId]);
  await pg.query(`DELETE FROM users WHERE "email" LIKE 'p0-%@test.com'`);

  await pg.end();

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failed checks:", failures.join(" | "));
    process.exit(1);
  }
  process.exit(0);
})().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
