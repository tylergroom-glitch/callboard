import { createClient } from "@supabase/supabase-js";

// These come from Vercel env vars (Preview environment on the `supabase` branch).
// The anon/publishable key is safe in the browser — the database security rules
// (Row-Level Security) decide what a signed-in user can actually read or write.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = !!(url && anonKey);

export const supabase = hasSupabaseConfig
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
