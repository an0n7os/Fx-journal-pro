// Guards the trader notebook now that it is stored against the account.
//
// It used to live entirely in localStorage: three keys in one browser, no
// route on the server and no table behind it. Notes written on a phone were
// not on the laptop, clearing site data destroyed them with no copy anywhere,
// and the editor showed a "Saved" badge the whole time — on a Pro feature.
//
// What has to hold: it is the caller's own notebook and nobody else's, it is
// Pro-gated like every other notebook surface, it survives a sign-out, and a
// save from a second device cannot be silently overwritten by a stale tab.
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

const FREE_EMAIL = `nb_free_${stamp}@example.com`;
const PRO_EMAIL = `nb_pro_${stamp}@example.com`;
const OTHER_EMAIL = `nb_other_${stamp}@example.com`;
const PASSWORD = 'NotebookTest12345';

const free = await signInOrRegister(BASE, FREE_EMAIL, PASSWORD);
let pro = await signInOrRegister(BASE, PRO_EMAIL, PASSWORD);
let other = await signInOrRegister(BASE, OTHER_EMAIL, PASSWORD);
ok('setup: three accounts exist', !!free.cookie && !!pro.cookie && !!other.cookie);

// ── the notebook is Pro, like the tab that shows it ───────────────────────
const freeRead = await api('/api/notebook', { cookie: free.cookie });
ok('a free account cannot read a notebook', freeRead.status === 403, `status ${freeRead.status}`);
ok('and is told upgrading is the way out', freeRead.json?.proRequired === true,
  String(freeRead.json?.proRequired));

const freeWrite = await api('/api/notebook', {
  method: 'PUT', cookie: free.cookie, body: { notes: [], folders: [], tags: [] },
});
ok('a free account cannot write one either', freeWrite.status === 403, `status ${freeWrite.status}`);

const anon = await api('/api/notebook');
ok('an anonymous caller is refused', anon.status === 401 || anon.status === 403, `status ${anon.status}`);

for (const [email, session] of [[PRO_EMAIL, 'pro'], [OTHER_EMAIL, 'other']]) {
  const target = session === 'pro' ? pro : other;
  await api(`/api/admin/users/${target.user.id}/plan`, {
    method: 'POST', cookie: admin.cookie, body: { isPro: true },
  });
}
pro = await signInOrRegister(BASE, PRO_EMAIL, PASSWORD);
other = await signInOrRegister(BASE, OTHER_EMAIL, PASSWORD);

// ── a fresh Pro account starts empty, not missing ─────────────────────────
const empty = await api('/api/notebook', { cookie: pro.cookie });
ok('a Pro account can read its notebook', empty.status === 200, `status ${empty.status}`);
ok('a new notebook is empty rather than an error', Array.isArray(empty.json?.notes) && empty.json.notes.length === 0,
  JSON.stringify(empty.json?.notes));

