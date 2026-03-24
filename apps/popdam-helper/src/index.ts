/**
 * PopDAM Helper — Windows protocol handler
 *
 * Handles popdam:// URLs from the web app by opening the target folder in Explorer.
 *
 * Usage:
 *   popdam-helper.exe "popdam://open-folder?path=%5C%5Cnas%5Cshare%5Cfolder"
 *   popdam-helper.exe --register      write HKCU registry keys
 *   popdam-helper.exe --unregister    remove registry keys
 */

import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";

// When packaged by pkg, process.execPath is the .exe itself.
const EXE_PATH = process.execPath;

function parsePopDamUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "popdam:") return null;
    return url.searchParams.get("path");
  } catch {
    return null;
  }
}

function openFolder(folderPath: string): void {
  // Normalize forward slashes to backslashes for Windows Explorer
  const winPath = folderPath.replace(/\//g, "\\");
  try {
    execFileSync("explorer.exe", [winPath], { windowsHide: false });
  } catch {
    // Explorer returns exit code 1 even on success — ignore
  }
}

function regAdd(keyPath: string, valueName: string | null, data: string, type = "REG_SZ"): void {
  const args = ["add", keyPath, "/t", type, "/d", data, "/f"];
  if (valueName) {
    args.push("/v", valueName);
  } else {
    args.push("/ve");
  }
  execSync(`reg ${args.map(a => `"${a}"`).join(" ")}`, { windowsHide: true, stdio: "pipe" });
}

function register(): void {
  const exe = EXE_PATH;
  const root = "HKCU\\Software\\Classes\\popdam";

  regAdd(root, null, "URL:PopDAM Folder Opener");
  regAdd(root, "URL Protocol", "");
  regAdd(`${root}\\DefaultIcon`, null, `${exe},0`);
  regAdd(`${root}\\shell\\open\\command`, null, `"${exe}" "%1"`);

  console.log(`popdam:// protocol handler registered.`);
  console.log(`Handler: "${exe}" "%1"`);
}

function unregister(): void {
  execSync(`reg delete "HKCU\\Software\\Classes\\popdam" /f`, {
    windowsHide: true,
    stdio: "pipe",
  });
  console.log("popdam:// protocol handler unregistered.");
}

// ── Main ─────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg) {
  console.error("PopDAM Helper");
  console.error("");
  console.error("Usage:");
  console.error("  popdam-helper.exe --register      Register popdam:// protocol handler");
  console.error("  popdam-helper.exe --unregister    Remove protocol handler");
  console.error("  popdam-helper.exe <popdam://...>  Open folder (called by browser)");
  process.exit(1);
}

if (arg === "--register") {
  register();
} else if (arg === "--unregister") {
  unregister();
} else {
  const folderPath = parsePopDamUrl(arg);
  if (!folderPath) {
    console.error(`Invalid or unsupported popdam:// URL: ${arg}`);
    process.exit(1);
  }
  openFolder(folderPath);
}
