-- ==============================================================================
-- FX Journal Pro: Supabase Production Seed Script
-- Run this in your Supabase Project: SQL Editor -> New Query -> Run
-- This creates/updates all 5 test/production accounts for Netlify deployment.
-- ==============================================================================
-- Password for ALL accounts: Demo@12345
-- Bcrypt Hash: $2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS
-- ==============================================================================

-- 1. Ensure required columns exist on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'USER';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS experience TEXT DEFAULT 'Intermediate';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trading_style TEXT DEFAULT 'Day Trading';
ALTER TABLE users ADD COLUMN IF NOT EXISTS main_markets JSONB DEFAULT '["Forex", "Gold"]'::jsonb;

-- 2. Ensure role constraint includes all application roles
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'PARTNER', 'SUPPORT', 'USER'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 3. Upsert Accounts

-- (1) Super Admin: admin@axyfx.com
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_admin',
  'admin@axyfx.com',
  'AxyFx Super Admin',
  '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS',
  'SUPER_ADMIN',
  true,
  'pro',
  '2099-12-31 23:59:59+00',
  true,
  true,
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = 'SUPER_ADMIN',
  is_pro = true,
  plan = 'pro',
  pro_until = '2099-12-31 23:59:59+00',
  is_email_verified = true,
  onboarding_completed = true,
  status = 'ACTIVE';

-- (2) Sub-Admin: mentor@axyfx.com
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_subadmin_demo',
  'mentor@axyfx.com',
  'Mentor Ravi',
  '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS',
  'SUB_ADMIN',
  true,
  'pro',
  '2099-12-31 23:59:59+00',
  true,
  true,
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = 'SUB_ADMIN',
  is_pro = true,
  plan = 'pro',
  pro_until = '2099-12-31 23:59:59+00',
  is_email_verified = true,
  onboarding_completed = true,
  status = 'ACTIVE';

-- (3) User (Pro): arun@example.com
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_trader_1',
  'arun@example.com',
  'Arun K',
  '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS',
  'USER',
  true,
  'pro',
  '2099-12-31 23:59:59+00',
  true,
  true,
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = 'USER',
  is_pro = true,
  plan = 'pro',
  pro_until = '2099-12-31 23:59:59+00',
  is_email_verified = true,
  onboarding_completed = true,
  status = 'ACTIVE';

-- (4) User (Free): nisha@example.com
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_trader_2',
  'nisha@example.com',
  'Nisha P',
  '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS',
  'USER',
  false,
  'free',
  NULL,
  true,
  true,
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = 'USER',
  is_pro = false,
  plan = 'free',
  pro_until = NULL,
  is_email_verified = true,
  onboarding_completed = true,
  status = 'ACTIVE';

-- (5) User (Free): sam@example.com
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_trader_3',
  'sam@example.com',
  'Sam Joseph',
  '$2b$10$yS0ToL0ISPD7iltFnLSXZeJqGRu4pFwPWlg9a6xo0UP1lATaAAlfS',
  'USER',
  false,
  'free',
  NULL,
  true,
  true,
  'ACTIVE',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password = EXCLUDED.password,
  role = 'USER',
  is_pro = false,
  plan = 'free',
  pro_until = NULL,
  is_email_verified = true,
  onboarding_completed = true,
  status = 'ACTIVE';

-- 4. Create default portfolio account for each user if not present
INSERT INTO trading_accounts (
  id, user_id, name, broker, platform, account_type, currency,
  starting_balance, current_balance, equity, status
) VALUES 
  ('acc_admin_1', 'user_admin', 'Admin Primary Account', 'MetaTrader 5', 'MT5', 'Live', 'USD', 50000, 52400, 52400, 'Active'),
  ('acc_mentor_1', 'user_subadmin_demo', 'Mentor Demo Account', 'IC Markets', 'MT5', 'Demo', 'USD', 10000, 10850, 10850, 'Active'),
  ('acc_arun_1', 'user_trader_1', 'Arun Live Account', 'Exness', 'MT5', 'Live', 'USD', 5000, 5420, 5420, 'Active'),
  ('acc_nisha_1', 'user_trader_2', 'Nisha Starter Account', 'IC Markets', 'MT5', 'Demo', 'USD', 1000, 1050, 1050, 'Active'),
  ('acc_sam_1', 'user_trader_3', 'Sam Practice Account', 'MetaTrader 5', 'MT5', 'Demo', 'USD', 1000, 980, 980, 'Active')
ON CONFLICT (id) DO NOTHING;

-- 5. Sub-Admin Assignment (Assign Arun and Nisha to mentor@axyfx.com for sub-admin testing)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sub_admin_assignments') THEN
    INSERT INTO sub_admin_assignments (id, sub_admin_id, user_id, assigned_by)
    VALUES 
      ('sub_assign_1', 'user_subadmin_demo', 'user_trader_1', 'user_admin'),
      ('sub_assign_2', 'user_subadmin_demo', 'user_trader_2', 'user_admin')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
