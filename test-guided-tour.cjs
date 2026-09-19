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
  const uid = 'tour_' + Date.now();
  const email = `tour_${Date.now()}@test.com`;

  console.log('1. Registering fresh user (no portfolio)...');
  const reg = await request({
    hostname: 'localhost', port: 3000, path: '/api/auth/register', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-user-id': uid, 'x-auth-email': email }
  }, { id: uid, email, name: 'Tour Tester', isEmailVerified: true });
  if (reg.statusCode !== 200) fail('register: ' + JSON.stringify(reg.body));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2' }).catch(e => fail('goto login: ' + e.message));
  await page.evaluate((u, e) => {
    sessionStorage.setItem('auth_user_id', u);
    sessionStorage.setItem('auth_email', e);
  }, uid, email);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);

  // STEP 1: Welcome card
  const step1 = await page.evaluate(() => document.body.innerText.includes('Welcome to FX Journal Pro'));
  if (!step1) fail('Step 1 welcome card not shown for fresh user');
  pass('Step 1: welcome card shows for fresh user with no portfolio');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const gs = btns.find(b => b.innerText.includes('Get Started'));
    if (gs) gs.click();
  });
  await sleep(900);

  // STEP 2: Create Portfolio tooltip
  const step2 = await page.evaluate(() => document.body.innerText.includes('Create Your Portfolio'));
  if (!step2) fail('Step 2 tooltip not shown');
  pass('Step 2: "Create Your Portfolio" tooltip shown');

  const nextDisabled = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const next = btns.find(b => b.innerText.trim() === 'Next');
    return next ? next.disabled : null;
  });
  if (nextDisabled !== true) fail('Next should be disabled before portfolio created, got: ' + nextDisabled);
  pass('Step 2: Next button disabled until portfolio created');

  const onAccountsTab = await page.evaluate(() => document.body.innerText.includes('Portfolio Accounts'));
  if (!onAccountsTab) fail('Should be on Accounts tab at step 2');
  pass('Step 2: auto-switched to Accounts tab');

  // Click the create-portfolio button through the spotlight hole
  await page.evaluate(() => {
    const el = document.querySelector('[data-tour="create-portfolio"]');
    if (!el) fail('no [data-tour="create-portfolio"]');
    el.click();
  });
  await sleep(600);
  const modalOpen = await page.evaluate(() => document.body.innerText.includes('Manual Account Opening'));
  if (!modalOpen) fail('Account modal did not open through spotlight hole');
  pass('Step 2: clicking through spotlight hole opens account modal');

  // Fill manual account form
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const manual = btns.find(b => b.innerText.includes('Manual Account Opening'));
    if (manual) manual.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const setVal = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const name = inputs.find(i => i.placeholder.includes('Primary Live Scalper'));
    if (name) setVal(name, 'Tour Portfolio');
    const broker = inputs.find(i => i.placeholder === 'IC Markets');
    if (broker) setVal(broker, 'IC Markets');
    const balance = inputs.find(i => i.type === 'number');
    if (balance) setVal(balance, '10000');
  });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const create = btns.find(b => b.innerText.includes('Create Portfolio Account'));
    if (create) create.click();
  });
  await sleep(1800);

  // Auto-advance to Step 3
  const step3 = await page.evaluate(() => document.body.innerText.includes('Add Your First Trade'));
  if (!step3) fail('Did not auto-advance to Step 3 after portfolio created');
  pass('Step 2→3: auto-advanced after portfolio created');

  const addTradeSpotlight = await page.evaluate(() => !!document.querySelector('[data-tour="add-trade"]'));
  if (!addTradeSpotlight) fail('[data-tour="add-trade"] not found on dashboard');
  pass('Step 3: spotlight anchor present on "Add New Trade" button');

  const nextEnabled = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const next = btns.find(b => b.innerText.trim() === 'Next');
    return next ? !next.disabled : null;
  });
  if (!nextEnabled) fail('Next should be enabled at step 3');
  pass('Step 3: Next button enabled');

  // Next -> step 4 done card
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const next = btns.find(b => b.innerText.trim() === 'Next');
    if (next) next.click();
  });
  await sleep(700);
  const step4 = await page.evaluate(() => document.body.innerText.includes('You\'re all set!'));
  if (!step4) fail('Step 4 done card not shown');
  pass('Step 4: "You\'re all set!" card shown');

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const fin = btns.find(b => b.innerText.trim() === 'Finish');
    if (fin) fin.click();
  });
  await sleep(500);

  const flagSet = await page.evaluate(() => localStorage.getItem('journal_tutorial_done'));
  if (flagSet !== '1') fail('journal_tutorial_done flag not set, got: ' + flagSet);
  pass('Completion flag persisted to localStorage');

  const overlayGone = await page.evaluate(() => {
    const dlg = document.querySelector('[aria-label="Onboarding guide"]');
    return dlg === null;
  });
  if (!overlayGone) fail('Tour overlay still present after finish');
  pass('Tour overlay closed after Finish');

  // Reload -> tour must NOT reappear
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2200);
  const noTourAfterReload = await page.evaluate(() => document.querySelector('[aria-label="Onboarding guide"]') === null);
  if (!noTourAfterReload) fail('Tour reappeared after reload despite done flag');
  pass('Tour does not reappear after reload (flag respected)');

  // Settings > Help > Restart Onboarding
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('*'));
    const s = links.find(el => el.tagName === 'BUTTON' && el.innerText.trim() === 'Settings');
    if (s) s.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('button'));
    const help = links.find(b => b.innerText.trim() === 'Help');
    if (help) help.click();
  });
  await sleep(500);
  const helpVisible = await page.evaluate(() => document.body.innerText.includes('Restart Onboarding'));
  if (!helpVisible) fail('Settings > Help tab not showing Restart Onboarding');
  pass('Settings > Help sub-tab shows Restart Onboarding');

  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('button'));
    const restart = links.find(b => b.innerText.includes('Restart Onboarding'));
    if (restart) restart.click();
  });
  await sleep(700);
  const restarted = await page.evaluate(() => document.body.innerText.includes('Welcome to FX Journal Pro'));
  if (!restarted) fail('Restart Onboarding did not reopen the tour');
  pass('Restart Onboarding reopens the tour from step 1');

  // Skip from step 1 persists flag
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const skip = btns.find(b => b.innerText.includes('Skip Tour'));
    if (skip) skip.click();
  });
  await sleep(400);
  const flagAfterSkip = await page.evaluate(() => localStorage.getItem('journal_tutorial_done'));
  if (flagAfterSkip !== '1') fail('Skip Tour did not persist done flag');
  pass('Skip Tour persists done flag');

  // Console error check
  if (errors.length > 0) {
    console.log('CONSOLE ERRORS DURING TEST:\n' + errors.join('\n'));
    fail('Console errors detected');
  }
  pass('No console/page errors during entire tour flow');

  console.log('--- ALL GUIDED TOUR TESTS PASSED ---');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
