// ─── Storage providers (Seafile / Synology / local) ───────────────────────────

export type StorageProvider = "seafile" | "synology" | "local";

export interface StorageHealth {
  provider: StorageProvider;
  available: boolean;
  detail?: string;
}

export interface SeafileLibraryMapping {
  libraryId: string;     // Seafile library UUID
  displayName: string;   // e.g. "Character Licensed"
  seaDriveFolder: string; // folder under seaDriveRoot (= the Seafile library name), e.g. "Character Licensed"
  rootId: string;        // PopDAM root_id this library lives under, e.g. "Decor"
  // relative_path prefix this library covers, e.g. "Decor/Character Licensed".
  // A PopDAM root can contain multiple libraries as subfolders, so the library is
  // resolved by longest-prefix match on relative_path, then the prefix is stripped
  // to get the in-library path.
  pathPrefix: string;
}

export interface HydrationStatus {
  state: "local" | "hydrating" | "unavailable";
  bytesDone?: number;
  bytesTotal?: number;
}

export interface CheckoutSource {
  provider: StorageProvider;
  localPath: string;
  seafileObjId?: string;
}

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
  // Source provider (machine-local — where the source file was read from)
  sourceProvider?: StorageProvider;
  sourceLocalPath?: string;
  seafileObjId?: string;       // Seafile obj_id captured at checkout → source_version
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
  // Existing entries default to "synology" — both fields are optional, no migration needed.
  provider?: StorageProvider;
  seafileLibraryId?: string;
}

// ─── Config (persisted locally) ───────────────────────────────────────────────

export interface LocalConfig {
  deviceId: string | null;
  deviceName: string;
  deviceOs: "windows" | "macos";
  helperVersion: string;
  damUrl: string;
  supabaseUrl: string;        // API base URL — auto-discovered from ${damUrl}/dam-config.json
  supabaseAnonKey: string;    // Public anon key — auto-discovered from ${damUrl}/dam-config.json
  workspacePath: string;
  rootMappings: RootMapping[];
  // ── Seafile / SeaDrive ──
  preferredProvider?: StorageProvider;     // default "seafile" for Brazil/WFH; USA/office users can switch to "synology"
  seaDriveRoot?: string;                   // absolute SeaDrive mount point, e.g. /Users/maria/SeaDrive
  seafileLibraries?: SeafileLibraryMapping[];
  seafileServerUrl?: string;               // Seafile server base URL (for obj_id REST lookups; optional)
  synologyFallbackAllowed?: boolean;       // mirror of server config; whether Synology fallback is permitted
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
  | "sign-in-microsoft"
  | "logout"
  | "get-storage-health"
  | "test-seafile-mapping"
  | "save-seafile-token";

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
  sourceProvider?: StorageProvider;
  seafileObjId?: string;
  // Re-drive: re-uploading a stuck 'verifying' check-in from its snapshot. On
  // success this reports to /redrive-complete instead of /complete-checkin and
  // does not mark the checkout done — verification continues.
  isRedrive?: boolean;
}
