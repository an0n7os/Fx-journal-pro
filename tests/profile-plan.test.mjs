import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Execute the real profile routes with an in-memory database adapter. No live
// accounts, billing keys or production database are touched.
const source = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('async function saveProfileFields('), source.indexOf('// PLAN ENTITLEMENTS'));
function setup({ pro = true, local = false, fail = false, missingAvatar = false, expired = false } = {}) {
  let row = { id: 'paid-id', email: 'paid@example.invalid', name: 'Original', password: 'secret',
    isPro: pro, plan: pro ? 'pro' : 'free', proUntil: pro ? new Date(Date.now() + (expired ? -1 : 1) * 86400000).toISOString() : null,
    preferences: { theme: 'dark' } };
  const routes = new Map();
  const writes = [];
  const snake = o => Object.fromEntries(Object.entries(o).map(([k,v]) => [k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), v]));
  const camel = o => Object.fromEntries(Object.entries(o).map(([k,v]) => [k.replace(/_([a-z])/g, (_,c) => c.toUpperCase()), v]));
  const context = { Object, Date, Error, JSON,
    app: { post: (p,h) => routes.set(p,h), patch: (p,h) => routes.set(p,h) },
    useSupabase: !local, toSnake: snake, toCamel: camel, userDatabases: new Map(),
    loadDatabaseFromFile: () => ({ users: [structuredClone(row)] }), DB_FILE: 'unused',
    fs: { writeFileSync: (_, data) => { row = JSON.parse(data).users[0]; } },
    sanitizeUser: u => { const copy = { ...u }; delete copy.password; return copy; },
    supabase: { from: table => {
      assert.equal(table, 'users');
      return { update: patch => {
        writes.push(structuredClone(patch));
        return { eq: (key, id) => {
          assert.equal(key, 'id'); assert.equal(id, row.id);
          return { select: () => ({ single: async () => {
            if (fail || (missingAvatar && 'avatar' in patch)) return { error: { message: 'avatar unavailable' } };
            Object.assign(row, camel(patch));
            return { data: snake(row) };
          } }) };
        } };
      } };
    } },
  };
  vm.runInNewContext(ts.transpile(section, { target: ts.ScriptTarget.ES2022 }), context);
  return { writes, row: () => row, request: async (path, body, stale = false) => {
    const currentUser = structuredClone(row);
    if (stale) { currentUser.isPro = false; currentUser.plan = 'free'; currentUser.proUntil = null; }
    const req = { body, currentUser, userDb: { users: [currentUser] } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await routes.get(path)(req, res);
    return res;
  } };
}
const profile = '/api/auth/update-profile';
for (const local of [false, true]) {
  test(`${local ? 'local' : 'cloud'}: rename, avatar and settings retain paid identity and expiry despite stale request`, async () => {
    const env = setup({ local });
    const until = env.row().proUntil;
    for (const [path, body] of [[profile, { name: 'New Name' }], [profile, { avatar: 'photo' }], [profile, { avatar: '' }], ['/api/auth/preferences', { theme: 'light' }]]) {
      const res = await env.request(path, body, true);
      assert.equal(res.code, 200);
      assert.equal(res.data.user.isPro, true);
      assert.equal(res.data.user.proUntil, until);
      assert.equal(res.data.user.id, 'paid-id');
      assert.equal(res.data.user.email, 'paid@example.invalid');
      assert.equal(res.data.user.password, undefined);
    }
    assert.equal(env.row().name, 'New Name');
    for (const patch of env.writes) {
      for (const key of ['is_pro', 'pro_until', 'plan', 'id', 'email', 'role']) assert.equal(key in patch, false);
    }
  });
}
test('profile cannot grant Pro or change identity/roles', async () => {
  const env = setup({ pro: false });
  const res = await env.request(profile, { name: 'Free Rename', isPro: true, plan: 'pro', email: 'other@example.invalid', id: 'other', role: 'SUPER_ADMIN' });
  assert.equal(res.data.user.isPro, false);
  assert.equal(res.data.user.email, 'paid@example.invalid');
  assert.equal(env.row().role, undefined);
});
test('expired plan is not reactivated by rename', async () => {
  const env = setup({ expired: true });
  assert.equal((await env.request(profile, { name: 'Expired' })).data.user.isPro, false);
});
test('save failure returns error without changing name or paid access', async () => {
  const env = setup({ fail: true });
  assert.equal((await env.request(profile, { name: 'Failed' })).code, 500);
  assert.equal(env.row().name, 'Original');
  assert.equal(env.row().isPro, true);
});
test('legacy database without avatar column retains plan and stores avatar preference', async () => {
  const env = setup({ missingAvatar: true });
  const res = await env.request(profile, { name: 'Legacy', avatar: 'photo' }, true);
  assert.equal(res.code, 200);
  assert.equal(res.data.user.isPro, true);
  assert.equal(env.row().preferences.avatar, 'photo');
});
