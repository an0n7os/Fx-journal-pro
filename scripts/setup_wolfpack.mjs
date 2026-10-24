import pg from 'pg';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { hashPassword } from 'better-auth/crypto';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const email = 'wolfpackwealthacademy@gmail.com';
  const password = 'Wolf@222';
  const name = 'Wolfpack';
  const userId = 'b1f1fc88-5a08-4d91-a849-b58d2fb26f52';
  const originalCreatedAt = '2026-08-28 12:58:09.874607+00';

  console.log(`Setting up user: ${email}`);

  // 1. Password hashes
  const bcryptHash = await bcrypt.hash(password, 10);
  const baHash = await hashPassword(password);

  // 2. Upsert into users table
  console.log('Upserting users table...');
  await pool.query(`
    INSERT INTO users (
      id, email, name, password, role, is_email_verified, onboarding_completed, is_pro, status, created_at
    ) VALUES (
      $1, $2, $3, $4, 'USER', true, true, false, 'ACTIVE', $5
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      password = EXCLUDED.password,
      is_email_verified = true,
      onboarding_completed = true,
      status = 'ACTIVE';
  `, [userId, email.toLowerCase(), name, bcryptHash, originalCreatedAt]);

  // Also update by email in case id differed
  await pool.query(`
    UPDATE users 
    SET password = $1, is_email_verified = true, onboarding_completed = true, status = 'ACTIVE'
    WHERE LOWER(email) = LOWER($2);
  `, [bcryptHash, email.toLowerCase()]);

  // 3. Upsert into "user" (Better Auth) table
  console.log('Upserting Better Auth "user" table...');
  await pool.query(`
    INSERT INTO "user" (
      id, email, name, role, "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, 'USER', true, $4, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      "emailVerified" = true,
      "updatedAt" = NOW();
  `, [userId, email.toLowerCase(), name, originalCreatedAt]);

  // Also update by email if different id exists
  await pool.query(`
    UPDATE "user" 
    SET "emailVerified" = true, "updatedAt" = NOW()
    WHERE LOWER(email) = LOWER($1);
  `, [email.toLowerCase()]);

  // 4. Upsert into "account" (Better Auth credentials provider)
  console.log('Upserting Better Auth "account" table...');
  const existingAcc = await pool.query(
    'SELECT id FROM "account" WHERE ("userId" = $1 OR LOWER("accountId") = LOWER($2)) AND "providerId" = $3',
    [userId, email, 'credential']
  );

  if (existingAcc.rows.length === 0) {
    const accId = `acc_ba_${crypto.randomBytes(12).toString('hex')}`;
    await pool.query(`
      INSERT INTO "account" (
        id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'credential', $4, NOW(), NOW()
      )
    `, [accId, userId, email.toLowerCase(), baHash]);
    console.log('Created new credential row in "account" table.');
  } else {
    await pool.query(`
      UPDATE "account" 
      SET password = $1, "updatedAt" = NOW()
      WHERE id = $2
    `, [baHash, existingAcc.rows[0].id]);
    console.log('Updated credential row in "account" table.');
  }

  // 5. Ensure default trading account exists
  console.log('Checking trading_accounts...');
  const accs = await pool.query('SELECT id FROM trading_accounts WHERE user_id = $1', [userId]);
  let accountId = accs.rows[0]?.id;
  if (!accountId) {
    accountId = `acc_wolfpack_1`;
    await pool.query(`
      INSERT INTO trading_accounts (
        id, user_id, name, broker, platform, account_type, currency, starting_balance, current_balance, equity, status, created_at
      ) VALUES (
        $1, $2, 'Wolfpack Portfolio', 'MetaTrader 5', 'MT5', 'Live', 'USD', 1000, 1000, 1000, 'Active', NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `, [accountId, userId]);
    console.log('Created default trading account: ' + accountId);
  } else {
    console.log('Trading account already exists: ' + accountId);
  }

  // 6. Ensure default risk settings exist
  console.log('Checking risk_settings...');
  const risk = await pool.query('SELECT id FROM risk_settings WHERE user_id = $1', [userId]);
  if (risk.rows.length === 0) {
    await pool.query(`
      INSERT INTO risk_settings (
        id, user_id, account_id, max_drawdown_limit, daily_loss_limit, created_at
      ) VALUES (
        $1, $2, $3, 10, 5, NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `, [`risk_wolfpack_1`, userId, accountId]);
    console.log('Created default risk settings.');
  } else {
    console.log('Risk settings already exist.');
  }

  console.log('\n=== SETUP COMPLETE ===');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`User ID:  ${userId}`);

  await pool.end();
}

main().catch(console.error);
