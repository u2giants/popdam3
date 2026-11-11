import { externalSupabase } from "@/lib/external-supabase";
import { IS_NON_PRODUCTION_DATABASE } from "@/lib/app-mode";

/**
 * Short-lived sandbox (dam-sandbox.designflow.app) without a login screen
 * (owner request 2026-11-11, one day of testing). Only when the build points at
 * a non-production database AND the sandbox build sets both variables; a
 * production build never contains them. Signs in a preview-only test account.
 */
export async function sandboxAutoLogin(): Promise<void> {
  const email = import.meta.env?.VITE_SANDBOX_AUTO_LOGIN_EMAIL as string | undefined;
  const password = import.meta.env?.VITE_SANDBOX_AUTO_LOGIN_PASSWORD as string | undefined;
  if (!IS_NON_PRODUCTION_DATABASE || !email || !password) return;
  try {
    const { data } = await externalSupabase.auth.getSession();
    if (!data.session) await externalSupabase.auth.signInWithPassword({ email, password });
  } catch {
    // Fall back to the normal login screen.
  }
}
