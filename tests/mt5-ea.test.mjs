// Guards MT5 sync through the Expert Advisor, the path the product actually
// ships — the cloud path needs a broker worker and refuses without one.
//
// Drives the endpoints exactly as the generated .mq5 does: Bearer token plus
// HMAC-SHA256(secret = sha256(token), "<iso timestamp>.<accountId>.<rawBody>").
//
// The check that matters most here is direction. MT5 closes a position with
// the OPPOSITE deal — a long is closed by a sell deal — and the trade builder
// read the closing deal's type, so every synced trade was labelled backwards:
// longs showed as Sell, shorts as Buy, and the long/short split in analytics
// was inverted for every MT5 user.
import crypto from 'node:crypto';
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

const sha256Hex = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

/** One signed EA request, headers and all, the way the .mq5 builds them. */
async function ea(path, accountId, token, payload, { isoOverride } = {}) {
  const raw = JSON.stringify(payload);
  const ts = isoOverride || new Date().toISOString();
  const sig = crypto.createHmac('sha256', sha256Hex(token))
    .update(`${ts}.${accountId}.${raw}`, 'utf8').digest('hex');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-ea-account-id': accountId,
      'x-ea-timestamp': ts,
      'x-ea-signature': sig,
      'x-ea-request-id': crypto.randomUUID(),
    },
    body: raw,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const stamp = Date.now();
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const adminEmail = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';
const admin = await signInOrRegister(BASE, adminEmail, adminPassword);

const EMAIL = `mt5_${stamp}@example.com`;
const PASSWORD = 'Mt5EaTest12345';
let trader = await signInOrRegister(BASE, EMAIL, PASSWORD);
ok('setup: trader exists', !!trader.cookie);

// MT5 sync is Pro — check the gate before granting it.
const freeAttempt = await api('/api/accounts', {
  method: 'POST', cookie: trader.cookie,
  body: { name: 'MT5 Free', broker: 'MetaTrader 5', isMt5Sync: true },
});
ok('a free account cannot create an MT5 sync account', freeAttempt.status === 403,
  `status ${freeAttempt.status}`);

await api(`/api/admin/users/${trader.user.id}/plan`, {
  method: 'POST', cookie: admin.cookie, body: { isPro: true },
});
trader = await signInOrRegister(BASE, EMAIL, PASSWORD);

const created = await api('/api/accounts', {
  method: 'POST', cookie: trader.cookie,
  body: { name: 'MT5 Probe', broker: 'MetaTrader 5', startingBalance: 10000, currency: 'USD', isMt5Sync: true },
});
const accountId = created.json?.account?.id;
ok('setup: an MT5 portfolio account exists', created.status === 200 && !!accountId, `status ${created.status}`);

// A new account has no EA running yet. It used to be created as Connected,
// which told the customer they were synced before the file was downloaded and
// hid the setup UI that keys off the connected state.
const fresh = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
ok('a new MT5 account is not yet connected', fresh.json?.eaStatus === 'Not Connected',
  String(fresh.json?.eaStatus));

// ── the EA file downloads with this account's token baked in ──────────────
const dl = await fetch(BASE + `/api/mt5/ea/${accountId}/download`, {
  headers: { Cookie: trader.cookie },
});
const source = await dl.text();
ok('the EA file downloads', dl.status === 200 && source.length > 1000, `status ${dl.status}, ${source.length} bytes`);
ok('it is served as a download', /attachment/.test(dl.headers.get('content-disposition') || ''),
  String(dl.headers.get('content-disposition')));
const token = (source.match(/"(ea_[A-Za-z0-9_]+)"/) || [])[1];
ok('a token is embedded in it', !!token, token ? 'present' : 'missing');
ok('this account id is embedded too', source.includes(accountId));

// ── handshake ─────────────────────────────────────────────────────────────
const authRes = await ea('/api/mt5/ea/authenticate', accountId, token, { accountId, token });
ok('the EA authenticates', authRes.status === 200, `status ${authRes.status}`);

