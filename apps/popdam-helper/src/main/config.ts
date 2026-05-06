/**
 * Local config — persisted to userData/config.json.
 * Does NOT store secrets (those go in the OS keychain via credentials.ts).
 */

import { app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir, hostname } from "os";
import { LocalConfig } from "@shared/types";
import { HELPER_VERSION } from "@shared/constants";
import { log } from "./logger";

const CONFIG_PATH = join(app.getPath("userData"), "config.json");

function defaultWorkspacePath(): string {
  const home = homedir();
  return process.platform === "win32"
    ? join("C:\\POP-DAM-Workspace")
    : join(home, "POP-DAM-Workspace");
}

function defaultConfig(): LocalConfig {
  return {
    deviceId: null,
    deviceName: hostname(),
    deviceOs: process.platform === "win32" ? "windows" : "macos",
    helperVersion: HELPER_VERSION,
    damUrl: "https://dam.designflow.app",
    supabaseUrl: "",
    workspacePath: defaultWorkspacePath(),
    rootMappings: [],
  };
}

let _config: LocalConfig | null = null;

export function loadConfig(): LocalConfig {
  if (_config) return _config;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    _config = { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    _config = defaultConfig();
  }
  return _config!;
}

export function saveConfig(updates: Partial<LocalConfig>): LocalConfig {
  const current = loadConfig();
  _config = { ...current, ...updates };
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), "utf-8");
  } catch (e) {
    log.error("Failed to save config:", e);
  }
  return _config!;
}

export function getConfig(): LocalConfig {
  return loadConfig();
}
