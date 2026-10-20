// Phase 4 HTTP contract checks (notifications outbox). Run from backend dir:
//   node scripts/phase4-http-test.cjs
// NOTE: register+login share a 10 req/15min IP limiter - restart the backend
// between runs or re-runs will 429.
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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const setCookies =
    res.headers.getSetCookie && typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data, cookie };
};

const addDays = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // ---- cleanup ----
  await pg.query(`DELETE FROM notifications WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE email LIKE 'p4-%@test.com')`);
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE email LIKE 'p4-%@test.com')`);
  await pg.query(`DELETE FROM room_inventory WHERE "roomTypeId" IN (SELECT "_id" FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P4 %'))`);
  await pg.query(`DELETE FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P4 %')`);
  await pg.query(`DELETE FROM bookings WHERE email LIKE 'p4-%@test.com'`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P4 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p4-%@test.com'`);

  // ---- register + roles ----
  const emails = {
    owner: "p4-owner@test.com",
    admin: "p4-admin@test.com",
  };
  const ids = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/users/register`, {
      body: { firstName: "P4", lastName: key, email, password: "password123" },
    });
    check(`register ${key}`, r.status === 200 && r.data?.userId, r);
    ids[key] = r.data.userId;
  }
  await pg.query(`UPDATE users SET role='hotel_owner' WHERE _id=$1`, [ids.owner]);
  await pg.query(`UPDATE users SET role='admin' WHERE _id=$1`, [ids.admin]);

  const hotelRes = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P4 Test Hotel','Addis Ababa','Ethiopia','Phase 4 fixture',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],1000,4,ARRAY['https://example.com/a.jpg']::text[], now())
     RETURNING "_id"`,
    [ids.owner]
  );
  const hotelId = hotelRes.rows[0]._id;

  const cookies = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/auth/login`, {
      body: { email, password: "password123" },
    });
    check(`login ${key}`, r.status === 200 && r.cookie.includes("auth_token"), r.status);
    cookies[key] = r.cookie;
  }

  // ---- create an active room type ----
  const roomRes = await pg.query(
    `INSERT INTO room_types ("hotelId","name","maxAdults","maxChildren","basePrice","roomCount","photos","sortOrder","active")
     VALUES ($1,'P4 Standard',2,0,1000,5,ARRAY[]::text[],0,true)
     RETURNING "_id"`,
    [hotelId]
  );
  const roomTypeId = roomRes.rows[0]._id;

  // ---- seed a confirmed booking checking in tomorrow (no HTTP needed) ----
  const bookingRes = await pg.query(
    `INSERT INTO bookings ("userId","hotelId","firstName","lastName","email","phone","adultCount","childCount","checkIn","checkOut","roomTypeId","reference","totalCost","depositAmount","balanceAmount","currency","source","status","paymentStatus")
     VALUES ($1,$2,'P4','Reminder','p4-guest@test.com','+251900000001',2,0,$3,$4,$5,'P4TESTREMIND',1000,1000,0,'ETB','web','confirmed','paid')
     RETURNING "_id"`,
    [ids.owner, hotelId, addDays(1), addDays(2), roomTypeId]
  );
  const bookingId = bookingRes.rows[0]._id;

  // ============================================================
  // 4a. notifications admin endpoints + RBAC
  // ============================================================
  console.log("\n[4a] notifications admin RBAC");

  const noAuth = await req("GET", `${BASE}/admin/notifications`);
  check("4a GET notifications no auth -> 401", noAuth.status === 401, noAuth.status);

  const ownerGet = await req("GET", `${BASE}/admin/notifications`, { cookie: cookies.owner });
  check("4a GET notifications as owner -> 403", ownerGet.status === 403, ownerGet.status);

  const adminEmpty = await req("GET", `${BASE}/admin/notifications`, { cookie: cookies.admin });
  check("4a GET notifications as admin -> 200", adminEmpty.status === 200 && Array.isArray(adminEmpty.data?.notifications), adminEmpty.status);

  // ============================================================
  // 4b. check-in reminder scan queues for tomorrow's confirmed booking
  // ============================================================
  console.log("\n[4b] check-in reminders");

  const ownerRem = await req("POST", `${BASE}/admin/notifications/reminders`, { cookie: cookies.owner });
  check("4b reminders as owner -> 403", ownerRem.status === 403, ownerRem.status);

  const rem1 = await req("POST", `${BASE}/admin/notifications/reminders`, { cookie: cookies.admin });
  check("4b reminders as admin -> 200", rem1.status === 200 && typeof rem1.data?.queued === "number", rem1.data);
  check("4b queued >= 1", (rem1.data?.queued ?? 0) >= 1, rem1.data);

  const rem2 = await req("POST", `${BASE}/admin/notifications/reminders`, { cookie: cookies.admin });
  check("4b reminders idempotent (queued 0 on re-run)", rem2.data?.queued === 0, rem2.data);

  const rowCount = await pg.query(
    `SELECT count(*)::int AS n FROM notifications WHERE "bookingId"=$1 AND type='check_in_reminder'`,
    [bookingId]
  );
  check("4b exactly one reminder row for booking", rowCount.rows[0].n === 1, rowCount.rows[0].n);

  // ============================================================
  // 4c. process outbox marks pending -> sent
  // ============================================================
  console.log("\n[4c] process outbox");

  const proc = await req("POST", `${BASE}/admin/notifications/process`, { cookie: cookies.admin });
  check("4c process as admin -> 200", proc.status === 200 && proc.data?.ok === true, proc.status);

  const sentRow = await pg.query(
    `SELECT status, "sentAt", attempts FROM notifications WHERE "bookingId"=$1 AND type='check_in_reminder'`,
    [bookingId]
  );
  check("4c reminder marked sent", sentRow.rows[0]?.status === "sent", sentRow.rows[0]);
  check("4c reminder has sentAt + attempts>=1", !!sentRow.rows[0]?.sentAt && sentRow.rows[0]?.attempts >= 1, sentRow.rows[0]);

  const filtered = await req("GET", `${BASE}/admin/notifications?status=sent`, { cookie: cookies.admin });
  check("4c status filter returns only sent", (filtered.data?.notifications ?? []).every((n) => n.status === "sent"), filtered.status);

  // ---- cleanup ----
  await pg.query(`DELETE FROM notifications WHERE "bookingId"=$1`, [bookingId]);
  await pg.query(`DELETE FROM bookings WHERE "_id"=$1`, [bookingId]);
  await pg.query(`DELETE FROM room_types WHERE "_id"=$1`, [roomTypeId]);
  await pg.query(`DELETE FROM hotels WHERE "_id"=$1`, [hotelId]);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p4-%@test.com'`);
  await pg.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("Failures:", failures.join(", "));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
