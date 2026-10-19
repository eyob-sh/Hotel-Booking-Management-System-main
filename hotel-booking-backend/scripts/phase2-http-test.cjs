// Phase 2 HTTP checks: phone identity — register/login by email OR phone,
// E.164 normalisation, uniqueness. Run from the backend directory:
//   node scripts/phase2-http-test.cjs
// NOTE: auth limiter is 10 req/15min per IP (register+login share it). This
// script makes 9 auth requests, so restart the backend between runs.
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
    console.log(
      `FAIL  ${name}  ${detail !== undefined ? JSON.stringify(detail) : ""}`
    );
  }
};

const req = async (method, url, opts = {}) => {
  const headers = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.headers) Object.assign(headers, opts.headers);
  if (opts.body !== undefined && !headers["Content-Type"])
    headers["Content-Type"] = "application/json";
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

const PHONE_LOCAL = "0911000001";
const PHONE_E164 = "+251911000001";
const EMAIL_A = "phase2-email-a@test.com";
const EMAIL_B = "phase2-email-b@test.com";
const EMAIL_BOTH = "phase2-both@test.com";

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // 1. register phone-only
  const regPhone = await req("POST", `${BASE}/users/register`, {
    body: {
      firstName: "Phone",
      lastName: "Only",
      phone: PHONE_LOCAL,
      password: "phone1234",
    },
  });
  check("register phone-only -> 200", regPhone.status === 200, regPhone);

  // /me reflects phone identity + null email
  const me = await req("GET", `${BASE}/users/me`, { cookie: regPhone.cookie });
  check(
    "phone-only /me: email null, phone E.164, unverified",
    me.status === 200 &&
      me.data?.email === null &&
      me.data?.phone === PHONE_E164 &&
      me.data?.phoneVerified === false,
    me.data
  );

  // 2. login with an explicitly typed phone number (identifier)
  const loginId = await req("POST", `${BASE}/auth/login`, {
    body: { identifier: PHONE_E164, password: "phone1234" },
  });
  check("login by identifier phone -> 200", loginId.status === 200, loginId.status);

  // 3. login with a local-format phone (must normalise to the same account)
  const loginLocal = await req("POST", `${BASE}/auth/login`, {
    body: { phone: PHONE_LOCAL, password: "phone1234" },
  });
  check(
    "login by local phone normalises -> 200 same user",
    loginLocal.status === 200 &&
      loginLocal.data?.userId === loginId.data?.userId,
    loginLocal.status
  );

  // 4. register email-only (no phone) still works
  const regEmail = await req("POST", `${BASE}/users/register`, {
    body: {
      firstName: "Email",
      lastName: "Only",
      email: EMAIL_A,
      password: "email1234",
    },
  });
  check("register email-only -> 200", regEmail.status === 200, regEmail);

  // 5. login via identifier with an email
  const loginEmailId = await req("POST", `${BASE}/auth/login`, {
    body: { identifier: EMAIL_A, password: "email1234" },
  });
  check("login by identifier email -> 200", loginEmailId.status === 200, loginEmailId.status);

  // 6. login via legacy `email` field
  const loginEmailField = await req("POST", `${BASE}/auth/login`, {
    body: { email: EMAIL_A, password: "email1234" },
  });
  check("login by email field -> 200", loginEmailField.status === 200, loginEmailField.status);

  // 7. register with both email + phone
  const regBoth = await req("POST", `${BASE}/users/register`, {
    body: {
      firstName: "Both",
      lastName: "Details",
      email: EMAIL_BOTH,
      phone: "0911000002",
      password: "both12345",
    },
  });
  check("register email+phone -> 200", regBoth.status === 200, regBoth);

  // 8. duplicate phone rejected
  const dupPhone = await req("POST", `${BASE}/users/register`, {
    body: {
      firstName: "Dup",
      lastName: "Phone",
      email: "phase2-dup-phone@test.com",
      phone: PHONE_LOCAL,
      password: "dupe12345",
    },
  });
  check("duplicate phone -> 400", dupPhone.status === 400, dupPhone.status);

  // 9. duplicate email rejected
  const dupEmail = await req("POST", `${BASE}/users/register`, {
    body: {
      firstName: "Dup",
      lastName: "Email",
      email: EMAIL_A,
      phone: "0911000003",
      password: "dupe12345",
    },
  });
  check("duplicate email -> 400", dupEmail.status === 400, dupEmail.status);

  // DB: stored phone is E.164
  const row = await pg.query('SELECT email, phone FROM users WHERE phone = $1', [
    PHONE_E164,
  ]);
  check(
    "DB stores normalised E.164 phone",
    row.rowCount === 1 && row.rows[0].phone === PHONE_E164,
    row.rows
  );

  // ---- cleanup ----
  await pg.query(
    "DELETE FROM users WHERE email = ANY($1::text[]) OR phone = ANY($2::text[])",
    [[EMAIL_A, EMAIL_BOTH, "phase2-dup-phone@test.com"], [PHONE_E164, "+251911000002", "+251911000003"]]
  );
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
