// Guards the manual balance adjustment an admin can apply to a partner.
//
// Referral income is derived from captured payments, so before this the only
// way to move a partner's balance was to insert a customer and a payment that
// never happened. This suite holds the replacement to the rules that make it
// safe to keep: super admin only, partners only, reasoned, bounded, signed,
// and reflected identically on the partner's own screen and the admin roster.
//
// Runs against the dev server on :3000.
import { signInOrRegister } from './auth-helper.mjs';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const stamp = Date.now();
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const adminEmail = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';

const admin = await signInOrRegister(BASE, adminEmail, adminPassword);
ok('setup: signed in as super admin', !!admin.cookie);

const partner = await signInOrRegister(BASE, `adj_p_${stamp}@example.com`, 'AdjTest12345');
const plain = await signInOrRegister(BASE, `adj_u_${stamp}@example.com`, 'AdjTest12345');
ok('setup: a future partner and a plain user exist', !!partner.cookie && !!plain.cookie);

const promote = await api(`/api/admin/users/${partner.user.id}/partner`, {
  method: 'POST', cookie: admin.cookie, body: {},
});
ok('setup: promoted to PARTNER', promote.status === 200, `status ${promote.status}`);

// The partner has no referrals, so every rupee below comes from adjustments
// alone — which is what makes the arithmetic here unambiguous.
const before = await api('/api/partner/payout', { cookie: partner.cookie });
const baseline = before.json?.earnings?.totalEarned ?? null;
ok('setup: partner starts at zero earned', baseline === 0, String(baseline));

// ── only a super admin can move money ─────────────────────────────────────
const byPlain = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', cookie: plain.cookie, body: { amount: 5000, reason: 'nice try' },
});
ok('a plain user cannot credit a partner', byPlain.status === 403, `status ${byPlain.status}`);

const bySelf = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', cookie: partner.cookie, body: { amount: 5000, reason: 'paying myself' },
});
ok('a partner cannot credit themselves', bySelf.status === 403, `status ${bySelf.status}`);

const anon = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', body: { amount: 5000, reason: 'anonymous' },
});
ok('an anonymous caller cannot credit a partner', anon.status === 403 || anon.status === 401, `status ${anon.status}`);

// ── the input is validated before anything is written ─────────────────────
const bad = [
  [{ amount: 0, reason: 'zero' }, 'zero is refused'],
  [{ amount: 'abc', reason: 'text' }, 'a non-number is refused'],
  [{ amount: Number.POSITIVE_INFINITY, reason: 'infinite' }, 'Infinity is refused'],
  [{ amount: 5000 }, 'a missing reason is refused'],
  [{ amount: 5000, reason: 'x' }, 'a one-character reason is refused'],
  [{ amount: 9_999_999, reason: 'slipped decimal' }, 'an amount over the cap is refused'],
  [{ amount: -9_999_999, reason: 'slipped decimal' }, 'a deduction over the cap is refused'],
];
for (const [body, name] of bad) {
  const r = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
    method: 'POST', cookie: admin.cookie, body,
  });
  ok(name, r.status === 400, `status ${r.status}`);
}

const notAPartner = await api(`/api/admin/partners/${plain.user.id}/adjustment`, {
  method: 'POST', cookie: admin.cookie, body: { amount: 500, reason: 'wrong target' },
});
ok('a non-partner has no balance to credit', notAPartner.status === 400, `status ${notAPartner.status}`);

const missing = await api('/api/admin/partners/user_does_not_exist/adjustment', {
  method: 'POST', cookie: admin.cookie, body: { amount: 500, reason: 'ghost' },
});
ok('an unknown user is 404', missing.status === 404, `status ${missing.status}`);

// Nothing above should have written anything.
const afterRejects = await api('/api/partner/payout', { cookie: partner.cookie });
ok('no refused call moved the balance', afterRejects.json?.earnings?.totalEarned === 0,
  String(afterRejects.json?.earnings?.totalEarned));

// ── a credit lands, and lands once ────────────────────────────────────────
const credit = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', cookie: admin.cookie, body: { amount: 2500, reason: 'Referral settled by UPI outside the gateway' },
});
ok('admin credits the partner', credit.status === 200, `status ${credit.status}`);
ok('the response carries the new total', credit.json?.adjustmentTotal === 2500, String(credit.json?.adjustmentTotal));

