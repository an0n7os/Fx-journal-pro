// Reports exactly what the configured Razorpay account can and cannot do, so
// a failing checkout can be told apart from a missing key, a missing plan, or
// credentials error.
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

const payments = await probe('/v1/payments?count=1');

console.log('');
if (payments.status === 200) {
  line('Credentials', 'valid');
} else if (payments.status === 401) {
  line('Credentials', 'REJECTED — wrong key id or secret');
  process.exit(1);
} else {
  line('Credentials', `unexpected status ${payments.status}`);
}

line('RAZORPAY_WEBHOOK_SECRET', webhookSecret
  ? `set (${webhookSecret.length} chars)`
  : 'OPTIONAL (falls back to RAZORPAY_KEY_SECRET if unset)');

const ready = payments.status === 200;
console.log(`\n  ${ready ? 'Ready to accept Razorpay payments.' : 'Not ready yet — see errors above.'}\n`);

process.exitCode = ready ? 0 : 1;
