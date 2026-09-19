const puppeteer = require('puppeteer');
const http = require('http');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ statusCode: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };
const pass = (msg) => console.log('PASS: ' + msg);

(async () => {
  const uid = 'mobile_' + Date.now();
  const email = `mobile_${Date.now()}@test.com`;
  await request({
    hostname: 'localhost', port: 3000, path: '/api/auth/register', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-user-id': uid, 'x-auth-email': email }
  }, { id: uid, email, name: 'Mobile Tester', isEmailVerified: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2' });
  await page.evaluate((u, e) => {
    sessionStorage.setItem('auth_user_id', u);
    sessionStorage.setItem('auth_email', e);
  }, uid, email);

  // ---- MOBILE (375px) ----
  await page.setViewport({ width: 375, height: 720, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  const welcomeMobile = await page.evaluate(() => document.body.innerText.includes('Welcome to FX Journal Pro'));
  if (!welcomeMobile) fail('Mobile: welcome card missing');
  pass('Mobile (375px): step 1 welcome card renders');

  const overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflowMobile) fail('Mobile: horizontal overflow detected on step 1');
  pass('Mobile (375px): no horizontal overflow on step 1');

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Get Started'));
    if (b) b.click();
  });
  await sleep(900);
  const tooltipMobile = await page.evaluate(() => document.body.innerText.includes('Create Your Portfolio'));
  if (!tooltipMobile) fail('Mobile: step 2 tooltip missing');
  pass('Mobile (375px): step 2 tooltip renders');
  const tooltipW = await page.evaluate(() => {
    const t = document.querySelector('[role="dialog"] .absolute');
    return t ? t.getBoundingClientRect().width : 0;
  });
  if (tooltipW <= 0 || tooltipW > 375) fail('Mobile: tooltip width ' + tooltipW + ' out of range');
  pass('Mobile (375px): tooltip width ' + tooltipW + 'px fits viewport');
  const tooltipOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (tooltipOverflow) fail('Mobile: horizontal overflow on step 2');
  pass('Mobile (375px): no horizontal overflow on step 2');

  // ---- DARK MODE ----
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2200);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (!isDark) fail('Dark: <html> missing dark class');
  pass('Dark mode: html.dark applied');
  const welcomeDark = await page.evaluate(() => document.body.innerText.includes('Welcome to FX Journal Pro'));
  if (!welcomeDark) fail('Dark: welcome card missing');
  pass('Dark mode: welcome card renders');

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Get Started'));
    if (b) b.click();
  });
  await sleep(900);
  const createDark = await page.evaluate(() => document.body.innerText.includes('Create Your Portfolio'));
  if (!createDark) fail('Dark: step 2 tooltip missing');
  pass('Dark mode: step 2 tooltip renders');

  if (errors.length) fail('Page errors: ' + errors.join(' | '));
  pass('No page errors (mobile + dark)');
  console.log('--- MOBILE & DARK MODE TESTS PASSED ---');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
