import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

const NEON_URL = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: NEON_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const rawSql = fs.readFileSync('supabase_setup.sql', 'utf8');
    
    // Clean up Supabase-specific statements:
    // Remove RLS policies that reference 'anon', 'authenticated', 'auth.uid()'
    const lines = rawSql.split('\n');
    const cleanedLines = [];
    let skipBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip lines that reference anon/authenticated/auth.uid
      if (
        trimmed.startsWith('CREATE POLICY') ||
        trimmed.startsWith('DROP POLICY') ||
        trimmed.startsWith('ALTER TABLE') && trimmed.includes('ENABLE ROW LEVEL SECURITY') ||
        /TO (anon|authenticated)/i.test(trimmed) ||
        /auth\.uid\(\)/i.test(trimmed) ||
        /revoke all on .* from anon, authenticated/i.test(trimmed)
      ) {
        continue;
      }

      cleanedLines.push(line);
    }

    const cleanedSql = cleanedLines.join('\n');
    fs.writeFileSync('neon_setup.sql', cleanedSql, 'utf8');
    console.log('Generated neon_setup.sql successfully. Size:', cleanedSql.length);

    // Let's test executing it against Neon
    console.log('Executing neon_setup.sql on Neon DB...');
    await pool.query(cleanedSql);
    console.log('Executed successfully!');

    // Check tables now
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    console.log('Tables created in Neon:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await pool.end();
  }
}

run();
