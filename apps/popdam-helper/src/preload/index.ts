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
  signIn: (provider?: string): Promise<IpcResponse> =>
    ipcRenderer.invoke("sign-in", provider ?? "google"),
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
};

contextBridge.exposeInMainWorld("popdam", api);

export type PopDamAPI = typeof api;
