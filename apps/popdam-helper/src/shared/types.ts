// ─── Checkout lifecycle ───────────────────────────────────────────────────────

export type CheckoutStatus =
  | "active"
  | "checkin_queued"
  | "uploading"
  | "verifying"
  | "complete"
  | "discarded"
  | "error"
  | "conflict";

export interface CheckoutRecord {
  id: string;                  // UUID from DB
  assetId: string;
  userId: string;
  deviceId: string | null;
  status: CheckoutStatus;
  checkedOutAt: string;        // ISO timestamp
  checkedInAt: string | null;
  // Asset info
  filename: string;
  relativePath: string;
  rootId: string;
  // File state
  sourceHash: string;
  sourceSize: number;
  // Local paths (machine-specific, not in DB)
  workspacePath: string;
  snapshotPath: string | null;
  // Upload progress (in-memory only)
  uploadProgress: number | null; // 0–100
  errorMessage: string | null;
}

// ─── Root validation ──────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; reason: "forbidden"; message: string }
  | { ok: false; reason: "no_marker"; message: string }
  | { ok: false; reason: "wrong_root_id"; expected: string; actual: string; message: string }
  | { ok: false; reason: "too_deep"; suggestedPath: string; message: string }
  | { ok: false; reason: "too_shallow"; suggestedPath: string; message: string };

// ─── Root mappings ────────────────────────────────────────────────────────────

export interface RootMapping {
  root_id: string;           // e.g. "design_hot"
  display_name: string;      // e.g. "Design Hot"
  local_path: string;        // e.g. "C:\\Users\\Maria\\Seafile\\Design_Hot"
  marker_verified: boolean;
}

// ─── Config (persisted locally) ───────────────────────────────────────────────

export interface LocalConfig {
  deviceId: string | null;
  deviceName: string;
  deviceOs: "windows" | "macos";
  helperVersion: string;
  damUrl: string;
  supabaseUrl: string;   // API base URL — auto-discovered from ${damUrl}/dam-config.json
  workspacePath: string;
  rootMappings: RootMapping[];
}

// ─── IPC channel types ────────────────────────────────────────────────────────

export type IpcChannel =
  | "get-checkouts"
  | "get-config"
  | "save-config"
  | "open-file"
  | "reveal-file"
  | "checkin"
  | "discard"
  | "open-dam"
  | "get-auth-state"
  | "logout";

export interface IpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthState {
  loggedIn: boolean;
  userId: string | null;
  email: string | null;
  accessToken: string | null;
}

// ─── Upload queue ─────────────────────────────────────────────────────────────

export interface UploadJob {
  checkoutId: string;
  snapshotPath: string;
  uploadMethod: "synology_file_station" | "webdav" | "smb_local";
  synologyUrl: string | null;
  synologyPort: string;
  relativePath: string;
  filename: string;
  tempSuffix: string;
  retryCount: number;
  addedAt: number; // Date.now()
}
