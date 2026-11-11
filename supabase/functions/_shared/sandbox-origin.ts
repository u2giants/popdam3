// Dependency-free so it is testable outside Deno.
const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";

/**
 * The sandbox site (dam-sandbox.designflow.app) calls the functions deployed on
 * the shared-db PREVIEW project. That project alone sets SANDBOX_ALLOWED_ORIGIN;
 * the production project never honors it, even if the setting appears there.
 */
export function sandboxOrigin(
  env: (name: string) => string | undefined = (name) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name),
): string | null {
  const origin = env("SANDBOX_ALLOWED_ORIGIN")?.trim();
  if (!origin || !/^https:\/\/[a-z0-9.-]+$/.test(origin)) return null;
  const projectUrl = env("SUPABASE_URL") ?? "";
  if (!projectUrl || projectUrl.includes(PRODUCTION_PROJECT_REF)) return null;
  return origin;
}
