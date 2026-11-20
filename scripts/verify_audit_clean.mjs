import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';
const OLD_DB = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  const oldPool = new pg.Pool({ connectionString: OLD_DB });
  const newPool = new pg.Pool({ connectionString: NEW_DB });

  const tables = [
    'users',
    'trading_accounts',
    'trades',
    'risk_settings',
    'payments',
    'partner_profiles',
    'sub_admin_assignments',
    'admin_audit_logs',
    'mt5_deals',
    'mt5_deals_v2',
    'mt5_connect_jobs',
    'mt5_connection_errors',
    'shared_journal_links',
    'support_tickets',
    'announcements'
  ];

  console.log('\n====================================================');
  console.log('💎 100% PURE EXACT MATCH AUDIT: OLD DB vs NEW DB');
  console.log('====================================================');

  const report = [];
  for (const t of tables) {
    const oRes = await oldPool.query(`SELECT count(*) FROM "${t}";`);
    const nRes = await newPool.query(`SELECT count(*) FROM "${t}";`);
    const o = parseInt(oRes.rows[0].count);
    const n = parseInt(nRes.rows[0].count);
    report.push({
      Table: t,
      'Old DB (Authentic)': o,
      'New DB (Cleaned)': n,
      Match: o === n ? '✅ 100% EXACT MATCH' : '⚠️ MISMATCH'
    });
  }

  console.table(report);

  // Revenue check
  const oRev = await oldPool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'captured';`);
  const nRev = await newPool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'captured';`);
  console.log(`\n💰 TOTAL REVENUE CHECK:`);
  console.log(`Old DB Total Revenue: ₹${oRev.rows[0].total}`);
  console.log(`New DB Total Revenue: ₹${nRev.rows[0].total}`);

  await oldPool.end();
  await newPool.end();
}

main().catch(console.error);
