/**
 * Synology File Station API client.
 *
 * Authenticates as the actual user (not a service account) so that
 * Synology audit logs record the correct username for every upload.
 *
 * API reference: Synology File Station API Guide
 * Base URL: https://<nas>:<port>/webapi/
 */

import { statSync, writeFileSync, mkdirSync, openAsBlob } from "fs";
import { dirname } from "path";
import { log } from "./logger";
import { loadToken, storeToken, deleteToken } from "./credentials";

const SID_KEY = "synology_sid";

export interface SynologyConfig {
  url: string;       // e.g. "https://nyc-synology.example"
  port: string;      // e.g. "5001"
  username: string;  // Synology account
  password: string;  // loaded from keychain
}

function apiBase(config: SynologyConfig): string {
  return `${config.url.replace(/\/$/, "")}:${config.port}/webapi`;
}

// ── Session management ────────────────────────────────────────────────────────

export async function login(config: SynologyConfig): Promise<string> {
  const cached = await loadToken(SID_KEY);
  if (cached) return cached;

  const url =
    `${apiBase(config)}/auth.cgi` +
    `?api=SYNO.API.Auth&version=3&method=login` +
    `&account=${encodeURIComponent(config.username)}` +
    `&passwd=${encodeURIComponent(config.password)}` +
    `&session=FileStation&format=sid`;

  const res = await fetch(url);
  const json = await res.json() as { success?: boolean; error?: { code?: unknown }; data?: { sid?: string } };
  if (!json.success) {
    throw new Error(`Synology login failed: error code ${json.error?.code}`);
  }

  const sid = json.data?.sid;
  if (!sid) throw new Error("Synology login failed: missing sid");
  await storeToken(SID_KEY, sid);
  return sid;
}

export async function logout(config: SynologyConfig): Promise<void> {
  const sid = await loadToken(SID_KEY);
  if (!sid) return;
  await fetch(
    `${apiBase(config)}/auth.cgi?api=SYNO.API.Auth&version=1&method=logout&session=FileStation&_sid=${sid}`,
  ).catch(() => {/* best-effort */});
  await deleteToken(SID_KEY);
}

// ── Upload ────────────────────────────────────────────────────────────────────

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

/**
 * Upload a file to Synology using File Station upload API.
 * Uploads to a temporary filename first, then renames to final name.
 *
 * @param config      Synology connection + auth config
 * @param localPath   Local file to upload (snapshot)
 * @param shareName   Synology share name, e.g. "Design_Hot"
 * @param remotePath  Relative path within the share, e.g. "Walmart/2026/Spring/WallArt"
 * @param tempName    Temporary filename to upload as (e.g. "art.ai.__pop_uploading_abc.tmp")
 * @param finalName   Final filename after rename (e.g. "art.ai")
 * @param onProgress  Optional progress callback
 */
export async function uploadFile(
  config: SynologyConfig,
  localPath: string,
  shareName: string,
  remoteDir: string,
  tempName: string,
  finalName: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const sid = await login(config);
  const totalBytes = statSync(localPath).size;
  const destFolder = `/${shareName}/${remoteDir}`.replace(/\/\//g, "/").replace(/\/$/, "");

  // Upload to temp filename
  log.info(`Uploading ${localPath} → ${destFolder}/${tempName}`);
  await uploadChunked(config, sid, localPath, destFolder, tempName, totalBytes, onProgress);

  // Rename temp → final
  log.info(`Renaming ${tempName} → ${finalName}`);
  await renameFile(config, sid, destFolder, tempName, finalName);
}

async function uploadChunked(
  config: SynologyConfig,
  sid: string,
  localPath: string,
  destFolder: string,
  destFilename: string,
  totalBytes: number,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  // Synology File Station supports multipart upload via SYNO.FileStation.Upload
  const uploadUrl = `${apiBase(config)}/entry.cgi`;

  const formData = new FormData();
  formData.append("api", "SYNO.FileStation.Upload");
  formData.append("version", "2");
  formData.append("method", "upload");
  formData.append("path", destFolder);
  formData.append("create_parents", "true");
  formData.append("overwrite", "true");
  formData.append("_sid", sid);

  const blob = await openAsBlob(localPath);
  formData.append("file", blob, destFilename);

  onProgress?.({ bytesUploaded: 0, totalBytes, percent: 0 });

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    headers: { Cookie: `id=${sid}` },
  });

  const json = await res.json() as { success?: boolean; error?: { code?: number } };
  if (!json.success) {
    // Session may have expired — clear cached SID and let caller retry
    if (json.error?.code === 119 || json.error?.code === 105) {
      await deleteToken(SID_KEY);
    }
    throw new Error(`Synology upload failed: error code ${json.error?.code}`);
  }

  onProgress?.({ bytesUploaded: totalBytes, totalBytes, percent: 100 });
}

async function renameFile(
  config: SynologyConfig,
  sid: string,
  folder: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const url = `${apiBase(config)}/entry.cgi`;
  const body = new URLSearchParams({
    api: "SYNO.FileStation.Rename",
    version: "2",
    method: "rename",
    path: JSON.stringify([`${folder}/${oldName}`]),
    name: JSON.stringify([newName]),
    _sid: sid,
  });

  const res = await fetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const json = await res.json() as { success?: boolean; error?: { code?: unknown } };
  if (!json.success) {
    throw new Error(`Synology rename failed: error code ${json.error?.code}`);
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

export async function downloadFile(
  config: SynologyConfig,
  shareName: string,
  remotePath: string,
  localDestPath: string,
): Promise<void> {
  const sid = await login(config);
  const fullRemotePath = `/${shareName}/${remotePath}`.replace(/\/\//g, "/");

  const url =
    `${apiBase(config)}/entry.cgi` +
    `?api=SYNO.FileStation.Download&version=2&method=download` +
    `&path=${encodeURIComponent(fullRemotePath)}&mode=download&_sid=${sid}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Synology download failed: ${res.status}`);

  mkdirSync(dirname(localDestPath), { recursive: true });

  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(localDestPath, buf);
  log.info(`Downloaded ${fullRemotePath} → ${localDestPath}`);
}
