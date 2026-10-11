/**
 * Bounded whole-file reads (#232).
 *
 * Some libraries (mupdf) need the whole document in memory. Art files can be
 * multiple GB, so never readFile() them blindly: read through one file handle
 * and refuse anything over the cap instead of risking an out-of-memory crash.
 */
import { open } from "node:fs/promises";

/** Default cap for in-memory document parsing (matches the PDF sampler limit). */
export const IN_MEMORY_READ_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Read a file into memory only if it is at most `maxBytes` long.
 * Returns null (without reading any content) when the file is larger.
 */
export async function readFileWithinLimit(
  filePath: string,
  maxBytes: number = IN_MEMORY_READ_LIMIT_BYTES,
): Promise<Buffer | null> {
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size > maxBytes) return null;
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}
