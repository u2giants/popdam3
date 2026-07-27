/**
 * Pure authorization policy helpers shared by every edge function that answers
 * "is this caller an admin?".
 *
 * ⚠️ PURE MODULE — NO IMPORTS. Not a single `import` statement, and in
 * particular no Deno / `https://` / `npm:` specifiers. vitest loads this file
 * directly from `src/test/auth-policy.test.ts`, which only works while the file
 * stays import-free. All Deno wiring (env, Supabase clients, the `user_roles`
 * query) lives in `./admin-auth.ts`.
 */

export type BearerParse =
  | { kind: "missing_header" } // no header, or no valid Bearer prefix
  | { kind: "empty_token" } // valid prefix, nothing after it → invalid_token
  | { kind: "token"; token: string };

/**
 * Extract a bearer token from an Authorization header.
 *
 * Parsing is deliberately NOT uniform across the six call sites — three
 * functions have always parsed case-sensitively and three case-insensitively.
 * Normalising them would broaden what three of them accept, so every caller
 * names its mode explicitly and there is no default.
 *
 * - "strict": literal `"Bearer "` prefix (admin-api, erp-sync, helper-api)
 * - "loose":  /^Bearer\s+/i          (export-table, export-sql-dump,
 *                                     export-thumbnail-manifest)
 */
export function extractBearerToken(
  authHeader: string | null,
  mode: "strict" | "loose",
): BearerParse {
  if (!authHeader) return { kind: "missing_header" };

  if (mode === "strict") {
    if (!authHeader.startsWith("Bearer ")) return { kind: "missing_header" };
    const token = authHeader.slice("Bearer ".length);
    return token ? { kind: "token", token } : { kind: "empty_token" };
  }

  const match = /^Bearer\s+/i.exec(authHeader);
  if (!match) {
    // `"Bearer"` with nothing (not even a space) after it is a malformed
    // header, not an empty token — same as any other non-Bearer scheme.
    return { kind: "missing_header" };
  }
  const token = authHeader.slice(match[0].length);
  return token ? { kind: "token", token } : { kind: "empty_token" };
}

/**
 * EXACT comparison against the service role key. Never a substring match: an
 * `includes()` check would authorise any header that merely *contains* the key.
 * Returns false when either side is empty, so a missing env var can never
 * authorise anyone.
 */
export function isServiceRoleToken(
  token: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): boolean {
  if (!token || !serviceRoleKey) return false;
  return token === serviceRoleKey;
}

/**
 * Given every `user_roles` row for a user, is that user an admin?
 *
 * `user_roles` is UNIQUE(user_id, role), so a user may legitimately hold both
 * `user` and `admin`. Any code that assumes exactly one row (`.single()`) denies
 * such an admin — that was the live helper-api bug this module replaces.
 */
export function rolesGrantAdmin(
  rows: Array<{ role: string }> | null | undefined,
): boolean {
  if (!rows) return false;
  return rows.some((r) => r?.role === "admin");
}
