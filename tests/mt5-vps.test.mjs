// Guards the MT5 VPS sync queue: the backend half of the worker pool.
//
// Workers run on a Windows VPS next to a MetaTrader terminal and PULL from
// here — claim a job, get the customer's investor password for that one job,
// send deal history back, complete, take the next. Nothing on this side needs
// a background timer, which is what made the MetaApi path impossible to run on
// serverless.
//
// What has to hold, in order of how much it would cost to get wrong:
//
//   - only an authenticated worker can claim, and therefore only an
//     authenticated worker can ever see an investor password;
//   - a customer's session cannot reach the worker API at all;
//   - a job is leased, so a worker that dies does not strand the terminal slot
//     or the customer's account forever;
//   - two workers cannot hold the same job;
//   - imported trades go through the same pipeline as the EA path, so they
//     dedupe by deal ticket and reconstruct positions identically;
//   - a failed sync keeps what it already imported and resumes from the cursor.
//
// Runs against the dev server on :3000 with MT5_VPS_SYNC_ENABLED=true and
// MT5_WORKER_TOKEN set; skips cleanly when they are not.
import { signInOrRegister } from './auth-helper.mjs';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const WORKER_TOKEN = process.env.MT5_WORKER_TOKEN || '';
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

/** A request as a VPS worker. */
async function worker(path, body, token = WORKER_TOKEN) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

if (!WORKER_TOKEN) {
  console.log('\nSKIPPED: set MT5_VPS_SYNC_ENABLED=true and MT5_WORKER_TOKEN to run this suite.');
  console.log('  PowerShell:  $env:MT5_VPS_SYNC_ENABLED="true"; $env:MT5_WORKER_TOKEN="dev-worker-token"; npm run dev');
  process.exit(0);
}

const stamp = Date.now();
const WORKER_ID = `test-worker-${stamp}`;
const PASSWORD = 'VpsSyncTest12345';
const INVESTOR_PASSWORD = `inv-${stamp}-secret`;
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const adminEmail = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';
const admin = await signInOrRegister(BASE, adminEmail, adminPassword);

const EMAIL = `vps_${stamp}@example.com`;
let trader = await signInOrRegister(BASE, EMAIL, PASSWORD);
await api(`/api/admin/users/${trader.user.id}/plan`, {
  method: 'POST', cookie: admin.cookie, body: { isPro: true },
});
trader = await signInOrRegister(BASE, EMAIL, PASSWORD);

const created = await api('/api/accounts', {
  method: 'POST', cookie: trader.cookie,
  body: { name: 'Prop Firm', broker: 'MetaTrader 5', startingBalance: 25000, currency: 'USD', isMt5Sync: true },
});
const accountId = created.json?.account?.id;
ok('setup: an MT5 account exists', created.status === 200 && !!accountId, `status ${created.status}`);

// ── the worker API is not reachable without the worker token ──────────────
const noToken = await worker('/api/mt5/worker/claim', { workerId: WORKER_ID }, '');
ok('a worker without a token is refused', noToken.status === 401, `status ${noToken.status}`);

const wrongToken = await worker('/api/mt5/worker/claim', { workerId: WORKER_ID }, 'not-the-token');
ok('a wrong worker token is refused', wrongToken.status === 401, `status ${wrongToken.status}`);
ok('the refusal names the reason', wrongToken.json?.code === 'WORKER_AUTH_FAILED', String(wrongToken.json?.code));

// A signed-in customer is not a worker. Their cookie must buy nothing here —
// this endpoint hands out investor passwords.
const asCustomer = await api('/api/mt5/worker/claim', {
  method: 'POST', cookie: trader.cookie, body: { workerId: WORKER_ID },
});
ok('a customer session cannot claim jobs', asCustomer.status === 401, `status ${asCustomer.status}`);

// ── connecting queues a job ───────────────────────────────────────────────
const connect = await api('/api/mt5/vps/connect', {
  method: 'POST', cookie: trader.cookie,
  body: { accountId, login: '5001234', server: 'Amplify-Live', investorPassword: INVESTOR_PASSWORD },
});
ok('the customer can connect for automatic sync', connect.status === 200, `status ${connect.status}`);
ok('it answers Queued, not Connected', connect.json?.status === 'Queued', String(connect.json?.status));

