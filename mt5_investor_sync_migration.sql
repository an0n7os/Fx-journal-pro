-- Migration: MT5 Investor Password sync
-- Apply to an EXISTING database. Fully backward-compatible:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS only
--   * No DROP, no renames, no type changes on existing tables
-- Run this in your Supabase SQL Editor.

-- ------------------------------------------------------------------
-- 1. Extend trading_accounts (additive)
-- ------------------------------------------------------------------
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_login TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_server TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS mt5_build TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS sync_method TEXT DEFAULT 'EA';          -- EA | CLOUD
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'Not Connected'; -- NotConnected | Validating | Connected | Disconnected | Error
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS backfill_start TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS backfill_end TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS investor_password_enc TEXT;             -- cloud bridge only (never EA flow)
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS password_enc_nonce TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS password_kms_key_id TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;

-- ------------------------------------------------------------------
-- 2. EA instances / tokens (store a HASH, never the raw token)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_ea_instances (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  request_id TEXT,
  last_ip TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(account_id, token_hash)
);

-- ------------------------------------------------------------------
-- 3. Account snapshots (append-only time series)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_account_snapshots (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance FLOAT,
  equity FLOAT,
  margin FLOAT,
  margin_free FLOAT,
  margin_level FLOAT,
  currency TEXT,
  leverage INTEGER,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snaps_account_time ON mt5_account_snapshots(account_id, captured_at DESC);

-- ------------------------------------------------------------------
-- 4. Open positions (replace-on-snapshot)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_open_positions (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id BIGINT NOT NULL,
  ticket BIGINT NOT NULL,
  symbol TEXT,
  side TEXT,
  volume FLOAT,
  open_time TIMESTAMPTZ,
  open_price FLOAT,
  sl FLOAT,
  tp FLOAT,
  commission FLOAT DEFAULT 0,
  swap FLOAT DEFAULT 0,
  profit FLOAT DEFAULT 0,
  current_price FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, position_id)
);

-- ------------------------------------------------------------------
-- 5. Pending orders (replace-on-snapshot)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_pending_orders (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL,
  symbol TEXT,
  type TEXT,
  volume FLOAT,
  open_price FLOAT,
  sl FLOAT,
  tp FLOAT,
  magic INTEGER,
  state TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, order_id)
);

-- ------------------------------------------------------------------
-- 6. Money flows (deposits / withdrawals — separate from trades)
-- ------------------------------------------------------------------
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

-- ------------------------------------------------------------------
-- 7. Sync logs (idempotency + audit)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_sync_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT,
  event TEXT,
  level TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id)
);

-- ------------------------------------------------------------------
-- 8. Connection errors
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_connection_errors (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  error_code TEXT,
  error_message TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- 9. Audit trail
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_audit_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT,
  ip TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- 10. Cloud/VPS connect jobs (queue) — design-only for now
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_connect_jobs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('CONNECT','DISCONNECT','RESYNC')),
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER DEFAULT 0,
  worker_id TEXT,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_connect_jobs_poll ON mt5_connect_jobs(status, created_at);

-- ------------------------------------------------------------------
-- 11. Account-scoped deal stream (fixes mt5_deals PK = raw ticket gap)
--     Writes route here going forward; legacy mt5_deals stays for back-compat.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mt5_deals_v2 (
  account_id TEXT NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket BIGINT NOT NULL,
  position_id BIGINT DEFAULT 0,
  deal JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, ticket)
);

-- Unique guard for EA-imported journal trades
CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_account_ea_deal
  ON trades(account_id, ea_deal_id)
  WHERE ea_deal_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 12. RLS (match existing convention: open policies for anon/authenticated;
--     app-level isolation is enforced by the server via x-auth headers)
-- ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mt5_ea_instances','mt5_account_snapshots','mt5_open_positions','mt5_pending_orders','mt5_money_flows','mt5_sync_logs','mt5_connection_errors','mt5_audit_logs','mt5_connect_jobs','mt5_deals_v2']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = format('Allow anon full access on %s', t)) THEN
      EXECUTE format('CREATE POLICY "Allow anon full access on %s" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', t, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = format('Allow authenticated full access on %s', t)) THEN
      EXECUTE format('CREATE POLICY "Allow authenticated full access on %s" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
    END IF;
  END LOOP;
END $$;
