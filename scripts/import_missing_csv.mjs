import fs from 'fs';
import path from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function importMissingFromCsv() {
  const dir = 'c:\\Users\\aswin\\Downloads';
  const csvFile = path.join(dir, 'Supabase Snippet Untitled query (1).csv');
  const content = fs.readFileSync(csvFile, 'utf8');
  const lines = content.trim().split('\n');

  const neonUsers = await pool.query('SELECT id, email FROM users');
  const neonEmails = new Set(neonUsers.rows.map(r => r.email?.toLowerCase()));

  const toInsert = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const parts = l.split(',');
    if (parts.length >= 2) {
      const id = parts[0].trim();
      const email = parts[1].trim().toLowerCase();
      const createdAt = parts[2] ? parts[2].trim() : new Date().toISOString();
      let name = email.split('@')[0];
      try {
        const metaMatch = l.match(/"?\{.*?\}"?/);
        if (metaMatch) {
          const cleaned = metaMatch[0].replace(/^"/, '').replace(/"$/, '').replace(/""/g, '"');
          const meta = JSON.parse(cleaned);
          if (meta.full_name || meta.name) name = meta.full_name || meta.name;
        }
      } catch (e) {}

      if (!neonEmails.has(email)) {
        toInsert.push({ id, email, name, createdAt });
      }
    }
  }

  console.log(`Found ${toInsert.length} users in CSV not in Neon.`);
  for (const u of toInsert) {
    console.log(`Inserting: ${u.email} (${u.name})`);
    await pool.query(`
      INSERT INTO users (id, email, name, role, is_email_verified, onboarding_completed, created_at)
      VALUES ($1, $2, $3, 'USER', true, true, $4)
      ON CONFLICT (id) DO NOTHING
    `, [u.id, u.email, u.name, u.createdAt]);

    await pool.query(`
      INSERT INTO "user" (id, email, name, role, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'USER', true, $4, $4)
      ON CONFLICT (id) DO NOTHING
    `, [u.id, u.email, u.name, u.createdAt]);
  }

  // Also sync the 10 users that were in "users" but not in "user"
  const missingInAuth = await pool.query(`
    SELECT u.id, u.email, u.name, u.role, u.created_at
    FROM users u
    LEFT JOIN "user" a ON LOWER(u.email) = LOWER(a.email)
    WHERE a.id IS NULL
  `);

  console.log(`Syncing ${missingInAuth.rows.length} users into Better Auth "user" table...`);
  for (const u of missingInAuth.rows) {
    await pool.query(`
      INSERT INTO "user" (id, email, name, role, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, COALESCE($4, 'USER'), true, COALESCE($5, NOW()), COALESCE($5, NOW()))
      ON CONFLICT (id) DO NOTHING
    `, [u.id, u.email, u.name || u.email.split('@')[0], u.role, u.created_at]);
  }

  const finalUsers = await pool.query('SELECT count(*) FROM users');
  const finalAuth = await pool.query('SELECT count(*) FROM "user"');
  console.log(`\nFinal counts:`);
  console.log(`users table: ${finalUsers.rows[0].count}`);
  console.log('user table: ' + finalAuth.rows[0].count);

  await pool.end();
}

importMissingFromCsv().catch(console.error);
