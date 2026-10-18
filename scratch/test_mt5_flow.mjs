import { signInOrRegister } from '../tests/auth-helper.mjs';

const BASE = 'http://localhost:3000';

async function run() {
  console.log('Testing MT5 Pro flow on Neon DB:');
  const admin = await signInOrRegister(BASE, 'dev@localhost', 'Demo@12345');
  console.log('1. Admin logged in:', !!admin.cookie);

  const stamp = Date.now();
  const email = `mt5_user_${stamp}@example.com`;
  const trader = await signInOrRegister(BASE, email, 'TestPass123!');
  console.log('2. Trader registered:', trader.user.id);

  // Upgrade to Pro
  const planRes = await fetch(`${BASE}/api/admin/users/${trader.user.id}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ isPro: true })
  });
  console.log('3. Upgraded to Pro:', planRes.status);

  // Re-login to get updated pro status
  const traderPro = await signInOrRegister(BASE, email, 'TestPass123!');
  console.log('4. Trader Pro verified:', traderPro.user.isPro);

  // Create MT5 account
  const accRes = await fetch(`${BASE}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: traderPro.cookie },
    body: JSON.stringify({
      name: 'MT5 Pro Account',
      broker: 'MetaTrader 5',
      startingBalance: 10000,
      currency: 'USD',
      isMt5Sync: true
    })
  });
  const accJson = await accRes.json();
  const accountId = accJson.account?.id;
  console.log('5. MT5 Account Created:', accRes.status, 'Account ID:', accountId);

  // Download EA
  const dlRes = await fetch(`${BASE}/api/mt5/ea/${accountId}/download`, {
    headers: { Cookie: traderPro.cookie }
  });
  const eaCode = await dlRes.text();
  const tokenMatch = eaCode.match(/"(ea_[A-Za-z0-9_]+)"/);
  console.log('6. EA Downloaded:', dlRes.status, 'Length:', eaCode.length, 'Token:', tokenMatch ? tokenMatch[1] : 'NONE');

  // Check Account Status
  const statusRes = await fetch(`${BASE}/api/mt5/${accountId}/status`, {
    headers: { Cookie: traderPro.cookie }
  });
  const statusJson = await statusRes.json();
  console.log('7. MT5 Status:', statusJson);

  console.log('\n--- MT5 PRO FLOW VERIFICATION COMPLETE! ---');
}

run().catch(console.error);
