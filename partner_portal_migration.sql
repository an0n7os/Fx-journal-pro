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
