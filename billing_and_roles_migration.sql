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
