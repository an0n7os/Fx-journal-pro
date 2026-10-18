import 'dotenv/config';
import { createNeonClient } from '../src/neonClient.ts';

const client = createNeonClient(process.env.DATABASE_URL);

async function test() {
  console.log('--- Testing Neon Client ---');

  // 1. Upsert
  const upsertRes = await client.from('users').upsert({
    id: 'test_neon_user_1',
    email: 'neon_tester@example.com',
    name: 'Neon Tester',
    is_pro: true
  }, { onConflict: 'id' });
  console.log('1. Upsert result:', upsertRes.error ? upsertRes.error : 'SUCCESS:', upsertRes.data?.id);

  // 2. Select with eq & maybeSingle
  const selectRes = await client.from('users').select('*').eq('id', 'test_neon_user_1').maybeSingle();
  console.log('2. Select maybeSingle result:', selectRes.error ? selectRes.error : 'FOUND:', selectRes.data?.email, selectRes.data?.name);

  // 3. Update
  const updateRes = await client.from('users').update({ name: 'Neon Tester Modified' }).eq('id', 'test_neon_user_1');
  console.log('3. Update result:', updateRes.error ? updateRes.error : 'UPDATED:', updateRes.data?.[0]?.name);

  // 4. Select with count
  const countRes = await client.from('users').select('*', { count: 'exact' });
  console.log('4. Count result:', countRes.count, 'rows count:', countRes.data?.length);

  // 5. Delete
  const deleteRes = await client.from('users').delete().eq('id', 'test_neon_user_1');
  console.log('5. Delete result:', deleteRes.error ? deleteRes.error : 'DELETED:', deleteRes.data?.length, 'rows');

  // Verify deletion
  const verifyRes = await client.from('users').select('*').eq('id', 'test_neon_user_1').maybeSingle();
  console.log('6. Verify deletion:', verifyRes.data === null ? 'CONFIRMED NULL' : 'STILL EXISTS');

  await client.pool.end();
}

test().catch(console.error);
