/**
 * Preload script — exposes a safe, typed IPC bridge to the renderer.
 * The renderer never has direct access to Node or Electron APIs.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { LocalConfig, IpcResponse, ValidationResult } from "../shared/types";

const api = {
  // Config
  getConfig: (): Promise<IpcResponse<LocalConfig>> =>
    ipcRenderer.invoke("get-config"),
  saveConfig: (updates: Partial<LocalConfig>): Promise<IpcResponse<LocalConfig>> =>
    ipcRenderer.invoke("save-config", updates),

  // Checkout state
  getCheckouts: (): Promise<IpcResponse<{
    checkouts: unknown[];
    uploadJobs: unknown[];
  }>> => ipcRenderer.invoke("get-checkouts"),

  // File actions
  openFile: (checkoutId: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("open-file", checkoutId),
  revealFile: (checkoutId: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("reveal-file", checkoutId),
  checkin: (checkoutId: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("checkin", checkoutId),
  discard: (checkoutId: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("discard", checkoutId),

  // Navigation
  openDam: (): Promise<IpcResponse> =>
    ipcRenderer.invoke("open-dam"),

  // Auth
  getAuthState: (): Promise<IpcResponse<{ loggedIn: boolean; userId: string | null; email: string | null; accessToken: string | null }>> =>
    ipcRenderer.invoke("get-auth-state"),
  signIn: (email: string, password: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("sign-in", { email, password }),
  signInMicrosoft: (): Promise<IpcResponse> =>
    ipcRenderer.invoke("sign-in-microsoft"),
  logout: (): Promise<IpcResponse> =>
    ipcRenderer.invoke("logout"),

  // Folder picker (native OS dialog)
  browseForFolder: (): Promise<IpcResponse<string | null>> =>
    ipcRenderer.invoke("browse-for-folder"),

  // Synology credentials
  saveSynologyCredentials: (creds: { username: string; password: string }): Promise<IpcResponse> =>
    ipcRenderer.invoke("save-synology-credentials", creds),
  hasSynologyCredentials: (): Promise<IpcResponse<boolean>> =>
    ipcRenderer.invoke("has-synology-credentials"),

  // Supabase URL auto-discovery
  discoverSupabaseUrl: (damUrl: string): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke("discover-supabase-url", damUrl),

  // Server-defined root mappings
  fetchServerRoots: (): Promise<IpcResponse<Array<{ root_id: string; display_name: string; server_path: string }>>> =>
    ipcRenderer.invoke("fetch-server-roots"),

  // Seafile / SeaDrive
  getStorageHealth: (): Promise<IpcResponse<{
    provider: "seafile";
    available: boolean;
    installed: boolean;
    running: boolean;
    root: string | null;
    discoveredLibraries: string[];
    librariesConfigured: string[];
    librariesMounted: string[];
    librariesMissing: string[];
    detail?: string;
  }>> => ipcRenderer.invoke("get-storage-health"),
  testSeafileMapping: (sampleRelativePath: string): Promise<IpcResponse<{
    ok: boolean; resolvedPath?: string; exists?: boolean; message: string;
  }>> => ipcRenderer.invoke("test-seafile-mapping", { sampleRelativePath }),
  saveSeafileToken: (token: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("save-seafile-token", token),

  // Photoshop plugin
  revealPhotoshopPlugin: (): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke("reveal-photoshop-plugin"),

  // Root path validation (runs in main process — has filesystem access)
  validateRoot: (path: string, rootId: string): Promise<IpcResponse<ValidationResult>> =>
    ipcRenderer.invoke("validate-root", { path, rootId }),

  // Events from main → renderer
  onCheckoutsChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("checkouts-changed", handler);
    return () => ipcRenderer.removeListener("checkouts-changed", handler);
  },
  onAuthChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("auth-changed", handler);
    return () => ipcRenderer.removeListener("auth-changed", handler);
  },
  onActionError: (cb: (payload: { action: string; message: string }) => void): (() => void) => {
    const handler = (_e: unknown, payload: { action: string; message: string }) => cb(payload);
    ipcRenderer.on("action-error", handler);
    return () => ipcRenderer.removeListener("action-error", handler);
  },
  // Main asks the renderer to open Settings, optionally focused on a section
  // (e.g. "credentials" after a check-in failed for missing Synology creds).
  onOpenSettings: (cb: (section?: string) => void): (() => void) => {
    const handler = (_e: unknown, section?: string) => cb(section);
    ipcRenderer.on("open-settings", handler);
    return () => ipcRenderer.removeListener("open-settings", handler);
  },
};

contextBridge.exposeInMainWorld("popdam", api);

export type PopDamAPI = typeof api;
