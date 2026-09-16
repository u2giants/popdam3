import { createClient } from '@supabase/supabase-js'
import type { AppConfig } from './config'

export function createSupabase(config: AppConfig) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: true },
    db: { schema: 'api' },
  })
}
