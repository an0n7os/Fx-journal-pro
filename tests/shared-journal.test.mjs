// Guards the public shared-journal link.
//
// The link is normally sent to another trader, who is usually signed in to
// their own account when they open it. That is exactly the case that was
// broken: a route effect that keeps the URL in step with the active tab saw a
// path matching no dashboard tab and replaced it, so a signed-in visitor was
// bounced to their own dashboard and reported the share link as showing "my
// own account". The redirect is client-side, so the checks here hold the
// server contract the page depends on: the endpoint is public, it answers with
// the OWNER's trades whoever asks, and a revoked link stops answering.
//
// Runs against the dev server on :3000.
import { signInOrRegister } from './auth-helper.mjs';

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const out = [];
const ok = (n, p, d = '') => out.push({ n, p, d });

async function api(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
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

let owner = await signInOrRegister(BASE, `share_owner_${stamp}@example.com`, 'ShareTest12345');
const viewer = await signInOrRegister(BASE, `share_viewer_${stamp}@example.com`, 'ShareTest12345');
ok('setup: an owner and a signed-in viewer exist', !!owner.cookie && !!viewer.cookie);

// Sharing is a Pro feature, so the owner needs the plan before anything below.
const grant = await api(`/api/admin/users/${owner.user.id}/plan`, {
  method: 'POST', cookie: admin.cookie, body: { isPro: true },
});
ok('setup: the owner is on Pro', grant.status === 200, `status ${grant.status}`);
owner = await signInOrRegister(BASE, `share_owner_${stamp}@example.com`, 'ShareTest12345');

const ownerAccounts = await api('/api/accounts', { cookie: owner.cookie });
const ownerAccId = ownerAccounts.json?.accounts?.[0]?.id;
ok('setup: the owner has an account', !!ownerAccId);

const OWNER_PROFIT = 137.25;
const logged = await api('/api/trades', {
  method: 'POST', cookie: owner.cookie,
  body: {
    accountId: ownerAccId, symbol: 'XAUUSD', type: 'Buy', lotSize: 0.1,
    entryPrice: 2300, exitPrice: 2310, profit: OWNER_PROFIT, commission: 0, swap: 0,
  },
});
ok('setup: the owner logged a trade', logged.status === 200, `status ${logged.status}`);

// The viewer logs a different amount, so a response carrying the viewer's data
// instead of the owner's is unmistakable rather than plausible.
const viewerAccounts = await api('/api/accounts', { cookie: viewer.cookie });
const viewerAccId = viewerAccounts.json?.accounts?.[0]?.id;
await api('/api/trades', {
  method: 'POST', cookie: viewer.cookie,
  body: {
    accountId: viewerAccId, symbol: 'EURUSD', type: 'Sell', lotSize: 0.5,
    entryPrice: 1.1, exitPrice: 1.09, profit: -999, commission: 0, swap: 0,
  },
});

// ── the owner creates a link ──────────────────────────────────────────────
const created = await api('/api/shared-links', {
  method: 'POST', cookie: owner.cookie,
  body: { sections: ['dashboard', 'journal'], months: 'all' },
});
const token = created.json?.link?.token || created.json?.token;
ok('the owner can create a share link', (created.status === 200 || created.status === 201) && !!token,
  `status ${created.status}`);
ok('the link is returned as a /shared/ path',
  String(created.json?.shareUrl || '').startsWith('/shared/'), String(created.json?.shareUrl));

// ── anyone can read it, and everyone reads the OWNER ──────────────────────
const anon = await api(`/api/shared/${token}`);
ok('an anonymous visitor can read it', anon.status === 200, `status ${anon.status}`);
ok('it reports the owner as the trader', anon.json?.valid === true, String(anon.json?.valid));
ok('it carries the owner trade', (anon.json?.stats?.netProfit ?? anon.json?.netProfit) === OWNER_PROFIT,
  String(anon.json?.stats?.netProfit ?? anon.json?.netProfit));

const asViewer = await api(`/api/shared/${token}`, { cookie: viewer.cookie });
ok('a signed-in viewer reads the same numbers',
  (asViewer.json?.stats?.netProfit ?? asViewer.json?.netProfit) === OWNER_PROFIT,
  String(asViewer.json?.stats?.netProfit ?? asViewer.json?.netProfit));
ok("the viewer's own trade is not in it",
  !JSON.stringify(asViewer.json?.trades || []).includes('EURUSD'));

// The dev-only impersonation headers must not steer a public endpoint either.
const spoofed = await api(`/api/shared/${token}`, {
  headers: { 'x-auth-user-id': viewer.user.id, 'x-auth-email': viewer.user.email },
});
ok('auth headers do not change what it returns',
  (spoofed.json?.stats?.netProfit ?? spoofed.json?.netProfit) === OWNER_PROFIT,
  String(spoofed.json?.stats?.netProfit ?? spoofed.json?.netProfit));

// ── it does not leak the owner's identity beyond the display name ─────────
const blob = JSON.stringify(anon.json || {});
ok('the owner email is not in the payload', !blob.includes(`share_owner_${stamp}@example.com`));
ok('no password field travels with it', !/"password"/i.test(blob));

// ── a made-up token is a clean 404 ────────────────────────────────────────
const bogus = await api('/api/shared/totallyMadeUpToken');
ok('an unknown token is 404', bogus.status === 404, `status ${bogus.status}`);

// ── revoking closes it ────────────────────────────────────────────────────
const revoked = await api(`/api/shared-links/${token}`, { method: 'DELETE', cookie: owner.cookie });
ok('the owner can revoke the link', revoked.status === 200, `status ${revoked.status}`);

const afterRevoke = await api(`/api/shared/${token}`);
ok('a revoked link stops answering', afterRevoke.status === 404, `status ${afterRevoke.status}`);

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
