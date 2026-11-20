import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';
const OLD_DB = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const oldPool = new pg.Pool({ connectionString: OLD_DB });
  const newPool = new pg.Pool({ connectionString: NEW_DB });

  console.log('=== Checking Old DB users columns & last_login ===');
  const oCols = (await oldPool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users';")).rows.map(r => r.column_name);
  console.log('Old users columns:', oCols.includes('last_login') ? 'has last_login' : 'NO last_login');
  
  if (oCols.includes('last_login')) {
    const oLogins = (await oldPool.query('SELECT count(*) FROM users WHERE last_login IS NOT NULL;')).rows[0].count;
    console.log('Old users with last_login NOT null:', oLogins);
    const sample = (await oldPool.query('SELECT id, email, created_at, last_login FROM users WHERE last_login IS NOT NULL LIMIT 5;')).rows;
    console.log('Old users sample last_login:', sample);
  }

  console.log('\n=== Checking New DB users columns & last_login ===');
  const nCols = (await newPool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users';")).rows.map(r => r.column_name);
  console.log('New users columns:', nCols.includes('last_login') ? 'has last_login' : 'NO last_login');
  
  if (nCols.includes('last_login')) {
    const nLogins = (await newPool.query('SELECT count(*) FROM users WHERE last_login IS NOT NULL;')).rows[0].count;
    console.log('New users with last_login NOT null:', nLogins);
    const sample = (await newPool.query('SELECT id, email, created_at, last_login FROM users WHERE last_login IS NOT NULL LIMIT 5;')).rows;
    console.log('New users sample last_login:', sample);
  } else {
    console.log('⚠️ last_login column is MISSING in New DB users table!');
  }

  // Also check sessions table
  console.log('\n=== Checking session tables ===');
  const oSessions = (await oldPool.query('SELECT count(*) FROM session;')).rows[0].count;
  const nSessions = (await newPool.query('SELECT count(*) FROM session;')).rows[0].count;
  console.log('Old DB sessions:', oSessions, 'New DB sessions:', nSessions);

  // Check Better Auth user table
  const oUser = (await oldPool.query('SELECT count(*) FROM "user";')).rows[0].count;
  const nUser = (await newPool.query('SELECT count(*) FROM "user";')).rows[0].count;
  console.log('Old DB "user":', oUser, 'New DB "user":', nUser);

  await oldPool.end();
  await newPool.end();
}

main().catch(console.error);
