/**
 * Quick hash computation per PROJECT_BIBLE §9.
 * Hash = SHA-256(first 64KB + last 64KB + file_size)
 * This is NOT a full content hash — it's for move detection.
 *
 * computeContentSha256 IS the full content hash (popdam3#1198 item 3): the
 * cross-volume move fallback, computed once per changed file at ingest and
 * stored. It reads the whole file — accepted because it runs only for files
 * the scan is already processing.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { quickHashV1 } from "./common/quick-hash-v1.js";

const HASH_VERSION = 1;

export interface QuickHashResult {
  quick_hash: string;
  quick_hash_version: number;
}

export async function computeQuickHash(filePath: string): Promise<QuickHashResult> {
  return {
    quick_hash: await quickHashV1(filePath),
    quick_hash_version: HASH_VERSION,
  };
}

/** Full-content SHA-256 (hex). Streams the file — no size cap, no partial reads. */
export async function computeContentSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
