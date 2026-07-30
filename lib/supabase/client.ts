import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv } from '@/lib/env';

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
