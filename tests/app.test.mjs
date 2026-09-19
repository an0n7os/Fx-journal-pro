// Pre-launch sweep: exercises every user-facing API path and reports what
// actually works, not what is supposed to.
const BASE = 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

const email = `golive_${Date.now()}@example.com`;
const login = await api('/api/auth/login', { method: 'POST', body: { email, password: 'GoLiveTest123' } });
const cookie = login.setCookie?.split(';')[0] || '';
ok('auth: sign in', login.status === 200);

const acc = await api('/api/accounts', { cookie });
const accountId = acc.json?.accounts?.[0]?.id;
ok('accounts: default portfolio created', !!accountId);

// --- account lifecycle ---------------------------------------------------
// A new account is on the free plan, which allows one trading account, and the
// default portfolio above already used it. A second one must be refused.
const created = await api('/api/accounts', {
  method: 'POST', cookie,
  body: { name: 'Prop Challenge', broker: 'FTMO', startingBalance: 25000, currency: 'USD' },
});
ok('accounts: free plan stops at one account', created.status === 403, `status ${created.status}`);
ok('accounts: refusal says Pro is the way out', created.json?.proRequired === true);

// Free plan is manual entry only.
const mt5Attempt = await api('/api/accounts', {
  method: 'POST', cookie,
  body: { name: 'Synced', broker: 'Exness', isMt5Sync: true },
});
ok('accounts: free plan cannot create an MT5 sync account', mt5Attempt.status === 403,
  `status ${mt5Attempt.status}`);

const renamed = await api(`/api/accounts/${accountId}`, { method: 'PUT', cookie, body: { name: 'Prop Challenge A' } });
ok('accounts: rename', renamed.json?.account?.name === 'Prop Challenge A');

// --- trade lifecycle -----------------------------------------------------
const t1 = await api('/api/trades', {
  method: 'POST', cookie,
  body: {
    accountId, symbol: 'eurusd', type: 'Buy', lotSize: 1, entryPrice: 1.08, exitPrice: 1.09,
    profit: 1000, commission: -7, swap: -2, riskPercentage: 1, strategy: 'Breakout',
    emotion: 'Calm', notes: 'Clean London open break', tags: ['London'],
    date: new Date().toISOString(),
  },
});
ok('trades: create', t1.status === 200, `status ${t1.status}`);
ok('trades: symbol uppercased', t1.json?.trade?.symbol === 'EURUSD', t1.json?.trade?.symbol);
ok('trades: balance math', t1.json?.updatedAccount?.currentBalance === 10991,
  `balance ${t1.json?.updatedAccount?.currentBalance} (expected 10000 + 1000 - 7 - 2)`);

const losing = await api('/api/trades', {
  method: 'POST', cookie,
  body: { accountId, symbol: 'GBPUSD', type: 'Sell', lotSize: 0.5, entryPrice: 1.27, exitPrice: 1.275,
    profit: -250, commission: -4, swap: 0, date: new Date().toISOString() },
});
ok('trades: losing trade recorded', losing.status === 200);

const list = await api(`/api/trades?accountId=${accountId}`, { cookie });
ok('trades: list returns both', list.json?.trades?.length === 2, `got ${list.json?.trades?.length}`);

const edited = await api(`/api/trades/${t1.json.trade.id}`, {
  method: 'PUT', cookie, body: { profit: 1200, notes: 'Updated note' },
});
ok('trades: edit', edited.status === 200 && edited.json?.trade?.profit === 1200);

const afterEdit = await api('/api/accounts', { cookie });
const balAfterEdit = afterEdit.json?.accounts?.find((a) => a.id === accountId)?.currentBalance;
ok('trades: balance follows edit', balAfterEdit === 10937, `balance ${balAfterEdit}`);

const del = await api(`/api/trades/${losing.json.trade.id}`, { method: 'DELETE', cookie });
ok('trades: delete', del.status === 200);
const afterDel = await api('/api/accounts', { cookie });
const balAfterDel = afterDel.json?.accounts?.find((a) => a.id === accountId)?.currentBalance;
ok('trades: balance reverses on delete', balAfterDel === 11191, `balance ${balAfterDel}`);

