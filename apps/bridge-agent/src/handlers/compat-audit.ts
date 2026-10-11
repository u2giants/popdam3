/** Moved out of index.ts (#234) — pure move, no behavior change. */
import * as api from "../api-client.js";
import { logger } from "../logger.js";
import { createCompatAuditWorker, isCompatAlertThumbnail } from "../thumbnailer.js";

// ── Compat audit ────────────────────────────────────────────────────────────
// Reads source AI files for all assets that currently have thumbnail_url set.
// Checks each file for the /CompatibilityAlert marker (Illustrator saved without
// PDF compatibility). Clears thumbnails for matches so the asset is re-queued
// for proper rendering (Windows Render Agent / Inkscape path).

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

      if (assets.length < batch_size) break; // last page
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

// ── Compat audit preview ─────────────────────────────────────────────────────
// Scans ALL AI assets across all batches and reports which are flagged as
// compatibility-alert placeholders — WITHOUT clearing anything.
// Uses Tesseract OCR on each stored thumbnail to detect the warning page
// visually, so it only flags thumbnails that *actually look wrong* regardless
// of what the source .ai file contains.
// Sends live progress after each batch so the UI can show thumbnails as they
// accumulate. Lets the admin visually confirm every affected asset before
// committing to the destructive full audit.

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
      }

      // Report incremental progress after each batch so the UI updates live
      await api.updateCompatAuditPreview(totalScanned, allFlagged).catch(() => {});

      if (assets.length < batch_size) break; // last page
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
