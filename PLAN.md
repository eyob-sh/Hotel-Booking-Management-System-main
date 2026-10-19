# PLAN — Guest-House / Hotel Booking System (single-property, Ethiopia-ready)

> Living plan. Read this first when resuming a session. Update checkboxes as work completes.

## 0. Project context

- MERN system migrated from MongoDB/Mongoose → **PostgreSQL 17 + Drizzle** (migration COMPLETE, app runs end-to-end).
- Now being customized: from a multi-hotel marketplace → **configurable single-property booking system**
  (small guest house → big hotel, scalable via rooms, not properties).
- Stack: React + Vite + TS (frontend, port 5174), Express + TS (backend, port 7002), PostgreSQL, Drizzle ORM.

### Environment gotchas (do not rediscover)

- Shell is **Windows PowerShell** via the bash tool — no `head`/`grep`/`ls`. Use `Get-Content`, `Select-String`, or the grep/read tools.
- Node v24.13.1, npm 11.8.0.
- Network is flaky (ECONNRESET). npm installs:
  `npm install --prefer-offline --no-audit --no-fund --maxsockets=2 --fetch-retries=12 --fetch-retry-mintimeout=8000 --fetch-retry-maxtimeout=90000 --fetch-timeout=600000`
  → **verify entry files + native `.node` sizes after install** (partial downloads truncate binaries).
- **`tsconfig` has `strictNullChecks: true`** — do NOT flip back (it caused Drizzle `$inferInsert` breakage).
- `react-router-dom` is missing `dist/index.d.ts` (types only; harmless for dev; breaks `npm run build` tsc only). Restore if build needed.
- Frontend `package.json` is `"type": "module"` — temp node scripts need `.cjs` extension.
- Vite must be launched via `node node_modules/vite/bin/vite.js --port 5174`
  (`Start-Process npm` fails: npm is a .cmd shim).
- Backend runs: `node dist/hotel-booking-backend/src/index.js` (no watch).
- Detached PID/log files: `C:\Users\User\AppData\Local\Temp\opencode\{be,fe}.{pid,log,err}`.
- Frontend API base auto = `http://localhost:7002` on localhost (`src/lib/api-client.ts`), `withCredentials`, 401→refresh interceptor.
- CORS allowlist: `http://localhost:5174`, `http://localhost:7002`, FRONTEND_URL, nip.io host (`backend/src/index.ts:77-82`).
- `/uploads` static mounted **before** `helmet()` (`index.ts:123`) — helmet's CORP `same-origin` blocks cross-origin `<img>`.
- `.env` live: `DATABASE_URL=postgresql://postgres:eyobsh%40123@localhost:5432/hotel-management`
  (PostgreSQL 17.4 on Windows). Test user: `owner@test.com` / `password123`.
- Schema migrations applied manually via `scripts/apply-migration.cjs` (no `drizzle.__drizzle_migrations` table):
  - `0000_classy_rattler.sql` — 6 base tables (analytics, bookings, favorites, hotels, reviews, users), 3 enums, 37 indexes.
  - `0001_*` — `settings` table; `bookings.checkIn/checkOut` → `date`.
  - `0002_room_inventory_payments.sql` — Phase 1: `room_types`, `room_inventory`, `payment_providers`, `payments`,
    extended booking/payment enums, new `bookings` columns; seeds 5 `payment_providers` rows.
  - `/api/health` reports `collections: 11`.
- Firebase removed entirely. Images → local disk `<backend>/uploads/hotels/`, served at `/uploads`.

---

## 1. Locked decisions (do not re-ask)

| Area | Decision |
|---|---|
| Property model | **One property per site**; schema stays property-capable (multi-mode toggle later). Scale via **rooms**. |
| Timezone | **`Africa/Addis_Ababa` (UTC+3, no DST)** — availability nights counted in Addis time, configurable. |
| Currency | **ETB stored/operational**; **USD display-only** at configurable rate in settings. Every payment records currency actually charged. |
| Identity | Login/register with **email OR phone** (password now; SMS OTP later as toggle). **Phone required on booking**, email optional. |
| Prepayment default | **100% paid before arrival** (settings: none / percent / fixed / full, changeable anytime). |
| Free cancellation | **48 hours** before check-in (configurable) → full refund inside window. |
| Payment methods | **pay-at-arrival** + **bank-transfer** live; **telebirr** pluggable (mock mode now, user adds trial/real keys later); **stripe + paypal kept but disabled** (no Ethiopian merchant accounts). |
| Payment extensibility | Adding a method = implement `PaymentProvider` + register + enable in settings (+ optional checkout form). NO changes to booking/pricing logic. |
| Cloudinary | **Keep config but make optional at boot** (decided by user). Nothing uses it. |

