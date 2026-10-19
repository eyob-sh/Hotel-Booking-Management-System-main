// Phase 1 HTTP contract checks: quotes, room-type inventory, provider checkout,
// payment ledger, webhooks. Run from the backend directory:
//   node scripts/phase1-http-test.cjs
// NOTE: auth limiter is 10 req/15min per IP (register+login share it); this
// script uses 3 users = 6 auth requests, so restart the backend between runs.
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

const nightsOf = (checkIn, checkOut) => {
  const out = [];
  const c = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  while (c < end) {
    out.push(c.toISOString().slice(0, 10));
    c.setUTCDate(c.getUTCDate() + 1);
  }
  return out;
};

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // ---- cleanup from any previous run ----
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE email LIKE 'p1-%@test.com')`);
  await pg.query(`DELETE FROM room_inventory WHERE "roomTypeId" IN (SELECT "_id" FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P1 %'))`);
  await pg.query(`DELETE FROM bookings WHERE email LIKE 'p1-%@test.com'`);
  await pg.query(`DELETE FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P1 %')`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P1 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p1-%@test.com'`);

  // ---- register 3 users (guest, guest2, admin) ----
  const emails = {
    guest: "p1-guest@test.com",
    guest2: "p1-guest2@test.com",
    admin: "p1-admin@test.com",
  };
  const ids = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/users/register`, {
      body: { firstName: "P1", lastName: key, email, password: "password123" },
    });
    check(`register ${key}`, r.status === 200 && r.data?.userId, r);
    ids[key] = r.data?.userId;
  }
  await pg.query(`UPDATE users SET role='admin' WHERE _id=$1`, [ids.admin]);

  // ---- fixtures: hotel + two room types ----
  const hotelRes = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P1 Test Hotel','Addis Ababa','Ethiopia','Phase 1 fixture',ARRAY['hotel']::text[],4,0,ARRAY['wifi']::text[],1000,4,ARRAY['https://example.com/a.jpg']::text[], now())
     RETURNING "_id"`,
    [ids.admin]
  );
  const hotelId = hotelRes.rows[0]._id;

  const rtA = (
    await pg.query(
      `INSERT INTO room_types ("hotelId","name","description","maxAdults","maxChildren","basePrice","roomCount","photos","sortOrder","active")
       VALUES ($1,'P1 Standard','Standard room',2,0,1000,3,ARRAY[]::text[],0,true) RETURNING "_id"`,
      [hotelId]
    )
  ).rows[0]._id;

  const rtSingle = (
    await pg.query(
      `INSERT INTO room_types ("hotelId","name","description","maxAdults","maxChildren","basePrice","roomCount","photos","sortOrder","active")
       VALUES ($1,'P1 Single','Only one room',2,0,1500,1,ARRAY[]::text[],1,true) RETURNING "_id"`,
      [hotelId]
    )
  ).rows[0]._id;

  // A room type belonging to a different property (for cross-hotel checks).
  const otherHotelId = (
    await pg.query(
      `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
       VALUES ($1,'P1 Other Hotel','Addis Ababa','Ethiopia','x',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],500,3,ARRAY[]::text[], now()) RETURNING "_id"`,
      [ids.admin]
    )
  ).rows[0]._id;
  const rtOther = (
    await pg.query(
      `INSERT INTO room_types ("hotelId","name","description","maxAdults","maxChildren","basePrice","roomCount","photos","sortOrder","active")
       VALUES ($1,'P1 Foreign','Not ours',2,0,500,1,ARRAY[]::text[],0,true) RETURNING "_id"`,
      [otherHotelId]
    )
  ).rows[0]._id;

  // ---- login ----
  const cookies = {};
  for (const [key, email] of Object.entries(emails)) {
    const r = await req("POST", `${BASE}/auth/login`, {
      body: { email, password: "password123" },
    });
    check(`login ${key}`, r.status === 200 && r.cookie.includes("auth_token"), r.status);
    cookies[key] = r.cookie;
  }

  const d = (s) => `${s}T00:00:00.000Z`;
  const book = (cookie, body) =>
    req("POST", `${BASE}/bookings`, { cookie, body });
  const quote = (body) => req("POST", `${BASE}/quotes`, { body });

  // =====================================================================
  // A. payment providers (public list)
  // =====================================================================
  const prov = await req("GET", `${BASE}/payment-providers`);
  check("GET /payment-providers 200", prov.status === 200, prov.status);
  const provIds = (prov.data?.providers || []).map((p) => p.id);
  check("providers include pay-at-arrival/bank-transfer/telebirr",
    ["pay-at-arrival", "bank-transfer", "telebirr"].every((id) => provIds.includes(id)),
    provIds);
  check("disabled providers excluded (stripe/paypal)",
    !provIds.includes("stripe") && !provIds.includes("paypal"), provIds);
  const payAtArrival = (prov.data?.providers || []).find((p) => p.id === "pay-at-arrival");
  const telebirr = (prov.data?.providers || []).find((p) => p.id === "telebirr");
  const bank = (prov.data?.providers || []).find((p) => p.id === "bank-transfer");
  check("pay-at-arrival kind=onsite", payAtArrival?.kind === "onsite", payAtArrival?.kind);
  check("telebirr kind=online + available(mock)", telebirr?.kind === "online" && telebirr?.available === true, telebirr);
  check("bank-transfer exposes instructions", typeof bank?.details?.instructions === "string", bank?.details);

  // =====================================================================
  // B. quotes
  // =====================================================================
  const qBad = await quote({ hotelId, adultCount: 2, childCount: 0 });
  check("quote missing dates -> 400", qBad.status === 400, qBad.status);

  const qRev = await quote({
    hotelId, roomTypeId: rtA, adultCount: 2, childCount: 0,
    checkIn: d("2027-03-04"), checkOut: d("2027-03-01"),
  });
  check("quote reversed dates -> 400", qRev.status === 400, qRev.status);

  const qOk = await quote({
    hotelId, roomTypeId: rtA, adultCount: 2, childCount: 0,
    checkIn: d("2027-03-01"), checkOut: d("2027-03-04"),
  });
  check("quote RT-A 3 nights 200", qOk.status === 200 && qOk.data?.available === true, qOk);
  check("quote nights=3 totalStored=3000 currency=ETB",
    qOk.data?.nights === 3 && qOk.data?.quote?.totalStored === 3000 && qOk.data?.currency === "ETB",
    qOk.data);

  const qForeign = await quote({
    hotelId, roomTypeId: rtOther, adultCount: 2, childCount: 0,
    checkIn: d("2027-03-01"), checkOut: d("2027-03-04"),
  });
  check("quote foreign roomType -> 404", qForeign.status === 404, qForeign.status);

  const qTooMany = await quote({
    hotelId, roomTypeId: rtA, adultCount: 3, childCount: 0,
    checkIn: d("2027-03-01"), checkOut: d("2027-03-04"),
  });
  check("quote over maxAdults -> available:false",
    qTooMany.status === 200 && qTooMany.data?.available === false, qTooMany.data);

  // =====================================================================
  // C. pay-at-arrival booking
  // =====================================================================
  const bookBase = {
    hotelId, roomTypeId: rtA,
    adultCount: 2, childCount: 0,
    firstName: "P1", lastName: "Guest",
    email: "p1-guest@test.com", phone: "+251911223344",
  };

  const noAuth = await req("POST", `${BASE}/bookings`, { body: bookBase });
  check("POST /bookings unauthenticated -> 401", noAuth.status === 401, noAuth.status);

  const wrongTotal = await book(cookies.guest, {
    ...bookBase, checkIn: d("2027-03-01"), checkOut: d("2027-03-04"), totalCost: 1,
  });
  check("book wrong totalCost -> 400 price changed",
    wrongTotal.status === 400 && /price changed/i.test(wrongTotal.data?.message || ""),
    wrongTotal);

  const arr = await book(cookies.guest, {
    ...bookBase, checkIn: d("2027-03-01"), checkOut: d("2027-03-04"),
  });
  check("book pay-at-arrival 201", arr.status === 201, arr);
  const arrB = arr.data?.booking;
  check("arrival: confirmed / payment pending",
    arrB?.status === "confirmed" && arrB?.paymentStatus === "pending", arrB);
  check("arrival: deposit 0 / balance 3000 / total 3000",
    Number(arrB?.depositAmount) === 0 && Number(arrB?.balanceAmount) === 3000 && Number(arrB?.totalCost) === 3000,
    arrB);
  check("arrival: reference HB-XXXXXXXXXX",
    /^HB-[0-9A-F]{10}$/.test(arrB?.reference || ""), arrB?.reference);
  check("arrival: currency ETB source web",
    arrB?.currency === "ETB" && arrB?.source === "web", arrB);

  const arrLedger = await pg.query(
    `SELECT "type","amount","status","currency" FROM payments WHERE "bookingId"=$1`,
    [arrB?._id]
  );
  check("arrival: ledger balance/pending/3000",
    arrLedger.rowCount === 1 &&
      arrLedger.rows[0].type === "balance" &&
      arrLedger.rows[0].status === "pending" &&
      Number(arrLedger.rows[0].amount) === 3000,
    arrLedger.rows);

  const arrNights = nightsOf(arrB.checkIn, arrB.checkOut);
  const arrInv = await pg.query(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM room_inventory WHERE "roomTypeId"=$1 AND "date" = ANY($2::date[])`,
    [rtA, arrNights]
  );
  check("arrival: inventory reserved=3 (3 nights)",
    Number(arrInv.rows[0].r) === 3, arrInv.rows[0]);

  // =====================================================================
  // D. bank-transfer booking (onsite, pending until confirmed)
  // =====================================================================
  const bt = await book(cookies.guest, {
    ...bookBase, providerId: "bank-transfer",
    checkIn: d("2027-04-01"), checkOut: d("2027-04-03"),
  });
  check("book bank-transfer 201", bt.status === 201, bt);
  const btB = bt.data?.booking;
  check("bank-transfer: status pending, payment pending",
    btB?.status === "pending" && btB?.paymentStatus === "pending", btB);
  check("bank-transfer: deposit 2000 / balance 0",
    Number(btB?.depositAmount) === 2000 && Number(btB?.balanceAmount) === 0, btB);
  check("bank-transfer: payment.intentId transfer_* + instructions",
    /^transfer_/.test(bt.data?.payment?.intentId || "") &&
      typeof bt.data?.payment?.details?.instructions === "string",
    bt.data?.payment);

  const btLedger = await pg.query(
    `SELECT "type","status","providerRef","amount" FROM payments WHERE "bookingId"=$1`,
    [btB?._id]
  );
  check("bank-transfer: ledger deposit/pending with transfer ref",
    btLedger.rowCount === 1 &&
      btLedger.rows[0].type === "deposit" &&
      btLedger.rows[0].status === "pending" &&
      /^transfer_/.test(btLedger.rows[0].providerRef || ""),
    btLedger.rows);

  // =====================================================================
  // E. telebirr online (mock captures immediately)
  // =====================================================================
  const tb = await book(cookies.guest, {
    ...bookBase, providerId: "telebirr",
    checkIn: d("2027-05-01"), checkOut: d("2027-05-03"),
  });
  check("book telebirr 201", tb.status === 201, tb);
  const tbB = tb.data?.booking;
  check("telebirr: confirmed + paid (full prepay)",
    tbB?.status === "confirmed" && tbB?.paymentStatus === "paid", tbB);
  check("telebirr: payment status succeeded",
    tb.data?.payment?.status === "succeeded", tb.data?.payment);

  const tbLedger = await pg.query(
    `SELECT "type","status","amount","currency","providerRef" FROM payments WHERE "bookingId"=$1`,
    [tbB?._id]
  );
  check("telebirr: ledger charge/succeeded/2000/ETB",
    tbLedger.rowCount === 1 &&
      tbLedger.rows[0].type === "charge" &&
      tbLedger.rows[0].status === "succeeded" &&
      Number(tbLedger.rows[0].amount) === 2000 &&
      tbLedger.rows[0].currency === "ETB",
    tbLedger.rows);

  const unknownProv = await book(cookies.guest, {
    ...bookBase, providerId: "nope", roomTypeId: rtA,
    checkIn: d("2027-05-10"), checkOut: d("2027-05-12"),
  });
  check("book unknown provider -> 400", unknownProv.status === 400, unknownProv.status);

  const disabledProv = await book(cookies.guest, {
    ...bookBase, providerId: "stripe", roomTypeId: rtA,
    checkIn: d("2027-05-10"), checkOut: d("2027-05-12"),
  });
  check("book disabled provider -> 400", disabledProv.status === 400, disabledProv.status);

  // =====================================================================
  // F. concurrency on a 1-room type
  // =====================================================================
  const c1 = await book(cookies.guest, {
    ...bookBase, roomTypeId: rtSingle,
    checkIn: d("2027-06-01"), checkOut: d("2027-06-03"),
  });
  check("single-room booking #1 -> 201", c1.status === 201, c1.status);

  const c2 = await book(cookies.guest2, {
    ...bookBase, roomTypeId: rtSingle, email: "p1-guest2@test.com",
    checkIn: d("2027-06-01"), checkOut: d("2027-06-03"),
  });
  check("single-room booking #2 overlap -> 409", c2.status === 409, c2);

  const qFull = await quote({
    hotelId, roomTypeId: rtSingle, adultCount: 2, childCount: 0,
    checkIn: d("2027-06-01"), checkOut: d("2027-06-03"),
  });
  check("quote sold-out room -> available:false",
    qFull.status === 200 && qFull.data?.available === false, qFull.data);

  // =====================================================================
  // G. webhooks (telebirr mock)
  // =====================================================================
  const hookBookingId = (
    await pg.query(
      `INSERT INTO bookings ("userId","hotelId","firstName","lastName","email","phone","adultCount","childCount","checkIn","checkOut","totalCost","status","paymentStatus","paymentMethod","balanceAmount","currency")
       VALUES ($1,$2,'P1','Hook','p1-guest@test.com','+251911223344',2,0,'2027-07-01','2027-07-03',3000,'pending','pending','telebirr',0,'ETB')
       RETURNING "_id"`,
      [ids.guest, hotelId]
    )
  ).rows[0]._id;
  const hookRef = "telebirr_mock_webhook_1";
  await pg.query(
    `INSERT INTO payments ("bookingId","providerId","type","amount","currency","status","providerRef")
     VALUES ($1,'telebirr','charge',3000,'ETB','pending',$2)`,
    [hookBookingId, hookRef]
  );

  const hookUnknown = await req("POST", `${BASE}/webhooks/payment/nope`, {
    headers: { "Content-Type": "application/json" },
    body: { intentId: hookRef, status: "succeeded" },
  });
  check("webhook unknown provider -> 404", hookUnknown.status === 404, hookUnknown.status);

  const hookBadSecret = await req("POST", `${BASE}/webhooks/payment/telebirr`, {
    headers: { "Content-Type": "application/json", "x-telebirr-secret": "wrong" },
    body: { intentId: hookRef, status: "succeeded" },
  });
  check("webhook wrong secret -> 401", hookBadSecret.status === 401, hookBadSecret.status);

  const hookOk = await req("POST", `${BASE}/webhooks/payment/telebirr`, {
    headers: { "Content-Type": "application/json", "x-telebirr-secret": "mock-secret" },
    body: { intentId: hookRef, status: "succeeded" },
  });
  check("webhook succeeded -> 200 matched",
    hookOk.status === 200 && hookOk.data?.matched === true && hookOk.data?.duplicate === false,
    hookOk.data);
  const hookBooking = await pg.query(
    `SELECT status,"paymentStatus" FROM bookings WHERE "_id"=$1`,
    [hookBookingId]
  );
  check("webhook finalized booking -> confirmed/paid",
    hookBooking.rows[0]?.status === "confirmed" && hookBooking.rows[0]?.paymentStatus === "paid",
    hookBooking.rows[0]);
  const hookRow = await pg.query(
    `SELECT status FROM payments WHERE "providerRef"=$1`,
    [hookRef]
  );
  check("webhook marked ledger succeeded", hookRow.rows[0]?.status === "succeeded", hookRow.rows[0]);

  const hookReplay = await req("POST", `${BASE}/webhooks/payment/telebirr`, {
    headers: { "Content-Type": "application/json", "x-telebirr-secret": "mock-secret" },
    body: { intentId: hookRef, status: "succeeded" },
  });
  check("webhook replay -> 200 duplicate:true",
    hookReplay.status === 200 && hookReplay.data?.duplicate === true, hookReplay.data);

  // =====================================================================
  // H. cancel releases inventory, restore re-reserves
  // =====================================================================
  const btNights = nightsOf(btB.checkIn, btB.checkOut);
  const beforeCancel = await pg.query(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM room_inventory WHERE "roomTypeId"=$1 AND "date" = ANY($2::date[])`,
    [rtA, btNights]
  );
  const cancelBt = await req("PATCH", `${BASE}/bookings/${btB._id}/status`, {
    cookie: cookies.guest, body: { status: "cancelled", cancellationReason: "p1 test" },
  });
  check("guest cancels bank-transfer booking -> 200",
    cancelBt.status === 200 && cancelBt.data?.status === "cancelled", cancelBt);
  const afterCancel = await pg.query(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM room_inventory WHERE "roomTypeId"=$1 AND "date" = ANY($2::date[])`,
    [rtA, btNights]
  );
  check("cancel released inventory",
    Number(beforeCancel.rows[0].r) === 2 && Number(afterCancel.rows[0].r) === 0,
    { before: beforeCancel.rows[0].r, after: afterCancel.rows[0].r });

  const restoreBt = await req("PATCH", `${BASE}/bookings/${btB._id}/status`, {
    cookie: cookies.admin, body: { status: "confirmed" },
  });
  check("admin restores cancelled booking -> 200 confirmed",
    restoreBt.status === 200 && restoreBt.data?.status === "confirmed", restoreBt);
  const afterRestore = await pg.query(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM room_inventory WHERE "roomTypeId"=$1 AND "date" = ANY($2::date[])`,
    [rtA, btNights]
  );
  check("restore re-reserved inventory", Number(afterRestore.rows[0].r) === 2, afterRestore.rows[0]);

  // Restore conflict: cancel single-room booking, take the room, restore -> 409.
  await req("PATCH", `${BASE}/bookings/${c1.data.booking._id}/status`, {
    cookie: cookies.guest, body: { status: "cancelled" },
  });
  const c3 = await book(cookies.guest2, {
    ...bookBase, roomTypeId: rtSingle, email: "p1-guest2@test.com",
    checkIn: d("2027-06-01"), checkOut: d("2027-06-03"),
  });
  check("re-book vacated single room -> 201", c3.status === 201, c3.status);
  const restoreConflict = await req("PATCH", `${BASE}/bookings/${c1.data.booking._id}/status`, {
    cookie: cookies.admin, body: { status: "confirmed" },
  });
  check("restore into sold-out room -> 409", restoreConflict.status === 409, restoreConflict);

  // =====================================================================
  // I. delete releases inventory
  // =====================================================================
  const tbNights = nightsOf(telebirr ? tbB.checkIn : tbB.checkIn, tbB.checkOut);
  const delRes = await req("DELETE", `${BASE}/bookings/${tbB._id}`, { cookie: cookies.admin });
  check("admin DELETE telebirr booking -> 200", delRes.status === 200, delRes.status);
  const afterDelete = await pg.query(
    `SELECT COALESCE(SUM(reserved),0) AS r FROM room_inventory WHERE "roomTypeId"=$1 AND "date" = ANY($2::date[])`,
    [rtA, tbNights]
  );
  check("delete released inventory", Number(afterDelete.rows[0].r) === 0, afterDelete.rows[0]);

  // ---- cleanup ----
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE email LIKE 'p1-%@test.com')`);
  await pg.query(`DELETE FROM room_inventory WHERE "roomTypeId" IN (SELECT "_id" FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P1 %'))`);
  await pg.query(`DELETE FROM bookings WHERE email LIKE 'p1-%@test.com'`);
  await pg.query(`DELETE FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P1 %')`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P1 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p1-%@test.com'`);

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
