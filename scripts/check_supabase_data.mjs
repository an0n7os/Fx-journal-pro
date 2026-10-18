import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Key prefix:', supabaseKey?.slice(0, 15));

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const tables = ['users', 'trading_accounts', 'trades', 'risk_settings', 'support_tickets', 'announcements'];
  for (const t of tables) {
    try {
      const res = await supabase.from(t).select('*', { count: 'exact' }).limit(5);
      if (res.error) {
        console.log(t, 'error object:', res.error);
      } else {
        console.log(t, 'count:', res.count, 'sample rows:', res.data?.length);
      }
    } catch (e) {
      console.log(t, 'exception:', e);
    }
  }
}

check();