// ── a save round trips ────────────────────────────────────────────────────
const NOTE = {
  id: 'note_1', title: 'Pre-Market Plan', folder: 'Daily Journal',
  tags: ['setup'], mood: 'Disciplined', content: '## Bias\nGold long above 2300.',
  isFavourite: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const saved = await api('/api/notebook', {
  method: 'PUT', cookie: pro.cookie,
  body: { notes: [NOTE], folders: ['Daily Journal', 'Psychology'], tags: ['setup', 'review'] },
});
ok('the notebook saves', saved.status === 200, `status ${saved.status}`);
ok('the save returns a timestamp', !!saved.json?.updatedAt, String(saved.json?.updatedAt));

const readBack = await api('/api/notebook', { cookie: pro.cookie });
ok('the note comes back', readBack.json?.notes?.length === 1, String(readBack.json?.notes?.length));
ok('with its content intact', readBack.json?.notes?.[0]?.content === NOTE.content,
  String(readBack.json?.notes?.[0]?.content).slice(0, 40));
ok('and its title', readBack.json?.notes?.[0]?.title === 'Pre-Market Plan',
  String(readBack.json?.notes?.[0]?.title));
ok('camelCase fields are not mangled', readBack.json?.notes?.[0]?.isFavourite === true,
  String(readBack.json?.notes?.[0]?.isFavourite));
ok('folders round trip', (readBack.json?.folders || []).includes('Psychology'),
  String(readBack.json?.folders));
ok('tags round trip', (readBack.json?.tags || []).includes('review'), String(readBack.json?.tags));

// ── it survives signing out and back in, which is the whole point ─────────
await api('/api/auth/logout', { method: 'POST', cookie: pro.cookie });
pro = await signInOrRegister(BASE, PRO_EMAIL, PASSWORD);
const afterRelogin = await api('/api/notebook', { cookie: pro.cookie });
ok('the notebook survives sign out and sign in', afterRelogin.json?.notes?.length === 1,
  String(afterRelogin.json?.notes?.length));
ok('still with its content', afterRelogin.json?.notes?.[0]?.content === NOTE.content);

// ── it is nobody else's ───────────────────────────────────────────────────
const others = await api('/api/notebook', { cookie: other.cookie });
ok('another Pro account sees their own empty notebook', (others.json?.notes || []).length === 0,
  String((others.json?.notes || []).length));

await api('/api/notebook', {
  method: 'PUT', cookie: other.cookie,
  body: { notes: [{ id: 'x', title: 'Not yours', content: 'secret' }], folders: [], tags: [] },
});
const mineStill = await api('/api/notebook', { cookie: pro.cookie });
ok("another account's save does not touch this one", mineStill.json?.notes?.[0]?.title === 'Pre-Market Plan',
  String(mineStill.json?.notes?.[0]?.title));

// ── a stale tab cannot overwrite a newer save ─────────────────────────────
const staleBase = '2000-01-01T00:00:00.000Z';
const conflict = await api('/api/notebook', {
  method: 'PUT', cookie: pro.cookie,
  body: { notes: [], folders: [], tags: [], baseUpdatedAt: staleBase },
});
ok('a stale write is refused', conflict.status === 409, `status ${conflict.status}`);
ok('the refusal names the reason', conflict.json?.code === 'NOTEBOOK_CONFLICT', String(conflict.json?.code));
ok('and hands back the server copy', conflict.json?.server?.notes?.length === 1,
  String(conflict.json?.server?.notes?.length));

const notWiped = await api('/api/notebook', { cookie: pro.cookie });
ok('the refused write changed nothing', notWiped.json?.notes?.length === 1,
  String(notWiped.json?.notes?.length));

// A write that carries the current timestamp is accepted.
const fresh = await api('/api/notebook', {
  method: 'PUT', cookie: pro.cookie,
  body: { notes: [NOTE, { ...NOTE, id: 'note_2', title: 'Review' }], folders: [], tags: [], baseUpdatedAt: notWiped.json?.updatedAt },
});
ok('an up-to-date write is accepted', fresh.status === 200, `status ${fresh.status}`);
const two = await api('/api/notebook', { cookie: pro.cookie });
ok('both notes are stored', two.json?.notes?.length === 2, String(two.json?.notes?.length));

// ── malformed and oversized bodies are refused ────────────────────────────
const bad = await api('/api/notebook', { method: 'PUT', cookie: pro.cookie, body: { notes: 'nope' } });
ok('a malformed body is refused', bad.status === 400, `status ${bad.status}`);

const huge = { id: 'big', title: 'Big', content: 'x'.repeat(1_100_000) };
const tooBig = await api('/api/notebook', {
  method: 'PUT', cookie: pro.cookie, body: { notes: [huge], folders: [], tags: [] },
});
ok('an oversized notebook is refused, not truncated', tooBig.status === 413, `status ${tooBig.status}`);
const survived = await api('/api/notebook', { cookie: pro.cookie });
ok('and the stored notebook is untouched', survived.json?.notes?.length === 2,
  String(survived.json?.notes?.length));

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
