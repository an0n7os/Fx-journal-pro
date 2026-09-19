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
