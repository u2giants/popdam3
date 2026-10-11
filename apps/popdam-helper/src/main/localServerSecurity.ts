/**
 * Request-validation rules for the Helper's localhost HTTP server.
 *
 * Kept free of Electron / config imports so it can be unit-tested directly.
 *
 * - Host check: blocks DNS-rebinding (an attacker domain resolving to 127.0.0.1
 *   still sends its own Host header). Only the loopback names on our port pass.
 * - Origin allowlist: exact production web-app origins plus the local Vite dev
 *   server — not "any localhost port".
 * - Editor token: a per-install shared secret the Photoshop plugin must send.
 * - Path containment: /browse only lists inside configured roots.
 */

import { timingSafeEqual } from "crypto";
import { isAbsolute, relative, resolve, sep } from "path";

export const ALLOWED_WEB_ORIGINS: ReadonlySet<string> = new Set([
  "https://dam.designflow.app",
  "https://sg.designflow.app",
  // Local development of the web app (vite.config.ts server.port).
  "http://localhost:8080",
]);

export const EDITOR_TOKEN_HEADER = "x-popdam-helper-token";

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  return !!origin && ALLOWED_WEB_ORIGINS.has(origin);
}

export function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resolve `subPath` inside `rootPath`. Returns null if the result would escape
 * the root (`..`, absolute paths, other drives).
 */
export function resolveWithinRoot(rootPath: string, subPath: string): string | null {
  const base = resolve(rootPath);
  const target = resolve(base, subPath || ".");
  const rel = relative(base, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}
