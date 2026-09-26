// A sub-admin must see exactly the users assigned to them — no more, no less.
//
// tests/subadmin.test.mjs proves the negative half: a plain user is refused
// everywhere. Nothing proved the positive half, which is the one that leaks
// customer data: once someone really is a SUB_ADMIN, do the scoped reads
// actually narrow, or do they quietly return the whole customer base?
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const PASSWORD = process.env.DEV_ADMIN_PASSWORD?.trim() || 'Demo@12345';
const ADMIN_EMAIL = process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || 'dev@localhost';

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}  ${detail}`); }
  else { failures.push(`${name} (${detail})`); console.log(`FAIL  ${name}  ${detail}`); }
};

async function raw(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function newUser(tag) {
  const email = `scope_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const reg = await raw('/api/auth/register', { method: 'POST', body: { name: tag, email, password: PASSWORD } });
  let cookie = reg.cookie;
  if (reg.json?.devOtp) {
    const v = await raw('/api/auth/verify-otp', { method: 'POST', body: { email, otp: reg.json.devOtp }, cookie });
    cookie = v.cookie || cookie;
  }
  const me = await raw('/api/auth/me', { cookie });
  return { email, cookie, id: me.json?.user?.id };
}

const admin = await raw('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: PASSWORD } });
check('setup: signed in as super admin', !!admin.cookie, `status ${admin.status}`);

// Three customers: two will belong to the sub-admin, one must stay invisible.
const mine1 = await newUser('mine1');
const mine2 = await newUser('mine2');
const theirs = await newUser('theirs');
check('setup: three customers exist', !!(mine1.id && mine2.id && theirs.id),
  `${[mine1.id, mine2.id, theirs.id].filter(Boolean).length}/3`);

// Each logs one trade, so there is real data to leak.
for (const u of [mine1, mine2, theirs]) {
  const accs = await raw('/api/accounts', { cookie: u.cookie });
  const acc = (accs.json?.accounts || accs.json || [])[0];
  u.accountId = acc?.id;
  await raw('/api/trades', {
    method: 'POST', cookie: u.cookie,
    body: {
      accountId: u.accountId, date: new Date().toISOString(), symbol: 'EURUSD',
      type: 'Buy', lotSize: 0.1, entryPrice: 1.1, exitPrice: 1.2, profit: 50,
    },
  });
}

// Promote one more account to SUB_ADMIN and assign the two customers.
const sub = await newUser('sub');
const roleRes = await raw('/api/admin/team/role', {
  method: 'POST', cookie: admin.cookie,
  body: { email: sub.email, role: 'SUB_ADMIN' },
});
check('super admin can create a sub-admin', roleRes.status === 200, `status ${roleRes.status} ${roleRes.json?.error || ''}`);

for (const u of [mine1, mine2]) {
  const a = await raw('/api/admin/assignments', {
    method: 'POST', cookie: admin.cookie,
    body: { subAdminId: sub.id, userEmail: u.email },
  });
  check(`assigned ${u.email.split('_')[1]} to the sub-admin`, a.status === 200,
    `status ${a.status} ${a.json?.error || ''}`);
}

// Re-sign-in so the session carries the new role.
const subLogin = await raw('/api/auth/login', { method: 'POST', body: { email: sub.email, password: PASSWORD } });
const subCookie = subLogin.cookie || sub.cookie;
const subCheck = await raw('/api/admin/check', { cookie: subCookie });
check('the sub-admin is recognised as one', subCheck.json?.role === 'SUB_ADMIN', String(subCheck.json?.role));
check('the sub-admin is not a super admin',
  !(subCheck.json?.permissions || []).includes('users.roles'),
  (subCheck.json?.permissions || []).join(',') || 'none');

// ── The scoped read ───────────────────────────────────────────────────────
const scoped = await raw('/api/admin/users', { cookie: subCookie });
const seen = (scoped.json?.users || []).map((u) => u.id);
check('the sub-admin can read their console', scoped.status === 200, `status ${scoped.status}`);
check('both assigned customers are visible',
  seen.includes(mine1.id) && seen.includes(mine2.id),
  `saw ${seen.length} users`);
check('the unassigned customer is NOT visible', !seen.includes(theirs.id),
  seen.includes(theirs.id) ? 'LEAKED' : 'hidden');
check('the super admin is NOT visible to the sub-admin',
  !(scoped.json?.users || []).some((u) => u.email === ADMIN_EMAIL),
  'admin row');

// Dashboard counters must be scoped the same way.
const dash = await raw('/api/admin/dashboard', { cookie: subCookie });
check('dashboard totals are scoped, not platform-wide',
  dash.status === 200 && dash.json?.totalUsers <= seen.length,
  `totalUsers ${dash.json?.totalUsers} vs ${seen.length} visible`);

// A super admin still sees everyone.
const all = await raw('/api/admin/users', { cookie: admin.cookie });
const allIds = (all.json?.users || []).map((u) => u.id);
check('the super admin still sees every customer',
  allIds.includes(mine1.id) && allIds.includes(mine2.id) && allIds.includes(theirs.id),
  `${allIds.length} users`);

// ── The sub-admin must not reach an unassigned customer directly ──────────
const poke = await raw(`/api/admin/inspect-user/${theirs.id}`, { cookie: subCookie });
check('inspecting an unassigned customer is refused',
  poke.status === 403 || poke.status === 404, `status ${poke.status}`);

const escalate = await raw('/api/admin/team/role', {
  method: 'POST', cookie: subCookie, body: { email: sub.email, role: 'SUPER_ADMIN' },
});
check('a sub-admin cannot promote themselves', escalate.status === 403, `status ${escalate.status}`);

const stealAssign = await raw('/api/admin/assignments', {
  method: 'POST', cookie: subCookie, body: { subAdminId: sub.id, userEmail: theirs.email },
});
check('a sub-admin cannot assign themselves more customers',
  stealAssign.status === 403, `status ${stealAssign.status}`);

const afterSteal = await raw('/api/admin/users', { cookie: subCookie });
check('the unassigned customer is still hidden after the attempts',
  !(afterSteal.json?.users || []).some((u) => u.id === theirs.id), 'still hidden');

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) {
  console.log('FAILING:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}
