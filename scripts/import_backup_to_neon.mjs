import fs from 'fs';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function toSnake(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const snakeKey = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    out[snakeKey] = v;
  }
  return out;
}

function formatVal(val) {
  if (val === undefined) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  return val;
}

async function batchUpsert(table, rows, conflictCols = ['id']) {
  if (!rows || rows.length === 0) return 0;
  
  // Get all unique columns
  const colSet = new Set();
  for (const r of rows) {
    Object.keys(r).forEach(k => colSet.add(k));
  }
  const cols = Array.from(colSet);
  const quotedCols = cols.map(c => `"${c}"`).join(', ');

  const conflictStr = conflictCols.map(c => `"${c}"`).join(', ');
  const updateCols = cols
    .filter(c => !conflictCols.includes(c))
    .map(c => `"${c}" = EXCLUDED."${c}"`);

  let insertedCount = 0;
  // Chunk in batches of 50
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuePlaceholders = [];
    const values = [];
    let idx = 1;

    for (const row of chunk) {
      const rowPlaceholders = [];
      for (const col of cols) {
        rowPlaceholders.push(`$${idx++}`);
        values.push(formatVal(row[col]));
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    let sql = `INSERT INTO "${table}" (${quotedCols}) VALUES ${valuePlaceholders.join(', ')}`;
    if (updateCols.length > 0) {
      sql += ` ON CONFLICT (${conflictStr}) DO UPDATE SET ${updateCols.join(', ')}`;
    } else {
      sql += ` ON CONFLICT (${conflictStr}) DO NOTHING`;
    }

    await pool.query(sql, values);
    insertedCount += chunk.length;
  }

  return insertedCount;
}

async function run() {
  console.log('=== Starting Backup Migration to Neon PostgreSQL ===');

  let db1 = { users: [] };
  let db2 = { users: [] };

  if (fs.existsSync('db.json')) {
    try { db1 = JSON.parse(fs.readFileSync('db.json', 'utf8')); } catch (e) { console.error('Error reading db.json:', e); }
  }
  if (fs.existsSync('db.json.bak')) {
    try { db2 = JSON.parse(fs.readFileSync('db.json.bak', 'utf8')); } catch (e) { console.error('Error reading db.json.bak:', e); }
  }

  // 1. Process Users
  const userMap = new Map();
  // Load db1 users
  if (Array.isArray(db1.users)) {
    for (const u of db1.users) {
      if (u.id) userMap.set(u.id, toSnake(u));
    }
  }
  // Overlay db2 users (often has passwords/details)
  if (Array.isArray(db2.users)) {
    for (const u of db2.users) {
      if (u.id) {
        const existing = userMap.get(u.id) || {};
        userMap.set(u.id, { ...existing, ...toSnake(u) });
      }
    }
  }

  const userRows = Array.from(userMap.values()).map(u => {
    // Sanitise columns
    return {
      id: u.id,
      email: u.email || null,
      name: u.name || null,
      password: u.password || null,
      role: u.role || 'USER',
      status: u.status || 'ACTIVE',
      is_pro: u.is_pro ?? false,
      is_email_verified: u.is_email_verified ?? false,
      experience: u.experience || null,
      trading_style: u.trading_style || null,
      main_markets: u.main_markets || null,
      onboarding_completed: u.onboarding_completed ?? false,
      avatar: u.avatar || null,
      created_at: u.created_at || new Date().toISOString(),
      plan: u.plan || 'free'
    };
  });

  console.log(`Importing ${userRows.length} users into Neon...`);
  const usersImported = await batchUpsert('users', userRows, ['id']);
  console.log(`✓ Successfully imported ${usersImported} users into Neon "users" table.`);

  // Also sync to Better Auth's "user" table so auth sees them
  const betterAuthUserRows = userRows.map(u => ({
    id: u.id,
    name: u.name || (u.email ? u.email.split('@')[0] : 'User'),
    email: u.email || `${u.id}@user.local`,
    emailVerified: u.is_email_verified,
    image: u.avatar,
    createdAt: u.created_at,
    updatedAt: new Date().toISOString(),
    role: u.role,
    isPro: u.is_pro
  }));
  await batchUpsert('user', betterAuthUserRows, ['id']);
  console.log(`✓ Successfully synced ${betterAuthUserRows.length} users to Better Auth "user" table.`);

  // 2. Process Trading Accounts
  const rawAccounts = [...(db1.accounts || []), ...(db2.accounts || [])];
  const accountMap = new Map();
  for (const a of rawAccounts) {
    if (a.id) accountMap.set(a.id, toSnake(a));
  }
  const validUserIds = new Set(userRows.map(u => u.id));
  const accountRows = Array.from(accountMap.values())
    .filter(a => a.user_id && validUserIds.has(a.user_id))
    .map(a => ({
      id: a.id,
      user_id: a.user_id,
      name: a.name || 'Main Account',
      broker: a.broker || 'Default',
      platform: a.platform || 'MT5',
      account_type: a.account_type || 'Live',
      currency: a.currency || 'USD',
      starting_balance: a.starting_balance ?? 1000,
      current_balance: a.current_balance ?? 1000,
      equity: a.equity ?? 1000,
      status: a.status || 'Active',
      created_at: a.created_at || new Date().toISOString()
    }));

  if (accountRows.length > 0) {
    console.log(`Importing ${accountRows.length} trading accounts...`);
    const accsImported = await batchUpsert('trading_accounts', accountRows, ['id']);
    console.log(`✓ Successfully imported ${accsImported} trading accounts.`);
  }

  // 3. Process Trades
  const rawTrades = [...(db1.trades || []), ...(db2.trades || [])];
  const tradeMap = new Map();
  for (const t of rawTrades) {
    if (t.id) tradeMap.set(t.id, toSnake(t));
  }
  const validAccountIds = new Set(accountRows.map(a => a.id));
  const tradeRows = Array.from(tradeMap.values())
    .filter(t => t.account_id && validAccountIds.has(t.account_id))
    .map(t => {
      // Find user_id from account
      const acc = accountMap.get(t.account_id);
      return {
        id: t.id,
        account_id: t.account_id,
        user_id: t.user_id || (acc ? acc.user_id : null),
        date: t.date || new Date().toISOString(),
        symbol: t.symbol || 'EURUSD',
        type: t.type || 'BUY',
        lot_size: t.lot_size ?? 0.1,
        entry_price: t.entry_price ?? 0,
        exit_price: t.exit_price ?? 0,
        stop_loss: t.stop_loss ?? 0,
        take_profit: t.take_profit ?? 0,
        profit: t.profit ?? 0,
        commission: t.commission ?? 0,
        swap: t.swap ?? 0,
        risk_percentage: t.risk_percentage ?? 1,
        strategy: t.strategy || null,
        emotion: t.emotion || null,
        notes: t.notes || null,
        tags: t.tags || null,
        created_at: t.created_at || new Date().toISOString()
      };
    });

  if (tradeRows.length > 0) {
    console.log(`Importing ${tradeRows.length} trades...`);
    const tradesImported = await batchUpsert('trades', tradeRows, ['id']);
    console.log(`✓ Successfully imported ${tradesImported} trades.`);
  }

  // 4. Process Risk Settings
  const rawRisk = [...(db1.riskSettings || []), ...(db2.riskSettings || [])];
  const riskMap = new Map();
  for (const r of rawRisk) {
    if (r.id) riskMap.set(r.id, toSnake(r));
  }
  const riskRows = Array.from(riskMap.values())
    .filter(r => r.account_id && validAccountIds.has(r.account_id))
    .map(r => ({
      id: r.id,
      account_id: r.account_id,
      user_id: r.user_id || accountMap.get(r.account_id)?.user_id,
      risk_per_trade_limit: r.risk_per_trade_limit ?? 2,
      daily_loss_limit: r.daily_loss_limit ?? 5,
      weekly_loss_limit: r.weekly_loss_limit ?? 10,
      max_drawdown_limit: r.max_drawdown_limit ?? 15,
      discipline_enabled: r.discipline_enabled ?? false
    }));

  if (riskRows.length > 0) {
    console.log(`Importing ${riskRows.length} risk settings...`);
    const riskImported = await batchUpsert('risk_settings', riskRows, ['id']);
    console.log(`✓ Successfully imported ${riskImported} risk settings.`);
  }

  // 5. Process Partner Profiles
  const rawPartners = [...(db1.partnerProfiles || []), ...(db2.partnerProfiles || [])];
  const partnerMap = new Map();
  for (const p of rawPartners) {
    const snake = toSnake(p);
    if (snake.user_id && validUserIds.has(snake.user_id)) {
      partnerMap.set(snake.user_id, snake);
    }
  }
  const partnerRows = Array.from(partnerMap.values()).map(p => ({
    user_id: p.user_id,
    referral_code: p.referral_code || `REF_${p.user_id.slice(0, 6)}`,
    created_at: p.created_at || new Date().toISOString(),
    created_by: p.created_by && validUserIds.has(p.created_by) ? p.created_by : null,
    offer_price: p.offer_price ?? 499,
    links: p.links || []
  }));

  if (partnerRows.length > 0) {
    console.log(`Importing ${partnerRows.length} partner profiles...`);
    const partnersImported = await batchUpsert('partner_profiles', partnerRows, ['user_id']);
    console.log(`✓ Successfully imported ${partnersImported} partner profiles.`);
  }

  // 6. Process Announcements
  const rawAnnouncements = [...(db1.announcements || []), ...(db2.announcements || [])];
  const announcementMap = new Map();
  for (const a of rawAnnouncements) {
    if (a.id) announcementMap.set(a.id, toSnake(a));
  }
  const announcementRows = Array.from(announcementMap.values()).map(a => ({
    id: a.id,
    title: a.title || 'Announcement',
    content: a.content || '',
    date: a.date || new Date().toISOString()
  }));

  if (announcementRows.length > 0) {
    console.log(`Importing ${announcementRows.length} announcements...`);
    const annImported = await batchUpsert('announcements', announcementRows, ['id']);
    console.log(`✓ Successfully imported ${annImported} announcements.`);
  }

  console.log('\n=== Backup Data Migration to Neon Completed Successfully! ===');
  await pool.end();
}

run().catch(err => {
  console.error('Migration failed:', err);
  pool.end();
});
