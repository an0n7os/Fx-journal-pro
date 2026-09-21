-- ===========================================================================
-- Per-section mentor access
-- Run AFTER partner_portal_migration.sql. Safe on a live database: it adds one
-- column and changes no existing row.
--
-- partner_portal_migration.sql gave every user a single allow_partner_trade_view
-- boolean: one switch for everything a mentor could see. This replaces it with a
-- per-section map, so a student can share their analysis without their journal.
--
-- Shape:
--   {
--     "dashboard":  true,
--     "analysis":   true,
--     "accounts":   null,          -- null = every account, [] = none,
--                                  -- ["acc_x"] = only those
--     "calendar":   true,
--     "liveCharts": true,
--     "journal":    true,
--     "notebook":   false          -- off by default, per the spec
--   }
--
-- NULL in this column means "never set". The server then derives the map from
-- allow_partner_trade_view, so nobody's current sharing changes the moment this
-- migration runs. The old boolean stays as the master switch: a section is
-- readable only when the master is on AND that section is on.
-- ===========================================================================

alter table public.users add column if not exists mentor_access jsonb;

comment on column public.users.mentor_access is
  'Per-section mentor read permissions. NULL means never set — derive from allow_partner_trade_view.';

-- Only rows that have opted in are worth indexing; the rest are NULL.
create index if not exists users_mentor_access_idx
  on public.users using gin (mentor_access)
  where mentor_access is not null;
