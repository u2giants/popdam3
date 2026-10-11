/**
 * Windows Render Agent heartbeat command handlers (dispatch table).
 *
 * Moved verbatim out of `startHeartbeat()` in index.ts (#234). Agent state and
 * side effects are reached through the injected context so the table can be
 * unit-tested without starting the agent. The self-updater itself (updater.ts)
 * is untouched — this table only calls it.
 */
import type { WindowsHeartbeatResponse } from "../api-client";
import type { PdfSampleAsset } from "../pdf-text-sampler";
import type { CommandHandler } from "./dispatch";

export type WindowsCommands = NonNullable<WindowsHeartbeatResponse["commands"]>;

type Log = (msg: string, meta?: Record<string, unknown>) => void;

/** Mutable busy flags owned by index.ts (exposed as accessors). */
export interface WindowsBusyFlags {
  isSamplingPdfText: boolean;
  isBackfillingPdfText: boolean;
  isBackfillingSgPdfText: boolean;
  isRunningCompatAudit: boolean;
  isRunningCompatAuditPreview: boolean;
  stopAcceptingJobs: boolean;
  readonly activeJobs: number;
}

export interface WindowsCommandContext {
  flags: WindowsBusyFlags;
  logger: { info: Log; error: Log };
  runPdfTextSample: (assets: PdfSampleAsset[]) => Promise<unknown>;
  runPdfBackfill: () => Promise<unknown>;
  runStyleGuidePdfBackfill: () => Promise<unknown>;
  triggerImmediateUpdate: (force?: boolean) => Promise<unknown>;
  forceRestart: () => void;
  waitForIdleThenRestart: () => void;
  setPairingCode: (code: string) => void;
  doPairing: () => Promise<void>;
  runCompatAudit: () => Promise<unknown>;
  runCompatAuditPreview: () => Promise<unknown>;
  handleDirBrowse: (cmd: { request_id: string; path: string }) => Promise<void>;
}

/** Handler names in dispatch order. Kept explicit so a smoke test can pin it. */
export const WINDOWS_HEARTBEAT_COMMANDS = [
  "trigger_pdf_text_sample",
  "trigger_pdf_backfill",
  "trigger_popsg_pdf_backfill",
  "trigger_update",
  "force_apply_update",
  "force_restart",
  "force_stop_jobs",
  "repair_pairing_code",
  "audit_compat_thumbnails",
  "audit_compat_preview",
  "browse_dir",
] as const;

