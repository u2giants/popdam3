/**
 * Bridge Agent heartbeat command handlers (dispatch table).
 *
 * Moved verbatim out of `sendHeartbeat()` in index.ts (#234). This module only
 * holds dispatch logic; every side effect and piece of agent state is reached
 * through the injected context so it can be unit-tested without starting the
 * agent. The self-updater (check/apply update) is still implemented in
 * index.ts — this table only calls it.
 */
import type { HeartbeatResponse } from "../api-client.js";
import type { PdfSampleAsset } from "../pdf-text-sampler.js";
import type { CommandHandler } from "./dispatch.js";

export type BridgeCommands = NonNullable<HeartbeatResponse["commands"]>;

type BlankThumbAsset = { id: string; thumbnail_url: string; file_type: string; relative_path: string };
type Log = (msg: string, meta?: Record<string, unknown>) => void;

/** Mutable busy flags owned by index.ts (exposed as accessors). */
export interface BridgeBusyFlags {
  isScanning: boolean;
  abortRequested: boolean;
  isSamplingPdfText: boolean;
  isAiSentinelScanning: boolean;
  isBlankThumbCleanupRunning: boolean;
  isPdfBackfilling: boolean;
  isAuditingCompatThumbnails: boolean;
  isPreviewingCompatThumbnails: boolean;
  isCrawlingStyleGuides: boolean;
}

export interface BridgeCommandContext {
  flags: BridgeBusyFlags;
  logger: { info: Log; error: Log };
  runScan: (sessionId?: string) => Promise<void>;
  handlePathTest: (cmd: NonNullable<BridgeCommands["test_paths"]>) => Promise<void>;
  handleDirBrowse: (cmd: { request_id: string; path: string }) => Promise<void>;
  handleCheckUpdate: () => Promise<void>;
  handleApplyUpdate: () => unknown;
  runPdfTextSample: (assets: PdfSampleAsset[]) => Promise<unknown>;
  runAiSentinelScan: (assets: NonNullable<BridgeCommands["ai_sentinel_scan_assets"]>) => Promise<unknown>;
  runBlankThumbCleanup: (assets: BlankThumbAsset[]) => Promise<void>;
  runPdfBackfill: () => Promise<unknown>;
  runCompatAudit: () => Promise<void>;
  runCompatAuditPreview: () => Promise<void>;
  getStyleGuideRoots: () => string[];
  crawlStyleGuides: (roots: string[]) => Promise<unknown>;
}

/** Handler names in dispatch order. Kept explicit so a smoke test can pin it. */
export const BRIDGE_HEARTBEAT_COMMANDS = [
  "abort_scan",
  "force_scan",
  "test_paths",
  "browse_dir",
  "check_update",
  "apply_update",
  "trigger_pdf_text_sample",
  "trigger_ai_sentinel_scan",
  "trigger_blank_thumb_cleanup",
  "trigger_pdf_backfill",
  "audit_compat_thumbnails",
  "audit_compat_preview",
  "trigger_style_guide_crawl",
] as const;

