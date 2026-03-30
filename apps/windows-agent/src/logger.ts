/**
 * Structured logger for Windows Render Agent.
 * Outputs JSON lines for easy log parsing.
 * Also maintains an in-memory circular buffer for remote log tail access.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

// Circular log buffer — last 200 lines, shipped as last 50 in each heartbeat
const LOG_BUFFER_MAX = 200;
const logBuffer: string[] = [];

export function getLogTail(n = 50): string[] {
  return logBuffer.slice(-n);
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
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
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
};
