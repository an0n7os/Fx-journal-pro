// What happens when many customers use the product at the same time.
//
// Every other suite drives one user at a time, so nothing covered the two
// failures that only appear under load and that a customer would never
// forgive: one person's trades landing in another person's account, and a
// running balance that drifts because concurrent writes overwrote each other.
//
// The balance is the sharpest probe available. It is a running total the
// server maintains itself, so if two concurrent writes read-modify-write the
// same account, the sum comes out wrong and stays wrong.
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASSWORD = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}  ${detail}`); }
  else { failures.push(`${name} (${detail})`); console.log(`FAIL  ${name}  ${detail}`); }
};

async function raw(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

/** A signed-in customer with their own cookie jar. */
async function newCustomer(tag) {
  const email = `conc_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const reg = await raw('/api/auth/register', {
    method: 'POST', body: { name: `Conc ${tag}`, email, password: PASSWORD },
  });
  let cookie = reg.cookie;
  if (reg.json?.devOtp) {
    const v = await raw('/api/auth/verify-otp', {
      method: 'POST', body: { email, otp: reg.json.devOtp }, cookie,
    });
    cookie = v.cookie || cookie;
  }
  if (!cookie) {
    const login = await raw('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    cookie = login.cookie;
  }
  const accounts = await raw('/api/accounts', { cookie });
  const list = accounts.json?.accounts || accounts.json || [];
  return { email, cookie, accountId: list[0]?.id, startBalance: list[0]?.currentBalance ?? 0 };
}

const tradeBody = (accountId, profit) => ({
  accountId,
  date: new Date().toISOString(),
  symbol: 'EURUSD',
  type: 'Buy',
  lotSize: 0.1,
  entryPrice: 1.1,
  exitPrice: 1.2,
  profit,
});

// ── 1. Many customers signing up at once ──────────────────────────────────
const COUNT = 8;
const customers = await Promise.all(
  Array.from({ length: COUNT }, (_, i) => newCustomer(`u${i}`)),
);
check('every concurrent signup got a session', customers.every((c) => !!c.cookie),
  `${customers.filter((c) => c.cookie).length}/${COUNT}`);
check('every concurrent signup got its own account', customers.every((c) => !!c.accountId),
  `${customers.filter((c) => c.accountId).length}/${COUNT}`);
const ids = new Set(customers.map((c) => c.accountId).filter(Boolean));
check('no two customers share an account id', ids.size === customers.filter((c) => c.accountId).length,
  `${ids.size} unique of ${customers.length}`);

// ── 2. Concurrent writes to ONE account must not lose updates ─────────────
const solo = customers[0];
const PER = 10;
const before = solo.startBalance;
// Distinct profits on purpose. The route rejects an identical trade on the
// same account within two seconds — a real double-click guard — so sending ten
// copies of one trade would only prove that guard works. Ten different trades
// arriving together is the case that would expose a lost update.
const amounts = Array.from({ length: PER }, (_, i) => 10 + i);
const expectedTotal = amounts.reduce((a, b) => a + b, 0);
const writes = await Promise.all(
  amounts.map((profit) => raw('/api/trades', {
    method: 'POST', cookie: solo.cookie, body: tradeBody(solo.accountId, profit),
  })),
);
const accepted = writes.filter((w) => w.status === 200).length;
const acceptedTotal = amounts.filter((_, i) => writes[i].status === 200).reduce((a, b) => a + b, 0);
const after = await raw('/api/accounts', { cookie: solo.cookie });
const balance = ((after.json?.accounts || after.json || [])[0] || {}).currentBalance;
check('every concurrent trade was accepted', accepted === PER,
  `${accepted}/${PER} returned 200` + (accepted < PER ? ` — first refusal: ${writes.find((w) => w.status !== 200)?.json?.error}` : ''));
check('no update was lost: balance is the exact sum', balance === before + acceptedTotal,
  `expected ${before + acceptedTotal}, got ${balance}` + (accepted === PER ? ` (total ${expectedTotal})` : ''));
const trades = await raw(`/api/trades?accountId=${solo.accountId}`, { cookie: solo.cookie });
const tradeList = trades.json?.trades || trades.json || [];
check('every accepted trade was stored', tradeList.length === accepted,
  `${tradeList.length} stored for ${accepted} accepted`);

// ── 3. Simultaneous writes by DIFFERENT customers stay separate ───────────
const others = customers.slice(1);
await Promise.all(others.map((c, i) =>
  raw('/api/trades', { method: 'POST', cookie: c.cookie, body: tradeBody(c.accountId, (i + 1) * 11) }),
));
const checks = await Promise.all(others.map((c) => raw('/api/accounts', { cookie: c.cookie })));
let balancesRight = 0;
let leaked = 0;
for (let i = 0; i < others.length; i++) {
  const list = checks[i].json?.accounts || checks[i].json || [];
  if (list.length !== 1) leaked++;
  const bal = (list[0] || {}).currentBalance;
  if (bal === others[i].startBalance + (i + 1) * 11) balancesRight++;
}
check('each customer sees only their own account', leaked === 0, `${leaked} saw someone else's`);
check('each balance moved by that customer\'s own trade', balancesRight === others.length,
  `${balancesRight}/${others.length}`);

// ── 4. No customer can read another's trades ──────────────────────────────
const victim = customers[0];
const attacker = customers[1];
const cross = await raw(`/api/trades?accountId=${victim.accountId}`, { cookie: attacker.cookie });
const crossList = cross.json?.trades || cross.json || [];
check('another customer\'s trades are not readable', crossList.length === 0,
  `${crossList.length} rows returned`);
const crossWrite = await raw('/api/trades', {
  method: 'POST', cookie: attacker.cookie, body: tradeBody(victim.accountId, 999),
});
check('another customer\'s account cannot be written to',
  crossWrite.status === 403 || crossWrite.status === 404,
  `status ${crossWrite.status}`);

const victimAfter = await raw('/api/accounts', { cookie: victim.cookie });
const victimBal = ((victimAfter.json?.accounts || victimAfter.json || [])[0] || {}).currentBalance;
check('the refused write left the victim balance untouched', victimBal === balance,
  `${victimBal} vs ${balance}`);

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('FAILING:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
