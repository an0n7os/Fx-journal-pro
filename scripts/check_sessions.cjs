require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const r = await pool.query('SELECT * FROM "session" ORDER BY "createdAt" DESC LIMIT 5');
  console.log('Recent sessions:', JSON.stringify(r.rows, null, 2));
  await pool.end();
}

run().catch(console.error);
