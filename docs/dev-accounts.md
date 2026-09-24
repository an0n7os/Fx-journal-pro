# The developer account

One account, for local work and the test suite. It does not exist in
production.

## Setting it up

Both variables are needed. Without `DEV_ADMIN_PASSWORD` there is no developer
account at all — not a weak one, none.

```
DEV_ACCOUNT_EMAIL=dev@localhost
DEV_ADMIN_PASSWORD=<choose one>
```

Start the server and sign in with those. The account is a `SUPER_ADMIN`, so the
admin console, the sub-admin console and the partner portal are all reachable.

The password is hashed with bcrypt at boot, so changing `DEV_ADMIN_PASSWORD`
takes effect on the next restart. `tsx` does not watch, so restart it yourself.

## Why it cannot reach production

`IS_DEV` gates both the email and the hash:

```ts
const IS_DEV = !IS_SERVERLESS && process.env.NODE_ENV !== 'production';
```

`IS_SERVERLESS` is true on Vercel, Netlify and Lambda from the platform's own
variables, so a serverless deployment is production whether or not `NODE_ENV`
arrives — `netlify.toml`'s `[build.environment]` reaches the build, not the
function runtime, and that gap once left a live site running as development.

On a live site `DEV_ACCOUNT_EMAIL` is the empty string and the hash is never
computed, so the email cannot be signed into even if it is guessed.

## What this replaced

The project used to ship demo identities, and they were removed rather than
renamed:

- `admin@axyfx.com` and `demo@axyfx.com` minted a `SUPER_ADMIN` from a
  hardcoded bcrypt hash committed to the repository. Two guessable names
  granting full admin wherever the guard did not hold.
- The file-store seed carried a named person's real email address together with
  their trading account and eleven of their trades. Sample rows in application
  source become someone's revenue and activity figures on the admin dashboard
  of any deployment that falls back to the file store.
- `seed_accounts_supabase.sql` and `seed_demo_client_accounts.sql` inserted ten
  more demo identities, including an `admin@axyfx.com` `SUPER_ADMIN`. Neither
  was referenced by `supabase_setup.sql` or the migration checker, so nothing
  stopped one being run by hand against the live database.
- `scripts/seed-subadmin-demo.mjs` wrote a sub-admin and three traders into
  `db.json`.
- The audit log began with a fabricated `system.startup` entry attributed to
  `admin@axyfx.com`. An audit trail whose first row is invented is worse than
  an empty one; it is the record used to answer who changed a role or blocked
  an account.

## The first administrator on a live site

There is no seeded admin in production. Create your account through the normal
sign-up, then promote it once:

```sql
UPDATE users SET role = 'SUPER_ADMIN' WHERE email = 'you@example.com';
```

## Tests

`journey`, `partner` and `plan-gates` sign in as the developer account and read
the same two variables, defaulting to `dev@localhost`. They fail rather than
skip if it is missing, because an admin-gated assertion that silently does not
run is worse than a red one.
