// Tells you exactly what is still missing before launch, and generates the
// secrets you have to generate yourself.
//
//   npm run launch:check              what is live, what is missing
//   npm run launch:check -- --secrets also print fresh secrets to paste
//
// It reads nothing private and sends nothing anywhere: the live checks are
// plain unauthenticated GETs against the public site, and the secrets are
// generated here and printed to this terminal only. Nothing is written to a
// file, because a generated secret belongs in the Netlify dashboard and
// nowhere else in this repository.
import crypto from 'node:crypto';

const SITE = process.env.LAUNCH_CHECK_SITE?.trim() || 'https://www.fxjournalpro.com';
const WANT_SECRETS = process.argv.includes('--secrets');

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`);
const bad = (m) => console.log(`  \x1b[31mTODO\x1b[0m  ${m}`);
const warn = (m) => console.log(`  \x1b[33m?\x1b[0m     ${m}`);

const get = async (path) => {
  try {
    const res = await fetch(SITE + path, { redirect: 'follow' });
    let body = null;
    try { body = await res.json(); } catch { /* not json, status is enough */ }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { message: String(err) } };
  }
};

console.log(`\nChecking ${SITE}\n`);

// ── Payments ──────────────────────────────────────────────────────────────
const pay = await get('/api/payments/config');
if (pay.status !== 200) {
  bad(`/api/payments/config answered ${pay.status} — the API is not responding`);
} else if (!pay.body?.configured) {
  bad('Cashfree is not configured. Netlify > Site configuration > Environment variables:');
  console.log('          CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=production');
  console.log('        Then Cashfree > Developers > Webhooks:');
  console.log(`          ${SITE}/api/payments/webhook   event: PAYMENT_SUCCESS_WEBHOOK`);
  console.log('        Without the webhook, money arrives and nobody is upgraded.');
} else if (pay.body.mode !== 'production') {
  warn(`Cashfree is configured but in ${pay.body.mode} mode — set CASHFREE_ENV=production for real payments`);
} else {
  ok(`Cashfree live (₹${pay.body.amountRupees})`);
}

// ── MT5 automatic sync ────────────────────────────────────────────────────
//
// An unauthenticated POST is enough to tell the three states apart: 401 means
// the route is live and refusing a bad token, 503 means the deployment has the
// feature switched off, 404 means this build does not have the route at all.
const worker = await fetch(SITE + '/api/mt5/worker/claim', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer launch-check-probe' },
  body: '{}',
}).then((r) => r.status).catch(() => 0);

if (worker === 401) ok('MT5 auto-sync is configured (the worker endpoint is live)');
else if (worker === 503) bad('MT5 auto-sync is off. Set MT5_VPS_SYNC_ENABLED=true, MT5_WORKER_TOKEN, MT5_CREDENTIAL_MASTER_KEY');
else if (worker === 404) bad('MT5 worker endpoint missing — this build predates it, redeploy');
else warn(`MT5 worker endpoint answered ${worker}`);

// ── FX News ───────────────────────────────────────────────────────────────
const news = await get('/api/fx-news?limit=1');
if (news.status === 200) ok('FX News is configured');
else if (news.body?.code === 'NOT_CONFIGURED') bad('FX News needs ALPHA_VANTAGE_API_KEY (free key at alphavantage.co)');
else warn(`/api/fx-news answered ${news.status}`);

// ── Bot protection on signup ──────────────────────────────────────────────
//
// The widget only renders when VITE_TURNSTILE_SITE_KEY was present at BUILD
// time, so its absence from the shipped bundle is the honest check.
try {
  const html = await fetch(SITE + '/').then((r) => r.text());
  const entry = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  const js = entry ? await fetch(`${SITE}/${entry}`).then((r) => r.text()) : '';
  if (js.includes('challenges.cloudflare.com')) ok('Turnstile is in the shipped bundle');
  else bad('No bot protection on signup. Set TURNSTILE_SECRET_KEY and VITE_TURNSTILE_SITE_KEY, then REDEPLOY (the site key is read at build time)');
} catch {
  warn('Could not read the shipped bundle to check Turnstile');
}

// ── Icons ─────────────────────────────────────────────────────────────────
const ico = await fetch(SITE + '/favicon.ico').then((r) => r.headers.get('content-type') || '').catch(() => '');
if (ico.includes('icon')) ok('favicon.ico is a real icon');
else bad(`/favicon.ico is serving "${ico}" — redeploy`);

// ── Secrets ───────────────────────────────────────────────────────────────
if (WANT_SECRETS) {
  console.log('\n\x1b[1mFresh secrets — paste into Netlify, then delete this output\x1b[0m');
  console.log('  Do not paste these into a chat, an issue, or a commit.\n');
  console.log(`  MT5_WORKER_TOKEN=${crypto.randomBytes(48).toString('hex')}`);
  console.log(`  MT5_CREDENTIAL_MASTER_KEY=${crypto.randomBytes(32).toString('hex')}`);
  console.log(`  SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
  console.log(`  BETTER_AUTH_SECRET=${crypto.randomBytes(32).toString('hex')}`);
  console.log('\n  MT5_CREDENTIAL_MASTER_KEY: if one is ALREADY set in production, keep it.');
  console.log('  Replacing it makes every stored investor password unreadable and every');
  console.log('  connected customer has to reconnect.');
  console.log('  Rotating BETTER_AUTH_SECRET signs everyone out, which is the point when');
  console.log('  the old one has been published.');
} else {
  console.log('\n  Run with --secrets to generate the values you need to paste.');
}

console.log('');
