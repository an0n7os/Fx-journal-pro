# FX Journal Pro — MT5 Investor Password Synchronization: Technical Specification

> Branch: `invester-password`
> Status: Design specification (not yet implemented)

## 1. System Overview

FX Journal Pro (FJP) will add a production-grade **MT5 Investor Password (read-only) synchronization** method that keeps the user's portfolio isolated and never uses the main trading password.

**Design principle:** the Investor Password grants read-only access by definition in MetaQuotes MT5. The system is built so that, in the primary flow, **the website never sees or stores the Investor Password at all** — the EA authenticates locally inside the user's MT5 terminal using the session the user logged in with. A cloud bridge (MetaApi) flow is offered as a secondary path, with the password encrypted under envelope encryption.

**Primary recommendation: Enhanced EA sync (local authentication).**
**Alternative (documented): Cloud bridge via MetaApi (server-side validation).**

The existing FJP EA-based integration (`src/eaTemplate.ts`, `/api/mt5/ea/authenticate`, `/api/mt5/ea/sync`, `trading_accounts.ea_token`) is extended, not replaced, so existing connected users are unaffected.

### Explicit assumptions

| # | Assumption |
|---|---|
| A1 | Backend is Express (`server.ts`), deployed on Vercel serverless; frontend is React/Vite. |
| A2 | Persistence is Supabase Postgres; the server currently uses the **anon/publishable key without Supabase Auth JWT**, so `auth.uid()` is NULL and isolation is **app-level** via `x-auth-user-id`/`x-auth-email` headers. RLS is enabled but currently open (`USING (true)`). |
| A3 | No MetaApi SDK is installed yet; `META_API_TOKEN` exists only as a placeholder in `.env`/`.env.example`. |
| A4 | The EA is MQL5, generated per account from `EA_TEMPLATE` with an embedded `ea_token`. |
| A5 | `mt5_deals.id` is currently the raw MT5 ticket (not account-scoped). This is a data-integrity gap to fix. |
| A6 | Deposits/withdrawals are currently stored as `trades` rows with `type='Deposit'|'Withdrawal'`; the first deposit is folded into `starting_balance`. This must be preserved for dashboard compatibility. |
| A7 | All new schema changes must be **backward-compatible** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`). |

---

## 2. User Flow

```
[Create MT5 portfolio account]
        │
        ▼
[Enter MT5 account login]
        │
        ▼
[Select: Broker │ Prop Firm]
        │
        ▼
[Enter broker / prop-firm name]
        │
        ▼
[Select: Live │ Demo]
        │
        ▼
[Enter MT5 server name]   e.g. IC Markets-Main, Exness-MT5Real3
        │
        ▼
[Choose sync method]
        │
        ├──► EA Auto-Sync (recommended)
        │        │   User enters the Investor Password ONLY in MT5 (or in the EA input dialog).
        │        │   Website never collects or stores it.
        │        │   → Download .mq5 → install → attach to chart → Connection validated
        │        ▼
        └──► Cloud Bridge (MetaApi)
                 │   User enters Investor Password in the form.
                 │   Password is encrypted at rest (envelope encryption) and used only
                 │   by the sync service for read-only connection.
                 ▼
                 → Server-side connection test → Connected
```

### Step-by-step (EA method — primary)

1. **Create portfolio account** — user supplies: alias/name, institution type (Broker/Prop Firm), institution name, Live/Demo, base currency, MT5 **login**, MT5 **server name**.
2. **Explained clearly (UI copy):** *"The Investor Password is read-only. It cannot place, modify, or close trades, cannot withdraw funds, and cannot access your main password. If a broker asks for the main password for journaling, refuse."*
3. **Investor Password entry** — in MT5: `Tools → Options → Server` → use the **Investor (read-only)** account. The EA reads the terminal's active session via the MQL5 API. The website displays instructions to find it: *"Broker client → Account management → 'Change/investor password' or 'Create investor account'."*
4. **EA generation** — backend generates a per-account `.mq5` with an embedded **EA token** and account ID.
5. **EA install & run** — user saves to `MQL5/Experts`, compiles (F7), attaches to a chart, enables automated trading.
6. **Validation** — the EA calls `POST /api/mt5/ea/validate` with `terminal.login`, `terminal.server`, `terminal.build`, and account info. The backend matches login+server against the portfolio, records `connected` only after the server replies `OK`. **The account is marked "Connected" only after this handshake.**
7. **Periodic sync** — every 30s (configurable) the EA sends account snapshots, open positions, pending orders, and closed deals (cursor-based).
8. **Status visible** — dashboard shows Connected / Syncing / Disconnected with last-sync time.

---

## 3. Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│  User MT5   │      │  FJP Web / SPA   │      │  FJP Backend (Node)   │
│  Terminal   │      │  (React)         │      │  server.ts / Vercel   │
│ ┌─────────┐ │      │                  │      │                      │
│ │ FJP EA  │◄──────┤ • Connection page │      │ • Auth (x-auth)      │
│ │ .mq5    │ │      │ • Status UI      │      │ • EA token auth      │
│ └─────────┘ │      └──────────────────┘      │ • Validation         │
│   │         │                                │ • Dedup / idempotency│
│   │ HTTPS   │                                │ • Snapshot writes    │
│   ▼         │      ┌──────────────────┐      │ • Cloud bridge       │
│ FJP API     │─────►│  Secure API      │─────►│ • Rate limiting      │
│ (read-only) │      │  /api/mt5/*      │      │ • Audit logging      │
└─────────────┘      └──────────────────┘      └──────────┬───────────┘
                                                         │ upsert
                                                     ┌───▼────────────┐
                                                     │  Supabase PG   │
                                                     │  (RLS, uniques)│
                                                     └────────────────┘
```

