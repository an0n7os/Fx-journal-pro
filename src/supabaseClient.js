import { createClient } from "@supabase/supabase-js";

// ============================================================================
// SUPABASE CONFIGURATION
// ============================================================================
// Replace the values below with your actual Supabase URL and Anon/Public Key.
// You can find these in your Supabase Project Settings under API.
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://your-project.supabase.co";

// 2. Your Supabase Anon/Public Key:
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_KEY || "your-anon-key";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});
