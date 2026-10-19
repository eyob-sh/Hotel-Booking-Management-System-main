// Phase 3 HTTP contract checks. Run from the backend directory:
//   node scripts/phase3-http-test.cjs
// NOTE: register+login share a 10 req/15min IP limiter � restart the backend
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
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE email LIKE 'p3-%@test.com')`);
  await pg.query(`DELETE FROM room_inventory WHERE "roomTypeId" IN (SELECT "_id" FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P3 %'))`);
  await pg.query(`DELETE FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P3 %')`);
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

  // ============================================================
  // 3b. room types CRUD
  // ============================================================
  const roomsBase = `${BASE}/my-hotels/${hotelId}/rooms`;

  const roomsNoAuth = await req("GET", roomsBase);
  check("3b GET rooms w/o auth -> 401", roomsNoAuth.status === 401, roomsNoAuth.status);

  const roomsGuest = await req("GET", roomsBase, { cookie: cookies.guest });
  check("3b GET rooms as guest -> 403", roomsGuest.status === 403, roomsGuest.status);

  const roomsOwner0 = await req("GET", roomsBase, { cookie: cookies.owner });
  check("3b GET rooms as owner -> 200", roomsOwner0.status === 200, roomsOwner0.status);
  check("3b rooms list starts empty", Array.isArray(roomsOwner0.data?.roomTypes) && roomsOwner0.data.roomTypes.length === 0, roomsOwner0.data);

  const roomsAdmin0 = await req("GET", roomsBase, { cookie: cookies.admin });
  check("3b GET rooms as admin -> 200", roomsAdmin0.status === 200, roomsAdmin0.status);

  // create (JSON photos payload)
  const createRoom = await req("POST", roomsBase, {
    cookie: cookies.owner,
    body: {
      name: "Deluxe King",
      description: "City view",
      maxAdults: 2,
      maxChildren: 1,
      basePrice: 1500,
      roomCount: 3,
      sortOrder: 1,
      active: true,
      photos: ["https://example.com/r1.jpg", "https://example.com/r2.jpg"],
    },
  });
  check("3b POST create room -> 201", createRoom.status === 201, createRoom.status);
  const room1 = createRoom.data;
  check("3b create returned fields", room1?._id && room1?.name === "Deluxe King" && room1?.basePrice === 1500 && room1?.roomCount === 3, room1);
  check("3b create stored photos", Array.isArray(room1?.photos) && room1.photos.length === 2, room1?.photos);

  // validation errors
  const badRoom = await req("POST", roomsBase, {
    cookie: cookies.owner,
    body: { name: "", basePrice: -5 },
  });
  check("3b POST invalid room -> 400", badRoom.status === 400, badRoom.status);

  const guestCreate = await req("POST", roomsBase, {
    cookie: cookies.guest,
    body: { name: "Sneaky", basePrice: 100 },
  });
  check("3b POST room as guest -> 403", guestCreate.status === 403, guestCreate.status);

  // create a second room so delete tests have one to burn
  const createRoom2 = await req("POST", roomsBase, {
    cookie: cookies.owner,
    body: { name: "Standard Twin", maxAdults: 2, maxChildren: 0, basePrice: 900, roomCount: 2, sortOrder: 2, photos: [] },
  });
  check("3b POST create second room -> 201", createRoom2.status === 201, createRoom2.status);
  const room2 = createRoom2.data;

  const listAfterCreate = await req("GET", roomsBase, { cookie: cookies.owner });
  check("3b GET lists 2 rooms", listAfterCreate.data?.roomTypes?.length === 2, listAfterCreate.data?.roomTypes?.length);
  check(
    "3b rooms sorted by sortOrder",
    listAfterCreate.data?.roomTypes?.[0]?.name === "Deluxe King",
    listAfterCreate.data?.roomTypes?.map((r) => r.name)
  );

  // update
  const updateRoom = await req("PUT", `${roomsBase}/${room1._id}`, {
    cookie: cookies.owner,
    body: { name: "Deluxe King (renamed)", basePrice: 1750, roomCount: 4, maxAdults: 3, active: false, photos: ["https://example.com/r1.jpg"] },
  });
  check("3b PUT update room -> 200", updateRoom.status === 200, updateRoom.status);
  check(
    "3b PUT applied fields",
    updateRoom.data?.name === "Deluxe King (renamed)" && updateRoom.data?.basePrice === 1750 && updateRoom.data?.roomCount === 4 && updateRoom.data?.maxAdults === 3 && updateRoom.data?.active === false,
    updateRoom.data
  );
  check("3b PUT kept kept photos only", updateRoom.data?.photos?.length === 1 && updateRoom.data.photos[0] === "https://example.com/r1.jpg", updateRoom.data?.photos);

  // inventory reconcile: a future date still tracking the current count (4)
  // gets bumped to the new count (5); a hand-adjusted date is left alone.
  const futureA = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const futureB = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  await pg.query(
    `INSERT INTO room_inventory ("roomTypeId","date","totalRooms","reserved","updatedAt")
     VALUES ($1,$2,4,1,now()),
            ($1,$3,9,0,now())`,
    [room1._id, futureA, futureB]
  );
  const recount = await req("PUT", `${roomsBase}/${room1._id}`, {
    cookie: cookies.owner,
    body: { roomCount: 5 },
  });
  check("3b recount -> 200", recount.status === 200, recount.status);
  const bumpedRow = await pg.query(
    `SELECT "totalRooms","reserved" FROM room_inventory WHERE "roomTypeId"=$1 AND "date"=$2`,
    [room1._id, futureA]
  );
  const keptRow = await pg.query(
    `SELECT "totalRooms" FROM room_inventory WHERE "roomTypeId"=$1 AND "date"=$2`,
    [room1._id, futureB]
  );
  check("3b inventory bumped with room count", bumpedRow.rows[0]?.totalRooms === 5 && bumpedRow.rows[0]?.reserved === 1, bumpedRow.rows);
  check("3b hand-adjusted date untouched", keptRow.rows[0]?.totalRooms === 9, keptRow.rows);

  // access control on another owner's hotel
  const hotel2Res = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P3 Other Hotel','Addis Ababa','Ethiopia','other',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],1000,4,ARRAY[]::text[], now())
     RETURNING "_id"`,
    [ids.admin]
  );
  const hotel2Id = hotel2Res.rows[0]._id;
  const crossHotel = await req("GET", `${BASE}/my-hotels/${hotel2Id}/rooms`, { cookie: cookies.owner });
  check("3b owner cannot read other owner's rooms -> 403", crossHotel.status === 403, crossHotel.status);

  // delete protected by live reservations
  const holding = await pg.query(
    `SELECT count(*)::int AS n FROM room_inventory WHERE "roomTypeId"=$1 AND reserved > 0`,
    [room1._id]
  );
  check("3b fixture has reserved rooms", holding.rows[0].n > 0, holding.rows[0].n);
  const deleteHeld = await req("DELETE", `${roomsBase}/${room1._id}`, { cookie: cookies.owner });
  check("3b DELETE held room -> 409", deleteHeld.status === 409, deleteHeld.status);

  // deactivate instead, then free the inventory and delete for real
  await req("PUT", `${roomsBase}/${room1._id}`, { cookie: cookies.owner, body: { active: true, roomCount: 5 } });
  await pg.query(`UPDATE room_inventory SET reserved = 0 WHERE "roomTypeId"=$1`, [room1._id]);
  const deleteRoom2 = await req("DELETE", `${roomsBase}/${room2._id}`, { cookie: cookies.owner });
  check("3b DELETE free room -> 200", deleteRoom2.status === 200, deleteRoom2.status);
  const listAfterDelete = await req("GET", roomsBase, { cookie: cookies.owner });
  check("3b room removed from list", listAfterDelete.data?.roomTypes?.length === 1, listAfterDelete.data?.roomTypes?.length);
  const invAfterDelete = await pg.query(`SELECT count(*)::int AS n FROM room_inventory WHERE "roomTypeId"=$1`, [room2._id]);
  check("3b inventory rows cleaned up", invAfterDelete.rows[0].n === 0, invAfterDelete.rows[0].n);

  const deleteUnknown = await req("DELETE", `${roomsBase}/00000000-0000-4000-8000-000000000000`, { cookie: cookies.owner });
  check("3b DELETE unknown room -> 404", deleteUnknown.status === 404, deleteUnknown.status);

  // ============================================================
  // 3c. booking management: record payments + refunds
  // ============================================================
  const mgBookings = `${BASE}/management/hotels/${hotelId}/bookings`;

  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const newBooking = async (overrides = {}) =>
    req("POST", `${BASE}/bookings`, {
      body: {
        hotelId,
        roomTypeId: room1._id,
        checkIn: day(10),
        checkOut: day(12),
        adultCount: 2,
        childCount: 0,
        firstName: "P3",
        lastName: "Guest",
        email: "p3-guest@test.com",
        phone: "+251911000000",
        providerId: "pay-at-arrival",
        ...overrides,
      },
    });

  const mk = await newBooking();
  check("3c create pay-at-arrival booking -> 201", mk.status === 201, mk.data);
  const booking = mk.data?.booking;
  const total = Number(booking?.totalCost);
  check("3c booking priced server-side", Number.isFinite(total) && total > 0, total);
  check("3c pay-at-arrival booking confirmed", booking?.status === "confirmed", booking?.status);
  check("3c booking starts unpaid", booking?.paymentStatus === "pending", booking?.paymentStatus);

  const mgNoAuth = await req("GET", mgBookings);
  check("3c GET management bookings w/o auth -> 401", mgNoAuth.status === 401, mgNoAuth.status);
  const mgGuest = await req("GET", mgBookings, { cookie: cookies.guest });
  check("3c GET management bookings as guest -> 403", mgGuest.status === 403, mgGuest.status);
  const mgOwner = await req("GET", mgBookings, { cookie: cookies.owner });
  check("3c GET management bookings as owner -> 200", mgOwner.status === 200, mgOwner.status);
  const listed = (mgOwner.data?.bookings || []).find((b) => b._id === booking._id);
  check("3c management list includes booking", Boolean(listed), mgOwner.data?.bookings?.length);
  check("3c management list carries room type name", listed?.roomTypeName === "Deluxe King (renamed)", listed?.roomTypeName);
  // pay-at-arrival books a pending "balance" ledger row at checkout time
  check("3c management list carries payments", Array.isArray(listed?.payments) && listed.payments.length > 0, listed?.payments?.length);
  check("3c listing shows nothing collected yet", Number(listed?.paidAmount) === 0 && listed?.payments?.every((p) => p.status === "pending"), { paid: listed?.paidAmount, statuses: listed?.payments?.map((p) => p.status) });
  const mgAdmin = await req("GET", mgBookings, { cookie: cookies.admin });
  check("3c GET management bookings as admin -> 200", mgAdmin.status === 200, mgAdmin.status);
  const mgFiltered = await req("GET", `${mgBookings}?status=confirmed`, { cookie: cookies.owner });
  check("3c management list filters by status", (mgFiltered.data?.bookings || []).length > 0 && (mgFiltered.data?.bookings || []).every((b) => b.status === "confirmed"), mgFiltered.data?.bookings?.map((b) => b.status));

  const half = Math.round(total / 2);
  const pay1 = await req("POST", `${BASE}/management/bookings/${booking._id}/payments`, {
    cookie: cookies.owner,
    body: { amount: half, reference: "RCPT-1" },
  });
  check("3c record partial payment -> 201", pay1.status === 201, pay1.data);
  check("3c partial payment -> deposit_paid", pay1.data?.booking?.paymentStatus === "deposit_paid", pay1.data?.booking?.paymentStatus);
  check("3c partial payment reduces balance", Math.abs(Number(pay1.data?.remaining) - (total - half)) < 0.02, pay1.data?.remaining);
  check("3c ledger row written", pay1.data?.payment?.type === "deposit" && pay1.data?.payment?.status === "succeeded", pay1.data?.payment);

  const overpay = await req("POST", `${BASE}/management/bookings/${booking._id}/payments`, {
    cookie: cookies.owner,
    body: { amount: total },
  });
  check("3c overpayment -> 400", overpay.status === 400, overpay.status);

  const pay2 = await req("POST", `${BASE}/management/bookings/${booking._id}/payments`, {
    cookie: cookies.owner,
    body: { amount: total - half },
  });
  check("3c settle balance -> 201", pay2.status === 201, pay2.status);
  check("3c booking marked paid", pay2.data?.booking?.paymentStatus === "paid", pay2.data?.booking?.paymentStatus);
  check("3c balance cleared", Number(pay2.data?.remaining) === 0, pay2.data?.remaining);

  const guestPay = await req("POST", `${BASE}/management/bookings/${booking._id}/payments`, {
    cookie: cookies.guest,
    body: { amount: 10 },
  });
  check("3c guest record payment -> 403", guestPay.status === 403, guestPay.status);

  const overRefund = await req("POST", `${BASE}/management/bookings/${booking._id}/refunds`, {
    cookie: cookies.owner,
    body: { amount: total + 100 },
  });
  check("3c over-refund -> 400", overRefund.status === 400, overRefund.status);

  const refund1 = await req("POST", `${BASE}/management/bookings/${booking._id}/refunds`, {
    cookie: cookies.owner,
    body: { amount: 500, reason: "Early checkout" },
  });
  check("3c partial refund -> 201", refund1.status === 201, refund1.data);
  check("3c partial refund -> partially_refunded", refund1.data?.booking?.paymentStatus === "partially_refunded", refund1.data?.booking?.paymentStatus);
  check("3c refundAmount tracked", Math.abs(Number(refund1.data?.booking?.refundAmount) - 500) < 0.02, refund1.data?.booking?.refundAmount);
  check("3c refund ledger row written", refund1.data?.refund?.type === "refund", refund1.data?.refund?.type);

  const refund2 = await req("POST", `${BASE}/management/bookings/${booking._id}/refunds`, {
    cookie: cookies.owner,
    body: { amount: total - 500 },
  });
  check("3c full refund -> 201", refund2.status === 201, refund2.status);
  check("3c booking marked refunded", refund2.data?.booking?.paymentStatus === "refunded", refund2.data?.booking?.paymentStatus);

  // bank transfer: pending until the manager records the money
  const btRes = await newBooking({ providerId: "bank-transfer", phone: "+251911000001" });
  check("3c create bank-transfer booking -> 201", btRes.status === 201, btRes.data);
  const bt = btRes.data?.booking;
  check("3c bank-transfer booking is pending", bt?.status === "pending", bt?.status);
  const btPay = await req("POST", `${BASE}/management/bookings/${bt._id}/payments`, {
    cookie: cookies.owner,
    body: { amount: bt.totalCost, reference: "TRF-1" },
  });
  check("3c transfer recorded -> 201", btPay.status === 201, btPay.data);
  check("3c transfer confirms pending booking", btPay.data?.booking?.status === "confirmed", btPay.data?.booking?.status);
  check("3c transfer marks paid", btPay.data?.booking?.paymentStatus === "paid", btPay.data?.booking?.paymentStatus);

  // cancelled booking rejects new payments
  await req("PATCH", `${BASE}/bookings/${bt._id}/status`, {
    cookie: cookies.owner,
    body: { status: "cancelled" },
  });
  const payCancelled = await req("POST", `${BASE}/management/bookings/${bt._id}/payments`, {
    cookie: cookies.owner,
    body: { amount: 1 },
  });
  check("3c payment on cancelled booking -> 409", payCancelled.status === 409, payCancelled.status);

  const unknownPay = await req("POST", `${BASE}/management/bookings/00000000-0000-4000-8000-000000000000/payments`, {
    cookie: cookies.owner,
    body: { amount: 1 },
  });
  check("3c payment on unknown booking -> 404", unknownPay.status === 404, unknownPay.status);

  await pg.end();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log("Failures: " + failures.join(" | "));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
