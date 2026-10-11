/**
 * Structured logger for PopDAM Worker.
 * Outputs JSON lines for easy Railway log parsing.
 *
 * LOG_LEVEL (debug | info | warn | error, default "info") sets the minimum
 * level written; lower-priority calls are dropped.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function resolveLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "").trim().toLowerCase();
  return value in PRIORITY ? (value as LogLevel) : "info";
}

export function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return PRIORITY[level] >= PRIORITY[minimum];
}

const minimumLevel = resolveLogLevel(process.env.LOG_LEVEL);

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level, minimumLevel)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
};
