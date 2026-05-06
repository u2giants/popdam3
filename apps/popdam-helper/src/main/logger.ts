import { join } from "path";
import { mkdirSync, appendFileSync } from "fs";
import { homedir } from "os";
import { LOGS_SUBDIR } from "@shared/constants";

function resolveLogDir(): string {
  // Use APPDATA on Windows, ~/Library/Application Support on Mac, ~/.local on Linux
  const appName = "POP DAM Helper";
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), appName, LOGS_SUBDIR);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", appName, LOGS_SUBDIR);
  }
  return join(homedir(), ".config", appName, LOGS_SUBDIR);
}

const logDir = resolveLogDir();
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, `helper-${new Date().toISOString().slice(0, 10)}.log`);

type Level = "info" | "warn" | "error" | "debug";

function write(level: Level, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] ${args.map(String).join(" ")}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logFile, line);
  } catch {
    // don't crash if log write fails
  }
}

export const log = {
  info:  (...args: unknown[]) => write("info",  ...args),
  warn:  (...args: unknown[]) => write("warn",  ...args),
  error: (...args: unknown[]) => write("error", ...args),
  debug: (...args: unknown[]) => write("debug", ...args),
};
