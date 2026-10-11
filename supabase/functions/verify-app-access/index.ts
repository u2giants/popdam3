/**
 * verify-app-access
 *
 * Cross-app authentication endpoint for sister apps (e.g. PopSG/StyleGuides).
 *
 * Flow:
 *   1. Sister app frontend obtains a JWT by signing the user into PopDAM's Supabase auth.
 *   2. Sister app's edge functions receive that JWT and call this endpoint to verify it
 *      and check whether the user is granted access to the requested app.
 *   3. This function returns { ok: true, user_id, email, apps } on success,
 *      or an error response otherwise.
 *
 * Public (verify_jwt = false in config.toml — we validate the bearer token in code).
 */

import { corsServe, json } from "../_shared/http.ts";
import { createClient } from "../_shared/supabase-js.ts";

const VALID_APPS = new Set(["popdam", "styleguides"]);

corsServe(async (req) => {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      return json({ ok: false, error: "Missing bearer token" }, 401);
    }

    let app = "styleguides";
    try {
      const body = await req.json();
      if (body && typeof body.app === "string" && VALID_APPS.has(body.app)) {
        app = body.app;
      }
    } catch {
      // body is optional — default to styleguides
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate the JWT against PopDAM's auth
    const userClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "Invalid or expired token" }, 401);
    }

    const userId = userData.user.id;
    const email = userData.user.email ?? null;

    // Look up all app_access rows for this user
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: rows, error: accessErr } = await admin
      .from("app_access")
      .select("app")
      .eq("user_id", userId);

    if (accessErr) {
      return json({ ok: false, error: accessErr.message }, 500);
    }

    const apps = (rows ?? []).map((r: { app: string }) => r.app);
    const hasAccess = apps.includes(app);

    if (!hasAccess) {
      return json(
        { ok: false, error: `User does not have access to '${app}'` },
        403,
      );
    }

    return json({
      ok: true,
      user_id: userId,
      email,
      apps,
      app,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