- **Unique identifier per portfolio:** existing `trading_accounts.id` (UUID) is the portfolio account identifier. The EA is bound to it via embedded `account_id` + `ea_token`.
- **EA scope:** each `.mq5` is generated for exactly one portfolio account. It cannot be reused on another account (token is validated against `account_id`).
- **Transport:** HTTPS only. EA→server uses `WebRequest` (TLS). User→server uses browser HTTPS.
- **Caches/queues:** server-side per-account sync queue with in-flight locking to prevent concurrent writes for the same account.
- **Offline behavior:** EA buffers nothing of consequence (MT5 holds its own history); on reconnect it re-syncs via cursor. Server keeps `last_heartbeat_at`; stale > 2 min → status `Disconnected`.

---

## 4. MT5 Investor Password Security Model

### 4.1 Policy

| Question | Decision |
|---|---|
| Request the main trading password? | **Never.** Not in UI, not in API, not in EA. |
| Store the Investor Password? | **Primary flow: No.** The EA authenticates locally against the terminal session. |
| Cloud-bridge flow storage? | **Yes, only if unavoidable** (no-EA validation), under **envelope encryption** (KMS data key wrapped with a key-encryption-key; DEK lives in memory only during a connection). |
| Log the password? | **Never.** Logs store only `account_id`, `login`, event codes. Logging must strip any body containing password fields. |
| Credentials in API requests? | **No.** EA uses a per-account **token** + HMAC signature. |

### 4.2 If storage is required (cloud bridge only)

- `trading_accounts.investor_password_enc` — AES-256-GCM ciphertext, with a per-row 12-byte nonce and 16-byte auth tag.
- Data key is a KMS-generated DEK; DEK wrapped (envelope) and stored; unwrapped only in memory for the connection lifetime; re-wrapped key is cached for ≤ 60s.
- One-time use on connect; never sent to the browser again; never returned by any GET endpoint.
- Rotation: re-encrypt on key rotation; support `kms:Decrypt` audit.
- Risk of storing even encrypted: ciphertext can be brute-forced if KMS is compromised, and the sync service becomes a high-value target. This is why EA-local auth is the recommended default.

### 4.3 TLS and transport

- All endpoints behind TLS 1.2+ (HSTS). MQL5 `WebRequest` requires HTTPS and the host must be allow-listed in MT5 (`Tools → Options → Expert Advisors → Allow WebRequest`).
- Server binds with `x-forwarded-proto` enforcement; refuse non-HTTPS in production.

### 4.4 EA-to-server authentication

- `Authorization: Bearer <ea_token>` + `X-EA-Account-Id` + `X-EA-Timestamp` (ISO-8601) + `X-EA-Signature`.
- Signature = `HMAC-SHA256(secret = sha256(ea_token), message = "<timestamp>.<accountId>.<rawBody>")` — prevents replay and body tampering.
- Timestamp window ±5 min; monotonic `requestId` idempotency.
- `ea_token` should be stored **hashed** (`sha256`) for new tokens; legacy raw values migrate lazily (see §15).

---

## 5. MT5 EA Workflow

1. **Install:** save generated `.mq5` to `MQL5/Experts`, compile with F7, attach to any chart, enable automated trading (`Tools → Options → Expert Advisors` → tick "Allow WebRequest" + add FJP host).
2. **Identify portfolio:** embedded `FXJP_ACCOUNT_ID` + `FXJP_TOKEN` constants; EA sends these on every request.
3. **Read data (read-only):** `AccountInfoInteger/Double/String`, `PositionsTotal`/`PositionGetTicket`, `OrdersTotal`/`OrderGetTicket`, `HistorySelect(from,to)` / `HistoryDealGetTicket`. No `OrderSend`, `PositionClose`, `OrderModify` — the EA contains **zero trading functions**.
4. **Authenticate + validate:** `POST /api/mt5/ea/validate` returns `{ ok, portfolioId }`; on failure the EA stops and sets terminal comment `FJP: auth failed`.
5. **Sync loop:** `OnTimer` every 30s: snapshot account → push positions → push orders → push new deals (cursor > `ea_last_deal_id`). `OnTradeTransaction` triggers an immediate sync on new deals.
6. **Backfill:** on start (if `InpFullSyncOnStart`), `HistorySelect(now-90d, now)` uploads closed deals up to `InpBatchSize` per request, until cursor reaches newest.
7. **MT5 offline:** requests fail with connection/`WebRequest` errors; EA retries with exponential backoff (5s → 10s → 30s, max 5 min); server marks `Disconnected` after missed heartbeats.
8. **EA removed:** server sees no heartbeat/sync; status goes `Disconnected`; no data loss — history persists; reconnect regenerates token or reuses.
9. **Token revoked:** EA receives `401`; it stops syncing and displays `FJP: token revoked` in the terminal; the user must download a fresh EA.

---

## 6. Synchronization Flow Diagram

```
User ──► FX Journal Pro (create MT5 portfolio: login, server, broker, live/demo)
                 │
                 ▼
          MT5 Connection created (account_id + ea_token)
                 │
                 ▼
       FX Journal Pro generates unique .mq5 (EA) per portfolio
                 │
                 ▼
          User installs EA in MT5 (investor-password session)
                 │
                 ▼
       EA ──HTTPS──► POST /api/mt5/ea/validate  (login, server, build, HMAC)
                 │        │
                 │        ▼
                 │   Backend validates token + login/server match ──► 200 ok (Connected)
                 ▼
       EA ──HTTPS──► POST /api/mt5/ea/account   (balance/equity/margin snapshot)
                 │
                 ├─► POST /api/mt5/ea/positions (open positions snapshot)
                 │
                 ├─► POST /api/mt5/ea/orders    (pending orders snapshot)
                 │
                 └─► POST /api/mt5/ea/sync      (cursor-based closed deals)
                 │        │
                 │        ▼
                 │   Backend validation (auth, schema, timestamps, idempotency,
                 │   dedup, ownership) ──► upsert
                 ▼
                 Database (account-scoped, RLS)
                 │
                 ▼
              Dashboard (positions, equity curve, P&L, deposits/withdrawals,
              last sync time, connection status)
```

