
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
async function test() {
  const { data: d1, error: e1 } = await supabase.from('users').select('id, status');
  console.log('d1', d1?.length, e1);
  const { data: d2, error: e2 } = await supabase.from('users').select('*');
  console.log('d2', d2?.length, e2);
}
test();

