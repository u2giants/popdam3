/**
 * Preload script — exposes a safe, typed IPC bridge to the renderer.
 * The renderer never has direct access to Node or Electron APIs.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { LocalConfig, IpcResponse } from "../shared/types";

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
  getAuthState: (): Promise<IpcResponse<{ loggedIn: boolean; accessToken: string | null }>> =>
    ipcRenderer.invoke("get-auth-state"),
  logout: (): Promise<IpcResponse> =>
    ipcRenderer.invoke("logout"),

  // Synology credentials
  saveSynologyCredentials: (creds: { username: string; password: string }): Promise<IpcResponse> =>
    ipcRenderer.invoke("save-synology-credentials", creds),
  hasSynologyCredentials: (): Promise<IpcResponse<boolean>> =>
    ipcRenderer.invoke("has-synology-credentials"),

  // Events from main → renderer
  onCheckoutsChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("checkouts-changed", handler);
    return () => ipcRenderer.removeListener("checkouts-changed", handler);
  },
};

contextBridge.exposeInMainWorld("popdam", api);

export type PopDamAPI = typeof api;
