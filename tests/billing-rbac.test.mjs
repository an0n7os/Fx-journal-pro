// Guards the two things that must not be wrong here:
//   1. a support sub-admin cannot reach user management or billing
//   2. an unsigned or wrongly-signed webhook cannot grant Pro
import crypto from 'node:crypto';
import { signInOrRegister } from './auth-helper.mjs';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie, headers = {}, rawBody } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(rawBody !== undefined ? { body: rawBody } : body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function signIn(email) {
  const r = await signInOrRegister(BASE, email, 'RbacTest12345');
  return r.cookie;
}

const userCookie = await signIn(`rbac_${Date.now()}@example.com`);
ok('setup: signed in', !!userCookie);

// --- a plain user is not an admin ----------------------------------------
const check = await api('/api/admin/check', { cookie: userCookie });
ok('plain user: isAdmin false', check.json?.isAdmin === false, `role ${check.json?.role}`);
ok('plain user: no permissions', (check.json?.permissions?.length ?? 0) === 0);

const adminRoutes = [
  ['/api/admin/users', 'GET'],
  ['/api/admin/dashboard', 'GET'],
  ['/api/admin/team', 'GET'],
  ['/api/admin/audit', 'GET'],
  ['/api/admin/billing', 'GET'],
  ['/api/admin/bugs', 'GET'],
];
let refused = 0;
for (const [path] of adminRoutes) {
  const r = await api(path, { cookie: userCookie });
  if (r.status === 403) refused++;
}
ok('plain user: every admin route refuses', refused === adminRoutes.length,
  `${refused}/${adminRoutes.length} returned 403`);

const roleGrab = await api('/api/admin/team/role', {
  method: 'POST', cookie: userCookie, body: { email: 'someone@example.com', role: 'SUPER_ADMIN' },
});
ok('plain user: cannot grant themselves a role', roleGrab.status === 403, `status ${roleGrab.status}`);

// --- unauthenticated ------------------------------------------------------
const anonAudit = await api('/api/admin/audit');
ok('anonymous: audit log refused', anonAudit.status === 403 || anonAudit.status === 401,
  `status ${anonAudit.status}`);

// --- webhook signature ----------------------------------------------------
// Razorpay signs rawBody with the merchant secret, hex. An
// event this account never issued must not be able to buy Pro for anyone.
const fakeEvent = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_fake',
        amount: 49900,
        notes: { userId: 'nobody' },
      },
    },
  },
});

const noSig = await api('/api/payments/webhook', { method: 'POST', rawBody: fakeEvent });
ok('webhook: unsigned rejected', noSig.status !== 200, `status ${noSig.status}`);

const badSig = await api('/api/payments/webhook', {
  method: 'POST', rawBody: fakeEvent,
  headers: {
    'x-razorpay-signature': crypto.createHmac('sha256', 'wrong-secret').update(fakeEvent).digest('hex'),
  },
});
ok('webhook: wrongly-signed rejected', badSig.status !== 200, `status ${badSig.status}`);

// --- paid routes fail closed ---------------------------------------------
// Pro is sold as a 30-day order, so there is no recurring plan to start. The
// route says so instead of pretending, and either way it never grants Pro.
const subscribe = await api('/api/payments/subscribe', { method: 'POST', cookie: userCookie });
ok('subscribe: reports that recurring billing is off', subscribe.status === 503,
  `status ${subscribe.status} — must never grant Pro`);
ok('subscribe: does not report the user as Pro', subscribe.json?.isPro !== true);

const verifyEmpty = await api('/api/payments/verify', { method: 'POST', cookie: userCookie, body: {} });
ok('verify: empty body never grants Pro', verifyEmpty.status !== 200, `status ${verifyEmpty.status}`);

// --- the three shortcuts that used to hand out Pro for free ---------------
// Each was a single POST away for any logged-in account.
const sandboxVerify = await api('/api/payments/verify', {
  method: 'POST', cookie: userCookie, body: { isSandbox: true },
});
ok('verify: isSandbox does not grant Pro', sandboxVerify.status !== 200, `status ${sandboxVerify.status}`);

const testTier = await api('/api/payments/toggle-test-tier', {
  method: 'POST', cookie: userCookie, body: { tier: 'pro' },
});
ok('toggle-test-tier: unavailable', testTier.status !== 200, `status ${testTier.status}`);

// The self-serve "type a UTR" upgrade is gone entirely: Razorpay handles UPI,
// and offline payments are activated by an admin from Billing & Payments.
const manual = await api('/api/payments/submit-manual', {
  method: 'POST', cookie: userCookie, body: { utr: '999988887777' },
});
ok('submit-manual: route removed', manual.status === 404, `status ${manual.status}`);

const me = await api('/api/auth/me', { cookie: userCookie });
ok('user did not become Pro during any of this', me.json?.user?.isPro !== true,
  `isPro ${me.json?.user?.isPro}`);

const config = await api('/api/payments/config');
ok('payments config readable', config.status === 200, `configured ${config.json?.configured}`);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
process.exit(failed.length ? 1 : 0);
