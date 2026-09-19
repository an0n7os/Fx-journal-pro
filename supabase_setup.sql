-- ============================================================================
-- FX Journal Pro — complete Supabase setup
--
-- Every migration, concatenated in dependency order. Paste the whole file into
-- the Supabase SQL editor and run it once on a NEW, EMPTY project.
--
--   !!  DESTRUCTIVE ON A LIVE DATABASE  !!
--
-- The first section drops and recreates users, trading_accounts, trades,
-- risk_settings, support_tickets, announcements and mt5_deals. On a project
-- that already holds real accounts and trades, running this file deletes them.
-- Take a backup first, or run only the individual migration you need.
--
-- Generated from the files listed below; edit those, not this one.
-- ============================================================================



-- ============================================================================
-- supabase_schema.sql
-- ============================================================================

-- ==============================================================================
-- SUPABASE RELATIONAL SCHEMA MIGRATION SCRIPT
-- ==============================================================================
-- Run this entire script in your Supabase SQL Editor.
-- It creates isolated tables for your app and enforces Row Level Security.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables so we can recreate them with the correct structure
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS risk_settings CASCADE;
DROP TABLE IF EXISTS mt5_deals CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS trading_accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  experience TEXT,
  trading_style TEXT,
  main_markets JSONB,
  onboarding_completed BOOLEAN DEFAULT false,
  is_pro BOOLEAN DEFAULT false,
  is_email_verified BOOLEAN DEFAULT false,
  auth_provider TEXT DEFAULT 'email',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- Server uses anon key (no Supabase JWT), so allow anon role full access.
