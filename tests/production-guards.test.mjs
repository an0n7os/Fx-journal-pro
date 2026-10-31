import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const bundledServer = path.join(root, `.env.production-smoke-${process.pid}.mjs`);
buildSync({ entryPoints: [path.join(root, 'server.ts')], outfile: bundledServer,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' });
async function launch(extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fxjp-production-guard-'));
  const port = 7000 + Math.floor(Math.random() * 2000);
  const env = { NODE_ENV: 'production', PORT: String(port), SESSION_SECRET: 'production_test_only_secret_32_characters', ...extra };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key];
  writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'existing-paid-user', email: 'guard@example.invalid', isPro: true, isEmailVerified: true }], accounts: [], trades: [] }));
  // Exercise the real production bundle, not the tsx development entry.
  const child = spawn(process.execPath, [bundledServer], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  const exited = new Promise(r => child.once('exit', r));
  return { child, exited, log: () => log, base: `http://127.0.0.1:${port}`, stop: async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
  } };
}
test('production refuses to start without database credentials', { timeout: 20000 }, async () => {
  const s = await launch();
  try {
    const code = await Promise.race([s.exited, new Promise(r => setTimeout(() => r('timeout'), 12000).unref())]);
    assert.equal(typeof code, 'number', 'server must abort, not run silently on temporary local storage');
    assert.notEqual(code, 0);
    assert.match(s.log(), /Database credentials.*required in production/);
    assert.doesNotMatch(s.log(), /Prod listening/);
  } finally { await s.stop(); }
});
test('production refuses weak session secrets', { timeout: 20000 }, async () => {
  const s = await launch({ ALLOW_LOCAL_DB: 'true', SESSION_SECRET: 'short' });
  try {
    const code = await Promise.race([s.exited, new Promise(r => setTimeout(() => r('timeout'), 12000).unref())]);
    assert.equal(typeof code, 'number'); assert.notEqual(code, 0);
    assert.match(s.log(), /SESSION_SECRET.*32/);
  } finally { await s.stop(); }
});
test('production disables developer auth, debug routes and billing bypass', { timeout: 25000 }, async () => {
  const s = await launch({ ALLOW_LOCAL_DB: 'true', ALLOW_NO_EMAIL: 'true', ALLOW_TEST_BILLING: 'true', DEV_ACCOUNT_EMAIL: 'guard@example.invalid', DEV_ADMIN_PASSWORD: 'Demo@12345' });
  try {
    let ready = false;
    for (let i = 0; i < 35; i++) {
      try { if ((await fetch(s.base + '/api/payments/config', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(ready, s.log());
    const config = await (await fetch(s.base + '/api/payments/config')).json();
    assert.equal(config.testBilling, false);
    assert.equal((await fetch(s.base + '/api/debug/env')).status, 404);
    const headers = { 'x-auth-user-id': 'existing-paid-user', 'x-auth-email': 'guard@example.invalid', 'Content-Type': 'application/json' };
    assert.equal((await fetch(s.base + '/api/auth/me', { headers })).status, 401);
    assert.equal((await fetch(s.base + '/api/trades', { headers })).status, 401);
    const toggle = await fetch(s.base + '/api/payments/toggle-test-tier', { method: 'POST', headers, body: JSON.stringify({ tier: 'pro' }) });
    assert.ok([401, 404].includes(toggle.status));
  } finally { await s.stop(); }
});
