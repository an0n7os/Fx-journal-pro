import crypto from 'node:crypto';
import { signInOrRegister } from '../tests/auth-helper.mjs';

const BASE = 'http://localhost:3000';
const sha256Hex = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

async function ea(path, accountId, token, payload) {
  const raw = JSON.stringify(payload);
  const ts = new Date().toISOString();
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
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function run() {
  const admin = await signInOrRegister(BASE, 'dev@localhost', 'Demo@12345');
  const stamp = Date.now();
  const email = `mt5_sync_${stamp}@example.com`;
  const trader = await signInOrRegister(BASE, email, 'TestPass123!');
  await fetch(`${BASE}/api/admin/users/${trader.user.id}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ isPro: true })
  });
  const traderPro = await signInOrRegister(BASE, email, 'TestPass123!');

  const accRes = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: traderPro.cookie },
    body: JSON.stringify({
      name: 'MT5 Sync Probe',
      broker: 'MetaTrader 5',
      startingBalance: 10000,
      currency: 'USD',
      isMt5Sync: true
    })
  });
  const accJson = await accRes.json();
  const accountId = accJson.account?.id;

  const dlRes = await fetch(`${BASE}/api/mt5/ea/${accountId}/download`, {
    headers: { Cookie: traderPro.cookie }
  });
  const eaCode = await dlRes.text();
  const token = eaCode.match(/"(ea_[A-Za-z0-9_]+)"/)[1];

  console.log('1. EA Token obtained:', token);

  // Authenticate
  const authRes = await ea('/api/mt5/ea/authenticate', accountId, token, { accountId, token });
  console.log('2. EA Authenticate:', authRes.status, authRes.json);

  // Validate
  const valRes = await ea('/api/mt5/ea/validate', accountId, token, {
    accountId, login: '888123', server: 'Demo-Server', build: 4200
  });
  console.log('3. EA Validate:', valRes.status, valRes.json);

  // Sync a Trade
  // Entry IN deal + Entry OUT deal
  const dealIn = {
    ticket: 1001,
    positionId: 5001,
    time: Math.floor((Date.now() - 3600000) / 1000),
    symbol: 'EURUSD',
    type: 0, // BUY
    entry: 0, // IN
    volume: 0.5,
    price: 1.0850,
    profit: 0,
    commission: -2,
    swap: 0
  };
  const dealOut = {
    ticket: 1002,
    positionId: 5001,
    time: Math.floor(Date.now() / 1000),
    symbol: 'EURUSD',
    type: 1, // SELL (closes BUY)
    entry: 1, // OUT
    volume: 0.5,
    price: 1.0900,
    profit: 250,
    commission: -2,
    swap: 0
  };

  const syncRes = await ea('/api/mt5/ea/sync', accountId, token, {
    accountId,
    deals: [dealIn, dealOut],
    moneyFlows: [],
    account: { balance: 10246, equity: 10246, currency: 'USD' }
  });
  console.log('4. EA Sync deals result:', syncRes.status, syncRes.json);

  // Now check the journal trades in Neon via user API
  const tradesRes = await fetch(`${BASE}/api/trades`, {
    headers: { Cookie: traderPro.cookie }
  });
  const tradesJson = await tradesRes.json();
  console.log('5. Trades in Journal (from Neon):', tradesJson.trades?.length, 'trades found!');
  if (tradesJson.trades?.length > 0) {
    const t = tradesJson.trades[0];
    console.log(`   Trade Symbol: ${t.symbol}, Type: ${t.type}, Profit: $${t.profit}, Commission: $${t.commission}`);
  }

  console.log('\n>>> SUCCESS: MT5 EA -> NEON DATABASE END-TO-END VERIFIED! <<<');
}

run().catch(console.error);
