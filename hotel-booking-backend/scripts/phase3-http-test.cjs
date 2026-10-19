// Phase 3 HTTP contract checks. Run from the backend directory:
//   node scripts/phase3-http-test.cjs
// NOTE: register+login share a 10 req/15min IP limiter — restart the backend
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

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // ---- cleanup ----
  await pg.query(`DELETE FROM bookings WHERE email LIKE 'p3-%@test.com'`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P3 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p3-%@test.com'`);

  // ---- register + roles ----
  const emails = {
    owner: "p3-owner@test.com",
    admin: "p3-admin@test.com",
    guest: "p3-guest@test.com",
  };
  const ids = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/users/register`, {
      body: { firstName: "P3", lastName: key, email, password: "password123" },
    });
    check(`register ${key}`, r.status === 200 && r.data?.userId, r);
    ids[key] = r.data.userId;
  }
  await pg.query(`UPDATE users SET role='hotel_owner' WHERE _id=$1`, [ids.owner]);
  await pg.query(`UPDATE users SET role='admin' WHERE _id=$1`, [ids.admin]);

  const hotelRes = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P3 Test Hotel','Addis Ababa','Ethiopia','Phase 3 fixture',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],1000,4,ARRAY['https://example.com/a.jpg']::text[], now())
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

  // ============================================================
  // 3a. payment providers admin CRUD
  // ============================================================
  const noAuth = await req("GET", `${BASE}/admin/payment-providers`);
  check("3a GET providers w/o auth -> 401", noAuth.status === 401, noAuth.status);

  const guestGet = await req("GET", `${BASE}/admin/payment-providers`, { cookie: cookies.guest });
  check("3a GET providers as guest -> 403", guestGet.status === 403, guestGet.status);

  const ownerGet = await req("GET", `${BASE}/admin/payment-providers`, { cookie: cookies.owner });
  check("3a GET providers as owner -> 200", ownerGet.status === 200, ownerGet.status);
  const providers = ownerGet.data?.providers || [];
  check("3a providers list non-empty", providers.length > 0, providers.length);
  check(
    "3a providers have required fields",
    providers.every((p) => p.id && typeof p.enabled === "boolean" && typeof p.sortOrder === "number" && p.config && typeof p.config === "object"),
    providers[0]
  );
  const bank = providers.find((p) => p.id === "bank-transfer");
  check("3a bank-transfer present", Boolean(bank), providers.map((p) => p.id));

  const adminGet = await req("GET", `${BASE}/admin/payment-providers`, { cookie: cookies.admin });
  check("3a GET providers as admin -> 200", adminGet.status === 200, adminGet.status);

  // disable + config the bank transfer provider
  const putBank = await req("PUT", `${BASE}/admin/payment-providers/bank-transfer`, {
    cookie: cookies.owner,
    body: {
      enabled: false,
      displayName: "Bank transfer (ETB)",
      sortOrder: 7,
      config: { bankName: "CBE", accountName: "Grand Hotel", accountNumber: "100012345678", instructions: "Use your reference." },
    },
  });
  check("3a PUT provider (owner) -> 200", putBank.status === 200, putBank.status);
  check("3a PUT applied fields", putBank.data?.enabled === false && putBank.data?.displayName === "Bank transfer (ETB)" && putBank.data?.sortOrder === 7, putBank.data);
  check("3a PUT stored config", putBank.data?.config?.bankName === "CBE", putBank.data?.config);

  // public list must hide the disabled provider
  const publicList = await req("GET", `${BASE}/payment-providers`);
  const publicIds = (publicList.data?.providers || []).map((p) => p.id);
  check("3a public list hides disabled provider", !publicIds.includes("bank-transfer"), publicIds);

  // re-enable
  const reEnable = await req("PUT", `${BASE}/admin/payment-providers/bank-transfer`, {
    cookie: cookies.admin,
    body: { enabled: true, sortOrder: 1 },
  });
  check("3a PUT provider (admin) -> 200", reEnable.status === 200, reEnable.status);
  check("3a re-enabled", reEnable.data?.enabled === true, reEnable.data);

  const publicList2 = await req("GET", `${BASE}/payment-providers`);
  const publicIds2 = (publicList2.data?.providers || []).map((p) => p.id);
  check("3a public list shows re-enabled provider", publicIds2.includes("bank-transfer"), publicIds2);

  // invalid: unknown provider id
  const unknown = await req("PUT", `${BASE}/admin/payment-providers/not-a-provider`, {
    cookie: cookies.owner,
    body: { enabled: true },
  });
  check("3a PUT unknown provider -> 404", unknown.status === 404, unknown.status);

  // invalid: non-object config
  const badConfig = await req("PUT", `${BASE}/admin/payment-providers/bank-transfer`, {
    cookie: cookies.owner,
    body: { config: "nope" },
  });
  check("3a PUT non-object config -> 400", badConfig.status === 400, badConfig.status);

  // invalid: guest cannot update
  const guestPut = await req("PUT", `${BASE}/admin/payment-providers/bank-transfer`, {
    cookie: cookies.guest,
    body: { enabled: false },
  });
  check("3a PUT provider as guest -> 403", guestPut.status === 403, guestPut.status);

  await pg.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log("Failures: " + failures.join(" | "));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
