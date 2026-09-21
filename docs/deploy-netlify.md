# Deploying to Netlify

The frontend is a static Vite build served from Netlify's CDN. The Express
server in `server.ts` runs as a single Netlify Function, wrapped by
`netlify/functions/api.ts`. `netlify.toml` wires the two together: `/api/*`
goes to the function, everything else falls through to `index.html` so
client-side routes survive a refresh.

## 1. Create the site

Netlify → **Add new site** → **Import an existing project** → pick this
repository. Do not fill in the build settings by hand; `netlify.toml` already
declares the build command, the publish directory and the functions directory.

## 2. Environment variables

Site configuration → Environment variables. The server refuses to start
without the ones marked required — that is deliberate, because starting
without them means silent data loss or a signup flow nobody can complete.

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Netlify has no writable disk, so the `db.json` fallback cannot be used |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The service-role key, never the anon key — the anon key is public |
| `SESSION_SECRET` | yes | 32+ characters. Changing it signs every user out |
| `TURNSTILE_SECRET_KEY` | yes | Without it every login and registration is rejected with 403 |
| `VITE_TURNSTILE_SITE_KEY` | yes | Read at build time, so a change needs a redeploy, not just a restart |
| `SENDGRID_API_KEY` or `RESEND_API_KEY` | yes | Verification codes; without one, nobody can finish signing up |
| `SENDGRID_FROM_EMAIL` | with SendGrid | A verified sender |
| `PUBLIC_APP_URL` | yes | The site's own URL, used for referral and reset links |
| `RAZORPAY_KEY_ID` | for Pro | `rzp_live_...` for real payments, `rzp_test_...` for testing |
| `RAZORPAY_KEY_SECRET` | for Pro | Verifies the payment signature; never exposed to the browser |
| `RAZORPAY_PLAN_ID` | for Pro | The ₹399/month plan |
| `RAZORPAY_WEBHOOK_SECRET` | recommended | Not required — `/api/payments/verify` grants Pro from the HMAC. The webhook is the recovery path for a user who closes the tab mid-payment |
| `ALPHA_VANTAGE_API_KEY` | for FX News | |

`NODE_ENV=production` is set in `netlify.toml`, so it does not need adding.

## 3. Database

Run the SQL files in a Supabase SQL editor, in this order:

1. `supabase_schema.sql`
2. `admin_schema.sql`
3. `add_user_columns.sql`
4. `add_otp_columns.sql`
5. `add_exit_time_column.sql`
6. `billing_and_roles_migration.sql`
7. `mt5_ea_schema_migration.sql`
8. `mt5_investor_sync_migration.sql`
9. `sub_admin_console_migration.sql`
10. `partner_portal_migration.sql`
11. `mentor_access_migration.sql`
12. `fix_rls_policies.sql`

## 4. Turnstile

Add the deployed hostnames to the widget's allowed list at
<https://dash.cloudflare.com/?to=/:account/turnstile>, including the
`*.netlify.app` domain and any custom domain. A hostname that is not listed
fails for real visitors while still working on localhost.

## 5. The first administrator

There is no in-app path to create one, on purpose: if registration could mint
an admin, anyone could. Register normally through the site, then promote that
account once:

```sql
UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'you@example.com';
```

Sign out and back in. Every later admin, sub-admin and partner can be created
from the Admin Panel.

## What does not work on Netlify

**MT5 cloud sync** (`META_API_TOKEN`). It is a background interval, and a
serverless function is frozen the moment it responds, so the timer never
fires. `server.ts` detects this through `IS_SERVERLESS` and logs it rather
than pretending to run. The EA method — the user installs the Expert Advisor
in MetaTrader and it pushes deals to the API — is unaffected, and it is the
default path.

If cloud sync is needed, run `npm start` on a host that stays up (Render,
Railway, Fly) and point `META_API_TOKEN` at that instance.

**Long exports.** Netlify's free plan caps a function at 10 seconds. A very
large Excel or PDF export can exceed that. It is a plan limit, not a code
limit.

## Local development

`npm run dev` still runs the full Express server with Vite in middleware mode
on port 3000. Nothing about the Netlify setup changes it. See
[dev-accounts.md](dev-accounts.md) for the seeded logins.
