/**
 * Compat audit — OCR-based detection of Illustrator "no PDF compatibility" placeholder thumbnails.
 *
 * Runs on the Windows render agent to avoid CPU spikes on the Synology NAS.
 * Uses Tesseract.js to read the stored thumbnail image from the cloud and checks
 * whether it contains the word "compatibility" — which only appears on the
 * Illustrator warning page, not on real artwork thumbnails.
 */

import { createWorker } from "tesseract.js";
import { logger } from "./logger";
import * as api from "./api-client";

/**
 * Create a long-lived Tesseract worker for batch OCR processing.
 * Caller is responsible for calling worker.terminate() when done.
 */
export async function createCompatAuditWorker() {
  return createWorker("eng");
}

/**
 * Buffer-based variant for inline OCR checks during rendering.
 * Use this when the image data is already in memory (avoids a round-trip fetch).
 *
 * Returns false conservatively on OCR errors — better to miss one
 * than to accidentally discard a good thumbnail.
 */
export async function isCompatAlertBuffer(
  imgBuffer: Buffer,
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<boolean> {
  try {
    const { data: { text } } = await worker.recognize(imgBuffer);
    return text.toLowerCase().includes("compatibility");
  } catch (e) {
    logger.warn("isCompatAlertBuffer: OCR check failed — skipping", {
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Checks whether a stored thumbnail URL visually shows an Illustrator
 * compatibility-alert warning page rather than real artwork.
 *
 * Strategy: OCR the thumbnail and look for the word "compatibility", which
 * Illustrator's warning page always contains prominently. Real artwork
 * thumbnails virtually never include that word.
 *
 * Returns false conservatively on fetch/OCR errors — better to miss one
 * than to accidentally clear a good thumbnail.
 */
export async function isCompatAlertThumbnail(
  thumbnailUrl: string,
  worker: Awaited<ReturnType<typeof createWorker>>,
): Promise<boolean> {
  try {
    const resp = await fetch(thumbnailUrl);
    if (!resp.ok) return false;
    const imgBuffer = Buffer.from(await resp.arrayBuffer());

    const { data: { text } } = await worker.recognize(imgBuffer);
    const lower = text.toLowerCase();

    return lower.includes("compatibility");
  } catch (e) {
    logger.warn("isCompatAlertThumbnail: check failed — skipping", {
      url: thumbnailUrl,
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Full compat audit — OCR all AI asset thumbnails, clear any that show the
 * Illustrator compatibility-alert placeholder page. This triggers re-queuing
 * for proper rendering.
 */
export async function runCompatAudit(): Promise<void> {
  logger.info("Starting compat thumbnail audit (OCR-based)");
  let afterId: string | null = null;
  let totalScanned = 0;
  let totalCleared = 0;

  const worker = await createCompatAuditWorker();
  try {
    while (true) {
      const { assets, batch_size } = await api.getCompatAuditBatch(afterId);
      if (!assets || assets.length === 0) break;

      const badIds: string[] = [];

      for (const asset of assets) {
        totalScanned++;
        if (!asset.thumbnail_url) continue;
        const isPlaceholder = await isCompatAlertThumbnail(asset.thumbnail_url, worker);
        if (isPlaceholder) {
          badIds.push(asset.id);
          logger.info("Compat audit: flagging placeholder thumbnail", { path: asset.relative_path });
        }
      }

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
  } finally {
    await worker.terminate();
  }
}

/**
 * Compat audit preview — OCR all AI asset thumbnails and report which are
 * flagged as compatibility-alert placeholders WITHOUT clearing anything.
 * Sends live progress after each batch so the UI can show thumbnails as they
 * accumulate, letting the admin visually confirm before running the full audit.
 */
export async function runCompatAuditPreview(): Promise<void> {
  logger.info("Starting compat thumbnail preview (OCR-based, all batches, no clearing)");
  let afterId: string | null = null;
  let totalScanned = 0;
  const allFlagged: api.CompatAuditPreviewFlagged[] = [];

  const worker = await createCompatAuditWorker();
  try {
    while (true) {
      const { assets, batch_size } = await api.getCompatAuditBatch(afterId);
      if (!assets || assets.length === 0) break;

      for (const asset of assets) {
        totalScanned++;
        if (!asset.thumbnail_url) continue;
        const isPlaceholder = await isCompatAlertThumbnail(asset.thumbnail_url, worker);
        if (isPlaceholder) {
          allFlagged.push({ id: asset.id, thumbnail_url: asset.thumbnail_url, relative_path: asset.relative_path });
          logger.info("Compat preview: flagged placeholder", { path: asset.relative_path });
        }
        // Report after every asset so the UI transitions out of "processing" state
        // immediately. Batches are 200 items × ~2s each = up to 6 min before the first
        // batch-level update — which exceeds the UI's 3-min stale timeout.
        await api.updateCompatAuditPreview(totalScanned, allFlagged).catch(() => {});
      }

      if (assets.length < batch_size) break;
      afterId = assets[assets.length - 1].id;
    }

    logger.info("Compat thumbnail preview complete", { scanned: totalScanned, flagged: allFlagged.length });
    await api.completeCompatAuditPreview(totalScanned, allFlagged);
  } catch (e) {
    const msg = (e as Error).message;
    logger.error("Compat thumbnail preview failed", { error: msg, scanned: totalScanned });
    await api.completeCompatAuditPreview(totalScanned, allFlagged, msg).catch(() => {});
  } finally {
    await worker.terminate();
  }
}
