import { basename } from "node:path";
import { logger } from "./logger";
import * as api from "./api-client";
import { processOne } from "./pdf-backfill";
import type { AiConfig } from "./pdf-text-sampler";
import { toStyleGuidePdfOutcome } from "./style-guide-pdf-outcome";

export async function runStyleGuidePdfBackfill(
  agentId: string,
  resolvePath: (relativePath: string) => string,
  aiConfig: AiConfig,
): Promise<void> {
  logger.info("PopSG PDF extraction: starting");
  let processed = 0;

  for (;;) {
    let jobs: api.StyleGuidePdfTextJob[];
    try {
      jobs = await api.claimStyleGuidePdfText(agentId);
    } catch (error) {
      logger.error("PopSG PDF extraction: claim failed; stopping until the next heartbeat", {
        error: (error as Error).message,
      });
      break;
    }
    if (jobs.length === 0) break;

    const results: api.StyleGuidePdfTextResult[] = [];
    for (const job of jobs) {
      try {
        const extracted = await processOne(
          {
            id: job.style_guide_file_id,
            filename: basename(job.relative_path),
            relative_path: job.relative_path,
            needs_thumbnail: false,
          },
          resolvePath(job.relative_path),
          aiConfig,
          false,
        );
        const outcome = toStyleGuidePdfOutcome(extracted);
        results.push({
          style_guide_file_id: job.style_guide_file_id,
          content_identity: job.content_identity,
          ...outcome,
        });
      } catch (error) {
        results.push({
          style_guide_file_id: job.style_guide_file_id,
          content_identity: job.content_identity,
          status: "failed",
          extraction_method: null,
          extracted_text: null,
          page_count: null,
          terminal_reason: (error as Error).message.slice(0, 500) || "Unexpected extraction failure",
        });
      }
    }

    try {
      await api.completeStyleGuidePdfText(results);
      processed += results.length;
      logger.info("PopSG PDF extraction: batch committed", { processed, batch: results.length });
    } catch (error) {
      logger.error("PopSG PDF extraction: completion failed; stopping until the next heartbeat", {
        error: (error as Error).message,
      });
      break;
    }
  }

  logger.info("PopSG PDF extraction: loop exited", { processed });
}
