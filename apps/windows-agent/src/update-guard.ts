/**
 * Fail-closed validation for Windows-agent OTA updates (issue #230).
 * The update payload is executed as code, so we require:
 *  - an HTTPS download URL on the project's own GitHub releases path
 *  - a well-formed SHA-256 checksum that the downloaded zip must match
 */
const ALLOWED_URL_PREFIX = "https://github.com/u2giants/popdam3/releases/";
// GitHub serves release assets via a redirect to these hosts.
const ALLOWED_REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export function assertTrustedDownloadUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Update refused: invalid download_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.href.startsWith(ALLOWED_URL_PREFIX)
  ) {
    throw new Error(`Update refused: download_url not on pinned release path (${url.origin})`);
  }
}

export function assertTrustedFinalUrl(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !ALLOWED_REDIRECT_HOSTS.has(url.hostname)) {
    throw new Error(`Update refused: download redirected to untrusted host ${url.hostname}`);
  }
}

export function normalizeChecksum(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(v)) {
    throw new Error("Update refused: missing or malformed checksum_sha256");
  }
  return v;
}
