const AUTHORIZE_URL = "https://auth.designflow.app/application/o/authorize/";
const TOKEN_URL = "https://auth.designflow.app/application/o/token/";
const CLIENT_ID = "q779goioDDC4P9QzTZM9GiO7SGUraIwPlMvFPb6j";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;

const VERIFIER_KEY = "authentik_pkce_verifier";
const STATE_KEY = "authentik_pkce_state";

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Redirect browser to Authentik's authorization endpoint with PKCE. */
export async function redirectToAuthentik(): Promise<void> {
  const verifier = randomBase64url(32);
  const challenge = await sha256Base64url(verifier);
  const state = randomBase64url(16);

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  window.location.href = `${AUTHORIZE_URL}?${params}`;
}

/** Exchange the authorization code for tokens. Returns the id_token. */
export async function exchangeCode(code: string, returnedState: string): Promise<string> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);

  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!verifier) throw new Error("PKCE verifier missing — session may have expired");
  if (returnedState !== expectedState) throw new Error("State mismatch — possible CSRF");

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokens = await resp.json();
  if (!tokens.id_token) throw new Error("Authentik did not return an id_token");
  return tokens.id_token as string;
}
