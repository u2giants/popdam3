export const HELPER_VERSION = "1.4.3";
export const PROTOCOL = "popdam";
export const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Dangerous base paths that must never be used as roots
export const FORBIDDEN_ROOT_PREFIXES_WIN = [
  "C:\\",
  "D:\\",
  "C:\\Users",
  "C:\\Windows",
  "C:\\Program Files",
];

export const FORBIDDEN_ROOT_PREFIXES_MAC = [
  "/",
  "/Users",
  "/home",
  "/tmp",
  "/var",
  "/etc",
  "/System",
  "/Library",
];

// Minimum depth below a user home dir before a path is considered safe
export const MIN_PATH_DEPTH = 2;

// File stability check
export const STABILITY_WAIT_MS = 3000;
export const STABILITY_MAX_ATTEMPTS = 10;

// Upload
export const UPLOAD_MAX_RETRIES = 5;
export const UPLOAD_RETRY_DELAY_MS = 10000;
export const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

// Heartbeat
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const LOCAL_SERVER_PORT = 47380;

// Marker file name that lives at the root of every managed root
export const ROOT_MARKER_FILENAME = "pop-root.json";

// Local app data subdirs
export const WORKSPACE_SUBDIR = "CheckedOut";
export const SNAPSHOTS_SUBDIR = "Snapshots";
export const LOGS_SUBDIR = "Logs";