const queued = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
ok('the account is on the VPS method', queued.json?.syncMethod === 'VPS', String(queued.json?.syncMethod));
ok('and holds stored credentials', queued.json?.cloudConnected === true, String(queued.json?.cloudConnected));

// The password must never come back through a customer-facing route.
const statusBlob = JSON.stringify(queued.json || {});
ok('the investor password is not in the status payload', !statusBlob.includes(INVESTOR_PASSWORD));

const accountsBlob = JSON.stringify((await api('/api/accounts', { cookie: trader.cookie })).json || {});
ok('nor in the accounts payload', !accountsBlob.includes(INVESTOR_PASSWORD));
ok('nor is the stored ciphertext handed out', !/investorPasswordEnc/.test(accountsBlob));

// Clicking Sync again must not stack a second job for one account.
const second = await api('/api/mt5/vps/sync', { method: 'POST', cookie: trader.cookie, body: { accountId } });
ok('a second sync request reuses the queued job', second.json?.alreadyQueued === true,
  String(second.json?.alreadyQueued));

// ── a worker claims it and gets exactly what it needs ─────────────────────
const claim = await worker('/api/mt5/worker/claim', { workerId: WORKER_ID, terminal: 'terminal1' });
ok('a worker claims the job', claim.status === 200 && !!claim.json?.job, `status ${claim.status}`);
const jobId = claim.json?.job?.id;
ok('the job names the account', claim.json?.job?.accountId === accountId, String(claim.json?.job?.accountId));
ok('the login is handed over', claim.json?.credentials?.login === '5001234',
  String(claim.json?.credentials?.login));
ok('the server is handed over', claim.json?.credentials?.server === 'Amplify-Live',
  String(claim.json?.credentials?.server));
ok('the investor password decrypts back to what was stored',
  claim.json?.credentials?.investorPassword === INVESTOR_PASSWORD);
ok('a first sync starts from zero', claim.json?.sinceDeal === 0, String(claim.json?.sinceDeal));
ok('the job carries a lease', !!claim.json?.job?.leaseUntil, String(claim.json?.job?.leaseUntil));

// One job, one worker. A second worker must not get the same one.
const double = await worker('/api/mt5/worker/claim', { workerId: `${WORKER_ID}-b` });
ok('a second worker does not get the same job', double.json?.job?.id !== jobId,
  String(double.json?.job?.id));

// ── history comes in and becomes journal trades ───────────────────────────
// Position 800001 is a long: opened by a buy deal, closed by a sell deal.
// Position 800002 is a short. Direction is read from the opening deal.
const now = Math.floor(Date.now() / 1000);
const deals = [
  { ticket: 500001, positionId: 800001, time: now - 7200, type: 0, entry: 0, symbol: 'XAUUSD', volume: 0.5, price: 2310, profit: 0, commission: -2, swap: 0 },
  { ticket: 500002, positionId: 800001, time: now - 3600, type: 1, entry: 1, symbol: 'XAUUSD', volume: 0.5, price: 2340, profit: 1500, commission: -2, swap: -1 },
  { ticket: 500003, positionId: 800002, time: now - 5400, type: 1, entry: 0, symbol: 'EURUSD', volume: 1.0, price: 1.0920, profit: 0, commission: -3, swap: 0 },
  { ticket: 500004, positionId: 800002, time: now - 1800, type: 0, entry: 1, symbol: 'EURUSD', volume: 1.0, price: 1.0880, profit: 400, commission: -3, swap: 0 },
];

const sync = await worker('/api/mt5/worker/sync', {
  jobId, workerId: WORKER_ID, deals, moneyFlows: [],
  account: { balance: 26900, equity: 26900, currency: 'USD' },
});
ok('the worker can hand over deals', sync.status === 200, `status ${sync.status}`);
ok('four deals become two trades', sync.json?.inserted === 2, String(sync.json?.inserted));
ok('the cursor advances', sync.json?.cursor === 500004, String(sync.json?.cursor));

