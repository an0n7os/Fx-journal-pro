import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const job = await pool.query(`
    SELECT id, account_id, status, worker_id, attempts, last_error, created_at, claimed_at, updated_at
    FROM mt5_connect_jobs
    WHERE id = 'job_acc_acc_78d927a5-09dd-48b4-9d99-aa30f9a90d99'
  `);
  console.log('Target Job:', job.rows[0]);

  const acc = await pool.query(`
    SELECT *
    FROM trading_accounts
    WHERE id = 'acc_78d927a5-09dd-48b4-9d99-aa30f9a90d99'
  `);
  console.log('Target Account:', acc.rows[0]);

  await pool.end();
}

check().catch(console.error);
