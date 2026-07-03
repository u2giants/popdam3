/**
 * Compat audit — detection of Illustrator "no PDF compatibility" placeholder thumbnails.
 *
 * These thumbnails are a render of Adobe's fixed CompatibilityAlert warning page
 * ("saved without PDF Content…") rather than real artwork. Because that page is a
 * fixed image, we detect it with a perceptual hash (dHash) against a small set of
 * reference hashes — fast, deterministic, and reliable.
 *
 * History: this previously OCR'd each thumbnail for the word "compatibility". That
 * was broken (the warning text says "Compatible", not "compatibility", so it matched
 * nothing) and far too slow (~1 thumbnail/sec → hours for the full library). The hash
 * approach flags every warning thumbnail (validated: distance 0 to a reference) while
 * real artwork stays far away (≥53 of 256 bits), and runs in milliseconds per image.
 */

import sharp from "sharp";
import { logger } from "./logger";
import * as api from "./api-client";

// ── Perceptual hash (dHash) ──────────────────────────────────────────────────
const HASH_W = 16;
const HASH_H = 16; // 16×16 comparisons → 256-bit hash (64 hex chars)

// Max Hamming distance (out of 256 bits) to treat a thumbnail as the warning page.
// Warning thumbnails hash to distance 0 from a reference; real artwork is ≥53 away,
// so 30 is a safe midpoint that tolerates minor cross-platform render jitter.
const COMPAT_HASH_THRESHOLD = 30;

// Reference dHashes of the Adobe CompatibilityAlert warning page, across its render
// variants (portrait/landscape/1-col/2-col). Computed with the exact dhash() below.
const COMPAT_REF_HASHES = [
  "000000000000000088000000e4c8cc9c00008000000000000000000000000000",
  "0000000081000000c600c600d690c600c610d600c600d690c600c610d6100000",
  "4400980098009800980098009800980098009800980098009800d80098000000",
  "0000000000000000000000000400000088008800888088008880880088808800",
  "0000a000a000a0004000a000a000a0002000a000a0004000a000a000a0000000",
  "0000800090008000800010008000800000009000800080001000800080000000",
  "0000b000b000b000a000b000b200a000a000b000b200a000b000b000b0002000",
  "1000c600c600d600c600c600d680c640c600c680d600c600c600d680c6000000",
];

