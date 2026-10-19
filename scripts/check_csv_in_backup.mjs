import fs from 'fs';
import path from 'path';

const dir = 'c:\\Users\\aswin\\Downloads';
const fullBackup = JSON.parse(fs.readFileSync(path.join(dir, 'fxjp-supabase-FULL-backup-2026-10-03.json'), 'utf8'));

const csvLines = fs.readFileSync(path.join(dir, 'Supabase Snippet Untitled query (1).csv'), 'utf8').trim().split('\n');
const csvUsers = [];
for (let i = 1; i < csvLines.length; i++) {
  const parts = csvLines[i].split(',');
  csvUsers.push({ id: parts[0].trim(), email: parts[1].trim().toLowerCase() });
}

console.log(`Checking ${csvUsers.length} CSV users against FULL backup tables...`);
const csvIds = new Set(csvUsers.map(u => u.id));
const csvEmails = new Set(csvUsers.map(u => u.email));

// Check in backup tables.users
const bUsers = fullBackup.tables.users || [];
const matchedBUsers = bUsers.filter(u => csvIds.has(u.id) || csvEmails.has(u.email?.toLowerCase()));
console.log(`Matched users in backup.tables.users: ${matchedBUsers.length}`);

// Check in backup trading_accounts
const bAccounts = fullBackup.tables.trading_accounts || [];
const matchedAccounts = bAccounts.filter(a => csvIds.has(a.user_id));
console.log(`Matched accounts in backup.tables.trading_accounts by Supabase user_id: ${matchedAccounts.length}`);
if (matchedAccounts.length > 0) {
  console.log('Matched accounts:', matchedAccounts.map(a => ({ id: a.id, user_id: a.user_id, name: a.name })));
}

// Check in backup trades
const bTrades = fullBackup.tables.trades || [];
const matchedTrades = bTrades.filter(t => csvIds.has(t.user_id));
console.log(`Matched trades in backup.tables.trades by Supabase user_id: ${matchedTrades.length}`);
if (matchedTrades.length > 0) {
  console.log('Matched trades count:', matchedTrades.length);
}

// Check payments
const bPayments = fullBackup.tables.payments || [];
const matchedPayments = bPayments.filter(p => csvIds.has(p.user_id));
console.log(`Matched payments in backup.tables.payments: ${matchedPayments.length}`);

// Check partner profiles
const bPartners = fullBackup.tables.partner_profiles || [];
const matchedPartners = bPartners.filter(p => csvIds.has(p.user_id));
console.log(`Matched partners in backup.tables.partner_profiles: ${matchedPartners.length}`);
