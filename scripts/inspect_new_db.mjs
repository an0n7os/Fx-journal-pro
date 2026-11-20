import pg from 'pg';
const { Pool } = pg;

const NEW_URL = "postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const pool = new Pool({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false } });
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('Tables in NEW DB:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}
main();
