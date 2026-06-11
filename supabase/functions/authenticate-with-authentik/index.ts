/**
 * authenticate-with-authentik
 *
 * Exchanges a validated Authentik id_token for a Supabase session token_hash.
 *
 * Flow:
 *   1. Frontend completes PKCE code exchange with Authentik (public client, browser-side)
 *   2. Frontend POSTs { id_token } to this function
 *   3. This function validates the id_token via Authentik's JWKS
 *   4. Gets or creates the Supabase user (new users bypass the invitation trigger
 *      because app_metadata.provider is set to 'authentik')
 *   5. Generates a magic-link OTP and returns { token_hash }
 *   6. Frontend calls supabase.auth.verifyOtp({ token_hash, type: 'email' })
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";
import { corsServe, err, json } from "../_shared/http.ts";

const AUTHENTIK_ISSUER = "https://auth.designflow.app/application/o/popdam/";
const AUTHENTIK_CLIENT_ID = "q779goioDDC4P9QzTZM9GiO7SGUraIwPlMvFPb6j";
const AUTHENTIK_JWKS_URL = "https://auth.designflow.app/application/o/popdam/jwks/";

corsServe(async (req) => {
  let body: { id_token?: string };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }

  const { id_token } = body;
  if (!id_token || typeof id_token !== "string") {
    return err("id_token is required");
  }

  // Validate id_token against Authentik's JWKS
  let claims: Record<string, unknown>;
  try {
    const JWKS = createRemoteJWKSet(new URL(AUTHENTIK_JWKS_URL));
    const { payload } = await jwtVerify(id_token, JWKS, {
      issuer: AUTHENTIK_ISSUER,
      audience: AUTHENTIK_CLIENT_ID,
    });
    claims = payload as Record<string, unknown>;
  } catch (e) {
    return err(`Invalid id_token: ${(e as Error).message}`, 401);
  }

  const email = (claims.email ?? claims.upn) as string | undefined;
  if (!email) {
    return err("id_token does not contain an email claim", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if user already exists
  const searchResp = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`,
    { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
  );
  const { users } = await searchResp.json();
  const userExists = Array.isArray(users) && users.length > 0;

  if (!userExists) {
    // Create user — app_metadata.provider='authentik' makes the invitation
    // trigger skip the invitation check (see migration 20260509_authentik_bypass)
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { provider: "authentik" },
      user_metadata: {
        full_name: (claims.name ?? claims.given_name ?? email) as string,
      },
    });
    if (createErr) {
      return err(`Failed to create user: ${createErr.message}`, 500);
    }
  }

  // Generate a magic-link OTP — does not send email, just produces a token_hash
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return err(`Failed to generate session: ${linkErr?.message ?? "no token"}`, 500);
  }

  return json({ token_hash: linkData.properties.hashed_token });
});