// --- validation ----------------------------------------------------------
const badTrade = await api('/api/trades', { method: 'POST', cookie, body: { accountId, symbol: 'X' } });
ok('validation: incomplete trade rejected', badTrade.status === 400, `status ${badTrade.status}`);

const negLot = await api('/api/trades', {
  method: 'POST', cookie,
  body: { accountId, symbol: 'XAUUSD', type: 'Buy', lotSize: -5, entryPrice: 1, exitPrice: 2, profit: 10 },
});
ok('validation: negative lot size rejected', negLot.status === 400,
  `status ${negLot.status} — accepted lotSize ${negLot.json?.trade?.lotSize}`);

const hugeProfit = await api('/api/trades', {
  method: 'POST', cookie,
  body: { accountId, symbol: 'XAUUSD', type: 'Buy', lotSize: 0.1, entryPrice: 1, exitPrice: 2, profit: 'not-a-number' },
});
ok('validation: non-numeric profit rejected', hugeProfit.status === 400,
  `status ${hugeProfit.status}, profit ${hugeProfit.json?.trade?.profit}`);

// --- risk settings -------------------------------------------------------
const risk = await api(`/api/risk-settings/${accountId}`, { cookie });
ok('risk settings: read', risk.status === 200, `status ${risk.status}`);
const riskSave = await api(`/api/risk-settings/${accountId}`, {
  method: 'PUT', cookie, body: { riskPerTradeLimit: 1.5, maxDailyLoss: 300, maxTradesPerDay: 4 },
});
ok('risk settings: save', riskSave.status === 200, `status ${riskSave.status}`);

// --- tickets -------------------------------------------------------------
const ticket = await api('/api/tickets', {
  method: 'POST', cookie, body: { title: 'Pre-launch check', description: 'Testing', category: 'Bug' },
});
ok('support: create ticket', ticket.status === 200);
const myTickets = await api('/api/tickets', { cookie });
ok('support: list own tickets', (myTickets.json?.tickets?.length ?? 0) >= 1);

// --- preferences / profile ----------------------------------------------
const prefs = await api('/api/auth/preferences', { method: 'PATCH', cookie, body: { skipDeleteConfirm: true } });
ok('settings: preferences save', prefs.status === 200, `status ${prefs.status}`);
const profile = await api('/api/auth/update-profile', { method: 'POST', cookie, body: { name: 'Go Live' } });
ok('settings: name change', profile.json?.user?.name === 'Go Live');

// --- gated / unconfigured features --------------------------------------
const ai = await api('/api/ai/mentor', { method: 'POST', cookie, body: { accountId, messages: [{ role: 'user', content: 'hi' }] } });
ok('AI mentor: gated for free users', ai.status === 403 && ai.json?.proRequired === true, `status ${ai.status}`);

const adminCheck = await api('/api/admin/check', { cookie });
ok('admin: non-admin sees isAdmin false', adminCheck.json?.isAdmin === false);
const adminUsers = await api('/api/admin/users', { cookie });
ok('admin: routes refuse non-admin', adminUsers.status === 403, `status ${adminUsers.status}`);

const announcements = await api('/api/announcements', { cookie });
ok('announcements: endpoint responds', announcements.status === 200, `status ${announcements.status}`);

const ea = await api(`/api/mt5/ea/${accountId}/download`, { cookie, raw: true });
ok('MT5: EA file downloads', ea.status === 200 && ea.text.includes('FXJP'),
  `status ${ea.status}, ${ea.text.length} bytes`);

// Live Chart is Pro-only, and this session is on the free plan, so the proxy
// must refuse it. It used to be open to anyone, signed in or not, which made
// hiding the tab pointless. The Pro path is covered in plan-gates.test.mjs.
const chart = await api('/api/chart/ohlc?symbol=XAUUSD&timeframe=1d', { cookie });
ok('chart: OHLC proxy is Pro-gated for free users', chart.status === 403, `status ${chart.status}`);

// --- session ------------------------------------------------------------
const me = await api('/api/auth/me', { cookie });
ok('session: /me works', me.status === 200);
await api('/api/auth/logout', { method: 'POST', cookie });
const afterLogout = await api('/api/auth/me', { cookie });
ok('session: logout invalidates', afterLogout.status === 401, `status ${afterLogout.status}`);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
