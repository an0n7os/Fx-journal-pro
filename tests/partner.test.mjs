// Guards the Partner Portal's load-bearing rules:
//   1. only an admin can promote someone to Partner, and doing so grants Pro
//   2. a partner sees only the users who signed up with THEIR referral code
//   3. a partner cannot read a user's trades until that user opts in
//   4. the opt-in is enforced on every route that returns trade data, not just
//      the console one, and revoking it takes effect on the next request
//   5. a partner session can never carry a write
//
// Runs against the dev server on :3000, same as the other suites. With no
// Supabase configured the server uses its file-backed store, which exercises
// the same code paths.
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
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function signIn(email, password = 'PartnerTest12345') {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
  let json = null;
  try { json = await res.json(); } catch {}
  return { cookie, user: json?.user || null };
}

// Registers and completes the OTP step, because a half-registered account
// cannot sign in and every check below needs the referred user's own session.
// The dev server echoes the code back as devOtp; production never does.
async function register(email, referralCode) {
  const res = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: email.split('@')[0], password: 'PartnerTest12345', referralCode }),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (json?.devOtp) {
    await fetch(BASE + '/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: json.devOtp }),
    });
  }
  return { status: res.status, user: json?.user || null, verified: !!json?.devOtp };
}

const stamp = Date.now();

// ── setup ─────────────────────────────────────────────────────────────────
// See the note in plan-gates.test.mjs: the seeded admin's password follows
// DEV_ADMIN_PASSWORD, and hardcoding it made every later assertion fail as
// soon as the seed password changed.
const adminPassword = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const adminEmail = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';
const admin = await signIn(adminEmail, adminPassword);
ok('setup: signed in as super admin', !!admin.cookie);

const partnerA = await signIn(`pa_${stamp}@example.com`);
const partnerB = await signIn(`pb_${stamp}@example.com`);
ok('setup: two future partners exist', !!partnerA.cookie && !!partnerB.cookie);

// ── 1. promotion is admin-only, and grants Pro ────────────────────────────
const selfPromote = await api(`/api/admin/users/${partnerA.user.id}/partner`, {
  method: 'POST', cookie: partnerA.cookie, body: {},
});
ok('a user cannot promote themselves', selfPromote.status === 403, `status ${selfPromote.status}`);

const promoteA = await api(`/api/admin/users/${partnerA.user.id}/partner`, {
  method: 'POST', cookie: admin.cookie, body: { referralCode: `AAA${stamp % 100000}` },
});
ok('admin promotes user to Partner', promoteA.status === 200, `status ${promoteA.status}`);
ok('promotion sets role PARTNER', promoteA.json?.role === 'PARTNER', String(promoteA.json?.role));
ok('promotion grants Pro', promoteA.json?.isPro === true, String(promoteA.json?.isPro));
ok('promotion returns a referral code', !!promoteA.json?.referralCode, String(promoteA.json?.referralCode));

const codeA = promoteA.json?.referralCode;

const promoteB = await api(`/api/admin/users/${partnerB.user.id}/partner`, {
  method: 'POST', cookie: admin.cookie, body: {},
});
const codeB = promoteB.json?.referralCode;
ok('second partner gets a different code', !!codeB && codeB !== codeA, `${codeA} vs ${codeB}`);

// The promoted account keeps its identity — same id, no second account.
ok('promotion reuses the existing account', promoteA.json?.userId === partnerA.user.id);

// ── 2. duplicate codes are refused ────────────────────────────────────────
const aSession = await signIn(`pa_${stamp}@example.com`);
const dupe = await api('/api/partner/code', {
  method: 'PUT', cookie: aSession.cookie, body: { referralCode: codeB },
});
ok('a taken code is refused', dupe.status === 409, `status ${dupe.status}`);

const badFormat = await api('/api/partner/code', {
  method: 'PUT', cookie: aSession.cookie, body: { referralCode: 'no spaces!' },
});
ok('a malformed code is refused', badFormat.status === 400, `status ${badFormat.status}`);

const reserved = await api('/api/partner/code', {
  method: 'PUT', cookie: aSession.cookie, body: { referralCode: 'ADMIN' },
});
ok('a reserved code is refused', reserved.status === 400, `status ${reserved.status}`);

