// Seeds db.json with a sub-admin and three traders so the Sub-Admin Console
// has something real to show locally. Development only — it writes the local
// file store, which a Supabase deployment does not use.
//
//   npm run seed:demo
//
// Idempotent: re-running updates the same rows rather than duplicating them.
// The original db.json is copied to db.json.bak the first time.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DB = path.resolve('db.json');
const BACKUP = path.resolve('db.json.bak');
const PASSWORD = process.env.DEV_ADMIN_PASSWORD?.trim() || 'LocalAdmin123';

if (!fs.existsSync(DB)) {
  console.error('db.json not found. Start the server once (npm run dev) so it creates one.');
  process.exit(1);
}
if (!fs.existsSync(BACKUP)) fs.copyFileSync(DB, BACKUP);

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
db.users ||= [];
db.accounts ||= [];
db.trades ||= [];

const hash = bcrypt.hashSync(PASSWORD, 10);

const upsertUser = (user) => {
  const i = db.users.findIndex((u) => u.email === user.email);
  if (i >= 0) db.users[i] = { ...db.users[i], ...user };
  else db.users.push(user);
};

// The local super admin. Its password has to match DEV_ADMIN_PASSWORD, since
// a seeded row in this file now wins over the built-in demo account.
upsertUser({
  id: 'user_admin',
  email: 'admin@axyfx.com',
  name: 'AxyFx Admin',
  password: hash,
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  isPro: true,
  isEmailVerified: true,
  onboardingCompleted: true,
});

upsertUser({
  id: 'user_subadmin_demo',
  email: 'mentor@axyfx.com',
  name: 'Mentor Ravi',
  password: hash,
  role: 'SUB_ADMIN',
  status: 'ACTIVE',
  isPro: true,
  isEmailVerified: true,
  onboardingCompleted: true,
  createdAt: '2026-05-02T09:00:00Z',
  lastLogin: new Date().toISOString(),
});

const TRADERS = [
  { id: 'user_trader_1', email: 'arun@example.com', name: 'Arun K', isPro: true, trades: 8 },
  { id: 'user_trader_2', email: 'nisha@example.com', name: 'Nisha P', isPro: false, trades: 4 },
  { id: 'user_trader_3', email: 'sam@example.com', name: 'Sam Joseph', isPro: false, trades: 0 },
];

const SYMBOLS = ['EURUSD', 'XAUUSD', 'GBPJPY'];
const NOTES_WIN = 'Waited for the retest before entering. Followed the plan.';
const NOTES_LOSS = 'Entered early without confirmation. Stop was too tight.';

TRADERS.forEach((t, idx) => {
  upsertUser({
    id: t.id,
    email: t.email,
    name: t.name,
    password: hash,
    role: 'USER',
    status: 'ACTIVE',
    isPro: t.isPro,
    isEmailVerified: true,
    onboardingCompleted: true,
    createdAt: new Date(Date.now() - (90 - idx * 20) * 86400000).toISOString(),
    lastLogin: new Date(Date.now() - idx * 86400000).toISOString(),
  });

  const accountId = `acc_${t.id}`;
  if (!db.accounts.some((a) => a.id === accountId)) {
    db.accounts.push({
      id: accountId,
      userId: t.id,
      name: `${t.name} Live`,
      broker: 'Exness',
      platform: 'MT5',
      accountType: 'Live',
      currency: 'USD',
      startingBalance: 10000,
      currentBalance: 10000,
      equity: 10000,
      status: 'Active',
      isMt5Sync: false,
    });
  }

  for (let i = 0; i < t.trades; i++) {
    const id = `t_${t.id}_${i}`;
    if (db.trades.some((x) => x.id === id)) continue;
    const win = i % 3 !== 0;
    // Buys only, so the R-multiple average is not cancelled out by mirrored sells.
    db.trades.push({
      id,
      userId: t.id,
      accountId,
      date: new Date(Date.now() - i * 2 * 86400000).toISOString(),
      symbol: SYMBOLS[i % SYMBOLS.length],
      type: 'Buy',
      lotSize: 0.5,
      entryPrice: 1.085,
      exitPrice: win ? 1.092 : 1.081,
      stopLoss: 1.08,
      takeProfit: 1.095,
      profit: win ? 320 : -180,
      commission: -6,
      swap: -1,
      riskPercentage: 1,
      strategy: win ? 'Order Block' : 'Counter-trend',
      emotion: win ? 'Calm' : 'Rushed',
      notes: win ? NOTES_WIN : NOTES_LOSS,
      tags: ['London'],
    });
  }
});

fs.writeFileSync(DB, JSON.stringify(db, null, 2));

console.log(`
Seeded db.json (backup: db.json.bak)

  Super admin   admin@axyfx.com    ${PASSWORD}
  Sub-admin     mentor@axyfx.com   ${PASSWORD}
  Traders       arun@example.com, nisha@example.com, sam@example.com

Next:
  1. npm run dev:testbilling
  2. Sign in as admin@axyfx.com
  3. Admin > Team & Roles > Mentor Ravi > Assigned Users > assign the three traders
  4. Sign out, sign in as mentor@axyfx.com to see their console
`);