/** Compute a 256-bit difference hash (hex) of an image buffer. */
async function dhash(buf: Buffer): Promise<string> {
  const raw = await sharp(buf)
    .resize(HASH_W + 1, HASH_H, { fit: "fill" })
    .greyscale()
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  const bits: number[] = [];
  for (let r = 0; r < HASH_H; r++) {
    for (let c = 0; c < HASH_W; c++) {
      bits.push(raw[r * (HASH_W + 1) + c] > raw[r * (HASH_W + 1) + c + 1] ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Run `fn` over items with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Thumbnails are fetched over the network; hashing is cheap, so fetch concurrency
// is the throughput lever. 16-wide keeps a full library scan to minutes, not hours.
const SCAN_CONCURRENCY = 16;

async function isCompatAlertBufferInternal(buf: Buffer): Promise<boolean> {
  const h = await dhash(buf);
  return COMPAT_REF_HASHES.some((ref) => hamming(h, ref) <= COMPAT_HASH_THRESHOLD);
}

/**
 * Compat-audit worker. Detection no longer needs OCR/Tesseract, but callers still
 * pass a "worker" handle around; this returns a cheap marker to keep them unchanged.
 */
export async function createCompatAuditWorker() {
  return { ready: true as const };
}

/**
 * Buffer-based variant for inline checks during rendering (image already in memory).
 * Returns false conservatively on error — better to miss one than discard good art.
 */
export async function isCompatAlertBuffer(
  imgBuffer: Buffer,
  _worker?: unknown,
): Promise<boolean> {
  try {
    return await isCompatAlertBufferInternal(imgBuffer);
  } catch (e) {
    logger.warn("isCompatAlertBuffer: hash check failed — skipping", { error: (e as Error).message });
    return false;
  }
}

/**
 * Checks whether a stored thumbnail URL is the Illustrator compatibility-alert
 * warning page rather than real artwork, via perceptual hash.
 * Returns false conservatively on fetch/hash errors.
 */
export async function isCompatAlertThumbnail(
  thumbnailUrl: string,
  _worker?: unknown,
): Promise<boolean> {
  try {
    const resp = await fetch(thumbnailUrl);
    if (!resp.ok) return false;
    const imgBuffer = Buffer.from(await resp.arrayBuffer());
    return await isCompatAlertBufferInternal(imgBuffer);
  } catch (e) {
    logger.warn("isCompatAlertThumbnail: check failed — skipping", {
      url: thumbnailUrl,
      error: (e as Error).message,
    });
    return false;
  }
}

/** Retry a transient batch fetch (the gateway occasionally 502s mid-scan). */
async function fetchBatchWithRetry(afterId: string | null, attempts = 5) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await api.getCompatAuditBatch(afterId);
    } catch (e) {
      lastErr = e;
      logger.warn("getCompatAuditBatch failed — retrying", {
        attempt: i + 1, attempts, error: (e as Error).message,
      });
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Full compat audit — hash-check all AI asset thumbnails, clear any that are the
 * Illustrator compatibility-alert placeholder page (which re-queues them for proper,
 * native rendering).
 */
export async function runCompatAudit(): Promise<void> {
  logger.info("Starting compat thumbnail audit (perceptual-hash based)");
  let afterId: string | null = null;
  let totalScanned = 0;
  let totalCleared = 0;

  try {
    while (true) {
      const { assets, batch_size } = await fetchBatchWithRetry(afterId);
      if (!assets || assets.length === 0) break;

      const flags = await mapLimit(assets, SCAN_CONCURRENCY, async (asset) =>
        asset.thumbnail_url ? await isCompatAlertThumbnail(asset.thumbnail_url) : false,
      );
      totalScanned += assets.length;
      const badIds: string[] = [];
      assets.forEach((asset, i) => {
        if (flags[i]) {
          badIds.push(asset.id);
          logger.info("Compat audit: flagging placeholder thumbnail", { path: asset.relative_path });
        }
      });

      if (badIds.length > 0) {
        await api.clearCompatThumbnails(badIds);
        totalCleared += badIds.length;
        logger.info("Compat audit: cleared placeholder thumbnails", { cleared: badIds.length, cumulative: totalCleared });
      }

      if (assets.length < batch_size) break;
      afterId = assets[assets.length - 1].id;
    }

    logger.info("Compat thumbnail audit complete", { scanned: totalScanned, cleared: totalCleared });
    await api.completeCompatAudit(totalScanned, totalCleared);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error("Compat thumbnail audit failed", { error: msg, scanned: totalScanned, cleared: totalCleared });
    await api.completeCompatAudit(totalScanned, totalCleared, msg).catch(() => {});
  }
}

/**
 * Compat audit preview — hash-check all AI asset thumbnails and report which are
 * flagged as compatibility-alert placeholders WITHOUT clearing anything.
 */
export async function runCompatAuditPreview(): Promise<void> {
  logger.info("Starting compat thumbnail preview (perceptual-hash based, no clearing)");
  let afterId: string | null = null;
  let totalScanned = 0;
  const allFlagged: api.CompatAuditPreviewFlagged[] = [];

  try {
    while (true) {
      const { assets, batch_size } = await fetchBatchWithRetry(afterId);
      if (!assets || assets.length === 0) break;

      const flags = await mapLimit(assets, SCAN_CONCURRENCY, async (asset) =>
        asset.thumbnail_url ? await isCompatAlertThumbnail(asset.thumbnail_url) : false,
      );
      totalScanned += assets.length;
      assets.forEach((asset, i) => {
        if (flags[i] && asset.thumbnail_url) {
          allFlagged.push({ id: asset.id, thumbnail_url: asset.thumbnail_url, relative_path: asset.relative_path });
          logger.info("Compat preview: flagged placeholder", { path: asset.relative_path });
        }
      });
      // Report once per batch (batches now complete in seconds), not per asset.
      await api.updateCompatAuditPreview(totalScanned, allFlagged).catch(() => {});

      if (assets.length < batch_size) break;
      afterId = assets[assets.length - 1].id;
    }

    logger.info("Compat thumbnail preview complete", { scanned: totalScanned, flagged: allFlagged.length });
    await api.completeCompatAuditPreview(totalScanned, allFlagged);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error("Compat thumbnail preview failed", { error: msg, scanned: totalScanned });
    await api.completeCompatAuditPreview(totalScanned, allFlagged, msg).catch(() => {});
  }
}
