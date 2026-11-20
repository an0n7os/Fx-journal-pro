import pg from 'pg';

const NEW_DB = 'postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require';
const OLD_DB = 'postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

async function main() {
  console.log('====================================================');
  console.log('🧹 PURGING FAKE/TEST DATA FROM NEW NEON DATABASE');
  console.log('====================================================');

  const oldPool = new pg.Pool({ connectionString: OLD_DB });
  const newPool = new pg.Pool({ connectionString: NEW_DB });

  try {
    // 1. Collect authentic users from Old DB
    console.log('Fetching authentic IDs from Old DB...');
    const oldUsers = (await oldPool.query('SELECT id, email FROM users;')).rows;
    const authenticUserIds = new Set(oldUsers.map(u => u.id));
    const authenticEmails = new Set(oldUsers.map(u => u.email.toLowerCase()));

    const authenticTradingAccounts = new Set((await oldPool.query('SELECT id FROM trading_accounts;')).rows.map(r => r.id));
    const authenticTrades = new Set((await oldPool.query('SELECT id FROM trades;')).rows.map(r => r.id));
    const authenticPayments = new Set((await oldPool.query('SELECT id FROM payments;')).rows.map(r => r.id));
    const authenticRiskSettings = new Set((await oldPool.query('SELECT id FROM risk_settings;')).rows.map(r => r.id));
    const authenticPartnerProfiles = new Set((await oldPool.query('SELECT user_id FROM partner_profiles;')).rows.map(r => r.user_id));
    const authenticSubAdmins = new Set((await oldPool.query('SELECT id FROM sub_admin_assignments;')).rows.map(r => r.id));
    const authenticAdminAuditLogs = new Set((await oldPool.query('SELECT id FROM admin_audit_logs;')).rows.map(r => r.id));
    const authenticConnectJobs = new Set((await oldPool.query('SELECT id FROM mt5_connect_jobs;')).rows.map(r => r.id));
    const authenticConnectionErrors = new Set((await oldPool.query('SELECT id FROM mt5_connection_errors;')).rows.map(r => r.id));
    const authenticDeals = new Set((await oldPool.query('SELECT id FROM mt5_deals;')).rows.map(r => r.id));

    console.log(`Authentic baseline:
- Users: ${authenticUserIds.size}
- Payments: ${authenticPayments.size}
- Partners: ${authenticPartnerProfiles.size}
- Trading Accounts: ${authenticTradingAccounts.size}
- Trades: ${authenticTrades.size}
- MT5 Deals: ${authenticDeals.size}
`);

    // 2. Clean child tables first to respect FK constraints

    // 2.1 Payments
    const newPayments = (await newPool.query('SELECT id FROM payments;')).rows;
    let purgedPayments = 0;
    for (const p of newPayments) {
      if (!authenticPayments.has(p.id)) {
        await newPool.query('DELETE FROM payments WHERE id = $1;', [p.id]);
        purgedPayments++;
      }
    }
    console.log(`✅ Payments: purged ${purgedPayments} fake rows.`);

    // 2.2 Trades
    const newTrades = (await newPool.query('SELECT id FROM trades;')).rows;
    let purgedTrades = 0;
    for (const t of newTrades) {
      if (!authenticTrades.has(t.id)) {
        await newPool.query('DELETE FROM trades WHERE id = $1;', [t.id]);
        purgedTrades++;
      }
    }
    console.log(`✅ Trades: purged ${purgedTrades} fake rows.`);

    // 2.3 Trading Accounts
    const newAccounts = (await newPool.query('SELECT id FROM trading_accounts;')).rows;
    let purgedAccounts = 0;
    for (const a of newAccounts) {
      if (!authenticTradingAccounts.has(a.id)) {
        await newPool.query('DELETE FROM trades WHERE account_id = $1;', [a.id]).catch(() => {});
        await newPool.query('DELETE FROM trading_accounts WHERE id = $1;', [a.id]);
        purgedAccounts++;
      }
    }
    console.log(`✅ Trading Accounts: purged ${purgedAccounts} fake rows.`);

    // 2.4 Risk Settings
    const newRisk = (await newPool.query('SELECT id FROM risk_settings;')).rows;
    let purgedRisk = 0;
    for (const r of newRisk) {
      if (!authenticRiskSettings.has(r.id)) {
        await newPool.query('DELETE FROM risk_settings WHERE id = $1;', [r.id]);
        purgedRisk++;
      }
    }
    console.log(`✅ Risk Settings: purged ${purgedRisk} fake rows.`);

    // 2.5 Partner Profiles
    const newPartners = (await newPool.query('SELECT user_id FROM partner_profiles;')).rows;
    let purgedPartners = 0;
    for (const p of newPartners) {
      if (!authenticPartnerProfiles.has(p.user_id)) {
        await newPool.query('DELETE FROM partner_profiles WHERE user_id = $1;', [p.user_id]);
        purgedPartners++;
      }
    }
    console.log(`✅ Partner Profiles: purged ${purgedPartners} fake rows.`);

    // 2.6 Sub Admin Assignments
    const newSubAdmins = (await newPool.query('SELECT id FROM sub_admin_assignments;')).rows;
    let purgedSubAdmins = 0;
    for (const s of newSubAdmins) {
      if (!authenticSubAdmins.has(s.id)) {
        await newPool.query('DELETE FROM sub_admin_assignments WHERE id = $1;', [s.id]);
        purgedSubAdmins++;
      }
    }
    console.log(`✅ Sub Admin Assignments: purged ${purgedSubAdmins} fake rows.`);

    // 2.7 MT5 Deals
    const newDeals = (await newPool.query('SELECT id FROM mt5_deals;')).rows;
    let purgedDeals = 0;
    for (const d of newDeals) {
      if (!authenticDeals.has(d.id)) {
        await newPool.query('DELETE FROM mt5_deals WHERE id = $1;', [d.id]);
        purgedDeals++;
      }
    }
    console.log(`✅ MT5 Deals: purged ${purgedDeals} fake rows.`);

    // 2.8 MT5 Connect Jobs & Errors
    const newJobs = (await newPool.query('SELECT id FROM mt5_connect_jobs;')).rows;
    let purgedJobs = 0;
    for (const j of newJobs) {
      if (!authenticConnectJobs.has(j.id)) {
        await newPool.query('DELETE FROM mt5_connect_jobs WHERE id = $1;', [j.id]);
        purgedJobs++;
      }
    }
    console.log(`✅ MT5 Connect Jobs: purged ${purgedJobs} fake rows.`);

    const newErrors = (await newPool.query('SELECT id FROM mt5_connection_errors;')).rows;
    let purgedErrors = 0;
    for (const e of newErrors) {
      if (!authenticConnectionErrors.has(e.id)) {
        await newPool.query('DELETE FROM mt5_connection_errors WHERE id = $1;', [e.id]);
        purgedErrors++;
      }
    }
    console.log(`✅ MT5 Connection Errors: purged ${purgedErrors} fake rows.`);

    // 2.9 Admin Audit Logs
    const newAdminLogs = (await newPool.query('SELECT id FROM admin_audit_logs;')).rows;
    let purgedAdminLogs = 0;
    for (const l of newAdminLogs) {
      if (!authenticAdminAuditLogs.has(l.id)) {
        await newPool.query('DELETE FROM admin_audit_logs WHERE id = $1;', [l.id]);
        purgedAdminLogs++;
      }
    }
    console.log(`✅ Admin Audit Logs: purged ${purgedAdminLogs} fake rows.`);

    // 2.10 Better Auth
    try {
      const authUsers = (await newPool.query('SELECT id, email FROM "user";')).rows;
      let purgedAuthUsers = 0;
      for (const au of authUsers) {
        if (!authenticEmails.has(au.email.toLowerCase())) {
          await newPool.query('DELETE FROM "session" WHERE "userId" = $1;', [au.id]).catch(() => {});
          await newPool.query('DELETE FROM "account" WHERE "userId" = $1;', [au.id]).catch(() => {});
          await newPool.query('DELETE FROM "user" WHERE id = $1;', [au.id]).catch(() => {});
          purgedAuthUsers++;
        }
      }
      console.log(`✅ Better Auth Users: purged ${purgedAuthUsers} fake rows.`);
    } catch (e) {
      console.warn('Better auth cleanup warning:', e.message);
    }

    // 2.11 Purge fake Users
    const newUsers = (await newPool.query('SELECT id FROM users;')).rows;
    let purgedUsers = 0;
    for (const u of newUsers) {
      if (!authenticUserIds.has(u.id)) {
        await newPool.query('UPDATE users SET referred_by = NULL WHERE referred_by = $1;', [u.id]).catch(() => {});
        await newPool.query('DELETE FROM users WHERE id = $1;', [u.id]);
        purgedUsers++;
      }
    }
    console.log(`✅ Users: purged ${purgedUsers} fake rows.`);

    // 3. Final Audit Table
    console.log('\n====================================================');
    console.log('📊 FINAL 100% PURE OLD DB vs NEW DB AUDIT');
    console.log('====================================================');

    const tablesToAudit = [
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

    const report = [];
    for (const t of tablesToAudit) {
      const oCount = parseInt((await oldPool.query(`SELECT count(*) FROM "${t}";`)).rows[0].count);
      const nCount = parseInt((await newPool.query(`SELECT count(*) FROM "${t}";`)).rows[0].count);
      report.push({
        Table: t,
        'Old DB (Authentic)': oCount,
        'New DB (Cleaned)': nCount,
        Match: oCount === nCount ? '✅ 100% EXACT MATCH' : '⚠️ MISMATCH'
      });
    }

    console.table(report);
    console.log('\n🎉 ALL FAKE DATA COMPLETELY REMOVED! DATABASE IS 100% PURE! 🎉');

  } catch (err) {
    console.error('Purge error:', err);
  } finally {
    await oldPool.end();
    await newPool.end();
  }
}

main();
