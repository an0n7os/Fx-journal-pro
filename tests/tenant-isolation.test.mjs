// Three customers, one database. The thing a trading journal cannot get wrong.
//
// Every check here is about one of two promises:
//   1. What I write is mine, and stays mine across logins.
//   2. I cannot see or touch anyone else's, however I ask.
//
// The second is tested by having one signed-in customer aim every verb at
// another customer's ids — read, update, delete, and writing a trade into
// their account — rather than by trusting that the UI never offers it.
import { signInOrRegister } from './auth-helper.mjs';

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
  try { json = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, json };
}

const stamp = Date.now();
const people = [
  { tag: 'alice', symbol: 'EURUSD', profit: 250 },
  { tag: 'bob', symbol: 'GBPJPY', profit: -120 },
  { tag: 'carol', symbol: 'XAUUSD', profit: 980 },
];

// ── each customer signs up and logs a trade ───────────────────────────────
section('Three customers, each with their own data');

for (const p of people) {
  p.email = `tenant_${p.tag}_${stamp}@example.com`;
  const { cookie } = await signInOrRegister(BASE, p.email, 'TenantIso12345');
  p.cookie = cookie;
  ok(`${p.tag}: signed up`, !!cookie);

  const accounts = await api('/api/accounts', { cookie });
  p.accountId = accounts.json?.accounts?.[0]?.id;
  p.startingBalance = accounts.json?.accounts?.[0]?.startingBalance ?? 0;
  ok(`${p.tag}: has their own starter account`, !!p.accountId, String(p.accountId).slice(0, 12));

  const trade = await api('/api/trades', {
    method: 'POST', cookie,
    body: {
      accountId: p.accountId, date: new Date().toISOString(), symbol: p.symbol,
      type: 'Buy', lotSize: 1, entryPrice: 1, exitPrice: 2,
      profit: p.profit, commission: 0, swap: 0, riskPercentage: 1,
    },
  });
  p.tradeId = trade.json?.trade?.id || trade.json?.id;
  ok(`${p.tag}: logged a ${p.symbol} trade`, trade.status === 200 || trade.status === 201, `status ${trade.status}`);
}

const ids = new Set(people.map((p) => p.accountId));
ok('no two customers share an account id', ids.size === people.length, `${ids.size} distinct`);

// ── each sees only their own ──────────────────────────────────────────────
section('Each customer sees only their own');

for (const p of people) {
  const trades = (await api('/api/trades', { cookie: p.cookie })).json?.trades || [];
  ok(`${p.tag}: sees exactly one trade`, trades.length === 1, `${trades.length}`);
  ok(`${p.tag}: and it is theirs`, trades[0]?.symbol === p.symbol, String(trades[0]?.symbol));

  const others = people.filter((o) => o !== p).map((o) => o.symbol);
  ok(`${p.tag}: sees none of ${others.join('/')}`,
    !trades.some((t) => others.includes(t.symbol)));

  const accounts = (await api('/api/accounts', { cookie: p.cookie })).json?.accounts || [];
  ok(`${p.tag}: sees exactly one account`, accounts.length === 1, `${accounts.length}`);
  ok(`${p.tag}: balance reflects their own trade`,
    Math.round(accounts[0]?.currentBalance) === Math.round(p.startingBalance + p.profit),
    `${accounts[0]?.currentBalance} vs ${p.startingBalance + p.profit}`);
}

// ── one customer aims every verb at another's ids ─────────────────────────
section('A customer cannot reach another customer');

const [alice, bob] = people;

const readBobTrades = await api(`/api/trades?accountId=${bob.accountId}`, { cookie: alice.cookie });
const leaked = (readBobTrades.json?.trades || []).filter((t) => t.symbol === bob.symbol);
ok('alice asking for bob\'s account id gets none of his trades', leaked.length === 0, `${leaked.length} leaked`);