### Prepayment semantics

- `prepayment` = amount due **when paying online at booking** → default 100%.
- **pay-at-arrival** bypasses it → deposit 0, full balance at arrival.
- **bank-transfer** → owes prepayment amount by transfer; booking `pending` until manager confirms receipt.
- `allowPayAtProperty` toggle decides whether onsite option is offered.

---

## 2. Delivery phases

### Phase 0 — Foundations (security + architecture, NO UI changes) — ✅ **COMPLETE (2026-10-19)**

**Goal:** close real holes before adding features; extract services layer.

- [x] Extract **services layer** (`backend/src/services/`):
  `settings.ts`, `pricing.ts`, `availability.ts`, `booking.ts`, `payments.ts`.
  (`notifications.ts` deferred to Phase 4 — repo had no email code to extract.)
  - `settings.ts`: cached settings (30s TTL), `calendarDateOf`/`diffNights` (Addis nights),
    `formatMoney`, `toDisplayAmount`, `assertNightsAllowed`, `ensureSettingsRow`.
  - `pricing.ts`: `quoteNights` + `depositFor` (full/percent/fixed/none) — server is the only pricer.
  - `availability.ts`: `checkCapacity` — Phase 0 property-capacity model over overlapping
    `pending/confirmed` bookings (`checkIn < newOut AND checkOut > newIn`); accepts db-or-tx executor.
  - `booking.ts`: `createBooking` — single `db.transaction` + advisory lock
    (`pg_advisory_xact_lock(hashtext('booking:<hotel>:<in>:<out>'))`), capacity check, DATE-string
    insert, atomic `totalBookings/totalRevenue` counters; `BookingConflictError` → 409.
  - `payments.ts`: lazy `getStripe()` (null when no key), `resolveChargePlan` (ETB→USD at `usdRate`,
    throws `PaymentConfigError` **before** any Stripe network call when unchargeable),
    `isStripeConfigured`, `STRIPE_CHARGEABLE = usd|eur|gbp`.
- [x] Create **`settings`** table: single JSONB row —
  `deployMode(single|multi)`, `currency("ETB")`, `displayCurrencies["ETB","USD"]`, `usdRate`,
  `timezone("Africa/Addis_Ababa")`, `prepayment{mode,value}`, `allowPayAtProperty`,
  `freeCancellationHours(48)`, `checkInTime`, `checkOutTime`, `minNights`, `maxNights`,
  `fees[]`, `branding{name,logo,phone,telegram}`, `features{phoneLogin,otpEnabled,reviewsEnabled,telegramEnabled}`,
  `telegram{botToken,chatId}`.
  - Seeded at boot (`ensureSettingsRow`). Endpoints: `GET /api/settings/public` (no `telegram` key),
    `GET /api/settings` + `PUT /api/settings` (verifyToken + admin/hotel_owner, top-level key
    whitelist, junk keys dropped). **Note:** routes are `/api/settings` (not `/api/admin/settings`).
  - **Telegram bot token is write-only:** GET/PUT responses return
    `telegram: {chatId, botTokenConfigured}` — raw `botToken` never leaves the server after being
    written; a client round-tripping the sanitized object cannot wipe the stored token.
    (`sanitizeForClient` in `services/settings.ts`.)
- [x] **Security fixes:**
  - Ownership checks on `routes/bookings.ts` via `getBookingAccess` (full/hotel/self/none):
    GET `/:id` → stranger 403; PATCH status: self only `cancelled`, owner only
    `confirmed|cancelled|completed`, admin any; PATCH payment: full/hotel only (guest 403);
    DELETE wrapped in `db.transaction`, admin-only (owner 403).
  - All booking writes inside **one DB transaction** (`createBooking` service).
  - Rate-limit booking endpoints: `bookingLimiter` 30/15min on `POST /api/hotels/:id/bookings`.
  - Validate booking fields: full express-validator chain (names, email, adult/child counts,
    `phone` regex, `specialRequests` ≤2000 chars) + tz-night helpers (`minNights/maxNights`).