---

## 7. Backend/API Design

### 7.1 Endpoint inventory (new + modified)

| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /api/mt5/ea/validate` | EA token + HMAC | Handshake; validate login/server/build; mark Connected |
| `POST /api/mt5/ea/account` | EA token + HMAC | Write account snapshot (balance/equity/margin/free margin/leverage/currency) |
| `POST /api/mt5/ea/positions` | EA token + HMAC | Replace open-positions snapshot for the account |
| `POST /api/mt5/ea/orders` | EA token + HMAC | Replace pending-orders snapshot |
| `POST /api/mt5/ea/sync` *(modified)* | EA token + HMAC | Closed-deal batch (cursor, `ea_last_deal_id`), money flows |
| `POST /api/mt5/ea/heartbeat` | EA token + HMAC | Liveness + current balance/equity |
| `POST /api/mt5/ea/error` | EA token + HMAC | Client-side errors (sanitized) |
| `GET /api/mt5/:accountId/status` | x-auth (user) | Connection status, last sync, last error |
| `POST /api/mt5/:accountId/disconnect` | x-auth (user) | Revoke token + mark disconnected |
| `POST /api/mt5/:accountId/reset-token` *(exists)* | x-auth (user) | Rotate EA token |
| `POST /api/mt5/cloud/connect` | x-auth (user) | MetaApi: validate login/server/investor-password; encrypted storage |
| `POST /api/mt5/cloud/disconnect` | x-auth (user) | Remove encrypted credential + revoke MetaApi account |
| `POST /api/mt5/ea/:accountId/download` *(exists)* | x-auth (user) | Serve per-account `.mq5` |
| `GET /api/mt5/admin/audit` | admin | Sync/audit log review |

### 7.2 EA authentication

```
constant-time compare(token, stored) using crypto.timingSafeEqual
→ lookup trading_accounts by account_id
→ reject if token mismatch (401 EA_AUTH_FAILED)
→ reject if revoked_at set (401 EA_TOKEN_REVOKED)
→ verify X-EA-Timestamp within ±5min and HMAC over body (replay prevention)
→ reject if requestId already processed (idempotency set, TTL 24h)
```

### 7.3 Validation rules

- **Ownership:** every write resolves `user_id` from the account row; all row inserts carry `account_id` + `user_id`; a user can only read/write their own accounts.
- **MT5 login/server:** `mt5_login` numeric 1..999999999; server string ≤ 64 chars; login+server must match the EA-reported terminal values during `validate`.
- **Timestamp/sequence:** reject deals with `time` older than the account's `backfill_start` or newer than server time + 5 min (clock-skew guard).
- **Payload schema:** strict JSON schema (`zod`) — unknown fields rejected; string lengths bounded; volume/price as finite numbers.
- **Rate limiting:** per account 10 req/5s; per token 60 req/60s; exponential backoff response `429` with `Retry-After`. Global EA IP rate cap 300 req/min.

### 7.4 Idempotency & duplicate prevention

- Deals: dedup key = `(account_id, ticket)` — upsert (fixes current PK gap).
- Positions/orders: replace snapshot per `(account_id, position_id/order_id)`.
- Money flows: dedup `(account_id, ticket)`.
- Whole-request: `requestId` stored in `mt5_sync_logs` with `UNIQUE(request_id)` to drop retransmissions.

### 7.5 Logging & monitoring

- Log `account_id`, `request_id`, `event`, `status`, latency. **Never log** tokens, passwords, or deal payload bodies.
- Alert on: consecutive auth failures (>5), repeated 429s, replay detection, cross-account access attempts.

---

## 8. Database Schema

All migrations **backward-compatible** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`), applied in Supabase SQL editor as root-level `.sql` scripts, matching the existing convention.

### 8.1 Extend `trading_accounts` (additive)

```sql
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_login TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_server TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_build TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS sync_method TEXT DEFAULT 'EA';  -- EA | CLOUD
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'Not Connected'; -- NotConnected|Validating|Connected|Disconnected|Error
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS backfill_start TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS backfill_end TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS investor_password_enc TEXT; -- cloud bridge only (never EA flow)
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS password_enc_nonce TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS password_kms_key_id TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;
```

### 8.2 New tables

```sql
-- EA instances / tokens (store hash, not raw)
CREATE TABLE IF NOT EXISTS mt5_ea_instances (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,           -- ea_xxxxxxxx (first 10 chars, for display)
  request_id TEXT,                      -- last idempotency key
  last_ip TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(account_id, token_hash)
);

-- Account snapshots (append-only time series)
CREATE TABLE IF NOT EXISTS mt5_account_snapshots (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance FLOAT, equity FLOAT, margin FLOAT, margin_free FLOAT, margin_level FLOAT,
  currency TEXT, leverage INTEGER,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snaps_account_time ON mt5_account_snapshots(account_id, captured_at DESC);

-- Open positions (replace-on-snapshot)
CREATE TABLE IF NOT EXISTS mt5_open_positions (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id BIGINT NOT NULL,
  ticket BIGINT NOT NULL,
  symbol TEXT, side TEXT, volume FLOAT,
  open_time TIMESTAMPTZ, open_price FLOAT, sl FLOAT, tp FLOAT,
  commission FLOAT DEFAULT 0, swap FLOAT DEFAULT 0, profit FLOAT DEFAULT 0,
  current_price FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, position_id)
);

-- Pending orders
CREATE TABLE IF NOT EXISTS mt5_pending_orders (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL,
  symbol TEXT, type TEXT, volume FLOAT,
  open_price FLOAT, sl FLOAT, tp FLOAT, magic INTEGER, state TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, order_id)
);

-- Money flows (deposits/withdrawals — separate from trades)
CREATE TABLE IF NOT EXISTS mt5_money_flows (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket BIGINT NOT NULL,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('DEPOSIT','WITHDRAWAL','CREDIT','INTEREST')),
  amount FLOAT NOT NULL,
  currency TEXT,
  time TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, ticket)
);

-- Sync logs (idempotency + audit)
CREATE TABLE IF NOT EXISTS mt5_sync_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT,
  event TEXT, level TEXT, message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id)
);

-- Connection errors
CREATE TABLE IF NOT EXISTS mt5_connection_errors (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  error_code TEXT, error_message TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Audit trail
CREATE TABLE IF NOT EXISTS mt5_audit_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT, action TEXT, ip TEXT, request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 8.3 Data-integrity fixes (safe, additive)

```sql
-- Fix: mt5_deals id is currently the raw ticket (cross-account collision risk).
CREATE TABLE IF NOT EXISTS mt5_deals_v2 (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket BIGINT NOT NULL,
  position_id BIGINT DEFAULT 0,
  deal JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, ticket)
);

