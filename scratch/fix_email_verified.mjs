import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const res = await pool.query('UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" IS NOT TRUE');
  console.log('Marked emailVerified = true for', res.rowCount, 'users in Better Auth table.');
  await pool.end();
}

run().catch(console.error);