const editBobTrade = await api(`/api/trades/${bob.tradeId}`, {
  method: 'PUT', cookie: alice.cookie, body: { profit: 99999 },
});
ok('alice cannot edit bob\'s trade', editBobTrade.status === 403 || editBobTrade.status === 404,
  `status ${editBobTrade.status}`);

const deleteBobTrade = await api(`/api/trades/${bob.tradeId}`, { method: 'DELETE', cookie: alice.cookie });
ok('alice cannot delete bob\'s trade', deleteBobTrade.status === 403 || deleteBobTrade.status === 404,
  `status ${deleteBobTrade.status}`);

const writeIntoBobAccount = await api('/api/trades', {
  method: 'POST', cookie: alice.cookie,
  body: {
    accountId: bob.accountId, date: new Date().toISOString(), symbol: 'HACK',
    type: 'Buy', lotSize: 1, entryPrice: 1, exitPrice: 2, profit: 1,
    commission: 0, swap: 0, riskPercentage: 1,
  },
});
ok('alice cannot write a trade into bob\'s account',
  writeIntoBobAccount.status === 403 || writeIntoBobAccount.status === 404,
  `status ${writeIntoBobAccount.status}`);

const editBobAccount = await api(`/api/accounts/${bob.accountId}`, {
  method: 'PUT', cookie: alice.cookie, body: { name: 'Taken' },
});
ok('alice cannot rename bob\'s account', editBobAccount.status === 403 || editBobAccount.status === 404,
  `status ${editBobAccount.status}`);

const bobMt5 = await api(`/api/mt5/${bob.accountId}/status`, { cookie: alice.cookie });
ok('alice cannot read bob\'s MT5 status', bobMt5.status === 403 || bobMt5.status === 404,
  `status ${bobMt5.status}`);

// Nothing above may have changed bob.
const bobAfter = (await api('/api/trades', { cookie: bob.cookie })).json?.trades || [];
ok('bob still has exactly his one trade', bobAfter.length === 1, `${bobAfter.length}`);
ok('with his own profit untouched', bobAfter[0]?.profit === bob.profit, String(bobAfter[0]?.profit));

// ── logging out and back in keeps it ──────────────────────────────────────
section('Signing out and back in keeps the data');

for (const p of people) {
  await api('/api/auth/logout', { method: 'POST', cookie: p.cookie });
  const stale = await api('/api/trades', { cookie: p.cookie });
  ok(`${p.tag}: the old session stops working`, stale.status === 401, `status ${stale.status}`);

  const again = await signInOrRegister(BASE, p.email, 'TenantIso12345');
  p.cookie = again.cookie;
  const trades = (await api('/api/trades', { cookie: p.cookie })).json?.trades || [];
  ok(`${p.tag}: signs back in and their trade is still there`,
    trades.length === 1 && trades[0]?.symbol === p.symbol,
    `${trades.length} trade(s), ${trades[0]?.symbol}`);

  const accounts = (await api('/api/accounts', { cookie: p.cookie })).json?.accounts || [];
  ok(`${p.tag}: balance survived the round trip`,
    Math.round(accounts[0]?.currentBalance) === Math.round(p.startingBalance + p.profit),
    String(accounts[0]?.currentBalance));
}

// ── an anonymous caller gets nothing ──────────────────────────────────────
section('No session, no data');

for (const [label, path] of [['trades', '/api/trades'], ['accounts', '/api/accounts'], ['me', '/api/auth/me']]) {
  const r = await api(path);
  ok(`anonymous ${label} is refused`, r.status === 401, `status ${r.status}`);
}

// ── report ────────────────────────────────────────────────────────────────
console.log('');
for (const r of out) {
  if (r.section) { console.log(`\n── ${r.section} ──`); continue; }
  console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
}
const checks = out.filter((r) => !r.section);
const failed = checks.filter((r) => !r.p);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
  console.log('FAILING:');
  for (const f of failed) console.log(` - ${f.n} (${f.d})`);
}
process.exit(failed.length ? 1 : 0);
