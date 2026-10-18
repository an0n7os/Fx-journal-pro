import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkAll() {
  const tables = [
    'users', 'trading_accounts', 'trades', 'risk_settings', 'support_tickets',
    'announcements', 'partner_profiles', 'partner_payout_requests', 'sub_admin_assignments',
    'mentor_access_grants', 'shared_journal_links', 'system_logs', 'mt5_deals',
    'mt5_money_flows', 'mt5_sync_sessions', 'mt5_connect_jobs', 'billing_subscriptions',
    'billing_invoices', 'billing_customers', 'ea_tokens', 'ea_audit_log',
    'user', 'session', 'account', 'verification'
  ];

  console.log('=== Neon Database Table Counts ===');
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM "${t}"`);
      console.log(`${t.padEnd(25)}: ${res.rows[0].count}`);
    } catch (e) {
      console.log(`${t.padEnd(25)}: table missing or error (${e.message})`);
    }
  }
  await pool.end();
}

checkAll();
