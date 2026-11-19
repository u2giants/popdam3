/**
 * Quick hash computation per PROJECT_BIBLE §9.
 * Hash = SHA-256(first 64KB + last 64KB + file_size)
 * This is NOT a full content hash — it's for move detection.
 */

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
