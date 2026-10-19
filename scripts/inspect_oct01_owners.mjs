import fs from 'fs';
import path from 'path';

const dir = 'c:\\Users\\aswin\\Downloads';
const oct01Backup = JSON.parse(fs.readFileSync(path.join(dir, 'fxjp-test-rows-backup-2026-10-01.json'), 'utf8'));

console.log('--- Inspecting Oct 01 Missing Accounts ---');
const accounts = oct01Backup.tables?.trading_accounts || [];
const trades = oct01Backup.tables?.trades || [];
const users = oct01Backup.users || [];

const userMap = new Map();
users.forEach(u => userMap.set(u.id, u.email));

console.log(`Total accounts in Oct 01: ${accounts.length}`);
const accByUser = new Map();
for (const a of accounts) {
  const email = userMap.get(a.user_id) || a.user_id;
  accByUser.set(email, (accByUser.get(email) || 0) + 1);
}
console.log('Accounts by user/email:');
for (const [k, v] of accByUser.entries()) {
  console.log(`  ${k}: ${v} accounts`);
}

console.log('\nTotal trades in Oct 01:', trades.length);
const tradesByUser = new Map();
for (const t of trades) {
  const email = userMap.get(t.user_id) || t.user_id;
  tradesByUser.set(email, (tradesByUser.get(email) || 0) + 1);
}
console.log('Trades by user/email:');
for (const [k, v] of tradesByUser.entries()) {
  console.log(`  ${k}: ${v} trades`);
}
