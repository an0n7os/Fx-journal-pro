import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';
const OLD_DB = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const newPool = new pg.Pool({ connectionString: NEW_DB });
  const oldPool = new pg.Pool({ connectionString: OLD_DB });

  // 1. Get all real user IDs from OLD DB
  const oldUsersRes = await oldPool.query('SELECT id, email, name, role, referred_by FROM users;');
  const oldUserIds = new Set(oldUsersRes.rows.map(u => u.id));
  console.log('Real Old Users count:', oldUserIds.size);

  // 2. Check users in NEW DB that were NOT in OLD DB
  const newUsersRes = await newPool.query('SELECT id, email, name, role, referred_by FROM users;');
  const extraUsers = newUsersRes.rows.filter(u => !oldUserIds.has(u.id));
  console.log('Extra/Test users in New DB:', extraUsers.length);
  console.log('Extra users sample:', extraUsers.slice(0, 10).map(u => ({ id: u.id, email: u.email, name: u.name })));

  // 3. Check payments
  const oldPayments = (await oldPool.query('SELECT * FROM payments;')).rows;
  const newPayments = (await newPool.query('SELECT * FROM payments;')).rows;
  const extraPayments = newPayments.filter(np => !oldPayments.some(op => op.id === np.id));
  console.log('\nPayments in Old DB:', oldPayments.length);
  console.log('Payments in New DB:', newPayments.length);
  console.log('Extra/Test payments in New DB:', extraPayments.length);
  console.log('Extra payments sample:', extraPayments.slice(0, 5).map(p => ({ id: p.id, user_id: p.user_id, amount: p.amount })));

  // 4. Check partner profiles
  const oldPartners = (await oldPool.query('SELECT * FROM partner_profiles;')).rows;
  const newPartners = (await newPool.query('SELECT * FROM partner_profiles;')).rows;
  const extraPartners = newPartners.filter(np => !oldPartners.some(op => op.user_id === np.user_id));
  console.log('\nPartners in Old DB:', oldPartners.length);
  console.log('Partners in New DB:', newPartners.length);
  console.log('Extra partners in New DB:', extraPartners.length, extraPartners.map(p => ({ user_id: p.user_id, referral_code: p.referral_code })));

  await newPool.end();
  await oldPool.end();
}

main().catch(console.error);
