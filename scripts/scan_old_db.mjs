import pg from 'pg';

const OLD_URL = "postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

async function scanOldDb() {
  const pool = new pg.Pool({ connectionString: OLD_URL, ssl: { rejectUnauthorized: false } });
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log(`Found ${res.rows.length} tables in OLD database:`);
    const counts = [];
    for (const row of res.rows) {
      try {
        const c = await pool.query(`SELECT count(*) FROM "${row.table_name}";`);
        counts.push({ table: row.table_name, rows: parseInt(c.rows[0].count) });
      } catch (e) {
        counts.push({ table: row.table_name, rows: 'ERROR: ' + e.message });
      }
    }
    console.table(counts);
  } catch (err) {
    console.error('Scan error:', err);
  } finally {
    await pool.end();
  }
}

scanOldDb();
