-- ===========================================================================
-- Partner Payouts & Withdrawal Requests Migration
-- ===========================================================================

-- 1. Create table for partner payout and withdrawal requests
create table if not exists public.partner_payout_requests (
  id             text primary key,
  partner_id     text not null references public.users(id) on delete cascade,
  amount         numeric not null check (amount > 0),
  method         text not null check (method in ('UPI', 'BANK')),
  payout_details jsonb not null default '{}'::jsonb,
  status         text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'REJECTED')),
  utr_number     text,
  admin_notes    text,
  requested_at   timestamptz not null default now(),
  processed_at   timestamptz,
  processed_by   text
);

-- 2. Indexes for fast lookup by partner and by status
create index if not exists idx_partner_payout_requests_partner on public.partner_payout_requests(partner_id);
create index if not exists idx_partner_payout_requests_status on public.partner_payout_requests(status);
create index if not exists idx_partner_payout_requests_date on public.partner_payout_requests(requested_at desc);

-- 3. Add payout_details column to partner_profiles if not present
alter table public.partner_profiles add column if not exists payout_details jsonb default '{}'::jsonb;

-- 4. Enable Row Level Security (RLS)
alter table public.partner_payout_requests enable row level security;
revoke all on public.partner_payout_requests from anon, authenticated;
