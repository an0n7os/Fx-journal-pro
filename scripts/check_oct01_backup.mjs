import fs from 'fs';
import path from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const dir = 'c:\\Users\\aswin\\Downloads';
  const jsonFile = path.join(dir, 'fxjp-test-rows-backup-2026-10-01.json');
  const backup = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  console.log('=== Checking fxjp-test-rows-backup-2026-10-01.json ===');
  console.log(`users count: ${Array.isArray(backup.users) ? backup.users.length : typeof backup.users}`);
  console.log(`tables.trading_accounts count: ${backup.tables?.trading_accounts?.length}`);
  console.log(`tables.trades count: ${backup.tables?.trades?.length}`);
  console.log(`tables.risk_settings count: ${backup.tables?.risk_settings?.length}`);

  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trading_accounts'");
  console.log('trading_accounts columns:', cols.rows.map(r => r.column_name));

  const neonAccounts = await pool.query('SELECT id, user_id, name FROM trading_accounts');
  const neonAccountIds = new Set(neonAccounts.rows.map(r => r.id));

  const neonTrades = await pool.query('SELECT id, user_id, symbol FROM trades');
  const neonTradeIds = new Set(neonTrades.rows.map(r => r.id));

  const neonUsers = await pool.query('SELECT id, email FROM users');
  const neonUserEmails = new Set(neonUsers.rows.map(r => r.email?.toLowerCase()));
  const neonUserIds = new Set(neonUsers.rows.map(r => r.id));

  // Check accounts in 2026-10-01 backup missing from Neon
  const missingAccounts = (backup.tables?.trading_accounts || []).filter(
    a => !neonAccountIds.has(a.id)
  );
  console.log(`\nTrading Accounts in Oct 01 backup NOT in Neon: ${missingAccounts.length} out of ${backup.tables?.trading_accounts?.length}`);
  if (missingAccounts.length > 0) {
    console.log('Sample missing accounts (first 10):');
    console.log(missingAccounts.slice(0, 10).map(a => ({ id: a.id, user_id: a.user_id, name: a.name, account_number: a.account_number })));
  }

  // Check trades in 2026-10-01 backup missing from Neon
  const missingTrades = (backup.tables?.trades || []).filter(
    t => !neonTradeIds.has(t.id) && (!t.ticket || !neonTickets.has(t.ticket))
  );
  console.log(`\nTrades in Oct 01 backup NOT in Neon: ${missingTrades.length} out of ${backup.tables?.trades?.length}`);
  if (missingTrades.length > 0) {
    console.log('Sample missing trades (first 10):');
    console.log(missingTrades.slice(0, 10).map(t => ({ id: t.id, user_id: t.user_id, symbol: t.symbol, profit: t.profit })));
  }

  // Check users in 2026-10-01 backup
  const bUsers = Array.isArray(backup.users) ? backup.users : (backup.tables?.users || []);
  const missingBUsers = bUsers.filter(u => !neonUserEmails.has(u.email?.toLowerCase()) && !neonUserIds.has(u.id));
  console.log(`\nUsers in Oct 01 backup NOT in Neon: ${missingBUsers.length} out of ${bUsers.length}`);
  if (missingBUsers.length > 0) {
    console.log('Missing users:', missingBUsers.map(u => ({ email: u.email, id: u.id })));
  }

  await pool.end();
}

check().catch(console.error);