-- Unique guard for imported journal trades
CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_account_ea_deal
  ON trades(account_id, ea_deal_id)
  WHERE ea_deal_id IS NOT NULL;
```

> Migration: copy old `mt5_deals` rows into `mt5_deals_v2` once, then route new writes to `mt5_deals_v2` and leave the legacy table for back-compat (or drop it after a full backfill).

### 8.4 RLS

Current RLS is open (`USING (true)`) because the server uses the anon key and `auth.uid()` is NULL. **Phase 1 (now):** keep app-level isolation (server enforces `user_id` on every query), but add indexes and the constraints above. **Phase 2 (recommended):** migrate the server to `service_role` for internal writes, keep anon role for nothing, and replace policies with strict ones:

```sql
CREATE POLICY "users own their account rows" ON trading_accounts
  FOR ALL TO authenticated USING (user_id = auth.uid());
```

Shipping Phase 2 requires the Supabase Auth JWT flow (not currently used); it must be a separate, explicitly tested rollout (§15) so it cannot break existing users.

---

## 9. Trade and Balance Data Handling

### 9.1 Classifications

| MT5 event | Classification | Destination |
|---|---|---|
| `DEAL_TYPE_BUY/SELL` (positions) | Trading trade | `trades` (type Buy/Sell) + grouped by `position_id` |
| `DEAL_TYPE_BALANCE` +, first ever | **Initial deposit** | `starting_balance` (as today) |
| `DEAL_TYPE_BALANCE` +, subsequent | Deposit | `mt5_money_flows` + mirrored `trades` row (type Deposit) for dashboard compat |
| `DEAL_TYPE_BALANCE` − | Withdrawal | `mt5_money_flows` + mirrored `trades` row (type Withdrawal) |
| `DEAL_TYPE_CREDIT` | Credit/interest | `mt5_money_flows` |
| `DEAL_TYPE_COMMISSION` / swap within a position | Costs | folded into that position's `commission`/`swap` sums |

### 9.2 Metrics

```
realized P&L = Σ closed trades (profit)          [excluding Deposit/Withdrawal]
unrealized  = Σ open positions profit
balance     = latest snapshot balance
equity      = latest snapshot equity
deposits    = Σ mt5_money_flows WHERE type='DEPOSIT'
withdrawals = Σ mt5_money_flows WHERE type='WITHDRAWAL'
wins        = count(closed trades with profit > 0)
losses      = count(closed trades with profit < 0)
best trade  = max(profit)   worst trade = min(profit)
```

### 9.3 Initial balance calculation (reliable)

1. If a **first-ever balance deal** exists → `starting_balance = that amount`.
2. Else reconcile: `initial_balance = current_balance − (deposits − withdrawals + realized P&L + costs)` computed over the imported window. If the window does not reach the account's creation (e.g., 90-day backfill on a 2-year-old account), store `starting_balance` as **estimated** (`is_estimated` flag) and recompute automatically once a full-history backfill completes.
3. Guard against double counting: initial deposit is excluded from `deposits`; balance deals must not be re-processed when the EA re-syncs (dedup by ticket).

### 9.4 Edge cases

- **Partial close:** multiple out-deals share `position_id` → one trade row with summed profit/commission/swap; `ea_deal_id` = last out-deal ticket.
- **Multiple positions / orders:** separate `position_id`/`order_id`; never merged.
- **Commissions, swaps, fees:** summed per position from all its deals.
- **Duplicate sync:** dedup by `(account_id, ticket)`; snapshot replace semantics for open items; `requestId` idempotency.
- **Historical range:** default `now − 90d`; `InpFullSyncOnStart` backfill with cursor pagination; schema supports arbitrary `backfill_start/end`.

---

## 10. Frontend/UI Flow

**Connection states** (drives the whole page):
`Not Started → Collecting → EA Ready (download) → Validating → Connected → Syncing → Synced → Error → Disconnected`

| State | UI |
|---|---|
| Not Started | Account-creation form (login, server, broker/prop firm, Live/Demo) + Investor Password explanation panel |
| Collecting | Spinner; "Generating your unique EA…" |
| EA Ready | Step-by-step install card (identical style to `MT5Automation.tsx`) + "Copy code"/"Download .mq5" |
| Validating | Pulse badge "Waiting for MT5…"; server listening for `validate` heartbeat |
| Connected | Green "Connected" chip, login `#123456` · `IC Markets-Main`, "Last sync 12s ago" |
| Syncing | Animated refresh; progress "Syncing 90 days of history… 47% (deal 9,400/20,000)" |
| Error | User-friendly message + "Retry" + link to error detail |
| Disconnected | Amber chip, "Reconnect" (re-download EA / re-auth) and "Disconnect" (revoke token) |

