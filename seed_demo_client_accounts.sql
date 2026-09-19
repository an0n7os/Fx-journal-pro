-- ==============================================================================
-- FX Journal Pro: Client Demo Accounts Seed Script
-- Safe to run in Supabase SQL Editor.
-- ==============================================================================
-- Password for ALL demo accounts: Demo@12345
-- Hash: $2b$10$mtG6lzKdInoQFjineHWuQOkSJtmiKTuEnbJpO2RHwu/t6QIr47uRy
-- ==============================================================================

-- 1. Ensure required constraints / columns exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'PARTNER', 'SUPPORT', 'USER'));
  END IF;
END $$;

-- 2. Insert or Update Demo Accounts
-- Account 1: Super Admin
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_demo_superadmin',
  'admin@demo.com',
  'Demo Super Admin',
  '$2b$10$mtG6lzKdInoQFjineHWuQOkSJtmiKTuEnbJpO2RHwu/t6QIr47uRy',
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

-- Account 2: Sub Admin (Mentor)
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_demo_subadmin',
  'mentor@demo.com',
  'Demo Trading Mentor',
  '$2b$10$mtG6lzKdInoQFjineHWuQOkSJtmiKTuEnbJpO2RHwu/t6QIr47uRy',
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

-- Account 3: Pro Trader (Full features unlocked + AI Mentor)
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_demo_pro',
  'pro@demo.com',
  'Alex Trader (PRO)',
  '$2b$10$mtG6lzKdInoQFjineHWuQOkSJtmiKTuEnbJpO2RHwu/t6QIr47uRy',
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

-- Account 4: Free Trader (To demonstrate free limits & upgrade modal)
INSERT INTO users (
  id, email, name, password, role, is_pro, plan, pro_until,
  is_email_verified, onboarding_completed, status, created_at
) VALUES (
  'user_demo_free',
  'free@demo.com',
  'Sam Beginner (FREE)',
  '$2b$10$mtG6lzKdInoQFjineHWuQOkSJtmiKTuEnbJpO2RHwu/t6QIr47uRy',
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

-- 3. Create Sample Trading Accounts for Pro Trader so the charts are active
INSERT INTO trading_accounts (
  id, user_id, name, broker, platform, account_type, currency,
  starting_balance, current_balance, equity, status
) VALUES (
  'acc_demo_pro_1',
  'user_demo_pro',
  'FTMO 100k Challenge',
  'FTMO',
  'MT5',
  'Prop Firm',
  'USD',
  100000.00,
  108450.00,
  108450.00,
  'Active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trading_accounts (
  id, user_id, name, broker, platform, account_type, currency,
  starting_balance, current_balance, equity, status
) VALUES (
  'acc_demo_free_1',
  'user_demo_free',
  'Personal Starter',
  'IC Markets',
  'MT5',
  'Live',
  'USD',
  1000.00,
  1000.00,
  1000.00,
  'Active'
)
ON CONFLICT (id) DO NOTHING;

-- 4. Sample Trades for Pro Trader (shows equity growth, win rate, statistics)
INSERT INTO trades (
  id, account_id, date, symbol, type, lot_size, entry_price, exit_price,
  stop_loss, take_profit, profit, commission, swap, risk_percentage,
  strategy, emotion, notes, tags
) VALUES
(
  'trade_demo_1',
  'acc_demo_pro_1',
  NOW() - INTERVAL '5 days',
  'XAUUSD',
  'Buy',
  1.5,
  2320.50,
  2338.50,
  2312.00,
  2345.00,
  2700.00,
  -15.00,
  0,
  1.0,
  'Daily Support Bounce',
  'Disciplined',
  'Perfect London open breakout reaction at key 4H support.',
  '["Gold", "London Breakout"]'::jsonb
),
(
  'trade_demo_2',
  'acc_demo_pro_1',
  NOW() - INTERVAL '4 days',
  'EURUSD',
  'Sell',
  2.0,
  1.0890,
  1.0825,
  1.0920,
  1.0810,
  1300.00,
  -14.00,
  -3.50,
  1.0,
  'Fair Value Gap Fill',
  'Confident',
  'Targeted previous day low liquidity pool after NY open.',
  '["Forex", "FVG", "ICT"]'::jsonb
),
(
  'trade_demo_3',
  'acc_demo_pro_1',
  NOW() - INTERVAL '3 days',
  'GBPUSD',
  'Buy',
  1.5,
  1.2720,
  1.2680,
  1.2680,
  1.2800,
  -600.00,
  -12.00,
  0,
  0.6,
  'Trend Continuation',
  'Patient',
  'Clean stop hit before market reversed. Risk strictly managed.',
  '["Forex", "Loss"]'::jsonb
),
(
  'trade_demo_4',
  'acc_demo_pro_1',
  NOW() - INTERVAL '2 days',
  'NAS100',
  'Buy',
  1.0,
  18250.00,
  18480.00,
  18190.00,
  18500.00,
  2300.00,
  -10.00,
  0,
  1.2,
  'Opening Range Breakout',
  'Disciplined',
  'Aggressive push on high tech earnings volume.',
  '["Indices", "Nasdaq"]'::jsonb
),
(
  'trade_demo_5',
  'acc_demo_pro_1',
  NOW() - INTERVAL '1 days',
  'XAUUSD',
  'Buy',
  1.5,
  2340.00,
  2358.50,
  2332.00,
  2365.00,
  2750.00,
  -15.00,
  0,
  1.0,
  'Asian High Sweep & Retest',
  'Disciplined',
  'Clean confluence with 50 EMA and key level.',
  '["Gold", "High Win"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 5. Assign Pro Trader to Sub Admin (Mentor) so Sub Admin Console displays data
CREATE TABLE IF NOT EXISTS public.sub_admin_assignments (
  id            text primary key,
  sub_admin_id  text not null references public.users(id) on delete cascade,
  user_id       text not null references public.users(id) on delete cascade,
  assigned_by   text references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

INSERT INTO public.sub_admin_assignments (id, sub_admin_id, user_id, assigned_by)
VALUES (
  'assign_demo_1',
  'user_demo_subadmin',
  'user_demo_pro',
  'user_demo_superadmin'
)
ON CONFLICT (id) DO NOTHING;
