import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dispatchCommands } from "./dispatch";
import {
  WINDOWS_HEARTBEAT_COMMANDS,
  createWindowsCommandHandlers,
  type WindowsBusyFlags,
  type WindowsCommandContext,
  type WindowsCommands,
} from "./heartbeat-commands";

function makeCtx(flagOverrides: Partial<WindowsBusyFlags> = {}) {
  const calls: string[] = [];
  const done = (name: string) => async () => { calls.push(name); };
  const flags: WindowsBusyFlags = {
    isSamplingPdfText: false, isBackfillingPdfText: false, isBackfillingSgPdfText: false,
    isRunningCompatAudit: false, isRunningCompatAuditPreview: false, stopAcceptingJobs: false,
    activeJobs: 0, ...flagOverrides,
  };
  const ctx: WindowsCommandContext = {
    flags,
    logger: { info: () => {}, error: () => {} },
    runPdfTextSample: done("runPdfTextSample"),
    runPdfBackfill: done("runPdfBackfill"),
    runStyleGuidePdfBackfill: done("runStyleGuidePdfBackfill"),
    triggerImmediateUpdate: async (force) => { calls.push(force ? "forceUpdate" : "triggerUpdate"); },
    forceRestart: () => { calls.push("forceRestart"); },
    waitForIdleThenRestart: () => { calls.push("waitForIdleThenRestart"); },
    setPairingCode: (code) => { calls.push(`setPairingCode:${code}`); },
    doPairing: done("doPairing"),
    runCompatAudit: done("runCompatAudit"),
    runCompatAuditPreview: done("runCompatAuditPreview"),
    handleDirBrowse: done("handleDirBrowse"),
  };
  return { ctx, calls, flags };
}

const allCommands: WindowsCommands = {
  trigger_update: true,
  trigger_pdf_text_sample: true,
  pdf_text_sample_assets: [],
  trigger_pdf_backfill: true,
  trigger_popsg_pdf_backfill: true,
  force_restart: true,
  force_apply_update: true,
  force_stop_jobs: true,
  repair_pairing_code: "ABC",
  audit_compat_thumbnails: true,
  audit_compat_preview: true,
  browse_dir: { request_id: "r", path: "" },
};

test("windows dispatch table registers the same handlers, in the original order", () => {
  const { ctx } = makeCtx();
  assert.deepEqual(createWindowsCommandHandlers(ctx).map((h) => h.name), [...WINDOWS_HEARTBEAT_COMMANDS]);
});

test("every heartbeat command reaches its handler", async () => {
  const { ctx, calls, flags } = makeCtx();
  await dispatchCommands(allCommands, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, [
    // the sample starts first, so both backfills are held back by the original guards
    "runPdfTextSample",
    "triggerUpdate", "forceUpdate", "forceRestart", "waitForIdleThenRestart",
    "setPairingCode:ABC", "doPairing",
    "runCompatAudit", "runCompatAuditPreview", "handleDirBrowse",
  ]);
  assert.equal(flags.stopAcceptingJobs, true);
});

test("backfills run when idle and no sample is requested", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands({ trigger_pdf_backfill: true }, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, ["runPdfBackfill"]);
  const busy = makeCtx({ activeJobs: 1 });
  await dispatchCommands({ trigger_popsg_pdf_backfill: true }, createWindowsCommandHandlers(busy.ctx));
  assert.deepEqual(busy.calls, []);
});

test("missing or empty commands trigger nothing", async () => {
  const { ctx, calls } = makeCtx();
  await dispatchCommands(undefined, createWindowsCommandHandlers(ctx));
  await dispatchCommands({}, createWindowsCommandHandlers(ctx));
  assert.deepEqual(calls, []);
});

test("entrypoint wires heartbeat commands through the dispatch table", () => {
  const src = readFileSync(path.join(__dirname, "..", "index.ts"), "utf-8");
  assert.match(src, /createWindowsCommandHandlers\(/);
  assert.match(src, /dispatchCommands\(commands, heartbeatCommandHandlers\)/);
  assert.doesNotMatch(src, /response\.commands\?\.(trigger_pdf_backfill|force_restart|browse_dir)/);
});