// ── 3. the partner can read their own profile ─────────────────────────────
const me = await api('/api/partner/me', { cookie: aSession.cookie });
ok('partner reads their own profile', me.status === 200, `status ${me.status}`);
ok('profile carries a referral link', String(me.json?.referralUrl || '').includes('ref='), me.json?.referralUrl);

const meAsUser = await api('/api/partner/me', { cookie: partnerB.cookie ? partnerB.cookie : '' });
ok('partner B cannot read partner A profile through /me', meAsUser.json?.partnerId !== partnerA.user.id);

// ── 4. referral linking ───────────────────────────────────────────────────
const u1 = await register(`ref1_${stamp}@example.com`, codeA);
const u2 = await register(`ref2_${stamp}@example.com`, codeA);
const u3 = await register(`ref3_${stamp}@example.com`, codeB);
ok('referred users register successfully', u1.status === 200 && u2.status === 200 && u3.status === 200);

const overviewA = await api('/api/subadmin/overview', { cookie: aSession.cookie });
ok('partner reads their console', overviewA.status === 200, `status ${overviewA.status}`);

const idsA = (overviewA.json?.users || []).map((u) => u.email);
ok('partner A sees their own referrals', idsA.includes(`ref1_${stamp}@example.com`) && idsA.includes(`ref2_${stamp}@example.com`), idsA.join(','));
ok("partner A does NOT see partner B's referral", !idsA.includes(`ref3_${stamp}@example.com`), idsA.join(','));

ok('growth series is present', Array.isArray(overviewA.json?.growth));
ok('total count matches the network', overviewA.json?.stats?.totalUsers === 2, String(overviewA.json?.stats?.totalUsers));

// ── 5. consent defaults to OFF ────────────────────────────────────────────
const card1 = (overviewA.json?.users || []).find((u) => u.email === `ref1_${stamp}@example.com`);
ok('a new referral does not share trades by default', card1?.tradeAccess === false, String(card1?.tradeAccess));
ok('withheld card carries no trade counts', card1?.tradesToday === null && card1?.netPnl === null);

const u1Id = card1?.id;
const denied = await api(`/api/subadmin/user/${u1Id}`, { cookie: aSession.cookie });
ok('deep-dive is refused without consent', denied.status === 403, `status ${denied.status}`);
ok('refusal names the reason', denied.json?.code === 'TRADE_ACCESS_DENIED', String(denied.json?.code));

// The second door into the same data must be shut too.
const deniedInspect = await api(`/api/admin/inspect-user/${u1Id}`, { cookie: aSession.cookie });
ok('inspect-user is refused without consent', deniedInspect.status === 403, `status ${deniedInspect.status}`);

// ── 6. the user opts in, and only the user can ────────────────────────────
const u1Session = await signIn(`ref1_${stamp}@example.com`);
const link = await api('/api/user/partner-link', { cookie: u1Session.cookie });
ok('user can see who referred them', link.json?.hasPartner === true, JSON.stringify(link.json));
ok('user sees sharing is off', link.json?.allowPartnerTradeView === false);

// A partner must not be able to switch it on for someone else. The endpoint
// only ever acts on the caller's own row, so this flips the PARTNER's flag,
// never the referred user's.
await api('/api/user/partner-visibility', {
  method: 'PATCH', cookie: aSession.cookie, body: { allow: true },
});
const stillOff = await api('/api/user/partner-link', { cookie: u1Session.cookie });
ok("a partner cannot switch on another user's sharing", stillOff.json?.allowPartnerTradeView === false);

const optIn = await api('/api/user/partner-visibility', {
  method: 'PATCH', cookie: u1Session.cookie, body: { allow: true },
});
ok('user can switch sharing on', optIn.json?.allowPartnerTradeView === true, JSON.stringify(optIn.json));

const allowed = await api(`/api/subadmin/user/${u1Id}`, { cookie: aSession.cookie });
ok('deep-dive works once consent is given', allowed.status === 200, `status ${allowed.status}`);
ok('deep-dive is marked read-only', allowed.json?.readOnly === true);
ok('deep-dive carries no password', !('password' in (allowed.json?.user || {})));

