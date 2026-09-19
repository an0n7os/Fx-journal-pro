import http from 'http';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING MULTI-ACCOUNT ISOLATION TEST SUITE ---');

  const userA_uid = 'uid_user_A_' + Date.now();
  const userA_email = `usera_${Date.now()}@test.com`;

  const userB_uid = 'uid_user_B_' + Date.now();
  const userB_email = `userb_${Date.now()}@test.com`;

  // 1. Register User A
  console.log('1. Registering User A...');
  const regA = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-user-id': userA_uid,
      'x-auth-email': userA_email
    }
  }, {
    id: userA_uid,
    email: userA_email,
    name: 'User A',
    isEmailVerified: true
  });

  if (regA.statusCode !== 200 || !regA.body.user) {
    throw new Error('Failed to register User A: ' + JSON.stringify(regA.body));
  }
  console.log('   User A registered successfully. UID:', userA_uid);

  // 2. Complete Onboarding for User A
  console.log('2. Completing onboarding for User A...');
  const obA = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/onboarding',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-user-id': userA_uid,
      'x-auth-email': userA_email
    }
  }, {
    experience: 'Advanced',
    tradingStyle: 'Swing Trading',
    markets: ['Forex']
  });

  if (obA.statusCode !== 200) {
    throw new Error('Failed onboarding User A: ' + JSON.stringify(obA.body));
  }

  // Get User A accounts
  const accsA = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts',
    method: 'GET',
    headers: { 'x-auth-user-id': userA_uid, 'x-auth-email': userA_email }
  });

  console.log('   DEBUG User A accounts response:', JSON.stringify(accsA.body));

  if (!accsA.body.accounts || accsA.body.accounts.length === 0) {
    throw new Error('User A has no accounts created after onboarding!');
  }
  const accA_id = accsA.body.accounts[0].id;
  console.log('   User A Account created. ID:', accA_id, 'Name:', accsA.body.accounts[0].name);

  // 3. Log a Trade for User A
  console.log('3. Logging trade for User A on Account ID:', accA_id);
  const tradeA = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/trades',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-user-id': userA_uid,
      'x-auth-email': userA_email
    }
  }, {
    accountId: accA_id,
    symbol: 'EURUSD',
    type: 'Buy',
    lotSize: 1.0,
    entryPrice: 1.0850,
    exitPrice: 1.0900,
    profit: 500,
    status: 'Closed',
    strategy: 'Breakout',
    session: 'London',
    date: new Date().toISOString()
  });

  if (tradeA.statusCode !== 200) {
    throw new Error('Failed to log trade for User A: ' + JSON.stringify(tradeA.body));
  }
  console.log('   Trade logged successfully for User A.');

  // Verify User A trades count
  const tradesA = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/trades?accountId=${accA_id}`,
    method: 'GET',
    headers: { 'x-auth-user-id': userA_uid, 'x-auth-email': userA_email }
  });
  console.log('   User A trades count:', tradesA.body.trades?.length);

  // 4. Simulate Logout (User A session cleared) & Register User B
  console.log('4. Simulating LOGOUT of User A & Registering User B...');

  const regB = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-user-id': userB_uid,
      'x-auth-email': userB_email
    }
  }, {
    id: userB_uid,
    email: userB_email,
    name: 'User B',
    isEmailVerified: true
  });

  if (regB.statusCode !== 200 || !regB.body.user) {
    throw new Error('Failed to register User B: ' + JSON.stringify(regB.body));
  }

  // 5. Query User B accounts & trades BEFORE onboarding (must NOT see User A data!)
  console.log('5. Verifying User B has ZERO access to User A accounts or trades...');
  const accsB_initial = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts',
    method: 'GET',
    headers: { 'x-auth-user-id': userB_uid, 'x-auth-email': userB_email }
  });

  console.log('   DEBUG User B initial accounts response:', JSON.stringify(accsB_initial.body));

  const containsAInB = (accsB_initial.body.accounts || []).some(a => a.id && accA_id && a.id === accA_id);
  if (containsAInB) {
    throw new Error('CRITICAL FAIL: User B sees User A account!');
  }
  console.log('   PASSED: User B sees ZERO User A accounts.');

  // 6. Complete User B Onboarding
  console.log('6. Completing onboarding for User B...');
  const obB = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/onboarding',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-user-id': userB_uid,
      'x-auth-email': userB_email
    }
  }, {
    experience: 'Beginner',
    tradingStyle: 'Day Trading',
    markets: ['Gold']
  });

  const accsB = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts',
    method: 'GET',
    headers: { 'x-auth-user-id': userB_uid, 'x-auth-email': userB_email }
  });

  const accB_id = accsB.body.accounts?.[0]?.id;
  console.log('   User B Account created. ID:', accB_id, 'Name:', accsB.body.accounts?.[0]?.name);

  const tradesB = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/trades?accountId=${accB_id}`,
    method: 'GET',
    headers: { 'x-auth-user-id': userB_uid, 'x-auth-email': userB_email }
  });

  if (tradesB.body.trades?.some(t => t.symbol === 'EURUSD')) {
    throw new Error('CRITICAL FAIL: User B sees User A trades!');
  }
  console.log('   PASSED: User B trade list is strictly isolated (0 trades from User A).');

  // 7. Log back in as User A and verify User A data is intact without User B crossover
  console.log('7. Logging back into User A and verifying data integrity...');
  const accsA_recheck = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/accounts',
    method: 'GET',
    headers: { 'x-auth-user-id': userA_uid, 'x-auth-email': userA_email }
  });

  const hasA_acc = accsA_recheck.body.accounts?.some(a => a.id === accA_id);
  const hasB_acc_in_A = accsA_recheck.body.accounts?.some(a => a.id === accB_id);

  if (!hasA_acc || hasB_acc_in_A) {
    throw new Error('CRITICAL FAIL: Data crossover detected on User A re-login!');
  }

  const tradesA_recheck = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/trades?accountId=${accA_id}`,
    method: 'GET',
    headers: { 'x-auth-user-id': userA_uid, 'x-auth-email': userA_email }
  });

  if (tradesA_recheck.body.trades?.length !== 1 || tradesA_recheck.body.trades[0].symbol !== 'EURUSD') {
    throw new Error('CRITICAL FAIL: User A trade lost or corrupted!');
  }

  console.log('   PASSED: User A re-login has 100% intact trade & account data with 0 crossover from User B.');
  console.log('--- ALL MULTI-ACCOUNT ISOLATION TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
