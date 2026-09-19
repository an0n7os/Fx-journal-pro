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