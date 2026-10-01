// Proves the Cashfree webhook HMAC actually works: a correctly-signed payload
// is accepted, a tampered one is not.
//
// Cashfree signs `timestamp + rawBody` with the merchant secret and sends the
// result base64-encoded, so both headers are needed to reproduce it. Runs
// against a server started with a known CASHFREE_SECRET_KEY.
import crypto from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://localhost:3101';
const SECRET = 'test-webhook-secret-value';

const payload = JSON.stringify({
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  data: {
    order: { order_id: 'fxj_does_not_exist', order_amount: 499, order_tags: { user_id: 'nobody' } },
    payment: { cf_payment_id: 'cfpay_probe', payment_status: 'SUCCESS', payment_amount: 499 },
  },
});

const sign = (secret, timestamp, body) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}${body}`, 'utf8').digest('base64');

const post = (sig, { timestamp, body = payload } = {}) =>
  fetch(BASE + '/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'x-webhook-signature': sig } : {}),
      ...(timestamp ? { 'x-webhook-timestamp': timestamp } : {}),
    },
    body,
  });

const ts = String(Date.now());
const good = sign(SECRET, ts, payload);
const bad = sign('not-the-secret', ts, payload);

const results = [];
results.push(['correct signature accepted', (await post(good, { timestamp: ts })).status === 200]);
results.push(['wrong signature rejected', (await post(bad, { timestamp: ts })).status === 400]);
results.push(['missing signature rejected', (await post(null, { timestamp: ts })).status === 400]);

// The timestamp is part of the signed string, so a signature without it cannot
// be checked — and must not be let through.
results.push(['missing timestamp rejected', (await post(good)).status === 400]);

// A signature made over a different timestamp must not verify, or the
// timestamp would be decoration.
results.push([
  'signature from another timestamp rejected',
  (await post(good, { timestamp: String(Number(ts) + 1) })).status === 400,
]);

// Tampering with the body after signing must invalidate it.
const tampered = payload.replace('fxj_does_not_exist', 'fxj_attacker_owned');
results.push([
  'tampered body rejected',
  (await post(good, { timestamp: ts, body: tampered })).status === 400,
]);

for (const [name, pass] of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
const failed = results.filter(([, p]) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
