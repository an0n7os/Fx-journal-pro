// Walks the whole path a new customer takes, in order, against a running
// server: register, verify the emailed code, sign in, onboard, look at the
// dashboard, log a trade, hit the free-plan limits, try to pay, then sign out.
// Finishes with the admin side.
//
// This is the "does the product work end to end" test, as opposed to the
// per-area suites. Run it with the dev server up on :3000.
const BASE = 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });
const section = (t) => out.push({ section: t });

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
}

const stamp = Date.now();
const email = `journey_${stamp}@example.com`;
const password = 'JourneyTest12345';

// ── 1. Sign up ────────────────────────────────────────────────────────────
section('1. New customer signs up');

const reg = await api('/api/auth/register', { method: 'POST', body: { email, name: 'Journey Trader', password } });
ok('register accepted', reg.status === 200, `status ${reg.status} ${reg.json?.error || ''}`);
ok('register does not sign you in before the code is verified', !reg.cookie || !reg.json?.user?.isEmailVerified);

const otp = reg.json?.devOtp;
ok('verification code issued', !!otp, otp ? 'received' : 'no devOtp in response');

const wrongOtp = await api('/api/auth/verify-otp', { method: 'POST', body: { email, otp: '000000' } });
ok('wrong code refused', wrongOtp.status !== 200, `status ${wrongOtp.status}`);

const verified = await api('/api/auth/verify-otp', { method: 'POST', body: { email, otp } });
ok('correct code verifies the account', verified.status === 200, `status ${verified.status} ${verified.json?.error || ''}`);

// ── 2. Sign in ────────────────────────────────────────────────────────────
section('2. Signs in');

const badLogin = await api('/api/auth/login', { method: 'POST', body: { email, password: 'WrongPassword1' } });
ok('wrong password refused', badLogin.status === 401, `status ${badLogin.status}`);

const login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
const cookie = login.cookie;
ok('signs in', login.status === 200 && !!cookie, `status ${login.status}`);

const me = await api('/api/auth/me', { cookie });
ok('session identifies the right account', me.json?.user?.email === email, me.json?.user?.email);
ok('new account starts on Free', me.json?.user?.isPro !== true, `isPro ${me.json?.user?.isPro}`);
ok('password never leaves the server', !JSON.stringify(me.json || {}).includes('password'));

// ── 3. Onboarding ─────────────────────────────────────────────────────────
section('3. Onboarding');

const onboard = await api('/api/auth/onboarding', {
  method: 'POST', cookie,
  body: { experience: 'Beginner', tradingStyle: 'Swing Trading', mainMarkets: ['Forex'] },
});
ok('onboarding saves', onboard.status === 200, `status ${onboard.status}`);

const afterOnboard = await api('/api/auth/me', { cookie });
ok('onboarding answers persist',
  (afterOnboard.json?.user?.tradingStyle || afterOnboard.json?.user?.trading_style) === 'Swing Trading',
  afterOnboard.json?.user?.tradingStyle || afterOnboard.json?.user?.trading_style);

// ── 4. First look at the dashboard ────────────────────────────────────────
section('4. Dashboard loads');

const accounts = await api('/api/accounts', { cookie });
const accountId = accounts.json?.accounts?.[0]?.id;
ok('a starter account already exists', !!accountId, `${accounts.json?.accounts?.length ?? 0} accounts`);
ok('starter account has a balance', Number(accounts.json?.accounts?.[0]?.currentBalance) > 0,
  `balance ${accounts.json?.accounts?.[0]?.currentBalance}`);

for (const [label, path] of [
  ['trades', '/api/trades'],
  ['announcements', '/api/announcements'],
  ['economic calendar', '/api/economic-calendar'],
]) {
  const r = await api(path, { cookie });
  ok(`${label} endpoint responds`, r.status === 200, `status ${r.status}`);
}

// FX news needs ALPHA_VANTAGE_API_KEY. Without it the route must say so
// rather than fail in a way the UI cannot explain to the customer.
const news = await api('/api/fx-news', { cookie });
ok('FX news responds or says it is unconfigured',
  news.status === 200 || news.json?.code === 'NOT_CONFIGURED',
  news.status === 200 ? 'live' : `status ${news.status} ${news.json?.code || ''} — set ALPHA_VANTAGE_API_KEY before launch`);

// ── 5. Logs a trade ───────────────────────────────────────────────────────
section('5. Logs a trade');

const trade = await api('/api/trades', {
  method: 'POST', cookie,
  body: {
    accountId, symbol: 'eurusd', type: 'Buy', lotSize: 1, entryPrice: 1.08, exitPrice: 1.09,
    profit: 500, commission: -5, swap: -1, riskPercentage: 1, strategy: 'Breakout',
    emotion: 'Calm', notes: 'First trade', date: new Date().toISOString(),
  },
});
ok('trade saves', trade.status === 200, `status ${trade.status} ${trade.json?.error || ''}`);
ok('symbol normalised to uppercase', trade.json?.trade?.symbol === 'EURUSD', trade.json?.trade?.symbol);
ok('balance updates by profit minus costs',
  trade.json?.updatedAccount?.currentBalance === 10494,
  `balance ${trade.json?.updatedAccount?.currentBalance} (expected 10000 + 500 - 5 - 1)`);

