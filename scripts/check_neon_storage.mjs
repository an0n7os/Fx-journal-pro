import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    console.log('--- NEON DATABASE STATUS CHECK ---');
    const connCheck = await pool.query('SELECT current_database(), current_user, version();');
    console.log('Connected to:', connCheck.rows[0].current_database);
    console.log('Postgres version:', connCheck.rows[0].version.split(',')[0]);

    // 1. Overall Database Disk Usage
    const dbSize = await pool.query(`
      SELECT 
        pg_database_size(current_database()) as raw_bytes,
        pg_size_pretty(pg_database_size(current_database())) as formatted_size
    `);
    console.log('\n--- TOTAL DB SIZE ON DISK ---');
    console.log(`Current Size: ${dbSize.rows[0].formatted_size} (${dbSize.rows[0].raw_bytes} bytes)`);

    // 2. Table Breakdown
    const tables = await pool.query(`
      SELECT 
        c.relname AS table_name,
        c.reltuples::bigint AS estimated_rows,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 15;
    `);
    console.log('\n--- TOP TABLES BY DISK USAGE ---');
    console.table(tables.rows);

    // 3. Test Write capability
    console.log('\n--- TESTING READ & WRITE CAPABILITY ---');
    const writeTest = await pool.query(`
      DROP TABLE IF EXISTS _neon_quota_test;
      CREATE TEMP TABLE _neon_quota_test (id serial primary key, val text);
      INSERT INTO _neon_quota_test (val) VALUES ('quota_check_ok');
      SELECT * FROM _neon_quota_test;
    `);
    const finalRows = Array.isArray(writeTest) ? writeTest[writeTest.length - 1].rows : writeTest.rows;
    console.log('Write test result: SUCCESS! Data written & read back successfully:', finalRows[0]);
    console.log('\n>>> VERDICT: Database is currently FULLY OPERATIONAL and accepting READ/WRITE queries! <<<');

  } catch (err) {
    console.error('DATABASE CHECK FAILED:', err);
  } finally {
    await pool.end();
  }
}

main();
