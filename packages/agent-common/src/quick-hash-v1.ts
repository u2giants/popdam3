import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";

const QUICK_HASH_CHUNK = 65536;

/** Stored V1 check-in fingerprint: first and last 64 KiB plus little-endian file size. */
export async function quickHashV1(filePath: string): Promise<string> {
  const { size } = await stat(filePath);
  const hash = createHash("sha256");
  const fh = await open(filePath, "r");
  try {
    const firstBuf = Buffer.alloc(Math.min(QUICK_HASH_CHUNK, size));
    await fh.read(firstBuf, 0, firstBuf.length, 0);
    hash.update(firstBuf);

    if (size > QUICK_HASH_CHUNK) {
      const lastBuf = Buffer.alloc(Math.min(QUICK_HASH_CHUNK, size));
      const offset = Math.max(0, size - QUICK_HASH_CHUNK);
      await fh.read(lastBuf, 0, lastBuf.length, offset);
      hash.update(lastBuf);
    }

    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(size));
    hash.update(sizeBuf);
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}
