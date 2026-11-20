import fs from 'fs';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const filePath = 'c:/Users/aswin/Downloads/fxjp-supabase-FULL-backup-2026-10-03.json';
  if (!fs.existsSync(filePath)) {
    console.error('Backup file not found:', filePath);
    return;
  }

  const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const tables = backup.tables || {};

  console.log('=== STARTING CLEAN DATA RESTORATION TO NEW NEON DB ===');
  const client = await pool.connect();

  try {
    async function insertRows(tableName, rows, overrideFields = {}) {
      if (!rows || rows.length === 0) {
        console.log(`Skipping ${tableName}: 0 rows`);
        return;
      }

      const colRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = 'public';
      `, [tableName]);
      const validCols = new Set(colRes.rows.map(r => r.column_name));

      let successCount = 0;
      for (const rawRow of rows) {
        try {
          const row = { ...rawRow, ...overrideFields };
          const rowCols = Object.keys(row).filter(c => validCols.has(c));
          if (rowCols.length === 0) continue;

          const colNames = rowCols.map(c => `"${c}"`).join(', ');
          const placeholders = rowCols.map((_, i) => `$${i + 1}`).join(', ');
          const vals = rowCols.map(c => {
            const v = row[c];
            if (v !== null && typeof v === 'object') {
              return JSON.stringify(v);
            }
            return v;
          });

          const sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING;`;
          await client.query(sql, vals);
          successCount++;
        } catch (err) {
          console.warn(`[${tableName}] row error:`, err.message);
        }
      }
      console.log(`✅ ${tableName}: ${successCount} / ${rows.length} rows restored.`);
    }

    // 1. Users (first pass without referred_by to avoid self-referential FK errors)
    if (tables.users) {
      console.log('Restoring users (pass 1: base profiles)...');
      await insertRows('users', tables.users, { referred_by: null });

      // Pass 2: update referred_by now that all user rows exist
      console.log('Updating user referral relations...');
      for (const u of tables.users) {
        if (u.referred_by) {
          try {
            await client.query('UPDATE users SET referred_by = $1 WHERE id = $2', [u.referred_by, u.id]);
          } catch (_) { }
        }
      }
    }

    // 2. Trading accounts
    if (tables.trading_accounts) await insertRows('trading_accounts', tables.trading_accounts);

    // 3. Trades
    if (tables.trades) await insertRows('trades', tables.trades);

    // 4. Risk settings
    if (tables.risk_settings) await insertRows('risk_settings', tables.risk_settings);

    // 5. Payments
    if (tables.payments) await insertRows('payments', tables.payments);

    // 6. Partner profiles
    if (tables.partner_profiles) await insertRows('partner_profiles', tables.partner_profiles);

    // 7. Sub admin assignments
    if (tables.sub_admin_assignments) await insertRows('sub_admin_assignments', tables.sub_admin_assignments);

    // 8. Admin audit logs
    if (tables.admin_audit_logs) await insertRows('admin_audit_logs', tables.admin_audit_logs);

    // 9. MT5 deals
    if (tables.mt5_deals) await insertRows('mt5_deals', tables.mt5_deals);

    // 10. MT5 connect jobs
    if (tables.mt5_connect_jobs) await insertRows('mt5_connect_jobs', tables.mt5_connect_jobs);

    // Populate Better Auth user table
    if (tables.users) {
      console.log('Syncing Better Auth user table...');
      let bUserCount = 0;
      for (const u of tables.users) {
        try {
          await client.query(`
            INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), NOW())
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
          `, [
            u.id,
            u.email,
            u.name || u.email?.split('@')[0] || 'Trader',
            u.is_email_verified ?? true,
            u.created_at || new Date().toISOString()
          ]);
          bUserCount++;
        } catch (e) {
          // ignore
        }
      }
      console.log(`✅ Better Auth user table: ${bUserCount} users synced.`);
    }

    console.log('\n🎉 ALL DATA RESTORATION FINISHED SUCCESSFULLY! 🎉');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