-- App-level user isolation is enforced in server.ts via x-auth headers.
CREATE POLICY "Allow anon full access on users" ON users FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on users" ON users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table: trading_accounts
CREATE TABLE IF NOT EXISTS trading_accounts (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  broker TEXT,
  platform TEXT,
  account_type TEXT,
  institution_type TEXT DEFAULT 'Broker',
  currency TEXT,
  starting_balance FLOAT,
  current_balance FLOAT,
  equity FLOAT,
  status TEXT,
  is_mt5_sync BOOLEAN DEFAULT FALSE,
  ea_token TEXT,
  ea_status TEXT,
  ea_last_deal_id BIGINT DEFAULT 0,
  ea_last_sync_time TIMESTAMPTZ,
  ea_sync_trade_count INTEGER DEFAULT 0,
  ea_connected_at TIMESTAMPTZ,
  ea_terminal_login TEXT,
  ea_terminal_server TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on trading_accounts" ON trading_accounts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on trading_accounts" ON trading_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table: trades
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ,
  symbol TEXT,
  type TEXT,
  lot_size FLOAT,
  entry_price FLOAT,
  exit_price FLOAT,
  exit_time TIMESTAMPTZ,
  stop_loss FLOAT,
  take_profit FLOAT,
  profit FLOAT,
  commission FLOAT,
  swap FLOAT,
  risk_percentage FLOAT,
  strategy TEXT,
  emotion TEXT,
  notes TEXT,
  screenshot TEXT,
  tags JSONB,
  is_mt5_sync BOOLEAN DEFAULT false,
  ea_deal_id BIGINT,
  ea_position_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: mt5_deals (raw MT5 deal stream used to recompute synced trades)
CREATE TABLE IF NOT EXISTS mt5_deals (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  position_id BIGINT DEFAULT 0,
  deal JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE mt5_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on mt5_deals" ON mt5_deals FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on mt5_deals" ON mt5_deals FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on trades" ON trades FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on trades" ON trades FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table: risk_settings
CREATE TABLE IF NOT EXISTS risk_settings (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  account_id TEXT REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  risk_per_trade_limit FLOAT,
  daily_loss_limit FLOAT,
  weekly_loss_limit FLOAT,
  max_drawdown_limit FLOAT,
  discipline_enabled BOOLEAN,
  max_trades_per_day INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE risk_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on risk_settings" ON risk_settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on risk_settings" ON risk_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table: support_tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  user_email TEXT,
  title TEXT,
  description TEXT,
  status TEXT,
  category TEXT,
  date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on support_tickets" ON support_tickets FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on support_tickets" ON support_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Table: announcements (Public readable)
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  title TEXT,
  content TEXT,
  date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Announcements are readable by everyone" ON announcements FOR SELECT USING (true);


-- ============================================================================
-- admin_schema.sql
-- ============================================================================

-- Migration: Admin Panel additions

-- 1. Alter users table to add role and status
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'USER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

-- 2. Create bug_reports table
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  screenshots JSONB DEFAULT '[]'::jsonb,
  priority TEXT DEFAULT 'LOW',
  status TEXT DEFAULT 'NEW',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on bug_reports" ON bug_reports FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on bug_reports" ON bug_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Create feature_requests table
CREATE TABLE IF NOT EXISTS feature_requests (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'PLANNED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on feature_requests" ON feature_requests FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on feature_requests" ON feature_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  admin_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_entity_id TEXT,
  target_entity_type TEXT,
  previous_state JSONB,
  new_state JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon full access on admin_audit_logs" ON admin_audit_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access on admin_audit_logs" ON admin_audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- add_user_columns.sql
-- ============================================================================

-- Add last_login and auth_provider columns to users table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_login'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'auth_provider'
  ) THEN
    ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'email';
  END IF;
END $$;


-- ============================================================================
-- add_otp_columns.sql
-- ============================================================================

-- ==============================================================================
-- ADD OTP COLUMNS TO USERS TABLE
-- Run this in your Supabase SQL Editor
-- ==============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ;


-- ============================================================================
-- add_exit_time_column.sql
-- ============================================================================

-- ============================================================
-- MIGRATION: Add exit_time column to the trades table
-- Run this in your Supabase SQL Editor
-- ============================================================

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ;


-- ============================================================================
-- billing_and_roles_migration.sql
-- ============================================================================

-- ==============================================================================
-- BILLING + ROLE-BASED ADMIN ACCESS
-- Run in the Supabase SQL editor. Safe to re-run.
-- ==============================================================================
-- Adds:
--   1. subscriptions      - the source of truth for who is Pro, and until when
--   2. payments           - a durable record of every charge (there was none)
--   3. role tiers         - SUPER_ADMIN / ADMIN / SUPPORT / USER
--   4. admin_audit_logs   - the table already existed; nothing wrote to it
--
-- RLS: these tables are server-only. No policy is granted to `anon`, so the
-- publishable key cannot read them even if it leaks. The server uses the
-- service-role key, which bypasses RLS.
-- ==============================================================================

-- ── 1. Subscriptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'pro',
  -- created | authenticated | active | pending | halted | cancelled | expired
  status TEXT NOT NULL DEFAULT 'created',
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_provider_id_idx ON subscriptions(provider_subscription_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ── 2. Payments ──────────────────────────────────────────────────────────────
-- Payment history previously lived only in an in-memory object, so every
-- record was lost on restart and nothing could be reconciled or refunded.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_payment_id TEXT UNIQUE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  plan TEXT DEFAULT 'pro',
  status TEXT NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ── 3. Pro state on users ────────────────────────────────────────────────────
-- is_pro stays as a fast read, but pro_until is what makes it expire. A boolean
-- with no end date meant a cancelled or failed subscription kept Pro forever.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';

-- ── 4. Role tiers ────────────────────────────────────────────────────────────
-- SUPER_ADMIN  owner: everything, including granting roles and viewing billing
-- ADMIN        day-to-day: users, announcements, blocking
-- SUPPORT      sub-admin: tickets and bug reports only, read-only on users
-- USER         default
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'USER';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'USER'));
  END IF;
END $$;

-- ── 5. Admin audit log ───────────────────────────────────────────────────────
-- The table was created in admin_schema.sql but no code ever wrote to it, so
-- there was no record of who blocked a user or changed a role.
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail JSONB DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- admin_schema.sql already created this table, with different column names
-- (admin_id, target_entity_id, previous_state, new_state, ip_address) that no
-- code ever wrote to. CREATE TABLE IF NOT EXISTS therefore does nothing on a
-- database that ran that file, and the index below then failed with
--   ERROR: 42703: column "actor_id" does not exist
-- Add the columns the server actually writes, so both a fresh database and one
-- created from the old schema end up with the same shape. The stale columns are
-- all nullable, so they are left alone rather than dropped — nothing reads them
-- and dropping them would discard any rows an older deployment wrote.
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS actor_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS detail JSONB DEFAULT '{}'::jsonb;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON admin_audit_logs(actor_id);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- ── 6. Promote your own account ──────────────────────────────────────────────
-- Replace the address, then run. The hardcoded admin@axyfx.com backdoor has
-- been removed from the server, so this is now the only way in.
-- UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'you@example.com';


-- ============================================================================
-- mt5_ea_schema_migration.sql
-- ============================================================================

-- Migration: MT5 EA auto-sync schema
-- Apply to an EXISTING database that was created before the MT5 EA feature.
-- (supabase_schema.sql covers fresh databases; this adds the missing pieces
--  without dropping data.)

-- EA fields on trading_accounts
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS is_mt5_sync BOOLEAN DEFAULT FALSE;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS institution_type TEXT DEFAULT 'Broker';
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_token TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_status TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_last_deal_id BIGINT DEFAULT 0;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_last_sync_time TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_sync_trade_count INTEGER DEFAULT 0;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_connected_at TIMESTAMPTZ;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_terminal_login TEXT;
ALTER TABLE trading_accounts ADD COLUMN IF NOT EXISTS ea_terminal_server TEXT;

-- EA fields on trades
ALTER TABLE trades ADD COLUMN IF NOT EXISTS ea_deal_id BIGINT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS ea_position_id BIGINT;

-- Raw MT5 deal stream table
CREATE TABLE IF NOT EXISTS mt5_deals (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  position_id BIGINT DEFAULT 0,
  deal JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE mt5_deals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mt5_deals' AND policyname = 'Allow anon full access on mt5_deals') THEN
    CREATE POLICY "Allow anon full access on mt5_deals" ON mt5_deals FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mt5_deals' AND policyname = 'Allow authenticated full access on mt5_deals') THEN
    CREATE POLICY "Allow authenticated full access on mt5_deals" ON mt5_deals FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================================
-- mt5_investor_sync_migration.sql
-- ============================================================================

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


-- ============================================================================
-- sub_admin_console_migration.sql
-- ============================================================================

-- ===========================================================================
-- Sub-Admin Console migration
-- Run AFTER billing_and_roles_migration.sql.
--
-- A sub-admin sees only the users listed here. Nothing else in the schema
-- changes: the console reads the same users / trades / trading_accounts rows
-- the user's own dashboard reads, filtered by this table on the server.
-- ===========================================================================

create table if not exists public.sub_admin_assignments (
  id            text primary key,
  sub_admin_id  uuid not null references public.users(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  assigned_by   uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- One row per (sub-admin, user). The server turns the resulting 23505 into a
-- "That user is already assigned." message rather than a 500.
create unique index if not exists sub_admin_assignments_unique
  on public.sub_admin_assignments (sub_admin_id, user_id);

create index if not exists sub_admin_assignments_sub_admin_idx
  on public.sub_admin_assignments (sub_admin_id);

-- SUB_ADMIN must be an accepted value of users.role. billing_and_roles_migration.sql
-- already created users_role_check; recreate it including SUB_ADMIN in case an
-- older copy of that file was run.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('USER', 'SUPPORT', 'SUB_ADMIN', 'ADMIN', 'SUPER_ADMIN'));

-- The console is served entirely through the API with the service-role key,
-- so no anon client ever needs to read this table.
alter table public.sub_admin_assignments enable row level security;
revoke all on public.sub_admin_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Making someone a sub-admin (do this in the Team & Roles tab, or here):
--
--   update public.users set role = 'SUB_ADMIN' where email = 'mentor@example.com';
--
-- Assign users to them from the Team & Roles tab. Assigning by hand:
--
--   insert into public.sub_admin_assignments (id, sub_admin_id, user_id)
--   select 'saa_' || gen_random_uuid(), s.id, u.id
--   from public.users s, public.users u
--   where s.email = 'mentor@example.com' and u.email = 'trader@example.com';
-- ---------------------------------------------------------------------------


-- ============================================================================
-- partner_portal_migration.sql
-- ============================================================================

-- ===========================================================================
-- Partner Portal migration
-- Run AFTER sub_admin_console_migration.sql.
--
-- A Partner is an existing user whose role becomes PARTNER. Nothing is moved
-- and no second account is created: the same row in public.users gains a role,
-- is_pro, and a referral code.
--
-- Two things are added:
--   1. partner_profiles  — the referral code a partner owns
--   2. users.referred_by — which partner a user signed up under
--
-- Users referred to a partner are ALSO written into sub_admin_assignments, so
-- the existing console scoping keeps working unchanged and a partner's network
-- can be inspected with the same queries as a sub-admin's assignment list.
-- ===========================================================================

-- ── 1. PARTNER must be an accepted role ────────────────────────────────────
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('USER', 'SUPPORT', 'SUB_ADMIN', 'PARTNER', 'ADMIN', 'SUPER_ADMIN'));

-- ── 2. Partner profiles ────────────────────────────────────────────────────
create table if not exists public.partner_profiles (
  user_id        uuid primary key references public.users(id) on delete cascade,
  referral_code  text not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.users(id) on delete set null
);

-- Codes are compared case-insensitively — a partner who prints "AXYFX10" on a
-- flyer must not lose a signup because someone typed "axyfx10".
create unique index if not exists partner_profiles_code_unique
  on public.partner_profiles (lower(referral_code));

-- ── 3. Referral link on the user row ───────────────────────────────────────
alter table public.users add column if not exists referred_by uuid
  references public.users(id) on delete set null;
alter table public.users add column if not exists referred_at timestamptz;

-- Consent for a partner to see this user's trading data.
--
-- Defaults to FALSE, and existing rows get FALSE: being referred by someone is
-- not consent to hand them your trade history. The user turns it on in
-- Settings, and every endpoint that returns trade data re-checks this column —
-- it is not a front-end toggle.
alter table public.users add column if not exists allow_partner_trade_view boolean not null default false;

create index if not exists users_referred_by_idx on public.users (referred_by);

-- ── 4. Lock the new table down ─────────────────────────────────────────────
-- Served only through the API with the service-role key, like the assignments
-- table. No anon or authenticated client reads it directly.
alter table public.partner_profiles enable row level security;
revoke all on public.partner_profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Promoting someone by hand (the Admin panel's "Upgrade to Partner" button
-- does all three steps in one call):
--
--   update public.users set role = 'PARTNER', is_pro = true
--    where email = 'partner@example.com';
--
--   insert into public.partner_profiles (user_id, referral_code)
--   select id, 'PARTNER10' from public.users where email = 'partner@example.com';
--
-- Checking a partner's network:
--
--   select u.email, u.created_at, u.allow_partner_trade_view
--     from public.users u
--     join public.users p on p.id = u.referred_by
--    where p.email = 'partner@example.com';
-- ---------------------------------------------------------------------------


-- ============================================================================
-- fix_rls_policies.sql
-- ============================================================================

-- ==============================================================================
-- RLS LOCKDOWN (no data loss - safe to run on an existing database)
-- ==============================================================================
-- Run this in your Supabase SQL Editor -> SQL Editor -> New Query -> Paste & Run
--
-- WHY THIS CHANGED
-- The previous version of this file granted the `anon` role FULL access to every
-- table (USING (true) WITH CHECK (true)). The anon/publishable key ships inside
-- the browser bundle, so those policies let any visitor read and write the entire
-- database - every user row (including password hashes and OTP codes) and every
-- trade - straight from the browser console.
--
-- The server no longer runs on the anon key. It authenticates with
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS by design, and enforces
-- per-user isolation itself using the signed session cookie.
--
-- BEFORE RUNNING: set SUPABASE_SERVICE_ROLE_KEY in your server environment
-- (Supabase Dashboard -> Project Settings -> API -> service_role secret).
-- Running this while the server is still on the anon key will break the app.
-- ==============================================================================

-- Make sure RLS is actually switched on for every table.
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades           ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;

-- ── Drop the permissive policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow anon full access on users" ON users;
DROP POLICY IF EXISTS "Allow authenticated full access on users" ON users;
DROP POLICY IF EXISTS "Users can manage their own data" ON users;

DROP POLICY IF EXISTS "Allow anon full access on trading_accounts" ON trading_accounts;
DROP POLICY IF EXISTS "Allow authenticated full access on trading_accounts" ON trading_accounts;
DROP POLICY IF EXISTS "Users can manage their own accounts" ON trading_accounts;

DROP POLICY IF EXISTS "Allow anon full access on trades" ON trades;
DROP POLICY IF EXISTS "Allow authenticated full access on trades" ON trades;
DROP POLICY IF EXISTS "Users can manage their own trades" ON trades;

DROP POLICY IF EXISTS "Allow anon full access on risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "Allow authenticated full access on risk_settings" ON risk_settings;
DROP POLICY IF EXISTS "Users can manage their own risk settings" ON risk_settings;

DROP POLICY IF EXISTS "Allow anon full access on support_tickets" ON support_tickets;
DROP POLICY IF EXISTS "Allow authenticated full access on support_tickets" ON support_tickets;
DROP POLICY IF EXISTS "Users can manage their own tickets" ON support_tickets;

-- ── Result: no policy for `anon` ─────────────────────────────────────────────
-- With RLS enabled and no policy granting it anything, the anon key can no
-- longer read or write these tables at all. That is the intended state: the
-- browser never talks to these tables directly, only to /api on the server.

-- ── Optional: direct access for Supabase-Auth (SSO) users ────────────────────
-- Only needed if you later let the browser query Supabase directly. `auth.uid()`
-- is the Supabase Auth user id, which matches users.id for SSO accounts.
-- These are scoped to the caller's own rows - never USING (true).

CREATE POLICY "Users read their own row"
  ON users FOR SELECT TO authenticated
  USING (auth.uid()::text = id::text);

CREATE POLICY "Users manage their own accounts"
  ON trading_accounts FOR ALL TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users manage their own trades"
  ON trades FOR ALL TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users manage their own risk settings"
  ON risk_settings FOR ALL TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users manage their own tickets"
  ON support_tickets FOR ALL TO authenticated
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect zero rows for the anon role:
--   SELECT tablename, policyname, roles FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY(roles);
