import { join } from "path";
import * as api from "./api-client.js";
import { logger } from "./logger.js";
import { isAiSentinel } from "./ai-sentinel-detect.js";

interface SentinelAsset {
  id: string;
  filename: string;
  relative_path: string;
}

export async function runAiSentinelScan(
  assets: SentinelAsset[],
  nasContainerMountRoot: string,
): Promise<void> {
  logger.info("AI sentinel scan batch starting", { count: assets.length });

  const results: api.AiSentinelScanResult[] = [];
  let sentinelCount = 0;

  for (const asset of assets) {
    const absolutePath = join(nasContainerMountRoot, asset.relative_path);
    try {
      const isSentinel = await isAiSentinel(absolutePath);
      results.push({ asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path, is_sentinel: isSentinel });
      if (isSentinel) {
        sentinelCount++;
        logger.debug("Sentinel .ai detected", { path: asset.relative_path });
      }
    } catch (e) {
      logger.warn("AI sentinel check failed", { path: asset.relative_path, error: (e as Error).message });
      results.push({ asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path, is_sentinel: false });
    }
  }

  logger.info("AI sentinel scan batch done", { checked: results.length, sentinel: sentinelCount });
  await api.completeAiSentinelScan(results);
}
