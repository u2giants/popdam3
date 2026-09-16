export interface AppConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  authRedirectUrl: string
  /**
   * Enables the internal email + password sign-in form alongside Microsoft SSO.
   * Intended for the development deployment ONLY so automated/AI testers can reach
   * the grid without Microsoft SSO. Production must leave this unset so
   * DB Data Admin at data.designflow.app stays SSO-only. Opt-in: anything other than the exact
   * string 'true' (or boolean true) is treated as disabled.
   */
  allowPasswordLogin: boolean
}

type RuntimeConfig = Partial<Omit<AppConfig, 'allowPasswordLogin'>> & {
  // nginx envsubst emits this as a string; an unset variable becomes ''.
  allowPasswordLogin?: boolean | string
}

declare global {
  interface Window {
    __DB_DATA_ADMIN_CONFIG__?: RuntimeConfig
  }
}

/** Strict opt-in: only boolean true or the exact string 'true' enables the flag. */
function toFlag(value: boolean | string | undefined): boolean {
  return value === true || value === 'true'
}

export function readConfig(): AppConfig | null {
  const runtime = window.__DB_DATA_ADMIN_CONFIG__
  const supabaseUrl = runtime?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = runtime?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY
  const authRedirectUrl = runtime?.authRedirectUrl || import.meta.env.VITE_AUTH_REDIRECT_URL
  const allowPasswordLogin = toFlag(runtime?.allowPasswordLogin ?? import.meta.env.VITE_ALLOW_PASSWORD_LOGIN)

  if (!supabaseUrl || !supabaseAnonKey || !authRedirectUrl) return null

  return { supabaseUrl, supabaseAnonKey, authRedirectUrl, allowPasswordLogin }
}
