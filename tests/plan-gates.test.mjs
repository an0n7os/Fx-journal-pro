// Guards the Free vs Pro feature matrix at the API, not at the button.
//
// Every check here calls the endpoint directly with a free session, the way
// someone poking at the network tab would. Hiding a tab is not a limit; a 403
// with proRequired is.
//
// Runs against the dev server on :3000.
const BASE = 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function signIn(email, password = 'PlanTest12345') {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
  let json = null;
  try { json = await res.json(); } catch {}
  return { cookie, user: json?.user || null };
}

const stamp = Date.now();
// The seeded admin's password is whatever DEV_ADMIN_PASSWORD was set to when
// db.json was written. Hardcoding it here meant that changing the seed
// password silently turned every assertion below into a failure, because the
// admin login returned no cookie and nothing after it could run.
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const admin = await signIn('admin@axyfx.com', adminPassword);
ok('setup: signed in as super admin', !!admin.cookie);
const free = await signIn(`plan_free_${stamp}@example.com`);
ok('setup: free user signed in', !!free.cookie);

// ── entitlements report the free plan honestly ────────────────────────────
const ent = await api('/api/plan/entitlements', { cookie: free.cookie });
ok('free: entitlements readable', ent.status === 200, `status ${ent.status}`);
ok('free: plan is free', ent.json?.plan === 'free', String(ent.json?.plan));
ok('free: 1 account limit', ent.json?.limits?.accounts === 1, String(ent.json?.limits?.accounts));
ok('free: 30 day reports', ent.json?.limits?.reportDays === 30, String(ent.json?.limits?.reportDays));
ok('free: csv only', JSON.stringify(ent.json?.limits?.reportFormats) === '["csv"]', JSON.stringify(ent.json?.limits?.reportFormats));

for (const f of ['mt5Sync', 'liveChart', 'aiMentor', 'unlimitedAccounts', 'proReports', 'whatsappAlerts']) {
  ok(`free: ${f} is off`, ent.json?.features?.[f] === false, String(ent.json?.features?.[f]));
}
for (const f of ['manualJournal', 'analytics', 'calendar', 'fxNews', 'tools']) {
  ok(`free: ${f} is on`, ent.json?.features?.[f] === true, String(ent.json?.features?.[f]));
}

// ── Pro-only endpoints refuse a free session ──────────────────────────────
const chart = await api('/api/chart/ohlc?symbol=EURUSD&timeframe=1d', { cookie: free.cookie });
ok('free: live chart data refused', chart.status === 403, `status ${chart.status}`);
ok('free: chart refusal asks for upgrade', chart.json?.proRequired === true);

const anonChart = await api('/api/chart/ohlc?symbol=EURUSD&timeframe=1d');
ok('anonymous: live chart data refused', anonChart.status === 401 || anonChart.status === 403, `status ${anonChart.status}`);

const mentor = await api('/api/ai/mentor', { method: 'POST', cookie: free.cookie, body: { messages: [] } });
ok('free: AI mentor refused', mentor.status === 403, `status ${mentor.status}`);
ok('free: mentor refusal asks for upgrade', mentor.json?.proRequired === true);

const cloudConnect = await api('/api/mt5/cloud/connect', { method: 'POST', cookie: free.cookie, body: {} });
ok('free: MT5 cloud connect refused', cloudConnect.status === 403, `status ${cloudConnect.status}`);
ok('free: MT5 refusal asks for upgrade', cloudConnect.json?.proRequired === true);

const cloudSync = await api('/api/mt5/cloud/sync', { method: 'POST', cookie: free.cookie, body: {} });
ok('free: MT5 cloud sync refused', cloudSync.status === 403, `status ${cloudSync.status}`);