const afterCredit = await api('/api/partner/payout', { cookie: partner.cookie });
ok('the partner sees it in total earned', afterCredit.json?.earnings?.totalEarned === 2500,
  String(afterCredit.json?.earnings?.totalEarned));
ok('and in the balance they can withdraw', afterCredit.json?.earnings?.availableBalance === 2500,
  String(afterCredit.json?.earnings?.availableBalance));
ok('the adjustment total is reported separately', afterCredit.json?.earnings?.adjustmentTotal === 2500,
  String(afterCredit.json?.earnings?.adjustmentTotal));
ok('the reason travels with it', afterCredit.json?.adjustments?.[0]?.reason?.includes('outside the gateway'),
  afterCredit.json?.adjustments?.[0]?.reason);
ok('and who applied it', afterCredit.json?.adjustments?.[0]?.createdByEmail === adminEmail,
  String(afterCredit.json?.adjustments?.[0]?.createdByEmail));

// ── a second credit adds rather than replaces ─────────────────────────────
await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', cookie: admin.cookie, body: { amount: 300.5, reason: 'Rounding top-up' },
});
const afterSecond = await api('/api/partner/payout', { cookie: partner.cookie });
ok('a second credit adds to the first', afterSecond.json?.earnings?.totalEarned === 2800.5,
  String(afterSecond.json?.earnings?.totalEarned));
ok('both entries are kept', (afterSecond.json?.adjustments?.length ?? 0) === 2,
  String(afterSecond.json?.adjustments?.length));

// ── a negative entry takes money back ─────────────────────────────────────
const deduct = await api(`/api/admin/partners/${partner.user.id}/adjustment`, {
  method: 'POST', cookie: admin.cookie, body: { amount: -800, reason: 'Credited twice by mistake' },
});
ok('a deduction is accepted', deduct.status === 200, `status ${deduct.status}`);
const afterDeduct = await api('/api/partner/payout', { cookie: partner.cookie });
ok('the balance comes back down', afterDeduct.json?.earnings?.totalEarned === 2000.5,
  String(afterDeduct.json?.earnings?.totalEarned));

// ── the admin roster agrees with the partner's own screen ─────────────────
const roster = await api('/api/admin/partners', { cookie: admin.cookie });
const card = (roster.json?.partners || []).find((p) => p.id === partner.user.id);
ok('the roster lists the partner', !!card, String(roster.status));
ok('the roster reports the same income', card?.referralIncome === 2000.5, String(card?.referralIncome));
ok('and shows how much of it was manual', card?.adjustmentTotal === 2000.5, String(card?.adjustmentTotal));
ok('the roster does not count it as a paid referral', card?.paidReferrals === 0, String(card?.paidReferrals));

// ── the history is readable, and only by an admin ─────────────────────────
const history = await api(`/api/admin/partners/${partner.user.id}/adjustments`, { cookie: admin.cookie });
ok('admin reads the adjustment history', history.status === 200 && history.json?.adjustments?.length === 3,
  `status ${history.status}, ${history.json?.adjustments?.length} entries`);

const historyByPlain = await api(`/api/admin/partners/${partner.user.id}/adjustments`, { cookie: plain.cookie });
ok('a plain user cannot read it', historyByPlain.status === 403, `status ${historyByPlain.status}`);

// ── it is in the audit log ────────────────────────────────────────────────
const audit = await api('/api/admin/audit', { cookie: admin.cookie });
const entries = audit.json?.entries || audit.json?.logs || audit.json || [];
const logged = Array.isArray(entries)
  && entries.some((e) => (e.action || e.Action) === 'partner.balance_adjusted');
ok('the credit is written to the audit log', logged, `audit status ${audit.status}`);

// ── report ────────────────────────────────────────────────────────────────
console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const passed = out.filter((r) => r.p).length;
console.log(`\n${passed}/${out.length} passed`);
if (passed !== out.length) {
  console.log('FAILING:');
  for (const r of out.filter((x) => !x.p)) console.log(` - ${r.n} (${r.d})`);
  process.exit(1);
}
