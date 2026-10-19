import fs from 'fs';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkOwnership() {
  const backupPath = 'c:\\Users\\aswin\\Downloads\\fxjp-supabase-FULL-backup-2026-10-03.json';
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  const backupUsers = backup.tables['users'] || [];
  const backupAccounts = backup.tables['trading_accounts'] || [];
  const backupTrades = backup.tables['trades'] || [];

  const bUserById = new Map();
  backupUsers.forEach(u => bUserById.set(u.id, u));

  console.log('=== Backup Users who have trading accounts ===');
  const accountsByUser = new Map();
  backupAccounts.forEach(a => {
    accountsByUser.set(a.user_id, (accountsByUser.get(a.user_id) || 0) + 1);
  });

  for (const [userId, count] of accountsByUser.entries()) {
    const u = bUserById.get(userId);
    console.log(`User ID ${userId} (${u ? u.email : 'UNKNOWN IN BACKUP USERS'}): ${count} accounts`);
  }

  console.log('\n=== Backup Users who have trades ===');
  const tradesByUser = new Map();
  backupTrades.forEach(t => {
    tradesByUser.set(t.user_id, (tradesByUser.get(t.user_id) || 0) + 1);
  });

  for (const [userId, count] of tradesByUser.entries()) {
    const u = bUserById.get(userId);
    console.log(`User ID ${userId} (${u ? u.email : 'UNKNOWN IN BACKUP USERS'}): ${count} trades`);
  }

  // Now let's check what is currently in Neon
  console.log('\n=== Neon DB Current Trading Accounts by User ===');
  const neonAccounts = await pool.query('SELECT user_id, count(*) as count FROM trading_accounts GROUP BY user_id');
  const neonUsers = await pool.query('SELECT id, email FROM users');
  const nUserById = new Map();
  neonUsers.rows.forEach(u => nUserById.set(u.id, u.email));

  for (const r of neonAccounts.rows) {
    console.log(`User ${r.user_id} (${nUserById.get(r.user_id) || 'UNKNOWN'}): ${r.count} accounts`);
  }

  console.log('\n=== Neon DB Current Trades by User ===');
  const neonTrades = await pool.query('SELECT user_id, count(*) as count FROM trades GROUP BY user_id');
  for (const r of neonTrades.rows) {
    console.log(`User ${r.user_id} (${nUserById.get(r.user_id) || 'UNKNOWN'}): ${r.count} trades`);
  }

  await pool.end();
}

checkOwnership().catch(console.error);