**Non-negotiable UI rules:**

- Investor Password input (cloud method only) is `type="password"` with `autocomplete="off"`; never echoed back; masked after submit.
- Read-only disclaimer shown at least twice (create + install).
- Reconnect and Disconnect are always available; Disconnect shows a confirm dialog explaining token revocation.
- Errors are mapped to friendly copy (e.g., `EA_AUTH_FAILED` → "This EA file no longer works. Download a fresh copy from your account page.").

---

## 11. Authentication and Token Security

| Layer | Mechanism |
|---|---|
| User → app | Existing header auth (`x-auth-user-id`/`x-auth-email`), OTP-verified email. No change for existing users. |
| User → MT5 endpoints | Same headers + server-side ownership check on `account_id`. |
| EA → server | `Bearer ea_token` + `X-EA-Account-Id` + `X-EA-Timestamp` + `X-EA-Signature` (HMAC-SHA256 over timestamp.accountId.body). |
| Token storage | New tokens stored as `sha256` hash + prefix; legacy raw tokens migrate lazily (first rotate). |
| Rotation | `POST /api/mt5/:accountId/reset-token` (exists) → old token revoked instantly, new EA file required. |
| Revocation | `POST /api/mt5/:accountId/disconnect` → `revoked_at` set, token hash deleted, EA rejected with `EA_TOKEN_REVOKED`. |
| Replay | Timestamp window ±5 min + per-token `requestId` uniqueness. |
| Rate limiting | Per token/account/IP as §7.3. |
| Validation | Strict JSON schema; `constant-time` token compare. |

---

## 12. Error Handling and Recovery

| Error code | HTTP | Meaning | Recovery |
|---|---|---|---|
| `EA_AUTH_FAILED` | 401 | Bad/revoked token | User downloads fresh EA |
| `EA_TOKEN_REVOKED` | 401 | Token revoked | Reconnect flow |
| `INVALID_TIMESTAMP` | 401 | Replay/clock skew | EA re-syncs clock, retries |
| `SIGNATURE_MISMATCH` | 401 | Tampered body | Drop request; log |
| `ACCOUNT_NOT_FOUND` | 404 | Unknown account_id | Log; alert |
| `INVALID_PAYLOAD` | 422 | Schema violation | EA retries next cycle |
| `RATE_LIMITED` | 429 | Too many requests | Backoff with `Retry-After` |
| `DUPLICATE_REQUEST` | 200 (idempotent) | Already processed | Return stored result |
| `SERVER_ERROR` | 500 | Internal | EA retries, backoff |
| `MT5_OFFLINE` | (EA-side) | No broker connection | EA backoff; status Disconnected |
| `E_CONNECTION_LOST` | (EA-side) | WebRequest failure | Backoff 5s→5min |

EA retry policy: exponential backoff capped at 5 min; heartbeat continues so the server can show "Disconnected" rather than "Error". All server errors recorded to `mt5_connection_errors` with resolution tracking.

---

## 13. Threat Model

| Threat | Impact | Mitigation |
|---|---|---|
| Credential theft (investor password) | Read-only data exposure | Primary flow never stores it; cloud flow encrypts with KMS envelope; no logging; rotation. |
| Fake EA requests | Fake data in DB | Bearer token + HMAC + constant-time compare + account scoping. |
| Token theft | Impersonate EA | Hashing at rest; TLS; short lifetime optional; rotation/revocation; IP drift detection. |
| Replay attacks | Duplicate/fake data | Timestamp window + `requestId` uniqueness + HMAC. |
| Cross-user data access | PII/portfolio leak | Server ownership checks on every query; account-scoped dedup keys; Phase-2 strict RLS. |
| API abuse | DoS / cost | Rate limiting, payload caps, per-IP caps, monitoring. |
| Duplicate synchronization | Corrupt stats | `(account_id, ticket)` dedup + snapshot replace + idempotency. |
| Database exposure | Full leak | Least-privilege keys; RLS; encrypted backups; no passwords stored (EA flow). |
| Man-in-the-middle | Payload tampering | TLS 1.2+, HSTS, HMAC signatures. |
| Compromised user PC | Token/password theft | Token bound to account; rotate on suspicion; investor password is read-only so damage is limited; never store main password. |
| Revoked/disconnected accounts | Stale writes | `revoked_at` checked on every EA request; disconnect endpoint. |

---

## 14. Production Security Checklist

- [ ] HTTPS-only; HSTS; MT5 WebRequest allow-list guidance
- [ ] EA tokens stored hashed; legacy tokens migrated on rotation
- [ ] No main trading password anywhere
- [ ] Investor password (cloud flow) only via KMS envelope encryption; never logged/returned
- [ ] HMAC-signed EA requests with replay window and `requestId`
- [ ] Constant-time token comparison
- [ ] Rate limiting (per token/account/IP) + `Retry-After`
- [ ] Strict input validation (zod) on all EA endpoints
- [ ] Ownership enforcement on every DB query (`account_id`, `user_id`)
- [ ] Account-scoped unique constraints (dedup fixes)
- [ ] Audit logging (`mt5_audit_logs`) without sensitive values
- [ ] Structured error monitoring + alerts on auth-failure spikes
- [ ] Automated encrypted backups + tested restore
- [ ] Data retention policy (e.g., snapshots 1y, sync logs 90d) with purge job
- [ ] Privacy: investor password never shared; transparency notice
- [ ] Phase-2 strict RLS only after JWT rollout is tested (see §15)

---

## 15. Existing User / Data Migration Strategy

**Principle: never overwrite, only add. All existing portfolio accounts, trades, journals, and subscriptions remain untouched.**

