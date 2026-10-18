import 'dotenv/config';
import { createNeonClient } from '../src/neonClient.ts';

const client = createNeonClient(process.env.DATABASE_URL);

async function testMT5() {
  console.log('--- Testing MT5 Tables in Neon ---');

  const tables = [
    'mt5_deals',
    'mt5_deals_v2',
    'mt5_account_snapshots',
    'mt5_open_positions',
    'mt5_pending_orders',
    'mt5_money_flows',
    'mt5_sync_logs',
    'mt5_connection_errors',
    'mt5_connect_jobs'
  ];

  for (const table of tables) {
    const res = await client.from(table).select('*').limit(1);
    if (res.error) {
      console.error(`❌ Table ${table} error:`, res.error);
    } else {
      console.log(`✓ Table ${table} OK (accessible, rows: ${res.data?.length})`);
    }
  }

  await client.pool.end();
}

testMT5().catch(console.error);
