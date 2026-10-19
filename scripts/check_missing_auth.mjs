import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkMissingInAuth() {
  const users = await pool.query('SELECT id, email, name, role, created_at FROM users');
  const authUsers = await pool.query('SELECT id, email FROM "user"');
  const authEmails = new Set(authUsers.rows.map(r => r.email?.toLowerCase()));

  const notInAuth = users.rows.filter(u => !authEmails.has(u.email?.toLowerCase()));
  console.log(`Users in "users" but NOT in Better Auth "user": ${notInAuth.length}`);
  for (const u of notInAuth) {
    console.log(`  ID: ${u.id}, Email: ${u.email}, Name: ${u.name}`);
  }

  await pool.end();
}

checkMissingInAuth().catch(console.error);
