import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dispatchCommands } from "./dispatch.js";
import {
  BRIDGE_HEARTBEAT_COMMANDS,
  createBridgeCommandHandlers,
  type BridgeBusyFlags,
  type BridgeCommandContext,
  type BridgeCommands,
} from "./heartbeat-commands.js";

function makeCtx(flagOverrides: Partial<BridgeBusyFlags> = {}) {
  const calls: string[] = [];
  const done = (name: string) => async () => { calls.push(name); };
  const flags: BridgeBusyFlags = {
    isScanning: false, abortRequested: false, isSamplingPdfText: false, isAiSentinelScanning: false,
    isBlankThumbCleanupRunning: false, isPdfBackfilling: false, isAuditingCompatThumbnails: false,
    isPreviewingCompatThumbnails: false, isCrawlingStyleGuides: false, ...flagOverrides,
  };
  const ctx: BridgeCommandContext = {
    flags,
    logger: { info: () => {}, error: () => {} },
    runScan: done("runScan"),
    handlePathTest: done("handlePathTest"),
    handleDirBrowse: done("handleDirBrowse"),
    handleCheckUpdate: done("handleCheckUpdate"),
    handleApplyUpdate: () => { calls.push("handleApplyUpdate"); },
    runPdfTextSample: done("runPdfTextSample"),
    runAiSentinelScan: done("runAiSentinelScan"),
    runBlankThumbCleanup: done("runBlankThumbCleanup"),
    runPdfBackfill: done("runPdfBackfill"),
    runCompatAudit: done("runCompatAudit"),
    runCompatAuditPreview: done("runCompatAuditPreview"),
    getStyleGuideRoots: () => ["/sg"],
    crawlStyleGuides: done("crawlStyleGuides"),
  };
  return { ctx, calls, flags };
}

const allCommands: BridgeCommands = {
  force_scan: true,
  abort_scan: true,
  test_paths: { request_id: "r", container_mount_root: "/m", scan_roots: [] },
  browse_dir: { request_id: "r", path: "" },
  check_update: true,
  apply_update: true,
  trigger_pdf_text_sample: true,
  pdf_text_sample_assets: [],
  trigger_ai_sentinel_scan: true,
  ai_sentinel_scan_assets: [{ id: "a", filename: "a.ai", relative_path: "x/a.ai" }],
  trigger_blank_thumb_cleanup: true,
  blank_thumb_cleanup_assets: [{ id: "a", thumbnail_url: "u", file_type: "psd", relative_path: "x" }],
  trigger_pdf_backfill: true,
  audit_compat_thumbnails: true,
  audit_compat_preview: true,
  trigger_style_guide_crawl: true,
};

test("bridge dispatch table registers the same handlers, in the original order", () => {
  const { ctx } = makeCtx();
  assert.deepEqual(createBridgeCommandHandlers(ctx).map((h) => h.name), [...BRIDGE_HEARTBEAT_COMMANDS]);
});

test("every heartbeat command reaches its handler", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands(allCommands, createBridgeCommandHandlers(ctx));
  assert.deepEqual(calls, [
    "runScan", "handlePathTest", "handleDirBrowse", "handleCheckUpdate", "handleApplyUpdate",
    "runPdfTextSample", "runAiSentinelScan", "runBlankThumbCleanup", "runPdfBackfill",
    "runCompatAudit", "crawlStyleGuides",
    // audit_compat_preview is skipped because the full audit started first (original guard)
  ]);
});

test("abort_scan only fires while scanning; force_scan is suppressed while scanning", async () => {
  const { ctx, calls, flags } = makeCtx({ isScanning: true });
  await dispatchCommands({ force_scan: true, abort_scan: true }, createBridgeCommandHandlers(ctx));
  assert.equal(flags.abortRequested, true);
  assert.deepEqual(calls, []);
});

test("empty commands trigger nothing", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands({ force_scan: false, abort_scan: false }, createBridgeCommandHandlers(ctx));
  assert.deepEqual(calls, []);
});

test("entrypoint wires heartbeat commands through the dispatch table", () => {
  const src = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
  assert.match(src, /createBridgeCommandHandlers\(/);
  assert.match(src, /dispatchCommands\(response\.commands, heartbeatCommandHandlers\)/);
  assert.doesNotMatch(src, /response\.commands\.(force_scan|test_paths|trigger_pdf_backfill)/);
});