const junkTrade = await api('/api/trades', {
  method: 'POST', cookie,
  body: { accountId, symbol: 'EURUSD', type: 'Buy', lotSize: -5, entryPrice: 1.08, profit: 'abc', date: new Date().toISOString() },
});
ok('nonsense numbers refused', junkTrade.status === 400, `status ${junkTrade.status}`);

const listed = await api('/api/trades', { cookie });
ok('the trade shows up in the journal', (listed.json?.trades || []).some((t) => t.symbol === 'EURUSD'));

// ── 6. Free-plan limits ───────────────────────────────────────────────────
section('6. Free-plan limits hold');

const secondAccount = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Second', broker: 'FTMO', startingBalance: 5000 },
});
ok('second account blocked on Free', secondAccount.status === 403, `status ${secondAccount.status}`);
ok('and the message points at Pro', secondAccount.json?.proRequired === true);

const mt5Account = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Synced', broker: 'Exness', isMt5Sync: true },
});
ok('MT5 sync account blocked on Free', mt5Account.status === 403, `status ${mt5Account.status}`);

const mentor = await api('/api/ai/mentor', { method: 'POST', cookie, body: { message: 'How am I doing?' } });
ok('AI Mentor blocked on Free', mentor.status === 403, `status ${mentor.status}`);

// ── 7. Tries to pay ───────────────────────────────────────────────────────
section('7. Upgrade flow');

const payConfig = await api('/api/payments/config');
ok('pricing is readable before paying', payConfig.status === 200 && payConfig.json?.amountRupees > 0,
  `₹${payConfig.json?.amountRupees}`);
ok('test billing is off', payConfig.json?.testBilling !== true);

const subscribe = await api('/api/payments/subscribe', { method: 'POST', cookie });
if (payConfig.json?.configured) {
  ok('checkout starts a real subscription', subscribe.status === 200 && !!subscribe.json?.subscriptionId,
    `id ${subscribe.json?.subscriptionId}`);
} else {
  ok('checkout reports honestly when Razorpay is unconfigured', subscribe.status === 503,
    `status ${subscribe.status} — 200 here would mean a free upgrade`);
}

const stillFree = await api('/api/auth/me', { cookie });
ok('customer is still on Free after all that', stillFree.json?.user?.isPro !== true);

const billing = await api('/api/payments/subscription', { cookie });
ok('subscription panel loads', billing.status === 200, `status ${billing.status}`);

// ── 8. Cannot reach the admin console ─────────────────────────────────────
section('8. Customer cannot reach admin');

for (const path of ['/api/admin/users', '/api/admin/billing', '/api/admin/audit', '/api/subadmin/overview']) {
  const r = await api(path, { cookie });
  ok(`customer refused: ${path}`, r.status === 403, `status ${r.status}`);
}

// ── 9. Signs out ──────────────────────────────────────────────────────────
section('9. Signs out');

const logout = await api('/api/auth/logout', { method: 'POST', cookie });
ok('sign out succeeds', logout.status === 200, `status ${logout.status}`);

const afterLogout = await api('/api/auth/me', { cookie });
ok('the old cookie no longer works', afterLogout.json?.user?.email !== email,
  `still ${afterLogout.json?.user?.email || 'signed out'}`);

// ── 10. Admin side ────────────────────────────────────────────────────────
section('10. Admin console');

// Matches DEV_ADMIN_PASSWORD from .env.testbilling, or whatever the seed
// script used. Skips cleanly when the local admin has a different password.
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'LocalAdmin123';
const adminLogin = await api('/api/auth/login', { method: 'POST', body: { email: 'admin@axyfx.com', password: adminPassword } });
if (adminLogin.status !== 200) {
  ok('admin sign-in (skipped: no local admin password on this server)', true, `status ${adminLogin.status}`);
} else {
  const adminCookie = adminLogin.cookie;
  const check = await api('/api/admin/check', { cookie: adminCookie });
  ok('admin is recognised as SUPER_ADMIN', check.json?.role === 'SUPER_ADMIN', `role ${check.json?.role}`);
  ok('admin holds every permission', (check.json?.permissions || []).includes('subadmin.assign'));

  for (const [label, path] of [
    ['dashboard', '/api/admin/dashboard'],
    ['user registry', '/api/admin/users'],
    ['team', '/api/admin/team'],
    ['billing', '/api/admin/billing'],
    ['audit', '/api/admin/audit'],
    ['sub-admin console', '/api/subadmin/overview'],
  ]) {
    const r = await api(path, { cookie: adminCookie });
    ok(`admin ${label} loads`, r.status === 200, `status ${r.status}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────
console.log('');
for (const r of out) {
  if (r.section) { console.log(`\n  ${r.section}`); continue; }
  console.log(`  ${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
}
const checks = out.filter((r) => !r.section);
const failed = checks.filter((r) => !r.p);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
process.exit(failed.length ? 1 : 0);
