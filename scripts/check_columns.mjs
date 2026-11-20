import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'partner_payout_requests';
    `);
    console.log('Columns in partner_payout_requests:');
    console.table(cols.rows);
  } catch (err) {
    console.error('Error checking columns:', err);
  } finally {
    await pool.end();
  }
}

main();
