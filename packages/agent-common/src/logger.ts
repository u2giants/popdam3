/**
 * Structured logger shared by the bridge agent and the Windows render agent.
 * Outputs JSON lines for easy log parsing and keeps an in-memory circular
 * buffer for remote log-tail access (shipped with each Windows heartbeat).
 *
 * LOG_LEVEL (debug|info|warn|error) controls verbosity. When LOG_LEVEL is
 * unset the platform default applies: the Windows agent filters debug (its
 * 3s poll loop logs idle chatter at debug — leave it off in production),
 * while the bridge agent (Docker) keeps every line, matching each agent's
 * behavior before the modules were shared (#708).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): number {
  const raw = (process.env.LOG_LEVEL || "").trim().toLowerCase();
  if (raw === "debug") return LEVEL_ORDER.debug;
  if (raw === "warn") return LEVEL_ORDER.warn;
  if (raw === "error") return LEVEL_ORDER.error;
  // Unset or unrecognized: platform default (see header).
  return process.platform === "win32" ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

const MIN_LEVEL = resolveMinLevel();

// Circular log buffer — last 200 lines, shipped as last 50 in each heartbeat
const LOG_BUFFER_MAX = 200;
const logBuffer: string[] = [];

export function getLogTail(n = 50): string[] {
  return logBuffer.slice(-n);
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
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