export function createWindowsCommandHandlers(ctx: WindowsCommandContext): CommandHandler<WindowsCommands | undefined>[] {
  const { flags, logger } = ctx;
  return [
    {
      // PDF text extraction sample
      name: "trigger_pdf_text_sample",
      run: (c) => {
        if (c?.trigger_pdf_text_sample && !flags.isSamplingPdfText) {
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
      // Full-library PDF/.ai backfill (self-driven claim loop — no asset list passed).
      // Runs the entire mupdf→OCR→AI extraction on this Windows VM so the load stays off
      // the Synology. runPdfBackfill never throws; the finally just clears the guard.
      name: "trigger_pdf_backfill",
      run: (c) => {
        if (
          c?.trigger_pdf_backfill &&
          !flags.isBackfillingPdfText &&
          !flags.isBackfillingSgPdfText &&
          !flags.isSamplingPdfText &&
          !flags.isRunningCompatAudit &&
          !flags.isRunningCompatAuditPreview &&
          flags.activeJobs === 0
        ) {
          flags.isBackfillingPdfText = true;
          logger.info("PDF backfill requested via heartbeat");
          ctx.runPdfBackfill().catch((e) => logger.error("PDF backfill error", { error: (e as Error).message })).finally(() => {
            flags.isBackfillingPdfText = false;
          });
        }
      },
    },
    {
      name: "trigger_popsg_pdf_backfill",
      run: (c) => {
        if (
          c?.trigger_popsg_pdf_backfill &&
          !flags.isBackfillingPdfText &&
          !flags.isBackfillingSgPdfText &&
          !flags.isSamplingPdfText &&
          !flags.isRunningCompatAudit &&
          !flags.isRunningCompatAuditPreview &&
          flags.activeJobs === 0
        ) {
          flags.isBackfillingSgPdfText = true;
          logger.info("PopSG PDF extraction requested via heartbeat");
          ctx.runStyleGuidePdfBackfill().catch((e) => logger.error("PopSG PDF extraction error", { error: (e as Error).message })).finally(() => {
            flags.isBackfillingSgPdfText = false;
          });
        }
      },
    },
    {
      // Check if cloud requests immediate update (standard — respects idle check)
      name: "trigger_update",
      run: (c) => {
        if (c?.trigger_update) {
          logger.info("Cloud requested immediate update check");
          return ctx.triggerImmediateUpdate().catch((e) => logger.error("Triggered update failed", { error: (e as Error).message }));
        }
      },
    },
    {
      // Force apply update — bypass activeJobs guard
      name: "force_apply_update",
      run: (c) => {
        if (c?.force_apply_update) {
          logger.info("Cloud requested force update — bypassing active-jobs guard");
          return ctx.triggerImmediateUpdate(true).catch((e) => logger.error("Force update failed", { error: (e as Error).message }));
        }
      },
    },
    {
      // Force restart — exit immediately, launcher restarts us
      name: "force_restart",
      run: (c) => {
        if (c?.force_restart) {
          logger.info("Cloud requested force restart — exiting now");
          ctx.forceRestart();
        }
      },
    },
    {
      // Force stop jobs — stop claiming, drain current jobs, then restart
      name: "force_stop_jobs",
      run: (c) => {
        if (c?.force_stop_jobs) {
          logger.info("Cloud requested stop — halting job claims and draining");
          flags.stopAcceptingJobs = true;
          ctx.waitForIdleThenRestart();
        }
      },
    },
    {
      // Remote re-pairing — cloud sent a new pairing code
      name: "repair_pairing_code",
      run: (c) => {
        if (!c?.repair_pairing_code) return; // stay synchronous when not requested
        const code = c.repair_pairing_code;
        return (async () => {
          logger.info("Cloud sent repair pairing code — re-pairing agent");
          try {
            ctx.setPairingCode(code);
            await ctx.doPairing();
            logger.info("Agent re-paired successfully via remote repair");
          } catch (pairErr) {
            logger.error("Remote re-pairing failed", { error: (pairErr as Error).message });
          }
        })();
      },
    },
    {
      // Compat thumbnail audit — OCR all AI thumbnails and clear placeholder ones
      name: "audit_compat_thumbnails",
      run: (c) => {
        if (c?.audit_compat_thumbnails && !flags.isRunningCompatAudit) {
          flags.isRunningCompatAudit = true;
          logger.info("Compat thumbnail audit requested via heartbeat");
          ctx.runCompatAudit().finally(() => {
            flags.isRunningCompatAudit = false;
          });
        }
      },
    },
    {
      // Compat thumbnail preview — OCR all AI thumbnails, report flagged without clearing
      name: "audit_compat_preview",
      run: (c) => {
        if (c?.audit_compat_preview && !flags.isRunningCompatAuditPreview) {
          flags.isRunningCompatAuditPreview = true;
          logger.info("Compat thumbnail preview requested via heartbeat");
          ctx.runCompatAuditPreview().finally(() => {
            flags.isRunningCompatAuditPreview = false;
          });
        }
      },
    },
    {
      name: "browse_dir",
      run: (c) => {
        if (c?.browse_dir) {
          ctx.handleDirBrowse(c.browse_dir as { request_id: string; path: string }).catch((e) =>
            logger.error("Dir browse failed", { error: (e as Error).message })
          );
        }
      },
    },
  ];
}