// ── portfolio limit ───────────────────────────────────────────────────────
// Signup already creates the one portfolio the free plan allows, so the very
// next account is the one that has to be refused.
const startingAccounts = await api('/api/accounts', { cookie: free.cookie });
ok('free: signup created one portfolio',
  (startingAccounts.json?.accounts || []).length === 1,
  String((startingAccounts.json?.accounts || []).length));

const acc2 = await api('/api/accounts', {
  method: 'POST', cookie: free.cookie,
  body: { name: 'Second', broker: 'Test', currency: 'USD', startingBalance: 10000 },
});
ok('free: second account refused', acc2.status === 403, `status ${acc2.status}`);
ok('free: account refusal asks for upgrade', acc2.json?.proRequired === true);

const mt5Acc = await api('/api/accounts', {
  method: 'POST', cookie: free.cookie,
  body: { name: 'Synced', broker: 'Test', currency: 'USD', startingBalance: 10000, isMt5Sync: true },
});
ok('free: MT5-synced account refused', mt5Acc.status === 403, `status ${mt5Acc.status}`);

// ── reports ───────────────────────────────────────────────────────────────
const csv = await api('/api/reports/export', { method: 'POST', cookie: free.cookie, body: { format: 'csv' } });
ok('free: csv report allowed', csv.status === 200, `status ${csv.status}`);
ok('free: csv report is clamped', csv.json?.clamped === true, String(csv.json?.clamped));
ok('free: clamp is 30 days', csv.json?.maxDays === 30, String(csv.json?.maxDays));

const floorMs = Date.now() - 31 * 86400000;
ok('free: window starts no earlier than 30 days ago',
  new Date(csv.json?.windowStart || 0).getTime() > floorMs,
  String(csv.json?.windowStart));

const xlsx = await api('/api/reports/export', { method: 'POST', cookie: free.cookie, body: { format: 'xlsx' } });
ok('free: xlsx report refused', xlsx.status === 403, `status ${xlsx.status}`);
ok('free: xlsx refusal asks for upgrade', xlsx.json?.proRequired === true);

const pdf = await api('/api/reports/export', { method: 'POST', cookie: free.cookie, body: { format: 'pdf' } });
ok('free: pdf report refused', pdf.status === 403, `status ${pdf.status}`);

// Asking for a year does not widen the window.
const wide = await api('/api/reports/export', {
  method: 'POST', cookie: free.cookie,
  body: { format: 'csv', start: new Date(Date.now() - 365 * 86400000).toISOString() },
});
ok('free: a year-long request is still clamped to 30 days',
  new Date(wide.json?.windowStart || 0).getTime() > floorMs,
  String(wide.json?.windowStart));

const anonReport = await api('/api/reports/export', { method: 'POST', body: { format: 'csv' } });
ok('anonymous: report refused', anonReport.status === 401, `status ${anonReport.status}`);

// ── free features stay reachable ──────────────────────────────────────────
const news = await api('/api/economic-calendar?limit=5', { cookie: free.cookie });
ok('free: economic calendar reachable', news.status === 200, `status ${news.status}`);

const trades = await api('/api/trades', { cookie: free.cookie });
ok('free: own journal reachable', trades.status === 200, `status ${trades.status}`);

const accounts = await api('/api/accounts', { cookie: free.cookie });
ok('free: own accounts reachable', accounts.status === 200, `status ${accounts.status}`);

// ── the same account, once upgraded ───────────────────────────────────────
const grant = await api(`/api/admin/users/${free.user.id}/plan`, {
  method: 'POST', cookie: admin.cookie, body: { isPro: true },
});
ok('admin can grant Pro', grant.status === 200, `status ${grant.status}`);

const proSession = await signIn(`plan_free_${stamp}@example.com`);
const entPro = await api('/api/plan/entitlements', { cookie: proSession.cookie });
ok('pro: plan is pro', entPro.json?.plan === 'pro', String(entPro.json?.plan));
ok('pro: accounts unlimited', entPro.json?.limits?.accounts === null, String(entPro.json?.limits?.accounts));
ok('pro: reports unlimited', entPro.json?.limits?.reportDays === null, String(entPro.json?.limits?.reportDays));

