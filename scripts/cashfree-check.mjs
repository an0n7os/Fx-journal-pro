// Reports exactly what the configured Cashfree account can and cannot do, so
// a failing checkout can be told apart from a missing key, keys from the wrong
// environment, and an account that has not been activated.
//
//   npm run cashfree:check
//
// It creates one ₹1 order to prove the credentials can actually mint a payment
// session — nothing is charged, nobody is sent to a payment page, and the
// order expires on its own. Everything else is read-only.
import 'dotenv/config';

const appId = process.env.CASHFREE_APP_ID?.trim();
const secretKey = process.env.CASHFREE_SECRET_KEY?.trim();
const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET?.trim();
const env = process.env.CASHFREE_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
const apiVersion = process.env.CASHFREE_API_VERSION?.trim() || '2026-01-01';
const BASE = env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);

console.log('\nCashfree configuration\n');

if (!appId || !secretKey) {
  line('Keys', 'MISSING — set CASHFREE_APP_ID and CASHFREE_SECRET_KEY');
  process.exit(1);
}

line('App id', appId);
line('Environment', env === 'production' ? 'PRODUCTION — real money' : 'sandbox');
line('API base', BASE);
line('API version', apiVersion);
line('Secret', `set (${secretKey.length} chars)`);

const headers = {
  'Content-Type': 'application/json',
  'x-api-version': apiVersion,
  'x-client-id': appId,
  'x-client-secret': secretKey,
};

const call = async (path, init = {}) => {
  try {
    const res = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (err) {
    return { status: 0, body: { message: String(err) } };
  }
};

// Cashfree has no "ping": the cheapest real proof that the keys work is to
// create a tiny order and read back the payment_session_id that checkout needs.
const probeOrderId = `fxjcheck_${Date.now().toString(36)}`;
const created = await call('/orders', {
  method: 'POST',
  body: JSON.stringify({
    order_id: probeOrderId,
    order_amount: 1,
    order_currency: 'INR',
    customer_details: {
      customer_id: 'fxjp_config_check',
      customer_phone: '9999999999',
      customer_email: 'config-check@example.invalid',
    },
    order_note: 'FX Journal Pro configuration check — never paid',
    // Expires as soon as Cashfree allows, so the probe does not sit in the
    // merchant's order list looking like an abandoned sale.
    order_expiry_time: new Date(Date.now() + 16 * 60 * 1000).toISOString(),
  }),
});

console.log('');
if (created.status === 200 && created.body?.payment_session_id) {
  line('Credentials', 'valid');
  line('Checkout session', 'minted OK');
} else if (created.status === 401 || created.status === 403) {
  line('Credentials', `REJECTED (${created.status}) — ${created.body?.message || 'wrong app id or secret, or wrong CASHFREE_ENV'}`);
  console.log('\n  Sandbox and production keys are not interchangeable. Check CASHFREE_ENV.\n');
  process.exit(1);
} else {
  line('Credentials', `unexpected status ${created.status} — ${created.body?.message || ''}`);
}

if (created.status === 200) {
  const fetched = await call(`/orders/${encodeURIComponent(probeOrderId)}`);
  line('Order lookup', fetched.status === 200
    ? `works (status ${fetched.body?.order_status})`
    : `FAILED (${fetched.status}) — /verify cannot confirm payments without it`);

  const payments = await call(`/orders/${encodeURIComponent(probeOrderId)}/payments`);
  line('Payments lookup', payments.status === 200
    ? 'works'
    : `FAILED (${payments.status}) — /verify cannot confirm payments without it`);
}

line('Webhook secret', webhookSecret
  ? `set separately (${webhookSecret.length} chars)`
  : 'using CASHFREE_SECRET_KEY (the Cashfree default)');

const ready = created.status === 200 && !!created.body?.payment_session_id;
console.log(`\n  ${ready ? 'Ready to take payments.' : 'Not ready yet — see the lines marked above.'}`);
console.log(`  Set the webhook to  POST  https://<your-domain>/api/payments/webhook`);
console.log(`  and subscribe to PAYMENT_SUCCESS_WEBHOOK, or nobody is ever upgraded.\n`);

process.exit(ready ? 0 : 1);
