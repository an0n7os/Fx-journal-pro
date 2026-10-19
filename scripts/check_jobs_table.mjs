import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const cols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'mt5_connect_jobs'
  `);
  console.log('mt5_connect_jobs cols:', cols.rows.map(r => r.column_name));

  const jobs = await pool.query(`
    SELECT *
    FROM mt5_connect_jobs
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('Recent jobs:', jobs.rows.map(j => ({
    id: j.id,
    account_id: j.account_id,
    status: j.status,
    last_error: j.last_error,
    error_code: j.error_code,
    created_at: j.created_at,
    finished_at: j.finished_at
  })));

  await pool.end();
}

check().catch(console.error);
