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

-- These four tables were granted the same FOR ALL TO anon USING (true) by the
-- schema migrations but were missed by the lockdown above, so running the whole
-- setup still left the public key with full read AND write on them.
-- admin_audit_logs is the worst: anyone holding the publishable key -- which
-- ships in the browser bundle -- could read the admin activity trail and, worse,
-- rewrite or delete it. mt5_deals holds every synced broker deal.
ALTER TABLE mt5_deals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anon full access on mt5_deals" ON mt5_deals;
DROP POLICY IF EXISTS "Allow authenticated full access on mt5_deals" ON mt5_deals;

DROP POLICY IF EXISTS "Allow anon full access on bug_reports" ON bug_reports;
DROP POLICY IF EXISTS "Allow authenticated full access on bug_reports" ON bug_reports;

DROP POLICY IF EXISTS "Allow anon full access on feature_requests" ON feature_requests;
DROP POLICY IF EXISTS "Allow authenticated full access on feature_requests" ON feature_requests;

DROP POLICY IF EXISTS "Allow anon full access on admin_audit_logs" ON admin_audit_logs;
DROP POLICY IF EXISTS "Allow authenticated full access on admin_audit_logs" ON admin_audit_logs;

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