- [x] **Payment integrity fix** in `routes/hotels.ts`:
  - Server recomputes total via `quoteNights` in both `payment-intent` and `confirm-booking`;
    client `totalCost` mismatch → 400 "The price changed since the page was loaded...".
  - intent `amount !== expected` → 409; currency mismatch → 409; Stripe returns 503 when
    unconfigured; ETB + `usdRate: 0` → 400 "cannot be charged online" (no Stripe call attempted).
  - `payment-intent` accepts optional `checkIn`/`checkOut` (preferred) or legacy `numberOfNights`.
- [x] **Availability hook**: `createBooking` capacity + advisory-lock double-booking protection
  (verified: overlap + same-dates-too-many-guests → 409 path). Real per-room-type inventory → Phase 1.
- [x] **Currency/timezone centralization**: `services/settings.ts` — `calendarDateOf(iso, tz)`
  (Intl `en-CA` in property tz), `diffNights` (calendar-day math), `formatMoney`, `toDisplayAmount`
  (ETB→USD at `usdRate`, returns null when not convertible).
- [x] `checkIn`/`checkOut` on bookings → **DATE** type (Addis-Ababa nights) — migration
  `drizzle/0001_youthful_kinsey_walden.sql` applied (settings table + date columns; bookings table was empty).
- [x] `requiredEnvVars`: **Cloudinary + Stripe optional** — boot requires only
  `DATABASE_URL, JWT_SECRET_KEY, REFRESH_SECRET_KEY`; `cloudinary.config()` runs conditionally.
- [ ] Restore `react-router-dom/dist/index.d.ts` — **deferred**: only breaks frontend
  `npm run build`, not dev server; fix when a frontend production build is first needed.
- [ ] Known frontend CSS bug (`--primary/--background` HSL vars) — **deferred to Phase 1** UI work.

**Verification (re-runnable scripts in `hotel-booking-backend/scripts/`):**
- `node scripts/phase0-http-test.cjs` → **55/55** (settings RBAC + write-only telegram,
  booking ownership/status/payment rules, payment-intent/confirm gates, DELETE + counter checks).
  ⚠️ register+login share a 10 req/15min IP limiter — restart backend between runs.
- `npx ts-node --transpile-only scripts/phase0-services-test.ts` → **24/24**
  (tz helpers incl. leap year, deposit modes, USD display, `createBooking` conflict + counters).
  Both excluded from tsc build via tsconfig `"exclude": ["node_modules", "dist", "scripts"]`.

**Acceptance:** ✅ tsc clean; `/api/health` 200 (`collections: 7`); smoke tests pass
(register/login/my-bookings); no route can touch another user's booking; totals are server-computed.

### Phase 1 — Rooms, availability, pricing, checkout (core product)

**Backend: ✅ COMPLETE (2026-10-19)** — verified with `scripts/phase1-http-test.cjs` (**55/55**),
plus Phase 0 regression (55 HTTP + 24 services) all green.
**Frontend checkout rework: ✅ COMPLETE (2026-10-19)** — `tsc` + `vite build` clean; public
`GET /api/hotels/:id` room-types integration verified. **Marketplace cleanup: ✅ COMPLETE.**
`AnalyticsDashboard` repurpose: ⬜ pending (low).

- [x] **New tables** (migration `0002_room_inventory_payments.sql`, applied):
  - `room_types`: name, description, capacity(maxAdults, maxChildren), basePrice, roomCount, photos, sortOrder, active.
  - `room_inventory(roomTypeId, date DATE, totalRooms, reserved, PK(roomTypeId,date), CHECK reserved>=0 AND reserved<=totalRooms)` — `available = total - reserved`.
  - `payment_providers(id PK, displayName, kind(online|onsite), enabled, sortOrder, config JSONB)` — seeded 5 rows.
  - `payments` ledger: `bookingId, providerId, type(deposit|balance|refund|charge), amount, currency, status, providerRef, raw JSONB, createdAt, updatedAt`.
- [x] **Availability engine** (`services/availability.ts`): `checkRoomTypeAvailability` (read-only),
  `reserveRoomTypeNights` (lazy-ensure rows + atomic guarded `UPDATE ... WHERE reserved < totalRooms RETURNING`),
  `releaseRoomTypeNights` (`GREATEST(reserved-1,0)`), legacy `checkCapacity` kept for roomTypeId-less bookings.
- [x] **Pricing engine** (`services/pricing.ts`): nights × basePrice + configured fees, `deposit`/`balance` per
  prepayment settings, optional USD display; returns `{totalStored, display, deposit, balance, fees}`.
