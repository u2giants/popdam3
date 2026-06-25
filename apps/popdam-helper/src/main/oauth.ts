/**
 * Microsoft OAuth for the desktop helper.
 *
 * The flow uses the user's system browser and redirects back to the helper's
 * localhost server. Supabase Auth returns a short-lived PKCE code, which we
 * exchange for the normal Supabase access/refresh tokens used by helper-api.
 */

import { shell } from "electron";
import { createHash, randomBytes } from "crypto";
import { storeSession } from "./credentials";
import { discoverSupabaseConfig } from "./damClient";
import { getConfig, saveConfig } from "./config";
import { log } from "./logger";
import { LOCAL_SERVER_PORT } from "@shared/constants";

const OAUTH_CALLBACK_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/auth/callback`;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

let pending:
  | {
      codeVerifier: string;
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  | null = null;

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function newCodeVerifier(): string {
  return base64Url(randomBytes(48));
}

function codeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

async function ensureSupabaseConfig(): Promise<{ supabaseUrl: string; supabaseAnonKey: string }> {
  const config = getConfig();
  if (config.supabaseUrl && config.supabaseAnonKey) {
    return { supabaseUrl: config.supabaseUrl, supabaseAnonKey: config.supabaseAnonKey };
  }
  const discovered = await discoverSupabaseConfig(config.damUrl);
  saveConfig(discovered);
  return discovered;
}

export async function startMicrosoftOAuth(): Promise<void> {
  if (pending) throw new Error("A Microsoft sign-in is already in progress.");

  const { supabaseUrl } = await ensureSupabaseConfig();
  const verifier = newCodeVerifier();
  const challenge = codeChallenge(verifier);

  // Do NOT set our own `state` here. Supabase GoTrue generates and stores its
  // own OAuth state (keyed to a flow_state row) and validates it on the
  // /auth/v1/callback. If we pass a `state`, GoTrue forwards it to the provider
  // verbatim, then fails to find it in its flow store on callback and returns
  // `bad_oauth_state`. PKCE (the code_verifier below) is what binds this flow.
  const url = new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/authorize`);
  url.searchParams.set("provider", "azure");
  url.searchParams.set("redirect_to", OAUTH_CALLBACK_URL);
  url.searchParams.set("scopes", "openid profile email User.Read");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "s256");

  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending = null;
      reject(new Error("Microsoft sign-in timed out. Please try again."));
    }, OAUTH_TIMEOUT_MS);
    pending = { codeVerifier: verifier, resolve, reject, timeout };
  });

  await shell.openExternal(url.toString());
  await done;
}

export async function completeMicrosoftOAuthCallback(url: URL): Promise<{ ok: boolean; message: string }> {
  if (!pending) {
    return { ok: false, message: "No Microsoft sign-in is currently waiting for this callback." };
  }

  const current = pending;
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const code = url.searchParams.get("code");

  try {
    if (error) throw new Error(error);
    if (!code) throw new Error("Microsoft sign-in did not return an auth code.");

    const { supabaseUrl, supabaseAnonKey } = await ensureSupabaseConfig();
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        auth_code: code,
        code_verifier: current.codeVerifier,
      }),
    });

    const json = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = (json.error_description ?? json.msg ?? json.message ?? "Token exchange failed") as string;
      throw new Error(msg);
    }

    const session = (json.session ?? json) as Record<string, unknown>;
    const accessToken = session.access_token as string | undefined;
    const refreshToken = session.refresh_token as string | undefined;
    if (!accessToken || !refreshToken) {
      throw new Error("Microsoft sign-in succeeded but no Supabase session was returned.");
    }

    storeSession(accessToken, refreshToken);
    clearTimeout(current.timeout);
    pending = null;
    current.resolve();
    return { ok: true, message: "Microsoft sign-in complete. You can return to POP DAM Helper." };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    log.warn("Microsoft OAuth failed:", err.message);
    clearTimeout(current.timeout);
    pending = null;
    current.reject(err);
    return { ok: false, message: err.message };
  }
}