const validate = await ea('/api/mt5/ea/validate', accountId, token, {
  accountId, login: '5001234', server: 'MetaQuotes-Demo', build: 4150,
});
ok('the EA validates against the terminal', validate.status === 200, `status ${validate.status}`);
ok('and reports Connected', validate.json?.status === 'Connected', String(validate.json?.status));

// ── deals become journal trades, with the right direction ─────────────────
// entry 0 = into the market, entry 1 = out. type 0 = BUY deal, 1 = SELL deal.
// Position 800001 is a LONG: opened by a buy deal, closed by a sell deal.
// Position 800002 is a SHORT: opened by a sell deal, closed by a buy deal.
const now = Math.floor(Date.now() / 1000);
const deals = [
  { ticket: 900001, positionId: 800001, time: now - 7200, type: 0, entry: 0, symbol: 'XAUUSD', volume: 0.5, price: 2310, profit: 0, commission: -2, swap: 0 },
  { ticket: 900002, positionId: 800001, time: now - 3600, type: 1, entry: 1, symbol: 'XAUUSD', volume: 0.5, price: 2340, profit: 1500, commission: -2, swap: -1 },
  { ticket: 900003, positionId: 800002, time: now - 5400, type: 1, entry: 0, symbol: 'EURUSD', volume: 1.0, price: 1.0920, profit: 0, commission: -3, swap: 0 },
  { ticket: 900004, positionId: 800002, time: now - 1800, type: 0, entry: 1, symbol: 'EURUSD', volume: 1.0, price: 1.0880, profit: 400, commission: -3, swap: 0 },
];

const sync = await ea('/api/mt5/ea/sync', accountId, token, {
  accountId, deals, moneyFlows: [], account: { balance: 11900, equity: 11900, currency: 'USD' },
});
ok('the sync is accepted', sync.status === 200, `status ${sync.status}`);
ok('four deals become two closed trades', sync.json?.inserted === 2, String(sync.json?.inserted));
ok('the cursor advances to the last ticket', sync.json?.cursor === 900004, String(sync.json?.cursor));

const listed = await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie });
const trades = listed.json?.trades || [];
ok('both trades reach the journal', trades.length === 2, String(trades.length));

const gold = trades.find((t) => t.symbol === 'XAUUSD');
const euro = trades.find((t) => t.symbol === 'EURUSD');
ok('a position opened by a buy deal is a Buy', gold?.type === 'Buy', String(gold?.type));
ok('a position opened by a sell deal is a Sell', euro?.type === 'Sell', String(euro?.type));
ok('the long keeps its profit', gold?.profit === 1500, String(gold?.profit));
ok('the short keeps its profit', euro?.profit === 400, String(euro?.profit));
ok('entry price comes from the opening deal', gold?.entryPrice === 2310, String(gold?.entryPrice));
ok('exit price comes from the closing deal', gold?.exitPrice === 2340, String(gold?.exitPrice));
ok('commission is summed across both deals', gold?.commission === -4, String(gold?.commission));
ok('swap is carried over', gold?.swap === -1, String(gold?.swap));
ok('the trade is marked as synced', gold?.isMt5Sync === true, String(gold?.isMt5Sync));

// ── the same deals sent twice must not duplicate ──────────────────────────
const replay = await ea('/api/mt5/ea/sync', accountId, token, { accountId, deals, moneyFlows: [] });
ok('a replayed batch inserts nothing', replay.json?.inserted === 0, String(replay.json?.inserted));
const afterReplay = await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie });
ok('and the journal still holds two trades', (afterReplay.json?.trades || []).length === 2,
  String((afterReplay.json?.trades || []).length));

// ── an open position is not imported until it closes ──────────────────────
const openOnly = await ea('/api/mt5/ea/sync', accountId, token, {
  accountId,
  deals: [{ ticket: 900005, positionId: 800003, time: now - 600, type: 0, entry: 0, symbol: 'GBPUSD', volume: 0.3, price: 1.265, profit: 0, commission: -1, swap: 0 }],
});
ok('an open position is accepted', openOnly.status === 200, `status ${openOnly.status}`);
const stillTwo = await api(`/api/trades?accountId=${accountId}`, { cookie: trader.cookie });
ok('but is not journalled until it closes', (stillTwo.json?.trades || []).length === 2,
  String((stillTwo.json?.trades || []).length));