- [x] **New APIs:**
  - `POST /api/quotes` — availability + price breakdown + deposit/balance (no side effects). ✅
  - `POST /api/bookings` — server-priced, transactional, holds inventory, provider-aware intent. ✅
  - `GET /api/payment-providers` — enabled only, no secrets. ✅
  - `POST /api/webhooks/payment/:provider` — raw body preserved (mounted before `express.json`). ✅
- [x] **Payment provider interface + registry** (`backend/src/payments/`):
  `types.ts` (`PaymentProvider`, `ProviderError`), `providers/{pay-at-arrival,bank-transfer,telebirr,stripe,paypal}.ts`,
  `registry.ts` (`getProviderRuntime`, `listEnabledProviders`, `chargedAmountFor`), `ledger.ts`
  (`markPaymentSucceeded`/`markPaymentFailed`, idempotent, flip booking pending→confirmed).
  `pay-at-arrival` + `bank-transfer` live; `telebirr` mock completes end-to-end (`mode: mock|live` seam);
  `stripe`/`paypal` present but disabled. **Adding a method = 1 class + 1 register line + DB toggle.**
- [x] **Booking statuses**: enum += `checked_in`, `checked_out`, `no_show`;
  payment_status += `deposit_paid`, `partially_refunded`.
- [x] **Bookings columns**: `roomTypeId`, `reference` (unique, `HB-XXXXXXXXXX`), `depositAmount`,
  `balanceAmount`, `currency` (ETB default), `source(web|phone|telegram|walkin)`; `email` nullable.
- [x] **Inventory lifecycle**: cancel → release; restore cancelled → re-reserve (409 if taken); delete → release.
  New hotels auto-seed one "Standard Room" room type.
- [x] **Frontend rework (single property): ✅ COMPLETE (2026-10-19)**
  - Removed entirely: `/search` page (redirects to `/`), `AdvancedSearch`, `SearchBar`, `FacilitiesFilter`,
    `HotelTypesFilter`, `PriceFilter`, `StarRatingFilter`, `Pagination`, `SearchResultsCard`,
    `LastestDestinationCard`, `IconTest`, marketplace home grid, favorites API helpers
    (`fetchFavorites`/`addFavorite`/`removeFavorite`).
  - Home → single-property hero (+ property info + Rooms & Rates grid from `GET /api/hotels/:id`).
    Hero rewritten without `AdvancedSearch`. Detail → room-type selection; Booking → server quote
    (`/api/quotes`) + provider picker + `POST /api/bookings`. `RoomTypeSummary`/`HotelDetailType`/
    `QuoteResponse`/`PaymentProviderInfo`/`CreateBookingResponse` in `shared/types.ts`.
  - Hardcoded `£` → `ETB` across `Detail`, `Booking`, `MyBookings`, `MyHotels`, `BookingLogModal`,
    `AdminDashboard`; `AnalyticsDashboard` Intl currency USD→ETB.
  - Removed dead `AuthorizedRoute` refs (none existed), cleaned `Layout.tsx` commented code,
    footer broken `/search|/privacy|/terms|/cookies` links → `/`, `/my-bookings`, `/api-docs`, `/api-status`;
    contact copy ETB/Ethiopia.
- [ ] `AnalyticsDashboard` → repurpose as manager reports (occupancy/revenue). ⬜ pending (low)

**Acceptance:** ✅ book a room end-to-end; ✅ second concurrent booking for same room/nights **fails (409)**;
✅ totals never come from client; ✅ pay-at-arrival + bank-transfer complete; ✅ telebirr mock completes;
✅ payments ledger rows created.

### Phase 2 — Phone identity

- [ ] `users.email` → nullable; add `phone` (E.164, UNIQUE), `phoneVerified BOOLEAN`; later `telegramId`.
- [ ] Register/login `identifier` = email **or** phone (reuse existing password flow — no SMS provider needed now).
- [ ] Booking requires `phone` (email optional); `bookings.email` NOT NULL relaxed, `phone` required.
- [ ] Frontend: phone field on register/sign-in/checkout (respect `settings.features.phoneLogin`).
- [ ] (Later) SMS OTP behind `features.otpEnabled`.

**Acceptance:** phone-only user registers, logs in, books with phone; email-only still works.

### Phase 3 — Manager/owner UX

- [ ] **Settings page** (owner/admin): currency, USD display rate, timezone, prepayment mode/value,
  `allowPayAtProperty`, cancellation hours, check-in/out times, min/max nights, fees, branding,
  **payment method enable/disable + provider config**, feature toggles.
