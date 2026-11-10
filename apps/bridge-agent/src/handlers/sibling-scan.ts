/** Moved out of index.ts (#234) — pure move, no behavior change. */
import { stat, readdir } from "node:fs/promises";
import * as api from "../api-client.js";
import { logger } from "../common/logger.js";
import { isPdfCandidate } from "../scanner.js";
import { generateThumbnail } from "../thumbnailer.js";

let siblingScanInProgress = false;

const SIBLING_SCAN_CONCURRENCY = 4;


const SIBLING_SCAN_MAX_DEPTH = 3;
const SIBLING_SCAN_MAX_FILES = 200;

/**
 * Matching files in the style folder and its subfolders (e.g. ART/), up to
 * SIBLING_SCAN_MAX_DEPTH levels down. Skips Synology/hidden metadata folders
 * (@eaDir, #recycle, .*) whose entries are not real files.
 */
export async function listSiblingCandidates(
  root: string,
  extensions: Set<string>,
): Promise<Array<{ name: string; rel: string }>> {
  const out: Array<{ name: string; rel: string }> = [];
  const walk = async (rel: string, depth: number) => {
    if (out.length >= SIBLING_SCAN_MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(rel ? `${root}/${rel}` : root, { withFileTypes: true });
    } catch {
      if (!rel) throw new Error("Cannot read folder");
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (out.length >= SIBLING_SCAN_MAX_FILES) return;
      const name = entry.name;
      if (name.startsWith(".") || name.startsWith("@") || name.startsWith("#")) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        subdirs.push(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = "." + name.split(".").pop()?.toLowerCase();
      if (!extensions.has(ext)) continue;
      if (ext === ".pdf" && !isPdfCandidate(name)) continue;
      out.push({ name, rel: childRel });
    }
    if (depth < SIBLING_SCAN_MAX_DEPTH) {
      for (const d of subdirs) await walk(d, depth + 1);
    }
  };
  await walk("", 0);
  return out;
}

async function executeSiblingScan(request: api.SiblingScanRequest, mountRoot: string): Promise<void> {
  const effectiveMountRoot = mountRoot.replace(/\/+$/, "");
  const folderPath = request.folder_path.replace(/^\/+/, "").replace(/\/+$/, "");
  const absoluteFolder = `${effectiveMountRoot}/${folderPath}`;

  const { resolve } = await import("node:path");
  const resolved = resolve(absoluteFolder);
  if (!resolved.startsWith(resolve(effectiveMountRoot))) {
    logger.error("Sibling scan path traversal blocked", { requested: absoluteFolder, resolved });
    await api.completeSiblingScan(request.request_id, "failed", [], "Path traversal detected — folder is outside allowed mount root");
    return;
  }

  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      await api.completeSiblingScan(request.request_id, "failed", [], `Path exists but is not a directory: ${folderPath}`);
      return;
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const msg = code === "ENOENT" ? `Folder not found: ${folderPath}` : code === "EACCES" ? `Permission denied: ${folderPath}` : `Cannot access folder: ${(e as Error).message}`;
    logger.warn("Sibling scan folder inaccessible", { folder: folderPath, error: msg });
    await api.completeSiblingScan(request.request_id, "failed", [], msg);
    return;
  }

  const extensions = new Set((request.extensions || [".jpg", ".jpeg", ".png"]).map(e => e.toLowerCase()));
  const images: api.SiblingImageResult[] = [];
  const candidates = await listSiblingCandidates(resolved, extensions);

  for (const { name, rel } of candidates) {
    const ext = "." + name.split(".").pop()?.toLowerCase();
    try {
      const filePath = `${resolved}/${rel}`;
      const fileStat = await stat(filePath);
      const result: api.SiblingImageResult = {
        filename: name,
        relative_path: `${folderPath}/${rel}`,
        file_size: fileStat.size,
      };

      try {
        let buffer: Buffer;
        if (ext === ".pdf") {
          const thumbResult = await generateThumbnail(filePath, "pdf");
          buffer = thumbResult.buffer;
        } else {
          const sharp = (await import("sharp")).default;
          buffer = await sharp(filePath)
            .flatten({ background: "#ffffff" })
            .resize(400, 400, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 75 })
            .toBuffer();
        }
        const { createHash } = await import("node:crypto");
        const pathHash = createHash("md5").update(result.relative_path).digest("hex");
        const { uploadSiblingThumbnail } = await import("../uploader.js");
        result.thumbnail_url = await uploadSiblingThumbnail(pathHash, buffer);
      } catch (thumbErr) {
        logger.warn("Sibling thumbnail generation failed", { file: rel, error: (thumbErr as Error).message });
      }

      images.push(result);
    } catch {
      // Skip files we can't stat
    }
  }

  await api.completeSiblingScan(request.request_id, "completed", images);
  logger.info("Sibling scan completed", { requestId: request.request_id, folder: folderPath, imageCount: images.length });
}

/** @param getMountRoot effective NAS mount root (cloud override or env), read per request. */
export async function processSiblingScanRequests(getMountRoot: () => string) {
  if (siblingScanInProgress) return;
  siblingScanInProgress = true;

  try {
    // Claim up to SIBLING_SCAN_CONCURRENCY requests at once, process in parallel,
    // then repeat until the queue is empty.
    while (true) {
      const claims = await Promise.all(
        Array.from({ length: SIBLING_SCAN_CONCURRENCY }, () => api.claimSiblingScan())
      );
      const requests = Array.from(
        new Map(
          claims
            .filter((r): r is api.SiblingScanRequest => r !== null)
            .map((r) => [r.request_id, r])
        ).values()
      );
      if (requests.length === 0) break;

      logger.info(`Sibling scan: processing ${requests.length} folders in parallel`);
      await Promise.all(requests.map(async (r) => {
        try {
          await executeSiblingScan(r, getMountRoot());
        } catch (e) {
          const message = (e as Error).message;
          logger.error("Sibling scan worker error", { requestId: r.request_id, error: message });
          try {
            await api.completeSiblingScan(r.request_id, "failed", [], `Bridge Agent error: ${message}`);
          } catch (completeErr) {
            logger.error("Failed to report sibling scan failure", {
              requestId: r.request_id,
              error: (completeErr as Error).message,
            });
          }
        }
      }));
    }
  } catch (e) {
    logger.error("Sibling scan error", { error: (e as Error).message });
  } finally {
    siblingScanInProgress = false;
  }
}