const overviewAfter = await api('/api/subadmin/overview', { cookie: aSession.cookie });
const cardAfter = (overviewAfter.json?.users || []).find((u) => u.id === u1Id);
ok('card now reports trade access', cardAfter?.tradeAccess === true);
ok('card now carries trade counts', cardAfter?.tradesToday !== null);

// ── 7. revoking takes effect at once ──────────────────────────────────────
await api('/api/user/partner-visibility', {
  method: 'PATCH', cookie: u1Session.cookie, body: { allow: false },
});
const revoked = await api(`/api/subadmin/user/${u1Id}`, { cookie: aSession.cookie });
ok('revoking consent closes the deep-dive again', revoked.status === 403, `status ${revoked.status}`);

// ── 8. a partner session carries no writes ────────────────────────────────
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const res = await api(`/api/subadmin/user/${u1Id}`, { cookie: aSession.cookie, method, body: {} });
  ok(`console: ${method} on a user is refused`, res.status !== 200, `status ${res.status}`);
}

const partnerBlock = await api('/api/admin/block-user', {
  method: 'POST', cookie: aSession.cookie, body: { userId: u1Id },
});
ok('partner cannot block a user', partnerBlock.status === 403, `status ${partnerBlock.status}`);

const partnerPromote = await api(`/api/admin/users/${u1Id}/partner`, {
  method: 'POST', cookie: aSession.cookie, body: {},
});
ok('partner cannot mint another partner', partnerPromote.status === 403, `status ${partnerPromote.status}`);

const partnerAssign = await api('/api/admin/assignments', {
  method: 'POST', cookie: aSession.cookie, body: { subAdminId: partnerA.user.id, userEmail: `ref3_${stamp}@example.com` },
});
ok('partner cannot assign themselves another user', partnerAssign.status === 403, `status ${partnerAssign.status}`);

// ── 9. an ordinary user gets none of it ───────────────────────────────────
const plain = await signIn(`plain_${stamp}@example.com`);
const plainMe = await api('/api/partner/me', { cookie: plain.cookie });
ok('plain user cannot read a partner profile', plainMe.status === 403, `status ${plainMe.status}`);

const plainOverview = await api('/api/subadmin/overview', { cookie: plain.cookie });
ok('plain user cannot read the console', plainOverview.status === 403, `status ${plainOverview.status}`);

const plainCheck = await api('/api/admin/check', { cookie: plain.cookie });
ok('plain user has no partner permission', !(plainCheck.json?.permissions || []).includes('partner.self'));

const partnerCheck = await api('/api/admin/check', { cookie: aSession.cookie });
ok('partner role is reported to the client', partnerCheck.json?.role === 'PARTNER', String(partnerCheck.json?.role));
ok('partner has no ticket access', !(partnerCheck.json?.permissions || []).includes('tickets.read'));
ok('partner has no user management', !(partnerCheck.json?.permissions || []).includes('users.manage'));

// ── 10. the public code lookup leaks nothing ──────────────────────────────
const lookup = await api(`/api/referral/${codeA}`);
ok('a valid code resolves', lookup.json?.valid === true, JSON.stringify(lookup.json));
ok('code lookup does not expose the partner email', !JSON.stringify(lookup.json || {}).includes('@'));

const badLookup = await api('/api/referral/NOPE9999');
ok('an unknown code is rejected', badLookup.status === 404, `status ${badLookup.status}`);

// ── 11. demotion ──────────────────────────────────────────────────────────
const demote = await api(`/api/admin/users/${partnerB.user.id}/partner`, {
  method: 'DELETE', cookie: admin.cookie,
});
ok('admin can demote a partner', demote.status === 200, `status ${demote.status}`);

const bAfter = await signIn(`pb_${stamp}@example.com`);
const bConsole = await api('/api/subadmin/overview', { cookie: bAfter.cookie });
ok('a demoted partner loses console access', bConsole.status === 403, `status ${bConsole.status}`);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
process.exit(failed.length ? 1 : 0);
