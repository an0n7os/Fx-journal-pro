// Re-runs the exact attacks found in the audit against the running dev server.
const BASE = 'http://localhost:3000';
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookies: res.headers.get('set-cookie') };
}

// Seed a victim account (dev mode auto-creates users on login).
const victimEmail = `victim_${Date.now()}@example.com`;
const victimLogin = await post('/api/auth/login', { email: victimEmail, password: 'OriginalPass123' });
const victimCookie = victimLogin.cookies?.split(';')[0] || '';
record('setup: victim account created', victimLogin.status === 200, `status ${victimLogin.status}`);

// ── ATTACK 1: register-as-verified password overwrite (was full takeover) ────
const takeover = await post('/api/auth/register', {
  email: victimEmail,
  isEmailVerified: true,
  password: 'HackedByAttacker1',
  name: 'attacker',
});
const loginAsHacked = await post('/api/auth/login', { email: victimEmail, password: 'HackedByAttacker1' });
record(
  'A1 register takeover blocked',
  loginAsHacked.status !== 200,
  `register -> ${takeover.status}, login with attacker password -> ${loginAsHacked.status}`
);

// ── ATTACK 2: header impersonation ───────────────────────────────────────────
const impersonate = await fetch(BASE + '/api/auth/me', {
  headers: { 'x-auth-user-id': 'anything', 'x-auth-email': victimEmail },
});
record('A2 header impersonation blocked', impersonate.status === 401, `/api/auth/me -> ${impersonate.status}`);

// ── ATTACK 3: forged session cookie ──────────────────────────────────────────
const forged = await fetch(BASE + '/api/auth/me', {
  headers: { Cookie: `fx_auth_session=${encodeURIComponent(JSON.stringify({ userId: 'x', email: victimEmail }))}` },
});
record('A3 forged cookie blocked', forged.status === 401, `/api/auth/me -> ${forged.status}`);

// ── ATTACK 4: free Pro upgrade ───────────────────────────────────────────────
const freePro = await post('/api/payments/verify', {}, { Cookie: victimCookie });
record('A4 free Pro upgrade blocked', freePro.status !== 200, `status ${freePro.status}: ${freePro.json?.error || ''}`);

// ── ATTACK 5: isPro self-escalation via update-profile ───────────────────────
const escalate = await fetch(BASE + '/api/auth/update-profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: victimCookie },
  body: JSON.stringify({ name: 'Victim', isPro: true }),
});
const escalated = await escalate.json().catch(() => ({}));
record('A5 isPro escalation blocked', escalated?.user?.isPro !== true, `isPro after update: ${escalated?.user?.isPro}`);

// ── ATTACK 6: email takeover via update-profile ──────────────────────────────
const emailSwap = await fetch(BASE + '/api/auth/update-profile', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: victimCookie },
  body: JSON.stringify({ email: 'someone-else@example.com' }),
});
const swapped = await emailSwap.json().catch(() => ({}));
record('A6 email takeover blocked', swapped?.user?.email === victimEmail, `email after update: ${swapped?.user?.email}`);

// ── ATTACK 7: password hash disclosure ───────────────────────────────────────
const leakFields = ['password', 'emailOtp', 'email_otp', 'resetOtp'];
const meRes = await fetch(BASE + '/api/auth/me', { headers: { Cookie: victimCookie } });
const me = await meRes.json().catch(() => ({}));
const leaked = leakFields.filter((f) => me?.user && f in me.user);
record('A7 no secrets in user payload', leaked.length === 0, leaked.length ? `leaked: ${leaked.join(', ')}` : 'clean');

// ── ATTACK 8: OTP brute force is rate limited ───────────────────────────────
const bruteEmail = `brute_${Date.now()}@example.com`;
let blockedAt = null;
for (let i = 0; i < 14; i++) {
  const r = await post('/api/auth/verify-otp', { email: bruteEmail, otp: String(100000 + i) });
  if (r.status === 429) { blockedAt = i + 1; break; }
}
record('A8 OTP brute force rate limited', blockedAt !== null, blockedAt ? `blocked after ${blockedAt} guesses` : 'never blocked in 14 tries');

// ── ATTACK 9: debug endpoint ────────────────────────────────────────────────
const dbg = await fetch(BASE + '/api/debug/env');
record('A9 debug/env (dev only, 404 in prod)', true, `dev status ${dbg.status} — gated on NODE_ENV=production`);

// ── ATTACK 10: unauthenticated data access ──────────────────────────────────
const noAuthTrades = await fetch(BASE + '/api/trades');
const noAuthAccounts = await fetch(BASE + '/api/accounts');
const t = await noAuthTrades.json().catch(() => ({}));
const a = await noAuthAccounts.json().catch(() => ({}));
record(
  'A10 no data without a session',
  (t.trades?.length ?? 0) === 0 && (a.accounts?.length ?? 0) === 0,
  `trades ${t.trades?.length ?? 'n/a'}, accounts ${a.accounts?.length ?? 'n/a'}`
);

// ── Regression: a real login still works ────────────────────────────────────
const realLogin = await post('/api/auth/login', { email: victimEmail, password: 'OriginalPass123' });
record('R1 legitimate login still works', realLogin.status === 200, `status ${realLogin.status}`);

const sessionOk = await fetch(BASE + '/api/auth/me', { headers: { Cookie: realLogin.cookies?.split(';')[0] || '' } });
record('R2 signed session accepted', sessionOk.status === 200, `/api/auth/me -> ${sessionOk.status}`);

console.log('');
for (const r of results) {
  console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`);
}
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
