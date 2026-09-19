-- ===========================================================================
-- Sub-Admin Console migration
-- Run AFTER billing_and_roles_migration.sql.
--
-- A sub-admin sees only the users listed here. Nothing else in the schema
-- changes: the console reads the same users / trades / trading_accounts rows
-- the user's own dashboard reads, filtered by this table on the server.
-- ===========================================================================

-- users.id is TEXT, not uuid — the server mints ids like "user_dev_1789..."
-- and "user_admin", which are not valid uuids. Declaring these columns as uuid
-- made the foreign key unbuildable:
--   ERROR: 42804: foreign key constraint ... cannot be implemented
--   DETAIL: Key columns "sub_admin_id" and "id" are of incompatible types.
create table if not exists public.sub_admin_assignments (
  id            text primary key,
  sub_admin_id  text not null references public.users(id) on delete cascade,
  user_id       text not null references public.users(id) on delete cascade,
  assigned_by   text references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- One row per (sub-admin, user). The server turns the resulting 23505 into a
-- "That user is already assigned." message rather than a 500.
create unique index if not exists sub_admin_assignments_unique
  on public.sub_admin_assignments (sub_admin_id, user_id);

create index if not exists sub_admin_assignments_sub_admin_idx
  on public.sub_admin_assignments (sub_admin_id);

-- SUB_ADMIN must be an accepted value of users.role. billing_and_roles_migration.sql
-- already created users_role_check; recreate it including SUB_ADMIN in case an
-- older copy of that file was run.
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('USER', 'SUPPORT', 'SUB_ADMIN', 'ADMIN', 'SUPER_ADMIN'));

-- The console is served entirely through the API with the service-role key,
-- so no anon client ever needs to read this table.
alter table public.sub_admin_assignments enable row level security;
revoke all on public.sub_admin_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Making someone a sub-admin (do this in the Team & Roles tab, or here):
--
--   update public.users set role = 'SUB_ADMIN' where email = 'mentor@example.com';
--
-- Assign users to them from the Team & Roles tab. Assigning by hand:
--
--   insert into public.sub_admin_assignments (id, sub_admin_id, user_id)
--   select 'saa_' || gen_random_uuid(), s.id, u.id
--   from public.users s, public.users u
--   where s.email = 'mentor@example.com' and u.email = 'trader@example.com';
-- ---------------------------------------------------------------------------
