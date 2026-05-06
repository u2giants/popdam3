/**
 * Local HTTP server — lets the web DAM talk to the helper directly over localhost,
 * bypassing the cloud roundtrip for directory browsing and other fast operations.
 *
 * Runs on a fixed port (47380) so the web app always knows where to find it.
 * CORS is restricted to *.designflow.app and localhost.
 *
 * Endpoints:
 *   GET /status          — health check; returns { ok, version, roots[] }
 *   GET /browse?path=X   — list directory; path="" lists configured roots
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { getConfig } from "./config";
import { log } from "./logger";
import { HELPER_VERSION } from "@shared/constants";

export const LOCAL_SERVER_PORT = 47380;

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.designflow\.app$/,
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser request
  return ALLOWED_ORIGINS.some((p) => p.test(origin));
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...(origin && isAllowedOrigin(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          Vary: "Origin",
        }
      : {}),
  });
  res.end(json);
}

// ── /browse ───────────────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  is_dir: boolean;
  size?: number;
  modified?: string;
}

function browseLocal(requestPath: string): { path: string; entries: DirEntry[] } {
  const config = getConfig();
  const roots = config.rootMappings.filter((r) => r.local_path);

  // Empty path → list configured roots
  if (!requestPath || requestPath === "/") {
    return {
      path: "",
      entries: roots.map((r) => ({
        name: r.root_id,
        is_dir: true,
      })),
    };
  }

  // Resolve path: first segment is root_id, rest is subpath
  const parts = requestPath.replace(/\\/g, "/").replace(/^\//, "").split("/");
  const rootId = parts[0];
  const subPath = parts.slice(1).join("/");

  const root = roots.find((r) => r.root_id === rootId);

  // If not a known root_id, try treating as an absolute local path (power-user mode)
  const localBase = root ? root.local_path : requestPath;
  const localPath = root && subPath ? join(localBase, subPath) : localBase;

  const entries: DirEntry[] = [];
  const items = readdirSync(localPath);

  for (const name of items) {
    // Skip hidden files
    if (name.startsWith(".")) continue;
    try {
      const st = statSync(join(localPath, name));
      entries.push({
        name,
        is_dir: st.isDirectory(),
        size: st.isDirectory() ? undefined : st.size,
        modified: st.mtime.toISOString(),
      });
    } catch {
      // skip entries we can't stat (broken symlinks, permission errors)
    }
  }

  return { path: requestPath, entries };
}

// ── Server ────────────────────────────────────────────────────────────────────

export function startLocalServer(): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", `http://localhost:${LOCAL_SERVER_PORT}`);

    // Preflight
    if (req.method === "OPTIONS") {
      if (isAllowedOrigin(origin)) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin ?? "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        });
      } else {
        res.writeHead(403);
      }
      res.end();
      return;
    }

    if (req.method !== "GET") {
      send(res, 405, { ok: false, error: "Method not allowed" }, origin);
      return;
    }

    if (!isAllowedOrigin(origin)) {
      send(res, 403, { ok: false, error: "Forbidden origin" });
      return;
    }

    try {
      if (url.pathname === "/status") {
        const config = getConfig();
        send(res, 200, {
          ok: true,
          version: HELPER_VERSION,
          roots: config.rootMappings.map((r) => ({
            root_id: r.root_id,
            display_name: r.display_name,
            local_path: r.local_path,
          })),
        }, origin);
        return;
      }

      if (url.pathname === "/browse") {
        const path = url.searchParams.get("path") ?? "";
        const result = browseLocal(path);
        send(res, 200, {
          ok: true,
          path: result.path,
          entries: result.entries,
          listed_at: new Date().toISOString(),
        }, origin);
        return;
      }

      send(res, 404, { ok: false, error: "Not found" }, origin);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("Local server error:", msg);
      send(res, 500, { ok: false, error: msg }, origin);
    }
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      log.warn(`Port ${LOCAL_SERVER_PORT} already in use — local server not started`);
    } else {
      log.error("Local server error:", e.message);
    }
  });

  server.listen(LOCAL_SERVER_PORT, "127.0.0.1", () => {
    log.info(`Local server listening on http://127.0.0.1:${LOCAL_SERVER_PORT}`);
  });
}
