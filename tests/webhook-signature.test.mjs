// Proves the webhook HMAC actually works: a correctly-signed payload is
// accepted, a tampered one is not. Runs against a server started with a known
// RAZORPAY_WEBHOOK_SECRET.
import crypto from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://localhost:3101';
const SECRET = 'test-webhook-secret-value';

const payload = JSON.stringify({
  event: 'subscription.charged',
  payload: { subscription: { entity: { id: 'sub_does_not_exist', current_end: Math.floor(Date.now() / 1000) + 2592000 } } },
});

const post = (sig) =>
  fetch(BASE + '/api/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(sig ? { 'x-razorpay-signature': sig } : {}) },
    body: payload,
  });

const good = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
const bad = crypto.createHmac('sha256', 'not-the-secret').update(payload).digest('hex');

const results = [];
results.push(['correct signature accepted', (await post(good)).status === 200]);
results.push(['wrong signature rejected', (await post(bad)).status === 400]);
results.push(['missing signature rejected', (await post(null)).status === 400]);

// Tampering with the body after signing must invalidate it.
const tampered = payload.replace('sub_does_not_exist', 'sub_attacker_owned');
const tamperRes = await fetch(BASE + '/api/payments/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': good },
  body: tampered,
});
results.push(['tampered body rejected', tamperRes.status === 400]);

for (const [name, pass] of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
const failed = results.filter(([, p]) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
