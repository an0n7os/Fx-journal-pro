import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const pool = new pg.Pool({ connectionString: NEW_DB });
  const res = await pool.query('SELECT id, email, last_login, created_at FROM users WHERE last_login IS NULL;');
  console.log('Users with NULL last_login:', res.rows);

  const res2 = await pool.query('SELECT id, email, last_login, created_at FROM users ORDER BY last_login DESC LIMIT 5;');
  console.log('\nDirect Postgres ORDER BY last_login DESC LIMIT 5:', res2.rows);

  const res3 = await pool.query('SELECT id, email, last_login, created_at FROM users ORDER BY last_login DESC NULLS LAST LIMIT 5;');
  console.log('\nDirect Postgres ORDER BY last_login DESC NULLS LAST LIMIT 5:', res3.rows);

  await pool.end();
}

main().catch(console.error);
