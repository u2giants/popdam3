/**
 * Quick hash computation per PROJECT_BIBLE §9.
 * Hash = SHA-256(first 64KB + last 64KB + file_size)
 * This is NOT a full content hash — it's for move detection.
 */

import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { logger } from "./logger.js";

const CHUNK_SIZE = 65536; // 64KB
const HASH_VERSION = 1;

export interface QuickHashResult {
  quick_hash: string;
  quick_hash_version: number;
}

export async function computeQuickHash(filePath: string): Promise<QuickHashResult> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  const hash = createHash("sha256");

  const fh = await open(filePath, "r");
  try {
    // Read first 64KB
    const firstBuf = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize));
    await fh.read(firstBuf, 0, firstBuf.length, 0);
    hash.update(firstBuf);

    // Read last 64KB (if file > 64KB, otherwise already covered)
    if (fileSize > CHUNK_SIZE) {
      const lastBuf = Buffer.alloc(Math.min(CHUNK_SIZE, fileSize));
      const offset = Math.max(0, fileSize - CHUNK_SIZE);
      await fh.read(lastBuf, 0, lastBuf.length, offset);
      hash.update(lastBuf);
    }

    // Include file size in hash for uniqueness
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(fileSize));
    hash.update(sizeBuf);
  } finally {
    await fh.close();
  }

  return {
    quick_hash: hash.digest("hex"),
    quick_hash_version: HASH_VERSION,
  };
}
