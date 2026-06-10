import { createHash } from "crypto";
import { createReadStream } from "fs";
import { open, stat } from "fs/promises";

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Quick-hash chunk size. MUST stay in lockstep with the bridge agent's
// hasher.ts (apps/bridge-agent/src/hasher.ts) — the agent re-derives this exact
// value from the on-disk file to verify receipt. Changing either side alone
// breaks check-in verification.
const QUICK_HASH_CHUNK = 65536; // 64KB

/**
 * Quick-hash = SHA-256(first 64KB + last 64KB + file_size).
 * Identical algorithm to the bridge agent's computeQuickHash. Used so the
 * Synology-side verifier can confirm the checked-in file landed intact with a
 * ~128KB read instead of streaming the whole file.
 */
export async function quickHashFile(filePath: string): Promise<string> {
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

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
