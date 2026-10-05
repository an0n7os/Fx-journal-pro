// One payment must buy exactly one period of Pro.
//
// The grant hangs off the provider's payment id, and nothing else: Razorpay
// retries a webhook until it gets a 2xx, and a retry carries the identical
// payment id. Without a claim on that id, every redelivery would add
// another 30 days — pay ₹499 once, let Razorpay retry twenty-four times, hold
// Pro for two years.
//
// Needs RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET to match the running
// server's, so the test can sign a webhook it will accept.
import crypto from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || process.env.RAZORPAY_KEY_SECRET?.trim();
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

const me0 = await api('/api/auth/me');
const userId = me0.body?.user?.id;
check('setup: has a user id', !!userId, String(userId));
check('setup: starts on Free', me0.body?.user?.isPro !== true, `isPro ${me0.body?.user?.isPro}`);

// One successful payment, as Razorpay reports it.
const orderId = `order_replay_${Date.now().toString(36)}`;
const paymentId = `pay_replay_${Date.now()}`;
const event = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: paymentId,
        amount: 49900,
        currency: 'INR',
        notes: { userId, periodDays: '30' },
      },
    },
    order: {
      entity: {
        id: orderId,
        amount: 49900,
        currency: 'INR',
        notes: { userId, periodDays: '30' },
      },
    },
  },
});

const deliver = async (body = event) => {
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(BASE + '/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
    },
    body,
  });
  await new Promise((r) => setTimeout(r, 400));
  return res.status;
};

const firstStatus = await deliver();
check('first delivery is accepted', firstStatus === 200, `status ${firstStatus}`);

const afterFirst = await api('/api/auth/me');
check('first delivery grants Pro', afterFirst.body?.user?.isPro === true,
  `isPro ${afterFirst.body?.user?.isPro}`);
const firstUntil = afterFirst.body?.user?.proUntil ? new Date(afterFirst.body.user.proUntil).getTime() : 0;
check('first delivery sets an expiry', firstUntil > Date.now(), String(afterFirst.body?.user?.proUntil));

// Redeliver identical event four more times.
let lastUntil = firstUntil;
let extended = false;
for (let i = 0; i < 4; i++) {
  const status = await deliver();
  const again = await api('/api/auth/me');
  const until = again.body?.user?.proUntil ? new Date(again.body.user.proUntil).getTime() : lastUntil;
  if (until > lastUntil + 1000) extended = true;
  lastUntil = until;
  check(`redelivery ${i + 1} is acknowledged but credits nothing`,
    status === 200 && until <= firstUntil + 1000,
    `until ${new Date(until).toISOString()}`);
}

check('four redeliveries did not extend Pro at all', !extended,
  `first ${new Date(firstUntil).toISOString()} last ${new Date(lastUntil).toISOString()}`);

const days = Math.round((lastUntil - Date.now()) / 86400000);
check('Pro is still one 30-day period', days <= 31, `${days} days`);

// /verify with invalid data is refused
const emptyVerify = await api('/api/payments/verify', { method: 'POST', body: JSON.stringify({}) });
check('verify with no payment id is refused', emptyVerify.status === 400, `status ${emptyVerify.status}`);

const forged = await api('/api/payments/verify', {
  method: 'POST',
  body: JSON.stringify({
    razorpay_order_id: 'order_fake',
    razorpay_payment_id: 'pay_fake',
    razorpay_signature: 'invalid_signature_hex'
  }),
});
check('verify with an invalid signature is refused', forged.status === 400, `status ${forged.status}`);

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('FAILING:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
