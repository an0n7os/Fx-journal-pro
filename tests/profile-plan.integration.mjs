import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { signInOrRegister } from './auth-helper.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let dir = mkdtempSync(path.join(tmpdir(), 'fxjp-profile-'));
const port = 3200 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
// Build an allowlisted environment: never inherit production DB, email or API keys.
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  NODE_ENV: 'development', PORT: String(port), TEST_BASE: base,
  BETTER_AUTH_SECRET: 'profile_test_only_secret_at_least_32_chars',
  SESSION_SECRET: 'profile_test_session_secret_at_least_32_chars',
  BETTER_AUTH_URL: base, ALLOW_TEST_BILLING: 'true', EXPOSE_DEV_OTP: 'true',
  DEV_ACCOUNT_EMAIL: 'dev@localhost', DEV_ADMIN_PASSWORD: 'Demo@12345',
});
const audit = process.argv.includes('--audit');
if (audit) Object.assign(env, {
  RAZORPAY_KEY_ID: 'rzp_test_fake_audit', RAZORPAY_KEY_SECRET: 'test-webhook-secret-value',
  RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret-value',
  MT5_VPS_SYNC_ENABLED: 'true', MT5_WORKER_TOKEN: 'audit_test_worker_token',
  MT5_CREDENTIAL_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  MT5_CLOUD_SYNC_ENABLED: 'false',
});
let server;
let serverLog = '';
async function start() {
  server = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(root, 'server.ts')], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => { serverLog += b; });
  server.stderr.on('data', b => { serverLog += b; });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Test server exited: ' + serverLog.slice(-1500));
    try {
      const r = await fetch(base + '/api/payments/config', { signal: AbortSignal.timeout(1500) });
      if (r.ok) { assert.equal((await r.json()).testBilling, env.ALLOW_TEST_BILLING === 'true'); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Test server readiness timeout: ' + serverLog.slice(-1500));
}
async function stop() {
  const running = server;
  server = null;
  if (!running || running.exitCode !== null || running.signalCode !== null) return;
  const exited = new Promise(r => running.once('exit', r));
  running.kill();
  await exited;
}
async function api(route, cookie, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const json = await r.json();
  assert.equal(r.status, 200, `${route}: ${r.status} ${json.error || ''}`);
  return json;
}
function paid(user, original) {
  assert.equal(user.id, original.id);
  assert.equal(user.email, original.email);
  assert.equal(user.isPro, true);
  assert.equal(user.proUntil, original.proUntil);
  for (const key of ['password', 'emailOtp', 'resetOtp']) assert.equal(user[key], undefined);
}
try {
  await start();
  const email = `profile_${Date.now()}@example.invalid`;
  const password = 'ProfileRegression123!';
  const login = await signInOrRegister(base, email, password);
  assert.equal(login.status, 200); assert.ok(login.cookie);
  let cookie = login.cookie;
  await api('/api/payments/toggle-test-tier', cookie, { tier: 'pro' });
  const original = (await api('/api/auth/me', cookie)).user;
  assert.equal(original.isPro, true);
  const portfolio = (await api('/api/accounts', cookie)).accounts[0];
  const recorded = await api('/api/trades', cookie, {
    accountId: portfolio.id, symbol: 'EURUSD', type: 'Buy', lotSize: 0.1,
    entryPrice: 1.08, exitPrice: 1.09, profit: 100, commission: -2, swap: 0,
  });
  for (const [route, body, method] of [
    ['/api/auth/update-profile', { name: 'Renamed Paid Trader' }],
    ['/api/auth/update-profile', { avatar: 'data:image/png;base64,dGVzdA==' }],
    ['/api/auth/update-profile', { avatar: '' }],
    ['/api/auth/preferences', { theme: 'light', isPro: false, plan: 'free' }, 'PATCH'],
    ['/api/auth/update-profile', { name: 'Final Paid Name', email: 'attacker@example.invalid', isPro: false, plan: 'free', proUntil: null }],
  ]) {
    paid((await api(route, cookie, body, method)).user, original);
    paid((await api('/api/auth/me', cookie)).user, original);
  }
  console.log('PASS: real HTTP profile/avatar/settings changes and refresh preserve Pro, ID and expiry');
  await api('/api/auth/logout', cookie, {});
  const signedOut = await fetch(base + '/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal(signedOut.status, 401);
  const relogin = await signInOrRegister(base, email, password);
  cookie = relogin.cookie; paid(relogin.user, original);
  assert.equal(relogin.user.name, 'Final Paid Name');
  console.log('PASS: logout invalidates session; new login retains saved name and Pro');
  // A tenant-scoped file save must not erase another customer's records.
  const otherEmail = `other_${Date.now()}@example.invalid`;
  const other = await signInOrRegister(base, otherEmail, password);
  assert.equal(other.status, 200);
  const otherAccount = (await api('/api/accounts', other.cookie)).accounts[0];
  const otherTrade = await api('/api/trades', other.cookie, {
    accountId: otherAccount.id, symbol: 'GBPUSD', type: 'Sell', lotSize: 0.1,
    entryPrice: 1.27, exitPrice: 1.26, profit: 75, commission: 0, swap: 0,
  });
  const deleted = await api('/api/trades', other.cookie, {
    accountId: otherAccount.id, symbol: 'GBPUSD', type: 'Sell', lotSize: 0.1,
    entryPrice: 1.27, exitPrice: 1.26, profit: 20, commission: 0, swap: 0,
  });
  await api(`/api/trades/${deleted.trade.id}`, other.cookie, undefined, 'DELETE');
  await stop(); await start();
  const restarted = await signInOrRegister(base, email, password);
  paid(restarted.user, original);
  assert.equal(restarted.user.name, 'Final Paid Name');
  cookie = restarted.cookie;
  const restoredAccounts = (await api('/api/accounts', cookie)).accounts;
  const restoredTrades = (await api('/api/trades', cookie)).trades;
  assert.ok(restoredAccounts.some(a => a.id === portfolio.id), 'portfolio survives restart');
  assert.ok(restoredTrades.some(t => t.id === recorded.trade.id), 'recorded trade survives restart');
  const otherRestored = await signInOrRegister(base, otherEmail, password);
  assert.equal(otherRestored.status, 200);
  const otherTrades = (await api('/api/trades', otherRestored.cookie)).trades;
  assert.ok(otherTrades.some(t => t.id === otherTrade.trade.id), 'other tenant trade survives restart');
  assert.ok(!otherTrades.some(t => t.id === recorded.trade.id), 'other tenant cannot see first tenant trade');
  assert.ok(!otherTrades.some(t => t.id === deleted.trade.id), 'deleted trade stays deleted after restart');
  console.log('PASS: server restart and fresh login preserve paid profile in persistent storage');
  await api('/api/payments/toggle-test-tier', cookie, { tier: 'free' });
  const free = await api('/api/auth/update-profile', cookie, { name: 'Free Name', isPro: true, plan: 'pro' });
  assert.equal(free.user.isPro, false);
  assert.equal((await api('/api/auth/me', cookie)).user.isPro, false);
  console.log('PASS: Free profile cannot gain Pro by forging update fields');
  if (process.argv.includes('--related') || audit) {
    const results = [];
    const suites = audit ? readdirSync(path.join(root, 'tests')).filter(n => n.endsWith('.test.mjs')) : ['security.test.mjs', 'pro-unlock.test.mjs'];
    for (const suite of suites) {
      await stop();
      if (audit) env.ALLOW_TEST_BILLING = suite === 'pro-unlock.test.mjs' ? 'true' : 'false';
      await start();
      let output = '';
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'tests', suite)], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', b => { output += b; });
        child.stderr.on('data', b => { output += b; });
        const timeout = setTimeout(() => child.kill(), 90000);
        child.on('error', reject); child.on('exit', resolve);
        child.on('exit', () => clearTimeout(timeout));
      });
      const passed = code === 0 && !/^\s*FAIL\b/m.test(output) && !/SKIPPED/.test(output);
      results.push({ suite, code, passed, output });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${suite}\n${output}`);
      if (!audit) assert.equal(code, 0, `${suite} failed`);
      if (audit) {
        await stop();
        dir = mkdtempSync(path.join(tmpdir(), 'fxjp-audit-'));
      }
    }
    if (audit) {
      writeFileSync(path.join(root, '.env.audit-results.json'), JSON.stringify(results, null, 2));
      process.exitCode = results.every(r => r.passed) ? 0 : 1;
    }
  }
} finally {
  await stop();
  writeFileSync(path.join(dir, 'server.log'), serverLog);
  console.log('Test data isolated from workspace and production.');
}
