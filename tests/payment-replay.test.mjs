// One payment must buy exactly one period of Pro.
//
// The grant hangs off the provider's payment id, and nothing else: Cashfree
// retries a webhook until it gets a 2xx, and a retry carries the identical
// cf_payment_id. Without a claim on that id, every redelivery would add
// another 30 days — pay ₹499 once, let Cashfree retry twenty-four times, hold
// Pro for two years.
//
// The browser callback cannot be exercised here by design: /api/payments/verify
// no longer believes anything the client says, it asks Cashfree whether the
// order was paid. The webhook is the path that CAN be signed offline, and it is
// the one that actually grants Pro, so it is the one tested.
//
// Needs CASHFREE_SECRET_KEY to match the running server's, so the test can
// sign a webhook it will accept. Skips without it rather than passing
// vacuously.
import crypto from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const SECRET = process.env.CASHFREE_WEBHOOK_SECRET?.trim() || process.env.CASHFREE_SECRET_KEY?.trim();
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
  console.log('SKIPPED: set CASHFREE_SECRET_KEY to run the payment replay suite.');
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

// One successful payment, as Cashfree reports it.
const orderId = `fxj_replay_${Date.now().toString(36)}`;
const cfPaymentId = `cfpay_replay_${Date.now()}`;
const event = JSON.stringify({
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  event_time: new Date().toISOString(),
  data: {
    order: {
      order_id: orderId,
      order_amount: 499,
      order_currency: 'INR',
      order_tags: { user_id: userId, plan: 'pro', period_days: '30' },
    },
    payment: {
      cf_payment_id: cfPaymentId,
      payment_status: 'SUCCESS',
      payment_amount: 499,
      payment_currency: 'INR',
      payment_group: 'upi',
    },
    customer_details: { customer_email: email },
  },
});

const deliver = async (body = event) => {
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', SECRET).update(`${timestamp}${body}`, 'utf8').digest('base64');
  const res = await fetch(BASE + '/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body,
  });
  // The handler acknowledges before it grants, so give the grant a moment to
  // land before reading the account back.
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

// Cashfree redelivers the identical event four more times.
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

// A different payment id on the same order is a different payment and may
// credit again — but a success event whose payment is NOT successful must not.
const notSuccess = JSON.stringify({
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  data: {
    order: { order_id: orderId, order_amount: 499, order_tags: { user_id: userId, period_days: '30' } },
    payment: { cf_payment_id: `${cfPaymentId}_failed`, payment_status: 'FAILED', payment_amount: 499 },
  },
});
await deliver(notSuccess);
const afterFailed = await api('/api/auth/me');
const failedUntil = afterFailed.body?.user?.proUntil ? new Date(afterFailed.body.user.proUntil).getTime() : 0;
check('a non-SUCCESS payment credits nothing', failedUntil <= lastUntil + 1000,
  `until ${new Date(failedUntil).toISOString()}`);

// And /verify must not be a way in on its own: no order id, no grant.
const emptyVerify = await api('/api/payments/verify', { method: 'POST', body: JSON.stringify({}) });
check('verify with no order id is refused', emptyVerify.status === 400, `status ${emptyVerify.status}`);

const forged = await api('/api/payments/verify', {
  method: 'POST',
  body: JSON.stringify({ orderId: 'fxj_not_a_real_order' }),
});
check('verify with an invented order id never grants Pro', forged.status !== 200 || forged.body?.success !== true,
  `status ${forged.status}`);

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('FAILING:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
