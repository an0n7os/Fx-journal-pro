// Reports exactly what the configured Razorpay account can and cannot do, so
// a failing checkout can be told apart from a missing key, a missing plan and
// a product that was never enabled on the account.
//
//   npm run razorpay:check
//
// Read-only: it lists, it never creates anything.
import 'dotenv/config';

const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
const planId = process.env.RAZORPAY_PLAN_ID?.trim();
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

console.log('\nRazorpay configuration\n');

if (!keyId || !keySecret) {
  line('Keys', 'MISSING — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  process.exit(1);
}

line('Key id', keyId);
line('Mode', keyId.startsWith('rzp_live_') ? 'LIVE — real money' : 'test');
line('Secret', `set (${keySecret.length} chars)`);

const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
const probe = async (path) => {
  try {
    const res = await fetch('https://api.razorpay.com' + path, { headers: { Authorization: auth } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, body: { error: String(err) } };
  }
};

// /v1/payments answers for any valid key. The subscription endpoints answer
// 401 when the Subscriptions product is not enabled on the account, which
// looks identical to a bad secret unless both are checked.
const payments = await probe('/v1/payments?count=1');
const plans = await probe('/v1/plans?count=100');
const subscriptions = await probe('/v1/subscriptions?count=1');

console.log('');
if (payments.status === 200) {
  line('Credentials', 'valid');
} else if (payments.status === 401) {
  line('Credentials', 'REJECTED — wrong key id or secret');
  process.exit(1);
} else {
  line('Credentials', `unexpected status ${payments.status}`);
}

const subsEnabled = plans.status === 200 && subscriptions.status === 200;
line('Subscriptions product', subsEnabled
  ? 'enabled'
  : 'NOT ENABLED on this account — enable it in the dashboard');

if (subsEnabled) {
  const items = plans.body.items || [];
  line('Plans on account', String(items.length));
  for (const p of items) {
    const amount = (p.item?.amount ?? 0) / 100;
    const mark = p.id === planId ? ' <- RAZORPAY_PLAN_ID' : '';
    console.log(`    ${p.id}  ${amount} ${p.item?.currency}  every ${p.interval} ${p.period}${mark}`);
  }
  if (!planId) {
    line('RAZORPAY_PLAN_ID', 'MISSING — subscribe answers 503 until it is set');
  } else if (!items.some((p) => p.id === planId)) {
    line('RAZORPAY_PLAN_ID', `${planId} is not a plan on this account`);
  }
}

line('RAZORPAY_WEBHOOK_SECRET', webhookSecret
  ? `set (${webhookSecret.length} chars)`
  : 'MISSING — every webhook is rejected, so no plan ever activates');

const ready = payments.status === 200 && subsEnabled && !!planId && !!webhookSecret;
console.log(`\n  ${ready ? 'Ready to take subscriptions.' : 'Not ready yet — see the lines marked above.'}\n`);

if (!subsEnabled) {
  console.log(`  To enable Subscriptions:
    Razorpay Dashboard > Subscriptions. Activate the product (test mode too).
    Then: Subscriptions > Plans > New Plan, amount 399, period Monthly.
    Put the plan_xxxxxxxx id in RAZORPAY_PLAN_ID and run this again.\n`);
}

process.exit(ready ? 0 : 1);
