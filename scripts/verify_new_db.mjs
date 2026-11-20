import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const tables = [
    'users',
    'user',
    'trading_accounts',
    'trades',
    'risk_settings',
    'payments',
    'partner_profiles',
    'sub_admin_assignments',
    'admin_audit_logs',
    'mt5_deals',
    'mt5_connect_jobs'
  ];

  console.log('=== VERIFYING NEW NEON DATABASE ROW COUNTS ===');
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM "${t}";`);
      console.log(`Table: ${t.padEnd(25)} -> ${res.rows[0].count} rows`);
    } catch (e) {
      console.log(`Table: ${t.padEnd(25)} -> ERROR: ${e.message}`);
    }
  }
  await pool.end();
}

check();
