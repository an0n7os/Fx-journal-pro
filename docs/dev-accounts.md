# Local development accounts

Seed accounts for trying the app on a developer machine. They exist only in the
local `db.json`, which is **not** in this repository — every clone starts from
the seed data written by `loadDatabaseFromFile()` in `server.ts`.

These credentials do not work against a real deployment. In production the
server runs on Supabase, never on `db.json`, and the development back doors
below are closed by the `NODE_ENV === 'production'` guards.

## Password

All seeded accounts share one password:

```
Demo@12345
```

To use a different one, hash it into `db.json`, or set `DEV_ADMIN_PASSWORD` in
`.env` for the `admin@axyfx.com` / `demo@axyfx.com` fallback accounts (see the
`DEV_DEMO_PASSWORD_HASH` block in `server.ts`).

## Accounts

| Email | Role | Plan | What it is for |
| --- | --- | --- | --- |
| `admin@axyfx.com` | `SUPER_ADMIN` | Pro | Admin Panel: every user, roles, plans, audit log |
| `mentor@axyfx.com` | `SUB_ADMIN` | Pro | Sub-Admin Console: only the assigned users |
| `arun@example.com` | `USER` | Pro | Pro features: MT5 Sync, Live Chart, AI Mentor, Excel/PDF export |
| `nisha@example.com` | `USER` | Free | Free plan and the upgrade walls |
| `sam@example.com` | `USER` | Free | A second free client |

In development any unknown email signs in and creates a fresh free account on
the spot, so extra test clients need no setup.

## Partner role

No partner is seeded, because a partner is made through the admin flow rather
than by editing a row. Sign in as `admin@axyfx.com`, open the Admin Panel,
find a user and choose **Upgrade to Partner** with a referral code. That is
also the only way to get a `partner_profiles` row, which the Partner Portal
needs.

## Production

There is no in-app path to create the first administrator on a fresh
deployment. Promote one directly in Supabase:

```sql
UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'you@example.com';
```