// ── heartbeat and status ──────────────────────────────────────────────────
const beat = await ea('/api/mt5/ea/heartbeat', accountId, token, {
  accountId, balance: 11900, equity: 11900, tradeCount: 2,
});
ok('the heartbeat is accepted', beat.status === 200, `status ${beat.status}`);

const status = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
ok('the account reads Connected', status.json?.eaStatus === 'Connected', String(status.json?.eaStatus));
ok('and carries a heartbeat time', !!status.json?.lastHeartbeatAt, String(status.json?.lastHeartbeatAt));

// ── nothing gets in without the right credentials ─────────────────────────
const wrongToken = await ea('/api/mt5/ea/heartbeat', accountId, 'ea_not_the_real_token', { accountId });
ok('a wrong token is refused', wrongToken.status === 401, `status ${wrongToken.status}`);
ok('the refusal names the reason', wrongToken.json?.code === 'EA_AUTH_FAILED', String(wrongToken.json?.code));

const stale = await ea('/api/mt5/ea/heartbeat', accountId, token, { accountId },
  { isoOverride: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() });
ok('a stale signature is refused', stale.status === 401, `status ${stale.status}`);

const tamperRes = await fetch(BASE + '/api/mt5/ea/heartbeat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-ea-account-id': accountId,
    'x-ea-timestamp': new Date().toISOString(),
    'x-ea-signature': 'f'.repeat(64),
  },
  body: JSON.stringify({ accountId, balance: 1 }),
});
ok('a forged signature is refused', tamperRes.status === 401, `status ${tamperRes.status}`);

// Another customer must not be able to drive this account with their session.
const stranger = await signInOrRegister(BASE, `mt5_other_${stamp}@example.com`, PASSWORD);
const steal = await api(`/api/mt5/ea/${accountId}/download`, { cookie: stranger.cookie });
ok('another user cannot download this EA', steal.status === 403 || steal.status === 404,
  `status ${steal.status}`);

// ── cloud sync refuses rather than parking at Validating ──────────────────
// It answered 200 and left the account at "Validating" forever, while the UI
// offered it as the easier of the two methods. Unless a deployment can really
// run the worker, saying no is the only honest answer.
const cloudEnabled = process.env.MT5_CLOUD_SYNC_ENABLED === 'true';
const cloudConnect = await api('/api/mt5/cloud/connect', {
  method: 'POST', cookie: trader.cookie,
  body: { accountId, login: '5001234', server: 'MetaQuotes-Demo', investorPassword: 'probe-investor-pw' },
});
if (cloudEnabled) {
  ok('cloud connect is accepted where the worker runs', cloudConnect.status === 200,
    `status ${cloudConnect.status}`);
} else {
  ok('cloud connect is refused where no worker runs', cloudConnect.status === 503,
    `status ${cloudConnect.status}`);
  ok('the refusal names the reason', cloudConnect.json?.code === 'CLOUD_WORKER_UNAVAILABLE',
    String(cloudConnect.json?.code));
  ok('and points at the EA instead', /Expert Advisor/i.test(cloudConnect.json?.error || ''),
    String(cloudConnect.json?.error));

  const afterRefusal = await api(`/api/mt5/${accountId}/status`, { cookie: trader.cookie });
  ok('the refused connect left the account on EA', afterRefusal.json?.syncMethod === 'EA',
    String(afterRefusal.json?.syncMethod));
  ok('and the EA connection still stands', afterRefusal.json?.eaStatus === 'Connected',
    String(afterRefusal.json?.eaStatus));
  ok('the UI is told cloud is unavailable', afterRefusal.json?.cloudSyncAvailable === false,
    String(afterRefusal.json?.cloudSyncAvailable));
}

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
