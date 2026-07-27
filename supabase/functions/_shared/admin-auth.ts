/**
 * The one place PopDAM edge functions answer "is this caller an admin?".
 *
 * Every admin-gated edge function must call `requireAdmin()` from here rather
 * than hand-rolling its own `user_roles` lookup — six hand-written copies had
 * already drifted apart, and one of them denied a legitimate admin.
 *
 * This module returns a plain result object, never a `Response`: the six
 * callers do NOT share a failure wire contract (some return `{ok:false,error}`
 * at 403, others a bare `{error}` at 401), and preserving each function's
 * existing status + body byte-for-byte is a hard requirement. Each caller maps
 * the result to its own response.
 *
 * Pure, testable policy lives in `./auth-policy.ts` (no imports, unit-tested by
 * vitest in `src/test/auth-policy.test.ts`). This file is the Deno wiring:
 * env vars, Supabase clients, the `user_roles` query. There is no local Deno
 * toolchain, so this file's type gate is the deploy workflow.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceClient } from "./service-client.ts";
import { extractBearerToken, isServiceRoleToken, rolesGrantAdmin } from "./auth-policy.ts";

export type AuthVia = "service_role" | "jwt";

export type UserAuthResult =
  | { ok: true; userId: string; via: AuthVia }
  | { ok: false; status: 401; reason: "missing_header" | "invalid_token" };

export type AdminAuthResult =
  | { ok: true; userId: string; via: AuthVia }
  | { ok: false; status: 401 | 403; reason: "missing_header" | "invalid_token" | "not_admin" };

export interface AuthOpts {
  /**
   * How to parse the Authorization header. REQUIRED — there is no default, so
   * no call site can silently inherit the wrong parser (see auth-policy.ts).
   */
  parseMode: "strict" | "loose";
  /**
   * Accept the Supabase service role key as a bearer token (server-to-server
   * callers such as the Railway worker). Default false — never implicit.
   */
  allowServiceRole?: boolean;
  /**
   * Fall back to `auth.getClaims()` when `auth.getUser()` rejects the token.
   * Default false. Only `admin-api` has ever done this; enabling it elsewhere
   * would widen authentication, not refactor it.
   */
  allowClaimsFallback?: boolean;
  /**
   * Attempts for the `user_roles` query only (transient connection errors).
   * Default 1; `admin-api` passes 3 to match its previous `withRetry()`.
   */
  roleQueryAttempts?: number;
}

/**
 * Validate the caller's credentials. Does NOT check the admin role.
 *
 * A valid service-role token (when `allowServiceRole`) yields the sentinel
 * userId "system", which `requireAdmin` treats as already-authorised.
 */
export async function authenticateUser(
  req: Request,
  opts: AuthOpts,
): Promise<UserAuthResult> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const parsed = extractBearerToken(authHeader, opts.parseMode);

  if (parsed.kind === "missing_header") {
    return { ok: false, status: 401, reason: "missing_header" };
  }
  // A present-but-empty bearer token is an *invalid* token, not a missing
  // header — this keeps admin-api's "Invalid or expired token" reply intact.
  if (parsed.kind === "empty_token") {
    return { ok: false, status: 401, reason: "invalid_token" };
  }

  const token = parsed.token;

  if (opts.allowServiceRole) {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (isServiceRoleToken(token, serviceRoleKey)) {
      return { ok: true, userId: "system", via: "service_role" };
    }
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  try {
    let sub: string | undefined;
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user?.id) {
      if (opts.allowClaimsFallback && typeof anonClient.auth.getClaims === "function") {
        const { data, error: claimsError } = await anonClient.auth.getClaims(token);
        if (!claimsError && data?.claims?.sub) {
          sub = data.claims.sub as string;
        }
      }
      if (!sub) {
        console.error("Auth failed — getUser:", userError);
        return { ok: false, status: 401, reason: "invalid_token" };
      }
    } else {
      sub = user.id;
    }
    console.log("Authenticated userId:", sub);
    return { ok: true, userId: sub, via: "jwt" };
  } catch (e) {
    console.error("Token validation error:", e);
    return { ok: false, status: 401, reason: "invalid_token" };
  }
}

/**
 * Validate the caller and require the `admin` role.
 *
 * Fails closed: a `user_roles` query that still errors after its attempts is
 * treated as "not an admin", never as a pass, and never throws out of here.
 */
export async function requireAdmin(
  req: Request,
  opts: AuthOpts,
): Promise<AdminAuthResult> {
  const auth = await authenticateUser(req, opts);
  if (!auth.ok) return auth;
  if (auth.via === "service_role") return auth;

  const userId = auth.userId;
  const attempts = Math.max(1, opts.roleQueryAttempts ?? 1);
  const db = serviceClient();

  let rows: Array<{ role: string }> | null = null;
  let roleError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // All rows for the user — no .eq("role","admin") filter, and never
    // .single()/.maybeSingle(): .single() errors when a user legitimately holds
    // both `user` and `admin`, which silently denied a real admin.
    const { data, error } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!error) {
      rows = (data ?? []) as Array<{ role: string }>;
      roleError = null;
      break;
    }
    roleError = error;
  }

  const isAdmin = rolesGrantAdmin(rows);
  console.log(
    "Role check for userId:",
    userId,
    "result:",
    JSON.stringify(rows),
    "error:",
    roleError,
  );

  if (!isAdmin) return { ok: false, status: 403, reason: "not_admin" };
  return auth;
}
