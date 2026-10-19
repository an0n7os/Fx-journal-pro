import fs from 'fs';
import path from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function verifyAllAccountsAndTrades() {
  const dir = 'c:\\Users\\aswin\\Downloads';
  const fullBackup = JSON.parse(fs.readFileSync(path.join(dir, 'fxjp-supabase-FULL-backup-2026-10-03.json'), 'utf8'));

  const backupAccounts = fullBackup.tables.trading_accounts || [];
  const backupTrades = fullBackup.tables.trades || [];
  const backupUsers = fullBackup.tables.users || [];

  const bUserEmailById = new Map();
  backupUsers.forEach(u => bUserEmailById.set(u.id, u.email?.toLowerCase()));

  console.log(`Backup has ${backupAccounts.length} trading_accounts and ${backupTrades.length} trades.`);

  // Neon data
  const neonUsers = await pool.query('SELECT id, email FROM users');
  const neonEmailToId = new Map();
  neonUsers.rows.forEach(u => neonEmailToId.set(u.email?.toLowerCase(), u.id));

  const neonAccounts = await pool.query('SELECT * FROM trading_accounts');
  const neonTrades = await pool.query('SELECT * FROM trades');

  console.log(`Neon has ${neonAccounts.rows.length} trading_accounts and ${neonTrades.rows.length} trades.`);

  // Group accounts by email in Neon
  const neonAccountsByEmail = new Map();
  neonAccounts.rows.forEach(a => {
    const email = neonUsers.rows.find(u => u.id === a.user_id)?.email || 'UNKNOWN';
    if (!neonAccountsByEmail.has(email)) neonAccountsByEmail.set(email, []);
    neonAccountsByEmail.get(email).push(a);
  });

  const neonTradesByEmail = new Map();
  neonTrades.rows.forEach(t => {
    const email = neonUsers.rows.find(u => u.id === t.user_id)?.email || 'UNKNOWN';
    if (!neonTradesByEmail.has(email)) neonTradesByEmail.set(email, []);
    neonTradesByEmail.get(email).push(t);
  });

  console.log('\n=== REAL USER ACCOUNTS & TRADES IN NEON ===');
  for (const [email, accs] of neonAccountsByEmail.entries()) {
    if (!email.includes('example') && !email.includes('invalid') && !email.includes('test')) {
      const trCount = neonTradesByEmail.get(email)?.length || 0;
      console.log(`Trader: ${email} -> ${accs.length} accounts, ${trCount} trades`);
      accs.forEach(a => console.log(`    Account: "${a.name}" (broker: ${a.broker || 'none'}, balance: ${a.balance || 0}, id: ${a.id})`));
    }
  }

  await pool.end();
}

verifyAllAccountsAndTrades().catch(console.error);
