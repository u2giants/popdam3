// Re-authenticate the same ordinary viewer before its token can expire during a search.
// The margin exceeds the evaluator's longest request timeout (45 seconds).
const RENEWAL_MARGIN_MS = 60_000;

export class ViewerAuthenticationError extends Error {
  constructor() {
    super("Viewer authentication failed or returned an invalid session");
    this.name = "ViewerAuthenticationError";
  }
}

export function createViewerSession({ authenticate, now = Date.now }) {
  let session;
  return async function getToken() {
    if (session && now() < session.expiresAt - RENEWAL_MARGIN_MS) return session.token;
    session = undefined;
    const started = now();
    try {
      const response = await authenticate();
      const expiries = [];
      for (const field of ["expires_at", "expires_in"]) {
        if (response?.[field] === undefined) continue;
        const value = response[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          throw new ViewerAuthenticationError();
        }
        expiries.push(field === "expires_at" ? value * 1000 : started + value * 1000);
      }
      const expiresAt = Math.min(...expiries);
      if (typeof response?.access_token !== "string" || !response.access_token.trim()
          || !expiries.length || !Number.isFinite(expiresAt)
          || expiresAt <= now() + RENEWAL_MARGIN_MS) {
        throw new ViewerAuthenticationError();
      }
      session = { token: response.access_token, expiresAt };
      return session.token;
    } catch {
      // Never include the auth response, credentials or token in reports/errors.
      throw new ViewerAuthenticationError();
    }
  };
}
