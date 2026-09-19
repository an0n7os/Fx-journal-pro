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
