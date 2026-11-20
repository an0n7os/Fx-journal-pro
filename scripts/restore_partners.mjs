import fs from 'fs';
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const backup = JSON.parse(fs.readFileSync('c:/Users/aswin/Downloads/fxjp-supabase-FULL-backup-2026-10-03.json', 'utf8'));
const list = backup.tables.partner_profiles || [];

async function run() {
  let count = 0;
  for (const p of list) {
    try {
      await pool.query(
        'INSERT INTO partner_profiles (user_id, referral_code, created_at, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING;',
        [p.user_id, p.referral_code, p.created_at || new Date().toISOString(), p.created_by]
      );
      count++;
    } catch (e) {
      console.warn('Partner profile row error:', e.message);
    }
  }
  console.log(`✅ partner_profiles: ${count} / ${list.length} rows restored.`);
  await pool.end();
}
run();
