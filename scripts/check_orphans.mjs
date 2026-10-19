import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkOrphans() {
  const users = await pool.query('SELECT id, email FROM users');
  const userIds = new Set(users.rows.map(r => r.id));
  const emailMap = new Map();
  users.rows.forEach(r => emailMap.set(r.email?.toLowerCase(), r.id));

  const authUsers = await pool.query('SELECT id, email FROM "user"');
  const authUserIds = new Set(authUsers.rows.map(r => r.id));

  console.log(`Total users in users: ${userIds.size}`);
  console.log(`Total users in "user" (Better Auth): ${authUserIds.size}`);

  // Check accounts
  const accounts = await pool.query('SELECT id, user_id, name FROM trading_accounts');
  const orphanAccounts = accounts.rows.filter(a => !userIds.has(a.user_id));
  console.log(`\nOrphan accounts (user_id not in users): ${orphanAccounts.length}`);
  if (orphanAccounts.length > 0) {
    console.log(orphanAccounts);
  }

  // Check trades
  const trades = await pool.query('SELECT id, user_id, symbol, account_id FROM trades');
  const orphanTrades = trades.rows.filter(t => !userIds.has(t.user_id));
  console.log(`\nOrphan trades (user_id not in users): ${orphanTrades.length}`);
  if (orphanTrades.length > 0) {
    console.log(orphanTrades.slice(0, 5));
  }

  // Check trades where account_id does not exist in trading_accounts
  const accountIds = new Set(accounts.rows.map(r => r.id));
  const tradesWithoutAccount = trades.rows.filter(t => t.account_id && !accountIds.has(t.account_id));
  console.log(`\nTrades with missing account_id: ${tradesWithoutAccount.length}`);

  // Check users where id in "users" differs from id in "user" (Better Auth)
  let mismatchedIds = 0;
  for (const au of authUsers.rows) {
    const u = users.rows.find(x => x.email?.toLowerCase() === au.email?.toLowerCase());
    if (u && u.id !== au.id) {
      mismatchedIds++;
      console.log(`Mismatch for ${au.email}: Better Auth id=${au.id}, users id=${u.id}`);
    }
  }
  console.log(`\nUsers with mismatched ID between "user" and "users": ${mismatchedIds}`);

  await pool.end();
}

checkOrphans().catch(console.error);