for (const f of ['mt5Sync', 'liveChart', 'aiMentor', 'unlimitedAccounts', 'proReports', 'whatsappAlerts']) {
  ok(`pro: ${f} is on`, entPro.json?.features?.[f] === true, String(entPro.json?.features?.[f]));
}

const proChart = await api('/api/chart/ohlc?symbol=EURUSD&timeframe=1d', { cookie: proSession.cookie });
ok('pro: live chart data allowed', proChart.status === 200, `status ${proChart.status}`);

const proAcc = await api('/api/accounts', {
  method: 'POST', cookie: proSession.cookie,
  body: { name: 'Second Pro', broker: 'Test', currency: 'USD', startingBalance: 10000 },
});
ok('pro: second account allowed', proAcc.status === 200 || proAcc.status === 201, `status ${proAcc.status}`);

const proXlsx = await api('/api/reports/export', { method: 'POST', cookie: proSession.cookie, body: { format: 'xlsx' } });
ok('pro: xlsx report allowed', proXlsx.status === 200, `status ${proXlsx.status}`);
ok('pro: report is not clamped', proXlsx.json?.clamped === false, String(proXlsx.json?.clamped));

const proPdf = await api('/api/reports/export', { method: 'POST', cookie: proSession.cookie, body: { format: 'pdf' } });
ok('pro: pdf report allowed', proPdf.status === 200, `status ${proPdf.status}`);

// ── a Partner gets Pro from the role alone ────────────────────────────────
const partnerToBe = await signIn(`plan_partner_${stamp}@example.com`);
const entBefore = await api('/api/plan/entitlements', { cookie: partnerToBe.cookie });
ok('partner-to-be starts on free', entBefore.json?.plan === 'free', String(entBefore.json?.plan));

const promote = await api(`/api/admin/users/${partnerToBe.user.id}/partner`, {
  method: 'POST', cookie: admin.cookie, body: {},
});
ok('admin promotes to Partner', promote.status === 200, `status ${promote.status}`);

const partnerSession = await signIn(`plan_partner_${stamp}@example.com`);
const entPartner = await api('/api/plan/entitlements', { cookie: partnerSession.cookie });
ok('partner: plan is pro', entPartner.json?.plan === 'pro', String(entPartner.json?.plan));
ok('partner: live chart on', entPartner.json?.features?.liveChart === true);
ok('partner: mt5 sync on', entPartner.json?.features?.mt5Sync === true);

const partnerChart = await api('/api/chart/ohlc?symbol=EURUSD&timeframe=1d', { cookie: partnerSession.cookie });
ok('partner: live chart data allowed', partnerChart.status === 200, `status ${partnerChart.status}`);

// ── the plan cannot be self-granted ───────────────────────────────────────
const free2 = await signIn(`plan_cheat_${stamp}@example.com`);
const selfGrant = await api(`/api/admin/users/${free2.user.id}/plan`, {
  method: 'POST', cookie: free2.cookie, body: { isPro: true },
});
ok('a user cannot grant themselves Pro', selfGrant.status === 403, `status ${selfGrant.status}`);

const stillFree = await api('/api/plan/entitlements', { cookie: free2.cookie });
ok('and stays on free', stillFree.json?.plan === 'free', String(stillFree.json?.plan));

// Claiming Pro in the request body must change nothing.
const claim = await api('/api/auth/profile', {
  method: 'POST', cookie: free2.cookie, body: { isPro: true, name: 'Cheat' },
});
const afterClaim = await api('/api/plan/entitlements', { cookie: free2.cookie });
ok('claiming isPro in a profile update is ignored', afterClaim.json?.plan === 'free',
  `profile status ${claim.status}, plan ${afterClaim.json?.plan}`);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
process.exit(failed.length ? 1 : 0);
