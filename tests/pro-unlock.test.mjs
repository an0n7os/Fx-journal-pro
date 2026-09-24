// Checks the thing a paying customer cares about most: that every gate the
// free plan closes actually opens once they are Pro, and closes again when
// the plan lapses.
//
// Needs a server started with ALLOW_TEST_BILLING=true (dev only) so the plan
// can be flipped without a real payment. Without it the suite reports the
// skip rather than passing silently.
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
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

const config = await api('/api/payments/config');
if (!config.json?.testBilling) {
  console.log('\nSKIPPED: start the server with ALLOW_TEST_BILLING=true to run this suite.');
  console.log('  Windows PowerShell:  $env:ALLOW_TEST_BILLING="true"; npm run dev');
  process.exit(0);
}

const setPlan = async (cookie, tier) =>
  api('/api/payments/toggle-test-tier', { method: 'POST', cookie, body: { tier } });

const email = `pro_${Date.now()}@example.com`;
const login = await api('/api/auth/login', { method: 'POST', body: { email, password: 'ProUnlock12345' } });
const cookie = login.cookie;
ok('setup: signed in', login.status === 200 && !!cookie, `status ${login.status}`);

const accounts = await api('/api/accounts', { cookie });
const accountId = accounts.json?.accounts?.[0]?.id;
ok('setup: starter account exists', !!accountId);

// ── Free ──────────────────────────────────────────────────────────────────
section('On Free, the Pro features are closed');

const freeMe = await api('/api/auth/me', { cookie });
ok('starts on Free', freeMe.json?.user?.isPro !== true);

const freeSecondAccount = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Second', broker: 'FTMO', startingBalance: 5000 },
});
ok('second account refused', freeSecondAccount.status === 403, `status ${freeSecondAccount.status}`);

const freeMt5 = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Synced', broker: 'Exness', isMt5Sync: true },
});
ok('MT5 sync account refused', freeMt5.status === 403, `status ${freeMt5.status}`);

const freeCloud = await api('/api/mt5/cloud/connect', { method: 'POST', cookie, body: { accountId } });
ok('MT5 cloud connect refused', freeCloud.status === 403, `status ${freeCloud.status}`);

const freeMentor = await api('/api/ai/mentor', { method: 'POST', cookie, body: { message: 'Review my trades' } });
ok('AI Mentor refused', freeMentor.status === 403, `status ${freeMentor.status}`);

// ── Pro ───────────────────────────────────────────────────────────────────
section('Turning Pro on opens all of them');

const grant = await setPlan(cookie, 'pro');
ok('plan switched to Pro', grant.status === 200, `status ${grant.status} ${grant.json?.error || ''}`);

const proMe = await api('/api/auth/me', { cookie });
ok('the account now reads as Pro', proMe.json?.user?.isPro === true, `isPro ${proMe.json?.user?.isPro}`);
ok('and carries an expiry date',
  !!(proMe.json?.user?.proUntil || proMe.json?.user?.pro_until),
  'a Pro flag with no expiry can never lapse');

const proSecondAccount = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Prop Challenge', broker: 'FTMO', startingBalance: 25000, currency: 'USD' },
});
const secondAccountId = proSecondAccount.json?.account?.id;
ok('second account allowed', proSecondAccount.status === 200 && !!secondAccountId,
  `status ${proSecondAccount.status} ${proSecondAccount.json?.error || ''}`);

const proThirdAccount = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Third', broker: 'IC Markets', startingBalance: 1000 },
});
ok('accounts are unlimited, not two', proThirdAccount.status === 200,
  `status ${proThirdAccount.status} ${proThirdAccount.json?.error || ''}`);

const proMt5 = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Synced', broker: 'Exness', isMt5Sync: true },
});
ok('MT5 sync account allowed', proMt5.status === 200,
  `status ${proMt5.status} ${proMt5.json?.error || ''}`);

// Cloud connect needs META_API_TOKEN to actually reach MT5. What matters here
// is that it is no longer refused *for being on the free plan*.
const proCloud = await api('/api/mt5/cloud/connect', { method: 'POST', cookie, body: { accountId } });
ok('MT5 cloud connect no longer blocked by plan',
  proCloud.status !== 403 || proCloud.json?.proRequired !== true,
  `status ${proCloud.status} ${proCloud.json?.error || ''}`);

// The mentor needs GEMINI_API_KEY to answer. Again: not a plan refusal.
const proMentor = await api('/api/ai/mentor', { method: 'POST', cookie, body: { message: 'Review my trades' } });
ok('AI Mentor no longer blocked by plan', proMentor.status !== 403,
  `status ${proMentor.status} ${proMentor.json?.error || ''}`);

// Trades still work on the new account.
const proTrade = await api('/api/trades', {
  method: 'POST', cookie,
  body: {
    accountId: secondAccountId, symbol: 'gbpusd', type: 'Sell', lotSize: 0.5,
    entryPrice: 1.27, exitPrice: 1.26, profit: 400, commission: -4, swap: 0,
    date: new Date().toISOString(),
  },
});
ok('can trade on the second account', proTrade.status === 200, `status ${proTrade.status}`);
ok('second account balance updated', proTrade.json?.updatedAccount?.currentBalance === 25396,
  `balance ${proTrade.json?.updatedAccount?.currentBalance} (expected 25000 + 400 - 4)`);

const proBilling = await api('/api/payments/subscription', { cookie });
ok('subscription panel still loads on Pro', proBilling.status === 200, `status ${proBilling.status}`);

// ── Back to Free ──────────────────────────────────────────────────────────
section('When the plan lapses the gates close again');

const revoke = await setPlan(cookie, 'free');
ok('plan switched back to Free', revoke.status === 200, `status ${revoke.status}`);

const backToFree = await api('/api/auth/me', { cookie });
ok('the account reads as Free again', backToFree.json?.user?.isPro !== true,
  `isPro ${backToFree.json?.user?.isPro}`);

const lapsedMentor = await api('/api/ai/mentor', { method: 'POST', cookie, body: { message: 'Review my trades' } });
ok('AI Mentor closes again', lapsedMentor.status === 403, `status ${lapsedMentor.status}`);

const lapsedMt5 = await api('/api/accounts', {
  method: 'POST', cookie, body: { name: 'Synced 2', broker: 'Exness', isMt5Sync: true },
});
ok('MT5 sync closes again', lapsedMt5.status === 403, `status ${lapsedMt5.status}`);

// The accounts they created while Pro stay — downgrading must not delete data.
const afterAccounts = await api('/api/accounts', { cookie });
ok('accounts created on Pro are not deleted on downgrade',
  (afterAccounts.json?.accounts || []).length >= 4,
  `${afterAccounts.json?.accounts?.length ?? 0} accounts`);

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