export function createBridgeCommandHandlers(ctx: BridgeCommandContext): CommandHandler<BridgeCommands>[] {
  const { flags, logger } = ctx;
  return [
    {
      name: "abort_scan",
      run: (c) => {
        if (c.abort_scan && flags.isScanning) {
          logger.info("Abort requested via heartbeat");
          flags.abortRequested = true;
        }
      },
    },
    {
      name: "force_scan",
      run: (c) => {
        if (!flags.isScanning && c.force_scan) {
          const sessionId = c.scan_session_id || undefined;
          logger.info("Scan requested via heartbeat config sync", { sessionId });
          ctx.runScan(sessionId).catch((e) => logger.error("Scan error", { error: (e as Error).message }));
        }
      },
    },
    {
      name: "test_paths",
      run: (c) => {
        if (c.test_paths) {
          ctx.handlePathTest(c.test_paths).catch((e) =>
            logger.error("Path test failed", { error: (e as Error).message })
          );
        }
      },
    },
    {
      name: "browse_dir",
      run: (c) => {
        if (c.browse_dir) {
          ctx.handleDirBrowse(c.browse_dir as { request_id: string; path: string }).catch((e) =>
            logger.error("Dir browse failed", { error: (e as Error).message })
          );
        }
      },
    },
    {
      name: "check_update",
      run: (c) => {
        if (c.check_update) {
          ctx.handleCheckUpdate().catch((e) =>
            logger.error("Update check failed", { error: (e as Error).message })
          );
        }
      },
    },
    {
      name: "apply_update",
      run: (c) => {
        if (c.apply_update) {
          ctx.handleApplyUpdate();
        }
      },
    },
    {
      // PDF text sample
      name: "trigger_pdf_text_sample",
      run: (c) => {
        if (c.trigger_pdf_text_sample && !flags.isSamplingPdfText) {
          const assets = (c.pdf_text_sample_assets as PdfSampleAsset[]) || [];
          flags.isSamplingPdfText = true;
          logger.info("PDF text sample requested via heartbeat", { count: assets.length });
          ctx.runPdfTextSample(assets).finally(() => {
            flags.isSamplingPdfText = false;
          });
        }
      },
    },
    {
      // AI sentinel scan (fast header-only check per batch)
      name: "trigger_ai_sentinel_scan",
      run: (c) => {
        if (c.trigger_ai_sentinel_scan && !flags.isAiSentinelScanning) {
          const assets = c.ai_sentinel_scan_assets ?? [];
          if (assets.length > 0) {
            flags.isAiSentinelScanning = true;
            logger.info("AI sentinel scan batch requested via heartbeat", { count: assets.length });
            ctx.runAiSentinelScan(assets)
              .finally(() => { flags.isAiSentinelScanning = false; });
          }
        }
      },
    },
    {
      // Blank thumbnail cleanup
      name: "trigger_blank_thumb_cleanup",
      run: (c) => {
        if (c.trigger_blank_thumb_cleanup && !flags.isBlankThumbCleanupRunning) {
          const assets = c.blank_thumb_cleanup_assets ?? [];
          if (Array.isArray(assets) && assets.length > 0) {
            logger.info("Blank thumbnail cleanup batch requested", { count: assets.length });
            ctx.runBlankThumbCleanup(assets as BlankThumbAsset[]).catch((e) => {
              logger.error("Blank thumbnail cleanup failed", { error: (e as Error).message });
              flags.isBlankThumbCleanupRunning = false;
            });
          }
        }
      },
    },
    {
      // PDF backfill (self-driven claim loop — no asset list passed)
      name: "trigger_pdf_backfill",
      run: (c) => {
        if (c.trigger_pdf_backfill && !flags.isPdfBackfilling) {
          flags.isPdfBackfilling = true;
          logger.info("PDF backfill requested via heartbeat");
          ctx.runPdfBackfill().catch((e) =>
            logger.error("PDF backfill error", { error: (e as Error).message })
          ).finally(() => {
            flags.isPdfBackfilling = false;
          });
        }
      },
    },
    {
      // Compat audit
      name: "audit_compat_thumbnails",
      run: (c) => {
        if (c.audit_compat_thumbnails && !flags.isAuditingCompatThumbnails) {
          flags.isAuditingCompatThumbnails = true;
          logger.info("Compat thumbnail audit requested via heartbeat");
          ctx.runCompatAudit().finally(() => {
            flags.isAuditingCompatThumbnails = false;
          });
        }
      },
    },
    {
      // Compat audit preview (scan first batch only, no clearing)
      name: "audit_compat_preview",
      run: (c) => {
        if (c.audit_compat_preview && !flags.isPreviewingCompatThumbnails && !flags.isAuditingCompatThumbnails) {
          flags.isPreviewingCompatThumbnails = true;
          logger.info("Compat thumbnail preview requested via heartbeat");
          ctx.runCompatAuditPreview().finally(() => {
            flags.isPreviewingCompatThumbnails = false;
          });
        }
      },
    },
    {
      // Style guide crawl
      name: "trigger_style_guide_crawl",
      run: (c) => {
        if (c.trigger_style_guide_crawl && !flags.isCrawlingStyleGuides) {
          flags.isCrawlingStyleGuides = true;
          const styleGuideRoots = ctx.getStyleGuideRoots();
          const roots = styleGuideRoots.length > 0 ? styleGuideRoots : [];
          logger.info("Style guide crawl requested via heartbeat", { roots });
          ctx.crawlStyleGuides(roots).finally(() => {
            flags.isCrawlingStyleGuides = false;
          });
        }
      },
    },
  ];
}
