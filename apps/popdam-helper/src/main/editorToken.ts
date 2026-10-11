/**
 * Per-install shared secret for the Photoshop plugin → Helper /editor-event call.
 *
 * Generated once and kept in userData. A copy of the bundled plugin is staged
 * in userData/photoshop-plugin with the token written beside its manifest, so
 * the plugin (which can read its own folder) can send it with each request.
 */

import { app } from "electron";
import { randomBytes } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const PLUGIN_TOKEN_FILE = "helper-token.json";

let cached: string | null = null;

export function getEditorToken(): string {
  if (cached) return cached;
  const dir = app.getPath("userData");
  const p = join(dir, "editor-token");
  try {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t.length >= 32) return (cached = t);
    }
  } catch {
    /* regenerate below */
  }
  const t = randomBytes(32).toString("hex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, t, { encoding: "utf8", mode: 0o600 });
  return (cached = t);
}

/** Copy the bundled plugin into userData and write the token next to it. */
export function stagePhotoshopPlugin(bundledPluginDir: string): string {
  const dest = join(app.getPath("userData"), "photoshop-plugin");
  mkdirSync(dest, { recursive: true });
  cpSync(bundledPluginDir, dest, { recursive: true, force: true });
  writeFileSync(join(dest, PLUGIN_TOKEN_FILE), JSON.stringify({ token: getEditorToken() }), {
    encoding: "utf8",
    mode: 0o600,
  });
  return dest;
}
