import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const accounts = await pool.query(`
    SELECT id, user_id, name, broker, mt5_login, mt5_server, connection_status, ea_status, investor_password_enc IS NOT NULL as has_pw
    FROM trading_accounts 
    WHERE mt5_server ILIKE '%Exness%' OR name ILIKE '%Exness%' OR id IN ('acc_70a26436-0c73-431a-8f1f-91bff9bc0502', 'acc_e02d12f7-39e8-4668-a966-f21ef8a36c54')
  `);
  console.log('Accounts:', accounts.rows);

  const jobs = await pool.query(`
    SELECT id, account_id, status, error, error_code, created_at, finished_at
    FROM mt5_connect_jobs
    ORDER BY created_at DESC
    LIMIT 6
  `);
  console.log('Latest 6 jobs:', jobs.rows);

  await pool.end();
}

check().catch(console.error);