- [ ] Rooms CRUD (`MyHotels` → Property + Rooms): room types, capacity, price, room count, photos.
- [ ] **Occupancy calendar** (`GET /api/admin/calendar`): inventory per date, manual adjustments.
- [ ] **Manual booking** (`POST /api/admin/bookings/manual`): phone/walk-in, source tag, record payments.
- [ ] Booking management: confirm / check-in / check-out / cancel / no-show (RBAC: owner+admin only).
- [ ] Record **pay-at-arrival** and **bank-transfer** payments; issue refunds (creates `payments` refund rows).
- [ ] Arrivals/departures today + light reports.

**Acceptance:** owner can configure everything without touching code; manual booking blocks inventory; payment recorded on arrival marks booking paid.

### Phase 4 — Notifications

- [ ] `notifications` **outbox** table + `services/notifications.ts` with pluggable channels:
  `email`, `sms`, `telegram` (interface `NotificationChannel { id; send(msg) }`).
- [ ] Trigger points: booking created/confirmed/reminder, payment received, cancellation, check-in.
- [ ] Email via existing SMTP/resend-style impl (whatever backend already has — check before building).
- [ ] Process outbox on interval (no queue infra needed at this scale).

**Acceptance:** booking → confirmation email recorded in outbox and delivered in dev (log mode OK).

### Phase 5 — Telegram

- [ ] `POST /api/webhooks/telegram/:secret` endpoint (secret in settings).
- [ ] Bot commands reuse **services** (availability/booking/payment status) — no logic duplication.
- [ ] Account linking by phone or `telegramId`.
- [ ] Enable via `settings.features.telegramEnabled`; `telegram{botToken,chatId}` from settings/env.

**Acceptance:** message bot → check availability / my booking without touching HTTP route code.

### Phase 6 — Scale-ups (later, as needed)

- [ ] Staff roles beyond owner/admin (housekeeping, front desk, read-only accountant).
- [ ] Physical room assignment (room number per booking) instead of room-type counts.
- [ ] Seasonal pricing: `rate_plans(roomTypeId, name, startDate, endDate, priceETB)`.
- [ ] Housekeeping status per room.
- [ ] Channel manager (Booking.com/Airbnb sync).
- [ ] Live telebirr/aggregator (Chapa/ArifPay) hardening once user has real credentials.
- [ ] Multi-property `deployMode` toggle (schema already property-capable).

---

## 3. Backend files (quick map)

| File | Notes |
|---|---|
| `hotel-booking-backend/src/index.ts` | requiredEnvVars, CORS `:77-82`, `/uploads` before helmet `:123`, route mounting |
| `src/db/schema.ts` | 6 tables + enums — base for room_types/room_inventory/settings/payments |
| `src/db/index.ts` | pg Pool singleton, table re-exports, check/close connection |
| `src/middleware/auth.ts` | `verifyToken` reads cookie `auth_token`, sets `req.userId`/`req.userRole` |
| `src/routes/hotels.ts` | search; payment-intent `:281`; **confirm-booking `:408` (client-total trust hole)** |
| `src/routes/bookings.ts` | **ownership holes `:182`, `:274`, `:359`; DELETE `:382`** |
| `src/routes/my-hotels.ts` | local-disk `uploadImages`/`filenameFromUrl`/`UPLOAD_DIR` ~`:526-560` |
| `src/routes/users.ts`, `src/routes/auth.ts` | register/login → extend for phone `identifier` |
| `hotel-booking-backend/.env`, `.env.example` | DB, JWT/REFRESH secrets, Cloudinary/Stripe (now optional) |
| `hotel-booking-backend/drizzle/0000_classy_rattler.sql` | applied migration |

## 4. Frontend files (quick map)

| File | Notes |
|---|---|
| `src/App.tsx` | route map + role guards — rework for single-property |
| `src/lib/api-client.ts` | axios baseURL `http://localhost:7002`, withCredentials, 401 refresh |
| `src/forms/ManageHotelForm/*` | → property/rooms editor |
| `src/pages/Booking*`, `src/forms/BookingForm/*` | → checkout with deposit split |
| `shared/types.ts` | shared API contract — add phone/currency/room types here |

## 5. Session resume checklist

1. Read this file.
2. Check servers: `http://localhost:7002/api/health`, `http://localhost:5174`.
   - Backend: `node dist/hotel-booking-backend/src/index.js` (rebuild: `npm run build` in backend dir).
   - Frontend: `node node_modules/vite/bin/vite.js --port 5174`.
3. Check current phase checkbox status above → continue from first unchecked phase.
4. After any code change: backend `tsc` must be clean; run frontend dev-server transform check.
