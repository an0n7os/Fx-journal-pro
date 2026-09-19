// Verifies normal app behaviour still works after the auth rework, and that
// cross-user isolation holds.
const BASE = 'http://localhost:3000';
const out = [];
const check = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

async function signIn(email) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password: 'GoodPass1234' } });
  return { cookie: r.setCookie?.split(';')[0] || '', user: r.json?.user };
}

const alice = await signIn(`alice_${Date.now()}@example.com`);
const bob = await signIn(`bob_${Date.now()}@example.com`);
check('two users signed in', !!alice.cookie && !!bob.cookie);

// Alice gets a default portfolio account
const aliceAccounts = await api('/api/accounts', { cookie: alice.cookie });
const aliceAccId = aliceAccounts.json?.accounts?.[0]?.id;
check('default account created', !!aliceAccId, `accounts: ${aliceAccounts.json?.accounts?.length}`);

// Log a trade
const trade = await api('/api/trades', {
  method: 'POST',
  cookie: alice.cookie,
  body: {
    accountId: aliceAccId, symbol: 'XAUUSD', type: 'Buy', lotSize: 0.1,
    entryPrice: 2300, exitPrice: 2310, profit: 100, commission: -2, swap: 0,
  },
});
check('trade created', trade.status === 200 && !!trade.json?.trade?.id, `status ${trade.status}`);
check('trade id is a uuid', /^trade_[0-9a-f-]{36}$/.test(trade.json?.trade?.id || ''), trade.json?.trade?.id);
check('balance updated', trade.json?.updatedAccount?.currentBalance === 10098,
  `balance ${trade.json?.updatedAccount?.currentBalance}`);

// Update it — the old code could turn the balance into NaN here
const upd = await api(`/api/trades/${trade.json.trade.id}`, {
  method: 'PUT', cookie: alice.cookie, body: { profit: 150 },
});
const afterUpdate = await api('/api/accounts', { cookie: alice.cookie });
const bal = afterUpdate.json?.accounts?.find((a) => a.id === aliceAccId)?.currentBalance;
check('trade updated', upd.status === 200, `status ${upd.status}`);
check('balance is a finite number (no NaN)', Number.isFinite(bal) && bal === 10148, `balance ${bal}`);

// Batch import twice — the second run must be skipped as duplicates
const rows = [
  { symbol: 'EURUSD', type: 'Sell', lotSize: 0.5, entryPrice: 1.08, exitPrice: 1.07, profit: 50, date: '2026-01-05T10:00:00.000Z', ticket: 111 },
  { symbol: 'GBPUSD', type: 'Buy', lotSize: 0.2, entryPrice: 1.26, exitPrice: 1.27, profit: 20, date: '2026-01-06T10:00:00.000Z', ticket: 222 },
];
const b1 = await api('/api/trades/batch', { method: 'POST', cookie: alice.cookie, body: { accountId: aliceAccId, trades: rows } });
const b2 = await api('/api/trades/batch', { method: 'POST', cookie: alice.cookie, body: { accountId: aliceAccId, trades: rows } });
check('batch import works', b1.json?.totalSaved === 2, `saved ${b1.json?.totalSaved}`);
check('re-import skipped as duplicates', b2.json?.totalSaved === 0 && b2.json?.totalSkipped === 2,
  `saved ${b2.json?.totalSaved}, skipped ${b2.json?.totalSkipped}`);

// Cross-user isolation
const bobSeesAlice = await api(`/api/trades?accountId=${aliceAccId}`, { cookie: bob.cookie });
check('bob cannot read alice trades', (bobSeesAlice.json?.trades?.length ?? 0) === 0,
  `bob got ${bobSeesAlice.json?.trades?.length} trades`);

const bobWrites = await api('/api/trades', {
  method: 'POST', cookie: bob.cookie,
  body: { accountId: aliceAccId, symbol: 'XAUUSD', type: 'Buy', lotSize: 0.1, entryPrice: 1, exitPrice: 2, profit: 1 },
});
check('bob cannot write to alice account', bobWrites.status === 403 || bobWrites.status === 404,
  `status ${bobWrites.status}`);

const bobDeletes = await api(`/api/trades/${trade.json.trade.id}`, { method: 'DELETE', cookie: bob.cookie });
check('bob cannot delete alice trade', bobDeletes.status === 403 || bobDeletes.status === 404, `status ${bobDeletes.status}`);

// Tickets: Bob must not be able to close Alice's ticket
const aliceTicket = await api('/api/tickets', {
  method: 'POST', cookie: alice.cookie, body: { title: 'Test', description: 'Test ticket' },
});
const bobCloses = await api(`/api/tickets/${aliceTicket.json?.ticket?.id}`, {
  method: 'PUT', cookie: bob.cookie, body: { status: 'Closed' },
});
check('bob cannot close alice ticket', bobCloses.status === 403 || bobCloses.status === 404, `status ${bobCloses.status}`);

// Logout clears the session
const logout = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { Cookie: alice.cookie } });
check('logout responds', logout.status === 200);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
