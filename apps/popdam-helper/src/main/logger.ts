import { app } from "electron";
import { join } from "path";
import { mkdirSync, appendFileSync } from "fs";
import { LOGS_SUBDIR } from "@shared/constants";

const logDir = join(app.getPath("userData"), LOGS_SUBDIR);
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
