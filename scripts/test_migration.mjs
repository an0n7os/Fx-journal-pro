import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const OLD_URL = "postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const NEW_URL = "postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function testOld() {
  const oldPool = new Pool({ connectionString: OLD_URL, ssl: { rejectUnauthorized: false } });
  try {
    const res = await oldPool.query('SELECT count(*) FROM users;');
    console.log('Old users count:', res.rows[0]);
  } catch (err) {
    console.error('Old DB read error:', err.message);
  } finally {
    await oldPool.end();
  }
}

async function testNew() {
  const newPool = new Pool({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false } });
  try {
    const res = await newPool.query('SELECT current_database(), version();');
    console.log('New DB connected:', res.rows[0]);
  } catch (err) {
    console.error('New DB error:', err.message);
  } finally {
    await newPool.end();
  }
}

async function run() {
  await testOld();
  await testNew();
}
run();