const trades = (await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie })).json?.trades || [];
ok('both trades reach the journal', trades.length === 2, String(trades.length));
const gold = trades.find((t) => t.symbol === 'XAUUSD');
const euro = trades.find((t) => t.symbol === 'EURUSD');
ok('the long is a Buy', gold?.type === 'Buy', String(gold?.type));
ok('the short is a Sell', euro?.type === 'Sell', String(euro?.type));
ok('entry price is the opening deal', gold?.entryPrice === 2310, String(gold?.entryPrice));
ok('exit price is the closing deal', gold?.exitPrice === 2340, String(gold?.exitPrice));
ok('net profit carries over', gold?.profit === 1500, String(gold?.profit));
ok('entry time is recorded', !!gold?.date, String(gold?.date));
ok('exit time is recorded', !!gold?.exitTime, String(gold?.exitTime));
ok('lot size carries over', gold?.lotSize === 0.5, String(gold?.lotSize));

// A batch sent twice must not duplicate — the VPS path shares the EA path's
// deduplication rather than reimplementing it.
const replay = await worker('/api/mt5/worker/sync', { jobId, workerId: WORKER_ID, deals, moneyFlows: [] });
ok('a replayed batch inserts nothing', replay.json?.inserted === 0, String(replay.json?.inserted));
const afterReplay = (await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie })).json?.trades || [];
ok('and the journal still holds two', afterReplay.length === 2, String(afterReplay.length));

// ── a stranger cannot drive someone else's job ────────────────────────────
const hijack = await worker('/api/mt5/worker/sync', {
  jobId, workerId: 'someone-else', deals: [], moneyFlows: [],
});
ok('another worker cannot push to this job', hijack.status === 409, `status ${hijack.status}`);
ok('the refusal says the lease is lost', hijack.json?.code === 'JOB_LEASE_LOST', String(hijack.json?.code));

const hijackBeat = await worker('/api/mt5/worker/heartbeat', { jobId, workerId: 'someone-else' });
ok('nor extend its lease', hijackBeat.status === 409, `status ${hijackBeat.status}`);

// ── heartbeat and completion ──────────────────────────────────────────────
const beat = await worker('/api/mt5/worker/heartbeat', { jobId, workerId: WORKER_ID });
ok('the owning worker can extend the lease', beat.status === 200, `status ${beat.status}`);

const done = await worker('/api/mt5/worker/complete', { jobId, workerId: WORKER_ID, ok: true, tradesImported: 2 });
ok('the worker completes the job', done.status === 200 && done.json?.status === 'DONE', String(done.json?.status));

const connected = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
ok('the account now reads Connected', connected.json?.eaStatus === 'Connected', String(connected.json?.eaStatus));
ok('and carries a last sync time', !!connected.json?.lastSyncTime, String(connected.json?.lastSyncTime));

// ── the next sync is incremental ──────────────────────────────────────────
const again = await api('/api/mt5/vps/sync', { method: 'POST', cookie: trader.cookie, body: { accountId } });
ok('a later sync can be queued', again.status === 200 && !again.json?.alreadyQueued, `status ${again.status}`);

const claim2 = await worker('/api/mt5/worker/claim', { workerId: WORKER_ID });
ok('the worker picks it up', claim2.json?.job?.accountId === accountId, String(claim2.json?.job?.accountId));
ok('and is told to resume from the cursor', claim2.json?.sinceDeal === 500004, String(claim2.json?.sinceDeal));

// ── a failed sync keeps what it already imported ──────────────────────────
const failed = await worker('/api/mt5/worker/complete', {
  jobId: claim2.json.job.id, workerId: WORKER_ID, ok: false,
  error: 'MT5 login failed (-6): invalid account', errorCode: 'MT5_LOGIN_FAILED',
});
ok('a failure is accepted', failed.status === 200, `status ${failed.status}`);

const afterFailure = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
const keptTrades = (await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie })).json?.trades || [];
ok('the already-imported trades survive the failure', keptTrades.length === 2, String(keptTrades.length));
ok('the failure is surfaced to the customer',
  (afterFailure.json?.lastErrors || []).some((e) => e.errorCode === 'MT5_LOGIN_FAILED'),
  JSON.stringify((afterFailure.json?.lastErrors || []).map((e) => e.errorCode)));
ok('and the error text does not leak the password',
  !JSON.stringify(afterFailure.json?.lastErrors || []).includes(INVESTOR_PASSWORD));

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
