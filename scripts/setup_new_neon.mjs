import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

const NEW_URL = "postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const pool = new Pool({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log('--- Applying neon_setup.sql to NEW database ---');
    const sql = fs.readFileSync('neon_setup.sql', 'utf8');
    await pool.query(sql);
    console.log('✅ neon_setup.sql executed successfully!');

    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('Created Tables in NEW DB:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

main();
