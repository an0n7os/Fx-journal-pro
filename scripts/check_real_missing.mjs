import fs from 'fs';
import path from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkReal() {
  const dir = 'c:\\Users\\aswin\\Downloads';
  const fullBackup = JSON.parse(fs.readFileSync(path.join(dir, 'fxjp-supabase-FULL-backup-2026-10-03.json'), 'utf8'));
  const oct01Backup = JSON.parse(fs.readFileSync(path.join(dir, 'fxjp-test-rows-backup-2026-10-01.json'), 'utf8'));

  const neonAccounts = await pool.query('SELECT id, user_id, name FROM trading_accounts');
  const neonTrades = await pool.query('SELECT id, user_id, symbol FROM trades');
  const neonUsers = await pool.query('SELECT id, email FROM users');

  const neonAccIds = new Set(neonAccounts.rows.map(r => r.id));
  const neonTradeIds = new Set(neonTrades.rows.map(r => r.id));
  const neonEmailMap = new Map();
  neonUsers.rows.forEach(r => neonEmailMap.set(r.email?.toLowerCase(), r.id));

  console.log(`Neon Current: ${neonUsers.rows.length} users, ${neonAccounts.rows.length} accounts, ${neonTrades.rows.length} trades`);

  // Check FULL backup (Oct 03)
  console.log('\n--- Checking Oct 03 Full Backup ---');
  let missingAccountsFull = 0;
  for (const acc of fullBackup.tables.trading_accounts || []) {
    if (!neonAccIds.has(acc.id)) {
      missingAccountsFull++;
      console.log('Missing Account from Oct 03:', acc.id, acc.name, acc.user_id);
    }
  }
  let missingTradesFull = 0;
  for (const tr of fullBackup.tables.trades || []) {
    if (!neonTradeIds.has(tr.id)) {
      missingTradesFull++;
    }
  }
  console.log(`Oct 03 missing accounts: ${missingAccountsFull}, missing trades: ${missingTradesFull}`);

  // Check Oct 01 Backup
  console.log('\n--- Checking Oct 01 Backup ---');
  let missingAccounts01 = 0;
  for (const acc of oct01Backup.tables?.trading_accounts || []) {
    if (!neonAccIds.has(acc.id)) {
      missingAccounts01++;
    }
  }
  let missingTrades01 = 0;
  for (const tr of oct01Backup.tables?.trades || []) {
    if (!neonTradeIds.has(tr.id)) {
      missingTrades01++;
    }
  }
  console.log(`Oct 01 missing accounts: ${missingAccounts01}, missing trades: ${missingTrades01}`);

  await pool.end();
}

checkReal().catch(console.error);
