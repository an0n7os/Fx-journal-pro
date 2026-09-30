// Guards the admin "Analysis" button — mentor read-only inspection.
//
// Clicking it swaps the admin's own `user`, `accounts` and `trades` state for
// the trader's while the session cookie stays the admin's. Everything that
// keys off `user` therefore aims at the wrong person, and two things did:
//
//   - the onboarding wizard fired for any trader who never finished it. It is
//     a full-screen early return with no close button (canDismiss reads the
//     same unfinished flag), and both Skip and Continue POST
//     /api/auth/onboarding on the ADMIN's session — overwriting the admin's
//     own experience, style and markets and marking their onboarding done,
//     while the trader's row was never touched.
//   - every paywall on screen followed the trader's plan, so a free trader put
//     four "Upgrade to PRO" buttons in front of the admin, and the checkout
//     behind them ran on the admin's session.
//
// Both guards are client-side. What is checkable from here is the contract the
// screen is built on: the endpoint returns the TRADER's rows and never the
// caller's, it is admin-only, and the registry the button is on reports the
// same counts the inspection screen then shows — they disagreed, because the
// registry counted accounts and trades out of db.json while reading users from
// the file-and-caches union.
//
// Runs against the dev server on :3000.
import { signInOrRegister } from './auth-helper.mjs';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const stamp = Date.now();
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const adminEmail = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';
const admin = await signInOrRegister(BASE, adminEmail, adminPassword);
ok('setup: signed in as super admin', !!admin.cookie);

const trader = await signInOrRegister(BASE, `inspect_${stamp}@example.com`, 'InspectTest12345');
const other = await signInOrRegister(BASE, `other_${stamp}@example.com`, 'InspectTest12345');
ok('setup: a trader and an unrelated user exist', !!trader.cookie && !!other.cookie);

// A brand-new signup has not finished onboarding. That is the state that
// triggered the wizard over the admin, so the fixture has to keep it.
ok('setup: the trader has not completed onboarding',
  !(trader.user?.onboardingCompleted ?? trader.user?.onboarding_completed),
  String(trader.user?.onboardingCompleted));

const accs = await api('/api/accounts', { cookie: trader.cookie });
const accountId = accs.json?.accounts?.[0]?.id;
ok('setup: the trader has a default account', !!accountId);

const TRADE_COUNT = 5;
for (let i = 0; i < TRADE_COUNT; i++) {
  await api('/api/trades', {
    method: 'POST', cookie: trader.cookie,
    body: {
      accountId, symbol: 'XAUUSD', type: 'Buy', lotSize: 0.1,
      entryPrice: 2300 + i, exitPrice: 2310 + i, profit: 100 - i * 37,
      commission: -2, swap: 0, emotion: 'Calm', strategy: 'Trend',
    },
  });
}

// ── the registry agrees with the inspection screen ────────────────────────
const registry = await api('/api/admin/users', { cookie: admin.cookie });
const row = (registry.json?.users || []).find((u) => u.email === `inspect_${stamp}@example.com`);
ok('the registry lists the trader', !!row, `status ${registry.status}`);
ok('the registry counts their accounts', row?.accountsCount === 1, String(row?.accountsCount));
ok('the registry counts their trades', row?.tradesCount === TRADE_COUNT, String(row?.tradesCount));
ok('the registry carries a join date', !!row?.createdAt, String(row?.createdAt));

// ── the inspection returns the TRADER, not the caller ─────────────────────
const inspect = await api(`/api/admin/inspect-user/${trader.user.id}`, { cookie: admin.cookie });
ok('admin can inspect the trader', inspect.status === 200, `status ${inspect.status}`);
ok('it returns the trader, not the admin', inspect.json?.user?.email === `inspect_${stamp}@example.com`,
  String(inspect.json?.user?.email));
ok('it returns the trader accounts', (inspect.json?.accounts || []).length === 1,
  String((inspect.json?.accounts || []).length));
ok('it returns the trader trades', (inspect.json?.trades || []).length === TRADE_COUNT,
  String((inspect.json?.trades || []).length));
ok('the counts match what the registry advertised',
  (inspect.json?.accounts || []).length === row?.accountsCount &&
  (inspect.json?.trades || []).length === row?.tradesCount);
ok('no password travels with it', !/"password"\s*:\s*"[^"]/.test(JSON.stringify(inspect.json || {})));

// ── it is admin-only ──────────────────────────────────────────────────────
const byOther = await api(`/api/admin/inspect-user/${trader.user.id}`, { cookie: other.cookie });
ok('a plain user cannot inspect anyone', byOther.status === 403 || byOther.status === 404,
  `status ${byOther.status}`);

const byAnon = await api(`/api/admin/inspect-user/${trader.user.id}`);
ok('an anonymous caller cannot inspect anyone', byAnon.status === 403 || byAnon.status === 401,
  `status ${byAnon.status}`);

const ghost = await api('/api/admin/inspect-user/user_does_not_exist', { cookie: admin.cookie });
ok('an unknown user is 404', ghost.status === 404, `status ${ghost.status}`);

// ── inspecting must not write anything ────────────────────────────────────
// The wizard's exit wrote the admin's own profile. Nothing about opening this
// screen may change either account.
const adminAfter = await api('/api/auth/me', { cookie: admin.cookie });
ok('the admin profile is untouched by inspecting',
  adminAfter.json?.user?.onboardingCompleted === true && adminAfter.json?.user?.email === adminEmail,
  `${adminAfter.json?.user?.email} onboarded=${adminAfter.json?.user?.onboardingCompleted}`);

const traderAfter = await api('/api/auth/me', { cookie: trader.cookie });
ok('the trader is still un-onboarded, not silently completed',
  !(traderAfter.json?.user?.onboardingCompleted ?? traderAfter.json?.user?.onboarding_completed),
  String(traderAfter.json?.user?.onboardingCompleted));

// ── report ────────────────────────────────────────────────────────────────
console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const passed = out.filter((r) => r.p).length;
console.log(`\n${passed}/${out.length} passed`);
if (passed !== out.length) {
  console.log('FAILING:');
  for (const r of out.filter((x) => !x.p)) console.log(` - ${r.n} (${r.d})`);
  process.exit(1);
}
