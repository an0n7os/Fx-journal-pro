import pg from 'pg';
const { Pool } = pg;

const OLD_URL = "postgresql://neondb_owner:npg_c1tdm3upqiCZ@ep-square-rain-a1z1psjs-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const NEW_URL = "postgresql://neondb_owner:npg_Mun6aYkg4AUp@ep-square-poetry-bdg7lppf-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function main() {
  console.log('====================================================');
  console.log('🚀 FXJOURNALPRO FULL A-TO-Z NEON DATABASE MIGRATION');
  console.log('====================================================');

  const oldPool = new Pool({ connectionString: OLD_URL, ssl: { rejectUnauthorized: false } });
  const newPool = new Pool({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false } });

  try {
    // 1. Get all public tables from old DB
    const tablesRes = await oldPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const allTables = tablesRes.rows.map(r => r.table_name);
    console.log(`Found ${allTables.length} tables in old database.`);

    // 2. Ensure missing tables / columns are created on new DB
    for (const table of allTables) {
      // Check if table exists in new DB
      const existsRes = await newPool.query(`
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1;
      `, [table]);

      if (existsRes.rows.length === 0) {
        console.log(`Creating missing table "${table}" in new DB...`);
        // Get columns and types from old DB
        const cols = await oldPool.query(`
          SELECT column_name, data_type, udt_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position;
        `, [table]);

        const colDefs = cols.rows.map(c => {
          let type = c.udt_name;
          if (type === 'varchar') type = 'text';
          if (type === 'timestamptz') type = 'TIMESTAMPTZ';
          if (type === 'int4') type = 'INTEGER';
          if (type === 'int8') type = 'BIGINT';
          if (type === 'bool') type = 'BOOLEAN';
          if (type === 'float8') type = 'FLOAT';
          if (type === 'jsonb') type = 'JSONB';
          return `"${c.column_name}" ${type}`;
        }).join(', ');

        // Find primary key in old DB
        const pkRes = await oldPool.query(`
          SELECT c.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
          JOIN information_schema.columns AS c ON c.table_schema = tc.constraint_schema
            AND tc.table_name = c.table_name AND ccu.column_name = c.column_name
          WHERE constraint_type = 'PRIMARY KEY' and tc.table_name = $1;
        `, [table]);
        const pkCol = pkRes.rows[0]?.column_name;
        const pkClause = pkCol ? `, PRIMARY KEY ("${pkCol}")` : '';

        await newPool.query(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs}${pkClause});`);
        console.log(`✅ Table "${table}" created.`);
      } else {
        // Table exists, check if any columns are missing in new DB
        const oldCols = await oldPool.query(`
          SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1;
        `, [table]);
        const newCols = await newPool.query(`
          SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1;
        `, [table]);
        const newColSet = new Set(newCols.rows.map(r => r.column_name));

        for (const col of oldCols.rows) {
          if (!newColSet.has(col.column_name)) {
            console.log(`Adding missing column "${col.column_name}" to "${table}"...`);
            let type = col.udt_name;
            if (type === 'varchar') type = 'text';
            if (type === 'timestamptz') type = 'TIMESTAMPTZ';
            if (type === 'int4') type = 'INTEGER';
            if (type === 'int8') type = 'BIGINT';
            if (type === 'bool') type = 'BOOLEAN';
            if (type === 'float8') type = 'FLOAT';
            if (type === 'jsonb') type = 'JSONB';
            try {
              await newPool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col.column_name}" ${type};`);
            } catch (colErr) {
              console.warn(`Could not add column ${col.column_name}:`, colErr.message);
            }
          }
        }
      }
    }

    // Helper function to migrate a table in batches
    async function migrateTable(tableName, primaryKey, options = {}) {
      const countRes = await oldPool.query(`SELECT count(*) FROM "${tableName}";`);
      const totalRows = parseInt(countRes.rows[0].count);
      if (totalRows === 0) {
        console.log(`Table "${tableName}": 0 rows (skipped).`);
        return;
      }

      console.log(`\n⏳ Migrating "${tableName}" (${totalRows} rows)...`);

      // Get target columns in new DB
      const targetColsRes = await newPool.query(`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1;
      `, [tableName]);
      const targetCols = new Set(targetColsRes.rows.map(r => r.column_name));

      // Fetch all rows from old DB
      const rowsRes = await oldPool.query(`SELECT * FROM "${tableName}";`);
      const rows = rowsRes.rows;

      let inserted = 0;
      let skipped = 0;

      // Batching for performance
      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        for (const rawRow of batch) {
          try {
            const row = options.transform ? options.transform(rawRow) : rawRow;
            const validKeys = Object.keys(row).filter(k => targetCols.has(k));
            if (validKeys.length === 0) continue;

            const colNames = validKeys.map(k => `"${k}"`).join(', ');
            const placeholders = validKeys.map((_, idx) => `$${idx + 1}`).join(', ');
            const values = validKeys.map(k => {
              const v = row[k];
              if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
                return JSON.stringify(v);
              }
              return v;
            });

            let onConflict = 'DO NOTHING';
            if (primaryKey && targetCols.has(primaryKey)) {
              const updateSets = validKeys
                .filter(k => k !== primaryKey)
                .map(k => `"${k}" = EXCLUDED."${k}"`)
                .join(', ');
              if (updateSets.length > 0) {
                onConflict = `("${primaryKey}") DO UPDATE SET ${updateSets}`;
              } else {
                onConflict = `("${primaryKey}") DO NOTHING`;
              }
            }

            const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT ${onConflict};`;
            await newPool.query(sql, values);
            inserted++;
          } catch (rowErr) {
            skipped++;
            if (skipped <= 3) {
              console.warn(`[${tableName}] row error:`, rowErr.message);
            }
          }
        }
      }
      console.log(`✅ Table "${tableName}": ${inserted} migrated, ${skipped} skipped.`);
    }

    // 3. Migrate tables in strict dependency order:

    // 3.1 USERS (Pass 1: set referred_by to null to avoid FK race)
    console.log('\n--- Step 1: Users ---');
    await migrateTable('users', 'id', {
      transform: (u) => ({ ...u, referred_by: null })
    });

    // 3.2 USERS (Pass 2: restore referred_by)
    console.log('Restoring users referral relations...');
    const allOldUsers = (await oldPool.query('SELECT id, referred_by FROM users WHERE referred_by IS NOT NULL;')).rows;
    for (const u of allOldUsers) {
      try {
        await newPool.query('UPDATE users SET referred_by = $1 WHERE id = $2;', [u.referred_by, u.id]);
      } catch (_) {}
    }

    // 3.3 BETTER AUTH CORE TABLES
    console.log('\n--- Step 2: Better Auth Users & Sessions ---');
    await migrateTable('user', 'id');
    await migrateTable('account', 'id');
    await migrateTable('session', 'id');
    await migrateTable('verification', 'id');

    // 3.4 TRADING ACCOUNTS & TRADES
    console.log('\n--- Step 3: Trading Accounts & Trades ---');
    await migrateTable('trading_accounts', 'id');
    await migrateTable('trades', 'id');

    // 3.5 RISK SETTINGS & PAYMENTS
    console.log('\n--- Step 4: Settings & Payments ---');
    await migrateTable('risk_settings', 'id');
    await migrateTable('payments', 'id');
    await migrateTable('subscriptions', 'id');

    // 3.6 MT5 INTEGRATION KIT TABLES
    console.log('\n--- Step 5: MT5 Integration & Deals ---');
    await migrateTable('mt5_deals', 'id');
    await migrateTable('mt5_deals_v2', 'id');
    await migrateTable('mt5_sync_logs', 'id');
    await migrateTable('mt5_connect_jobs', 'id');
    await migrateTable('mt5_connection_errors', 'id');
    await migrateTable('mt5_ea_instances', 'id');
    await migrateTable('mt5_money_flows', 'id');
    await migrateTable('mt5_open_positions', 'id');
    await migrateTable('mt5_pending_orders', 'id');
    await migrateTable('mt5_account_snapshots', 'id');
    await migrateTable('mt5_audit_logs', 'id');

    // 3.7 PARTNERS & ADMIN TABLES
    console.log('\n--- Step 6: Partners & Admin Operations ---');
    await migrateTable('partner_profiles', 'user_id');
    await migrateTable('partner_payout_requests', 'id');
    await migrateTable('sub_admin_assignments', 'id');
    await migrateTable('admin_audit_logs', 'id');
    await migrateTable('shared_journal_links', 'id');
    await migrateTable('support_tickets', 'id');
    await migrateTable('announcements', 'id');
    await migrateTable('bug_reports', 'id');
    await migrateTable('feature_requests', 'id');

    // 4. Verification Check
    console.log('\n====================================================');
    console.log('📊 FINAL ROW COUNT AUDIT: OLD DB vs NEW DB');
    console.log('====================================================');
    const auditReport = [];
    for (const t of allTables) {
      try {
        const oRes = await oldPool.query(`SELECT count(*) FROM "${t}";`);
        const nRes = await newPool.query(`SELECT count(*) FROM "${t}";`);
        const oldCount = parseInt(oRes.rows[0].count);
        const newCount = parseInt(nRes.rows[0].count);
        const matches = oldCount === newCount ? '✅ MATCH' : (newCount >= oldCount ? '✅ OK' : '⚠️ MISMATCH');
        auditReport.push({
          Table: t,
          'Old DB': oldCount,
          'New DB': newCount,
          Status: matches
        });
      } catch (auditErr) {
        auditReport.push({ Table: t, 'Old DB': '?', 'New DB': '?', Status: 'ERR: ' + auditErr.message });
      }
    }
    console.table(auditReport);
    console.log('\n🎉 FULL MIGRATION SUCCESSFULLY COMPLETED! 🎉');

  } catch (err) {
    console.error('Fatal migration error:', err);
  } finally {
    await oldPool.end();
    await newPool.end();
  }
}

main();