1. **DB migrations first (backward-compatible):** only `ADD COLUMN IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS` + additive indexes/constraints. No `DROP`, no column renames, no type changes on `trades`/`trading_accounts`.
2. **Preserve current semantics:** keep writing Deposit/Withdrawal rows to `trades` for dashboards; `mt5_money_flows` is additive. Keep `ea_last_deal_id` cursor working.
3. **Fix `mt5_deals` PK safely:** write to new `mt5_deals_v2`; backfill-copy legacy rows once; leave old table readable until all accounts have re-synced (then optional cleanup in a later release).
4. **Feature flag:** new Investor-Password UI + endpoints behind a flag; existing EA flow keeps working with the old endpoints until the new ones are proven.
5. **Legacy tokens:** `ea_token` raw column stays readable; new `mt5_ea_instances.token_hash` populated on next successful EA auth or token reset — no forced re-login for existing users.
6. **EA template upgrade:** new fields are optional (send only when available); old EA binaries keep working against new endpoints for 1 release cycle.
7. **Deploy order:** (a) SQL scripts → (b) server (backward compatible) → (c) frontend (feature-flagged) → (d) new EA template → (e) enable flag.
8. **Rollback:** revert flag = old UI; server endpoints remain; new tables are inert and safe to leave. No destructive migration to reverse.
9. **Regression gate:** existing EA users' accounts continue syncing during and after deploy; monitor `ea_last_sync_time` freshness for a representative sample before/after.

---

## 16. API Examples

**EA validate**

```
POST /api/mt5/ea/validate
Authorization: Bearer ea_xxxxxxxxxxxx
X-EA-Account-Id: acc_1q2w3e
X-EA-Timestamp: 2026-08-09T14:30:00Z
X-EA-Signature: 5f9c…(hmac-sha256)
{ "terminal": { "login": "52345678", "server": "ICMarkets-MT5-Demo",
                "build": 4120, "name": "Demo" },
  "account": { "balance": 10234.55, "equity": 10198.10,
               "margin": 812.30, "margin_free": 9385.80,
               "currency": "USD", "leverage": 100 } }
```

`200`

```json
{ "ok": true, "portfolioId": "acc_1q2w3e", "syncIntervalSec": 30 }
```

**EA sync (deals)**

```
POST /api/mt5/ea/sync
{ "cursor": { "lastDealId": 9400 },
  "deals": [
    { "ticket": 9401, "positionId": 77821, "time": "2026-08-09T14:21:00Z",
      "type": "DEAL_TYPE_BUY", "entry": "DEAL_ENTRY_OUT", "magic": 0,
      "symbol": "EURUSD", "volume": 0.50, "price": 1.08421,
      "profit": 125.40, "commission": -3.5, "swap": -0.42, "comment": "" } ],
  "moneyFlows": [
    { "ticket": 9390, "type": "DEPOSIT", "amount": 5000,
      "currency": "USD", "time": "2026-08-09T10:00:00Z" } ] }
```

`200`

```json
{ "ok": true, "processedDeals": 1, "skippedDuplicates": 0, "nextCursor": 9401 }
```

**User disconnect**

```
POST /api/mt5/acc_1q2w3e/disconnect
x-auth-user-id: u_abc123
```

`200` → `{ "ok": true, "status": "Disconnected", "tokenRevoked": true }`

---

## 17. EA Pseudocode

```mql5
// FXJournalPro_InvestorSync.mq5
input int   InpSyncIntervalSec = 30;   // sync cadence
input int   InpBatchSize       = 200;  // deals per request
input bool  InpFullSyncOnStart = true; // backfill 90 days on start

#define FXJP_ACCOUNT_ID "acc_1q2w3e"
#define FXJP_TOKEN      "ea_..."
#define FXJP_API_URL    "https://fxjournalpro.com/api/mt5"

long   lastDealId = 0;

string Sign(string body, string ts) {
  return HmacSha256(Sha256(FXJP_TOKEN), StringFormat("%s.%s.%s", ts, FXJP_ACCOUNT_ID, body));
}

int Post(string path, string body) {
  string ts = TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS); // ISO-ish
  string headers = StringFormat("Authorization: Bearer %s\r\n"
    "X-EA-Account-Id: %s\r\nX-EA-Timestamp: %s\r\n"
    "X-EA-Signature: %s\r\nContent-Type: application/json",
    FXJP_TOKEN, FXJP_ACCOUNT_ID, ts, Sign(body, ts));
  return HttpPost(path, headers, body);   // WebRequest (HTTPS, 15s timeout)
}

void SyncAccount() {
  body = BuildAccountJson();                 // balance, equity, margin, ...
  if (Post("/ea/account", body) == 200) UpdateLastSync();
}

void SyncPositions() {                       // PositionsTotal loop
  body = BuildPositionsJson();               // side, volume, price, sl, tp, profit
  Post("/ea/positions", body);               // replace-snapshot semantics
}

void SyncOrders() {                          // OrdersTotal loop
  body = BuildOrdersJson();                  // pending orders
  Post("/ea/orders", body);
}

void SyncDeals(long fromDeal) {
  int total = HistoryDealsTotal();
  if (total == 0) return;
  // gather deals with ticket > fromDeal, up to InpBatchSize
  body = BuildDealsJson(batch, moneyFlows);  // profit, commission, swap, type
  int code = Post("/ea/sync", body);
  if (code == 200) lastDealId = batchNewest; // advance cursor
  else if (code == 401) { Comment("FJP: token revoked"); ExpertRemove(); }
}

void OnInit() {
  if (Post("/ea/validate", BuildValidateJson()) != 200) { Comment("FJP: auth failed"); return; }
  if (InpFullSyncOnStart) SyncDeals(HistorySelect(now-90d, now));
  EventSetTimer(InpSyncIntervalSec);
}
void OnTimer() {
  SyncAccount(); SyncPositions(); SyncOrders();
  SyncDeals(lastDealId);
}
void OnTradeTransaction(..) { if (deal added) SyncDeals(lastDealId); }
// NOTE: no OrderSend / PositionClose / OrderModify anywhere in this EA.
```

