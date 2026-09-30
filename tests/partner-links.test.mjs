// Guards a partner's referral links surviving the round trip.
//
// A partner created a custom referral link, signed out, signed back in, and
// the Partner Portal showed only the primary default again. The link was
// never lost — users.preferences is a JSONB column, and the camelCase-to-
// snake_case converter that renames a row's COLUMNS was recursing into its
// VALUE. On the next login saveDatabase upserted the row through toSnake and
// `partnerLinks` became `partner_links`, `isActive` became `is_active`. Every
// reader looks for the camelCase key, so the links read as an empty list.
//
// Everything the app keeps in preferences was exposed to this: referral
// links, the offer price, payout details, payout requests, shared journal
// links and manual balance adjustments.
//
// The mangling only happens on the Supabase upsert path, so the round trip
// below is the part that is checkable here; the corruption itself was
// reproduced and the fix verified against a Supabase project by hand.
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

const EMAIL = `plink_${stamp}@example.com`;
const PASSWORD = 'PartnerLink12345';
let partner = await signInOrRegister(BASE, EMAIL, PASSWORD);
const promote = await api(`/api/admin/users/${partner.user.id}/partner`, {
  method: 'POST', cookie: admin.cookie, body: {},
});
ok('setup: promoted to PARTNER', promote.status === 200, `status ${promote.status}`);

partner = await signInOrRegister(BASE, EMAIL, PASSWORD);
const start = await api('/api/partner/me', { cookie: partner.cookie });
ok('a new partner has a referral code', !!start.json?.referralCode, String(start.json?.referralCode));
ok('and no custom links yet', (start.json?.links || []).length === 0,
  String((start.json?.links || []).length));

// ── a created link comes back with its fields intact ──────────────────────
const created = await api('/api/partner/links', {
  method: 'POST', cookie: partner.cookie, body: { label: 'Diwali Offer', offerPrice: 299 },
});
const code = created.json?.link?.code;
ok('the partner can create a link', created.status === 200 && !!code, `status ${created.status}`);

const afterCreate = await api('/api/partner/me', { cookie: partner.cookie });
const mine = (afterCreate.json?.links || []).find((l) => l.code === code);
ok('it is listed straight away', !!mine, String((afterCreate.json?.links || []).map((l) => l.code)));
ok('the offer price survived', mine?.offerPrice === 299, String(mine?.offerPrice));
ok('the label survived', mine?.label === 'Diwali Offer', String(mine?.label));
ok('it is active', mine?.isActive === true, String(mine?.isActive));
ok('it carries a created date', !!mine?.createdAt, String(mine?.createdAt));

// ── and it is still there after signing out and back in ───────────────────
await api('/api/auth/logout', { method: 'POST', cookie: partner.cookie });
partner = await signInOrRegister(BASE, EMAIL, PASSWORD);
const afterRelogin = await api('/api/partner/me', { cookie: partner.cookie });
const survivor = (afterRelogin.json?.links || []).find((l) => l.code === code);
ok('the link survives sign out and sign in', !!survivor,
  String((afterRelogin.json?.links || []).map((l) => l.code)));
ok('with its price still set', survivor?.offerPrice === 299, String(survivor?.offerPrice));
ok('and still active', survivor?.isActive === true, String(survivor?.isActive));
ok('the referral code is unchanged too', afterRelogin.json?.referralCode === start.json?.referralCode,
  `${start.json?.referralCode} vs ${afterRelogin.json?.referralCode}`);

// ── a second link adds rather than replaces ───────────────────────────────
const second = await api('/api/partner/links', {
  method: 'POST', cookie: partner.cookie, body: { label: 'New Year', offerPrice: 399 },
});
ok('a second link is accepted', second.status === 200, `status ${second.status}`);
const both = await api('/api/partner/me', { cookie: partner.cookie });
ok('both links are kept', (both.json?.links || []).length === 2,
  String((both.json?.links || []).map((l) => l.code)));

// ── the code actually resolves for a student ──────────────────────────────
const lookup = await api(`/api/referral/${code}`);
ok('the created code resolves publicly', lookup.status === 200 && lookup.json?.valid === true,
  `status ${lookup.status}`);
ok('at the price the partner set', lookup.json?.offerPrice === 299 || lookup.json?.finalPrice === 299,
  `${lookup.json?.offerPrice} / ${lookup.json?.finalPrice}`);

// ── revoking removes it ───────────────────────────────────────────────────
const revoke = await api(`/api/partner/links/${survivor.id}`, {
  method: 'DELETE', cookie: partner.cookie,
});
ok('the partner can revoke a link', revoke.status === 200, `status ${revoke.status}`);
const afterRevoke = await api('/api/partner/me', { cookie: partner.cookie });
ok('the revoked link is gone', !(afterRevoke.json?.links || []).some((l) => l.code === code),
  String((afterRevoke.json?.links || []).map((l) => l.code)));
ok('and the other one is untouched', (afterRevoke.json?.links || []).length === 1,
  String((afterRevoke.json?.links || []).length));

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
