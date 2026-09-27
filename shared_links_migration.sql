-- Shared Journal Links Migration
-- Enables Premium Users to create privacy-guarded public links to share their journal

CREATE TABLE IF NOT EXISTS shared_journal_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT,
  sections JSONB NOT NULL DEFAULT '["dashboard", "journal"]'::jsonb,
  months TEXT NOT NULL DEFAULT 'all',
  active BOOLEAN NOT NULL DEFAULT true,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_journal_links_user ON shared_journal_links(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_journal_links_active ON shared_journal_links(active);
