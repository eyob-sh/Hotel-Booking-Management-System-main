// Phase 5 HTTP contract checks (Telegram bot). Run from backend dir:
//   node scripts/phase5-http-test.cjs
// NOTE: register+login share a 10 req/15min IP limiter - restart the backend
// between runs or re-runs will 429.
//
// The bot runs in "fallback" mode here (no real bot token): sendMessage logs
// to the server console instead of calling Telegram, so the *DB side effects*
// (booking created / cancelled) are what we assert on. The webhook secret path
// is exercised directly against the public endpoint.
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const { Client } = require("pg");

const BASE = "http://localhost:7002/api";
const SECRET = "p5-test-secret";

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

const post = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
};

const addDays = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const hook = (secret, update) => post(`${BASE}/webhooks/telegram/${secret}`, update);

// Give the fire-and-forget processUpdate time to finish before asserting.
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  // ---- cleanup ----
  await pg.query(`DELETE FROM notifications WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE phone LIKE '+2519111%')`);
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE phone LIKE '+2519111%')`);
  await pg.query(`DELETE FROM bookings WHERE phone LIKE '+2519111%'`);
  await pg.query(`DELETE FROM room_inventory WHERE "roomTypeId" IN (SELECT "_id" FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P5 %'))`);
  await pg.query(`DELETE FROM room_types WHERE "hotelId" IN (SELECT "_id" FROM hotels WHERE name LIKE 'P5 %')`);
  await pg.query(`DELETE FROM hotels WHERE name LIKE 'P5 %'`);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p5-%@test.com'`);

  // ---- fixture: owner + hotel + room type (direct SQL, no HTTP auth needed) ----
  const userRes = await pg.query(
    `INSERT INTO users ("firstName","lastName","email","password","role")
     VALUES ('P5','Owner','p5-owner@test.com','$2b$10$abcdefghijklmnopqrstuv','hotel_owner')
     RETURNING "_id"`
  );
  const ownerId = userRes.rows[0]._id;

  const hotelRes = await pg.query(
    `INSERT INTO hotels ("userId","name","city","country","description","type","adultCount","childCount","facilities","pricePerNight","starRating","imageUrls","lastUpdated")
     VALUES ($1,'P5 Test Hotel','Addis Ababa','Ethiopia','Phase 5 fixture',ARRAY['hotel']::text[],2,0,ARRAY['wifi']::text[],1000,4,ARRAY['https://example.com/a.jpg']::text[], now())
     RETURNING "_id"`,
    [ownerId]
  );
  const hotelId = hotelRes.rows[0]._id;

  // The bot is single-property: it always resolves the SAME hotel the public
  // site would (first by createdAt). Point the room type at whatever that is so
  // the conversation can actually find a room type.
  const propRes = await pg.query(
    `SELECT "_id" FROM hotels ORDER BY "createdAt" ASC LIMIT 1`
  );
  const propertyId = propRes.rows[0]._id;

  const roomRes = await pg.query(
    `INSERT INTO room_types ("hotelId","name","maxAdults","maxChildren","basePrice","roomCount","photos","sortOrder","active")
     VALUES ($1,'P5 Standard',2,0,1000,5,ARRAY[]::text[],0,true)
     RETURNING "_id"`,
    [propertyId]
  );
  const roomTypeId = roomRes.rows[0]._id;

  // ---- enable telegram in settings (empty bot token => fallback send) ----
  const patch = {
    "features.telegramEnabled": true,
    "telegram.chatId": "5550001",
    "telegram.webhookSecret": SECRET,
  };
  await pg.query(
    `INSERT INTO settings (id, data)
     VALUES ('main', jsonb_build_object(
       'features', jsonb_build_object('phoneLogin', true,'otpEnabled', false,'reviewsEnabled', true,'telegramEnabled', true),
       'telegram', jsonb_build_object('botToken','','chatId','5550001','webhookSecret',$1::text)
     ))
     ON CONFLICT (id) DO UPDATE SET data = settings.data || jsonb_build_object(
       'features', (COALESCE(settings.data->'features','{}'::jsonb) || jsonb_build_object('telegramEnabled', true)),
       'telegram', (COALESCE(settings.data->'telegram','{}'::jsonb) || jsonb_build_object('webhookSecret', $1::text, 'chatId', '5550001'))
     )`,
    [SECRET]
  );
  void patch;

  // Wait past the settings cache TTL so the server picks up the new row.
  await settle(1000);

  // ============================================================
  // 5a. webhook secret guard
  // ============================================================
  console.log("\n[5a] webhook secret guard");

  const bad = await hook("wrong-secret", { update_id: 1, message: { message_id: 1, chat: { id: 9001, type: "private" }, text: "/start" } });
  check("5a wrong secret -> 403", bad.status === 403, bad.status);

  const ok = await hook(SECRET, { update_id: 2, message: { message_id: 2, chat: { id: 9001, type: "private" }, text: "/start" } });
  check("5a correct secret -> 200 {ok:true}", ok.status === 200 && ok.data?.ok === true, ok.data);
  await settle(300);

  // ============================================================
  // 5b. guest booking conversation -> DB row
  // ============================================================
  console.log("\n[5b] booking conversation");

  const chatId = 9001;
  const ci = addDays(2);
  const co = addDays(4);

  await hook(SECRET, { update_id: 3, message: { message_id: 3, chat: { id: chatId, type: "private" }, text: "/book" } });
  await settle(300);
  await hook(SECRET, { update_id: 4, message: { message_id: 4, chat: { id: chatId, type: "private" }, text: `${ci} ${co}` } });
  await settle(300);
  await hook(SECRET, { update_id: 5, message: { message_id: 5, chat: { id: chatId, type: "private" }, text: "2 0" } });
  await settle(300);
  // room selection via inline button
  await hook(SECRET, {
    update_id: 6,
    callback_query: { id: "cb1", from: { id: chatId }, data: `book:room:${roomTypeId}`, message: { chat: { id: chatId, type: "private" } } },
  });
  await settle(300);
  // phone number finalises the booking
  await hook(SECRET, { update_id: 7, message: { message_id: 7, chat: { id: chatId, type: "private" }, text: "+251911100001" } });
  await settle(900);

  const created = await pg.query(
    `SELECT "_id", "reference", "source", "telegramId", "status", "totalCost"
     FROM bookings WHERE "hotelId"=$1 AND phone='+251911100001' ORDER BY "createdAt" DESC LIMIT 1`,
    [propertyId]
  );
  const booking = created.rows[0];
  check("5b booking created via bot", !!booking, created.rows);
  check("5b source = telegram", booking?.source === "telegram", booking?.source);
  check("5b telegramId captured", booking?.telegramId === String(chatId), booking?.telegramId);
  check("5b status confirmed", booking?.status === "confirmed", booking?.status);
  check("5b totalCost = 2 nights * 1000 = 2000", Number(booking?.totalCost) === 2000, booking?.totalCost);

  // ============================================================
  // 5c. lookup + cancel by reference + phone
  // ============================================================
  console.log("\n[5c] lookup + cancel");

  const reference = booking?.reference;
  await hook(SECRET, { update_id: 8, message: { message_id: 8, chat: { id: chatId, type: "private" }, text: `/mybooking ${reference}` } });
  await settle(300);
  // wrong phone must NOT cancel
  await hook(SECRET, { update_id: 9, message: { message_id: 9, chat: { id: chatId, type: "private" }, text: `/cancel ${reference}` } });
  await settle(300);
  await hook(SECRET, { update_id: 10, message: { message_id: 10, chat: { id: chatId, type: "private" }, text: "+251900000000" } });
  await settle(500);

  const stillThere = await pg.query(`SELECT status FROM bookings WHERE "_id"=$1`, [booking._id]);
  check("5c wrong phone does not cancel", stillThere.rows[0]?.status === "confirmed", stillThere.rows[0]);

  // correct phone cancels
  await hook(SECRET, { update_id: 11, message: { message_id: 11, chat: { id: chatId, type: "private" }, text: `/cancel ${reference}` } });
  await settle(300);
  await hook(SECRET, { update_id: 12, message: { message_id: 12, chat: { id: chatId, type: "private" }, text: "+251911100001" } });
  await settle(700);

  const cancelled = await pg.query(`SELECT status FROM bookings WHERE "_id"=$1`, [booking._id]);
  check("5c correct phone cancels", cancelled.rows[0]?.status === "cancelled", cancelled.rows[0]);

  // ============================================================
  // 5d. capacity rejection surfaces as no booking
  // ============================================================
  console.log("\n[5d] over-capacity guests");

  const chat2 = 9002;
  await hook(SECRET, { update_id: 20, message: { message_id: 20, chat: { id: chat2, type: "private" }, text: "/book" } });
  await settle(200);
  await hook(SECRET, { update_id: 21, message: { message_id: 21, chat: { id: chat2, type: "private" }, text: `${addDays(2)} ${addDays(3)}` } });
  await settle(200);
  await hook(SECRET, { update_id: 22, message: { message_id: 22, chat: { id: chat2, type: "private" }, text: "9 0" } });
  await settle(200);
  await hook(SECRET, {
    update_id: 23,
    callback_query: { id: "cb2", from: { id: chat2 }, data: `book:room:${roomTypeId}`, message: { chat: { id: chat2, type: "private" } } },
  });
  await settle(300);
  const overCap = await pg.query(
    `SELECT count(*)::int AS n FROM bookings WHERE "hotelId"=$1 AND "telegramId"='9002'`,
    [propertyId]
  );
  check("5d over-capacity creates no booking", overCap.rows[0].n === 0, overCap.rows[0].n);

  // ============================================================
  // 5e. inert when disabled
  // ============================================================
  console.log("\n[5e] disabled bot");

  await pg.query(
    `UPDATE settings SET data = jsonb_set(data, '{features,telegramEnabled}', 'false') WHERE id='main'`
  );
  await settle(1000);
  const disabled = await hook(SECRET, { update_id: 30, message: { message_id: 30, chat: { id: 9003, type: "private" }, text: "/book" } });
  // webhook secret still validates (secret unchanged) but no conversation happens.
  check("5e disabled: webhook still acks", disabled.status === 200, disabled.status);

  // ---- cleanup ----
  await pg.query(`DELETE FROM notifications WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE "hotelId"=$1)`, [propertyId]);
  await pg.query(`DELETE FROM payments WHERE "bookingId" IN (SELECT "_id" FROM bookings WHERE "hotelId"=$1)`, [propertyId]);
  await pg.query(`DELETE FROM bookings WHERE "hotelId"=$1`, [propertyId]);
  await pg.query(`DELETE FROM room_types WHERE "_id"=$1`, [roomTypeId]);
  await pg.query(`DELETE FROM hotels WHERE "_id"=$1`, [hotelId]);
  await pg.query(`DELETE FROM users WHERE email LIKE 'p5-%@test.com'`);
  // restore telegram disabled
  await pg.query(
    `UPDATE settings SET data = jsonb_set(data, '{features,telegramEnabled}', 'false') WHERE id='main'`
  );
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
