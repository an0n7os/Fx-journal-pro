-- ====================================================================
-- MT5 Integration Complete Database Schema (PostgreSQL / Supabase)
-- ====================================================================

-- NOT USED BY THIS REPOSITORY. Reference only.
--
-- mt5_connections below stores investor_password as plaintext TEXT. This
-- project does not: an investor password is encrypted with AES-256-GCM under a
-- per-record key wrapped by MT5_CREDENTIAL_MASTER_KEY, and the columns live on
-- the accounts row (investor_password_enc, password_kms_key_id). A database
-- dump of the table below hands the reader every customer's broker login.
--
-- The sync queue here is likewise superseded: this project uses
-- db.mt5ConnectJobs with a lease (MT5_JOB_LEASE_MS) and an attempt cap, so two
-- workers cannot claim the same job. Run this file only if you are taking the
-- kit standalone into a different project.

-- 1. MT5 Connections Table (For Python Worker & Investor Password sync)
CREATE TABLE IF NOT EXISTS mt5_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_account_id TEXT NOT NULL,
  broker_name TEXT,
  mt5_server TEXT NOT NULL,
  mt5_account_number TEXT NOT NULL,
  investor_password TEXT NOT NULL,  -- Read-only password
  account_type TEXT DEFAULT 'Live',
  connection_status TEXT DEFAULT 'DISCONNECTED',
  last_sync_status TEXT,
  last_sync_error TEXT,
  last_sync_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MT5 Sync Jobs Queue (Polled by the Python Worker)
CREATE TABLE IF NOT EXISTS mt5_sync_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  portfolio_account_id TEXT NOT NULL,
  mt5_connection_id TEXT NOT NULL REFERENCES mt5_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED | CONNECTING | FETCHING_HISTORY | IMPORTING | COMPLETED | FAILED
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mt5_sync_jobs_status ON mt5_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_mt5_sync_jobs_user ON mt5_sync_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_mt5_connections_user ON mt5_connections(user_id);

-- 3. Account Snapshots Table (Time-series balance & equity history)
CREATE TABLE IF NOT EXISTS mt5_account_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  user_id TEXT,
  balance FLOAT NOT NULL,
  equity FLOAT NOT NULL,
  margin FLOAT,
  margin_free FLOAT,
  margin_level FLOAT,
  currency TEXT,
  leverage INTEGER,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snaps_account_time ON mt5_account_snapshots(account_id, captured_at DESC);

-- 4. Open Positions Table (Live open trades)
CREATE TABLE IF NOT EXISTS mt5_open_positions (
  account_id TEXT NOT NULL,
  user_id TEXT,
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

-- 5. Pending Orders Table (Limit & Stop orders)
CREATE TABLE IF NOT EXISTS mt5_pending_orders (
  account_id TEXT NOT NULL,
  user_id TEXT,
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

-- 6. Money Flows Table (Deposits & Withdrawals)
CREATE TABLE IF NOT EXISTS mt5_money_flows (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  user_id TEXT,
  ticket BIGINT NOT NULL,
  flow_type TEXT NOT NULL,
  amount FLOAT NOT NULL,
  currency TEXT,
  time TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, ticket)
);

-- 7. Account Scoped Deals V2 Table (Raw deal stream from MT5)
CREATE TABLE IF NOT EXISTS mt5_deals_v2 (
  account_id TEXT NOT NULL,
  user_id TEXT,
  ticket BIGINT NOT NULL,
  position_id BIGINT DEFAULT 0,
  deal JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (account_id, ticket)
);

-- 8. MT5 Connection Errors
CREATE TABLE IF NOT EXISTS mt5_connection_errors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  user_id TEXT,
  error_code TEXT,
  error_message TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 9. MT5 Sync Logs (Audit trail)
CREATE TABLE IF NOT EXISTS mt5_sync_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT NOT NULL,
  user_id TEXT,
  request_id TEXT,
  event TEXT,
  level TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