---

## 18. End-to-End Implementation Steps

1. **Schema:** write `mt5_investor_sync_migration.sql` (§8), apply to Supabase.
2. **Server:** add `mt5_deals_v2` writes, new endpoints (§7.1), HMAC/replay middleware, rate limiter, zod schemas, KMS envelope helper (cloud flow), audit logging. Keep old endpoints working.
3. **EA template (`src/eaTemplate.ts`):** add validate/account/positions/orders/heartbeat calls, HMAC signing, money-flow detection, backfill 90d, backoff.
4. **Frontend:** new MT5 connection page (§10) with connection-state machine, investor-password guidance, read-only disclaimer; integrate with existing `MT5Automation.tsx` install steps.
5. **Feature flag + deploy** in §15 order.
6. **Dashboards:** add snapshot time-series (equity curve from `mt5_account_snapshots`), open-positions panel, deposits/withdrawals from `mt5_money_flows`.
7. **MetaApi cloud bridge:** add SDK (`metaapi.cloud`), `META_API_TOKEN` wiring, encrypted credential store, server-side validation, disconnect.
8. **Monitoring/alerting:** sync freshness, auth-failure spikes, replay alerts.

---

## 19. Testing Checklist

**Functional**

- [ ] EA validate → Connected only after handshake; login/server match enforced
- [ ] Periodic sync every 30s; heartbeats recorded
- [ ] 90-day backfill with batching + resume-after-failure
- [ ] Partial close, multi-position, multi-order correctness
- [ ] Deposits/withdrawals classified correctly; initial deposit → starting_balance
- [ ] `balance = starting + deposits − withdrawals + realizedP&L` reconciliation holds
- [ ] Open positions/pending orders replace-on-snapshot, not append

**Idempotency/dedup**

- [ ] Re-send same deal batch → zero new rows
- [ ] Same `requestId` retransmission → idempotent 200
- [ ] Replayed old timestamp → rejected
- [ ] Tampered body → `SIGNATURE_MISMATCH`

**Security**

- [ ] Token rotation kills old EA instantly
- [ ] Disconnect revokes token; EA stops with `EA_TOKEN_REVOKED`
- [ ] Cross-account attempt (user A → account B) → 403/404
- [ ] Rate limits hit correctly; `Retry-After` honored
- [ ] No password/token in any log output

**Migration/regression**

- [ ] Existing EA accounts keep syncing with zero manual action
- [ ] Existing trades/deposits dashboards unchanged after migration
- [ ] Rollback (flag off) leaves system fully functional
- [ ] New tables populated; legacy `mt5_deals` copied correctly

**Load**

- [ ] 100 concurrent EA syncs per minute handled; no lock contention per account

---

## 20. Final Recommended Architecture

**Adopt the enhanced EA (local investor-password auth) as the primary path**, because it satisfies the strongest security requirement — **the website never stores or transmits the MT5 Investor Password** — while reusing FJP's existing generated-EA, token, and cursor infrastructure. For users who cannot run an EA, use the **cloud bridge** whose broker-connect component can be backed by either a **self-hosted Windows VPS worker** (preferred, see Appendix A) or the **MetaApi** managed service. Either way the investor password is protected by KMS envelope encryption at rest.

The full stack: React connection UI → Express API (HMAC-signed EA endpoints, rate-limited, idempotent) → Supabase Postgres (account-scoped dedup keys, additive backward-compatible migrations, Phase-2 strict RLS) → MQL5 EA (read-only, no trading functions, 30s cadence, 90-day backfill). All changes are additive and feature-flagged so **existing users are never broken**, and a documented rollback path exists at every layer.

---

## Appendix A — Self-Hosted Windows VPS Sync (MetaApi Alternative)

### A.1 Overview

A self-hosted Windows VPS replaces MetaApi as the "connect to the broker" component of the cloud bridge. Everything else — the backend `/api/mt5/*` endpoints, HMAC auth, validation, dedup, schema, dashboards, and the migration strategy — is **unchanged**. The VPS runs real MT5 terminals, each logged in with the user's Investor (read-only) credentials, and the standard FJP EA agent uploads data to the existing API.

### A.2 Architecture

```
FJP Backend                    Queue (Postgres)          VPS Worker (Windows)
┌───────────────┐             ┌───────────────┐         ┌─────────────────────────────┐
│ /api/mt5/cloud│─enqueue────►│ mt5_connect_  │─poll────►│ Worker daemon (Node/PowerShell)
│ /connect      │             │ jobs          │ SKIP     │   │                        │
│ /disconnect   │             │               │ LOCKED   │   ├─ MT5 terminal #1 (user A)┐
│ status/audit  │◄─results────│ status fields │◄─────────│   │   └─ FJP EA agent ────────┤
└───────┬───────┘             └───────────────┘         │   ├─ MT5 terminal #2 (user B) │
        │                                               │   │   └─ FJP EA agent ────────┤
        │  EA posts snapshots/positions/deals            │   └─ ... up to capacity ──────┤
        └───────HTTPS───────►  /api/mt5/ea/* (unchanged) │                               │
                                                         └─────────────────────────────┘
                                                                     │ HTTPS (read-only)
                                                                     ▼
                                                               Broker servers
```

### A.3 Components on the VPS

