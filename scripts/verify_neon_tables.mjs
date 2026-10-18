import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('Total Tables:', res.rows.length);
  console.log('Tables:', res.rows.map(r => r.table_name));

  // Let's also check rows in each table
  for (const row of res.rows) {
    const t = row.table_name;
    const countRes = await pool.query(`SELECT count(*) FROM "${t}"`);
    console.log(`  ${t.padEnd(30)}: ${countRes.rows[0].count} rows`);
  }

  await pool.end();
}

verify();
