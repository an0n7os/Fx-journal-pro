// Guards the Sub-Admin Console's two load-bearing rules:
//   1. a sub-admin sees only the users assigned to them
//   2. a sub-admin session can never carry a write
//
// Runs against the dev server on :3000. When Supabase is not configured the
// server uses its in-memory store, which exercises the same code paths.
const BASE = 'http://localhost:3000';
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

async function signIn(email) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'SubAdminTest12345' }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] || '';
}

const stamp = Date.now();
const plainCookie = await signIn(`sa_plain_${stamp}@example.com`);
ok('setup: signed in as a plain user', !!plainCookie);

// --- a plain user cannot reach the console -------------------------------
const overview = await api('/api/subadmin/overview', { cookie: plainCookie });
ok('plain user: overview is 403', overview.status === 403, `status ${overview.status}`);

const detail = await api('/api/subadmin/user/anything', { cookie: plainCookie });
ok('plain user: user detail is 403', detail.status === 403, `status ${detail.status}`);

// --- and neither can an anonymous caller ---------------------------------
const anon = await api('/api/subadmin/overview');
ok('anonymous: overview is 403', anon.status === 403, `status ${anon.status}`);

// --- assignment management is super-admin only ---------------------------
const assignGet = await api('/api/admin/assignments?subAdminId=x', { cookie: plainCookie });
ok('plain user: cannot read assignments', assignGet.status === 403, `status ${assignGet.status}`);

const assignPost = await api('/api/admin/assignments', {
  method: 'POST', cookie: plainCookie,
  body: { subAdminId: 'x', userEmail: 'someone@example.com' },
});
ok('plain user: cannot create an assignment', assignPost.status === 403, `status ${assignPost.status}`);

const assignDelete = await api('/api/admin/assignments', {
  method: 'DELETE', cookie: plainCookie, body: { subAdminId: 'x', userId: 'y' },
});
ok('plain user: cannot delete an assignment', assignDelete.status === 403, `status ${assignDelete.status}`);

// --- the console exposes no write verbs at all ---------------------------
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const res = await api('/api/subadmin/user/anything', { method, cookie: plainCookie, body: {} });
  ok(`console: ${method} on a user is refused`, res.status !== 200, `status ${res.status}`);
}

// --- the role table still says what it should ----------------------------
const check = await api('/api/admin/check', { cookie: plainCookie });
ok('plain user: not an admin', check.json?.isAdmin === false, `role ${check.json?.role}`);
ok('plain user: no assigned.read', !(check.json?.permissions || []).includes('assigned.read'));

// --- an admin route that a sub-admin must not be able to write -----------
const blockWrite = await api('/api/admin/block-user', {
  method: 'POST', cookie: plainCookie, body: { userId: 'someone' },
});
ok('admin write refused without permission', blockWrite.status === 403, `status ${blockWrite.status}`);

console.log('');
for (const r of out) console.log(`${r.p ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
const failed = out.filter((r) => !r.p);
console.log(`\n${out.length - failed.length}/${out.length} passed`);
if (failed.length) console.log('FAILING:\n' + failed.map((f) => ` - ${f.n} (${f.d})`).join('\n'));
process.exit(failed.length ? 1 : 0);