| Component | Responsibility |
|---|---|
| Worker daemon | Polls `mt5_connect_jobs`, provisions/tears down terminals, health-checks, reports status. Runs as a scheduled task (auto-start at boot). |
| Terminal manager | Creates an isolated `/portable` MT5 data folder per account, launches `terminal64.exe`, attaches the EA, enables automated trading + WebRequest allow-list. |
| FJP EA agent | The existing `eaTemplate.ts` logic (read-only reads + HMAC-signed POSTs to `/api/mt5/ea/*`). No trading functions. |
| Session keeper | Keeps an interactive desktop session alive (auto-login Windows user) so MT5 GUI processes don't suspend. |
| Golden image | A clean, version-pinned MT5 install copied per terminal so upgrades/corruption never affect running terminals. |

### A.4 Per-account terminal lifecycle

States: `Provisioned → LoggingIn → Attached → Syncing → Degraded → Removed`

1. **Provision:** `mkdir <root>\terminals\<accountId>\` and copy the golden portable MT5.
2. **Login:** see §A.5 (config pre-seed or `AccountLogin()` bootstrap).
3. **Attach:** add FJP EA to a chart; `WebRequest` allow-list = FJP API host only; enable automated trading.
4. **Sync:** EA pushes account/positions/orders/deals every 30s (cursor-based) to `/api/mt5/ea/*`.
5. **Degrade/remove:** on heartbeat loss the worker restarts the terminal; on disconnect the worker kills the process, wipes the data folder + credentials, and frees the slot.

### A.5 Auto-login methods (investor credentials)

1. **Config pre-seed (fastest):** write login/server/password into the terminal's `config\common.ini` (and server list), then start `terminal64.exe /portable`. MT5 logs in on start.
2. **Bootstrap `AccountLogin()` (recommended, resilient):** a tiny "LoginAgent" EA calls MQL5 `AccountLogin(login, password, server, timeout)` at `OnInit` (investor credentials are supported and stay read-only), verifies `AccountInfoInteger(ACCOUNT_LOGIN)`, then continues as the sync agent.

> Notes: the broker **server name must match exactly**; investor passwords are accepted by `AccountLogin`; if the broker's build rejects programmatic login, fall back to config pre-seed.

### A.6 Credential handling on the VPS

- The worker never receives the raw password from the browser. The backend stores the encrypted blob (KMS envelope, §4.2) and the worker fetches a short-lived decrypted value over an authenticated internal channel, or decrypts locally with a VPS-held key.
- Credentials live **only in memory** during login; the terminal's config file is wiped after a successful login if possible.
- Passwords are **never logged**; logs keep `account_id` + event codes.
- No main trading password is ever accepted or stored on the VPS.
- Rotation: investor passwords are broker-issued and cannot be rotated by FJP programmatically. On suspicion or on user request, re-run the connect flow with a new password and overwrite the old blob (one-time use).

### A.7 Job queue design

```sql
CREATE TABLE IF NOT EXISTS mt5_connect_jobs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('CONNECT','DISCONNECT','RESYNC')),
  payload TEXT,                    -- reference to encrypted credential blob (never the password)
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|CLAIMED|RUNNING|SUCCEEDED|FAILED
  attempts INTEGER DEFAULT 0,
  worker_id TEXT,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connect_jobs_poll ON mt5_connect_jobs(status, created_at);
```

- Workers claim a job with `SELECT ... FOR UPDATE SKIP LOCKED` so only one worker handles an account at a time.
- At-least-once delivery; duplicate work is harmless because the EA endpoints are idempotent (account-scoped dedup).
- A job stuck in `RUNNING` past its heartbeat timeout is released back to `PENDING` and re-queued.

### A.8 Scaling & sizing

- ~300–500 MB RAM per MT5 terminal → roughly **10–30 accounts per 8 GB VPS**.
- Multiple VPS workers share the same queue; `worker_id` tracks which VPS owns which account.
- Horizontal scaling = add VPS + run the same worker daemon; no app code changes.
- Cost: one Windows VPS (~$15–40/mo) covers small scale; MetaApi's per-account pricing is cheaper than buying VPS capacity only at very low account counts.

### A.9 Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Terminal process crash | Worker health check + missing EA heartbeat | Restart terminal from golden image |
| Broker blocks datacenter IP / login | Connect `FAILED` or EA auth error | Friendly error; broker allow-list guidance; retry with backoff |
| MT5 auto-update breaks `/portable` | Version mismatch | Re-provision from pinned golden image |
| VPS reboot | Job heartbeat timeout | Scheduled task relaunches worker + terminals; queue persists in Postgres |
| Worker dies mid-job | `claimed_at` + heartbeat stale | Job released to `PENDING`, re-claimed by another worker |
| Disk full / memory pressure | Metrics alerts | Auto-teardown least-recently-used idle terminals |

### A.10 Security hardening for the VPS

- [ ] Dedicated, non-admin service account for the worker
- [ ] RDP restricted by IP + MFA; disable default admin
- [ ] Windows Firewall: outbound HTTPS to FJP API + broker servers only; inbound RDP/WinRM locked down
- [ ] BitLocker/DPAPI on the data volume holding terminal data
- [ ] AppLocker / controlled folder access around `terminals\`
- [ ] Endpoint monitoring + alerts on credential-file access
- [ ] Credentials encrypted at rest; one-time use; wiped on teardown
- [ ] Audit log of every connect/disconnect and credential access
- [ ] Network egress allow-list (FJP API + broker hosts) — the worker cannot reach anything else

### A.11 Ops notes

- Feature-flag the VPS path; keep the EA-local path as the default.
- Monitor: queue depth, terminal count per VPS, per-account heartbeat lag, error-rate dashboard.
- Backups: terminal data folders are transient (the DB is the source of truth), so only queue + config need backup.
- Rollback: stop the worker + flag off; the queue is inert and safe to leave.
- MetaApi remains a drop-in alternative: implement the broker-connect behind an interface (`ICloudBridge`) with two adapters — `VpsWorker` and `MetaApiClient`.

