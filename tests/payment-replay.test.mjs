// One payment must buy exactly one period of Pro.
//
// /api/payments/verify checks Razorpay's HMAC and then extends Pro from the
// current expiry. The signature stays valid for as long as the order exists,
// so without a claim on the payment id the same confirmation could be replayed
// for another 30 days each time: pay once, resend twenty-four times, hold Pro
// for two years.
//
// Needs RAZORPAY_KEY_SECRET so the test can produce a signature the server
// accepts. Skips without it rather than passing vacuously.
import crypto from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const SECRET = process.env.RAZORPAY_KEY_SECRET?.trim();
const PASSWORD = process.env.DEV_ADMIN_PASSWORD || 'Demo@12345';

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}  ${detail}`);
  } else {
    failures.push(`${name} (${detail})`);
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

if (!SECRET) {
  console.log('SKIPPED: set RAZORPAY_KEY_SECRET to run the payment replay suite.');
  process.exit(0);
}

const jar = { cookie: '' };
async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(jar.cookie ? { Cookie: jar.cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  let body = null;
  try { body = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body };
}

const email = `replay_${Date.now()}@example.invalid`;
const reg = await api('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Replay Probe', email, password: PASSWORD }),
});
check('setup: registered', reg.status === 200, `status ${reg.status}`);
if (reg.body?.devOtp) {
  const v = await api('/api/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp: reg.body.devOtp }),
  });
  check('setup: verified', v.status === 200, `status ${v.status}`);
} else {
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) });
}

// A confirmation Razorpay would have signed.
const orderId = `order_replay_${Date.now()}`;
const paymentId = `pay_replay_${Date.now()}`;
const signature = crypto
  .createHmac('sha256', SECRET)
  .update(`${orderId}|${paymentId}`)
  .digest('hex');
const confirmation = {
  razorpay_order_id: orderId,
  razorpay_payment_id: paymentId,
  razorpay_signature: signature,
};

const first = await api('/api/payments/verify', { method: 'POST', body: JSON.stringify(confirmation) });
check('first verify grants Pro', first.status === 200 && first.body?.active === true,
  `status ${first.status} active ${first.body?.active}`);
const firstUntil = first.body?.proUntil ? new Date(first.body.proUntil).getTime() : 0;
check('first verify returns an expiry', firstUntil > Date.now(), String(first.body?.proUntil));

// Replay the identical confirmation four more times.
let lastUntil = firstUntil;
let extended = false;
for (let i = 0; i < 4; i++) {
  const again = await api('/api/payments/verify', { method: 'POST', body: JSON.stringify(confirmation) });
  const until = again.body?.proUntil ? new Date(again.body.proUntil).getTime() : lastUntil;
  if (until > lastUntil + 1000) extended = true;
  lastUntil = until;
  check(`replay ${i + 1} is refused as already applied`,
    again.status === 200 && again.body?.alreadyApplied === true,
    `alreadyApplied ${again.body?.alreadyApplied}`);
}

check('four replays did not extend Pro at all', !extended,
  `first ${new Date(firstUntil).toISOString()} last ${new Date(lastUntil).toISOString()}`);

const days = Math.round((lastUntil - Date.now()) / 86400000);
check('Pro is still one 30-day period', days <= 31, `${days} days`);

// A tampered signature must still be refused.
const bad = await api('/api/payments/verify', {
  method: 'POST',
  body: JSON.stringify({ ...confirmation, razorpay_payment_id: `${paymentId}_x`, }),
});
check('a payment id the signature does not cover is refused', bad.status === 400, `status ${bad.status}`);

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('FAILING:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
