process.env.DATABASE_URL = "postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

import { autoMigrateBetterAuth } from '../auth.js';
import pg from 'pg';
const { Pool } = pg;

async function run() {
  try {
    console.log('--- Running Better Auth auto-migrations on NEW database ---');
    await autoMigrateBetterAuth();
    console.log('✅ Better Auth tables checked/migrated.');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
    console.log('All tables now in NEW DB:', res.rows.map(r => r.table_name));
    await pool.end();
  } catch (err) {
    console.error('Better Auth migration error:', err);
  }
}

run();
