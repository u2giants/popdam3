import assert from "node:assert/strict";
import test from "node:test";
import { safeFilesystemModifiedAt } from "./file-date-validation.js";
import { isIngestableFile } from "./sg-ingest-filter.js";
import { boundedRetryDelay, completionDisposition } from "./sg-crawl-continuation.js";
import { SG_CRAWL_INGEST_BATCH_SIZE, SG_CRAWL_MAX_COMPLETION_CONTINUATIONS } from "./sg-crawl-bounds.js";

test("completion budget covers hourly refresh's 67-minute cap and bounded search slices", () => {
  const waitContinuations = Math.ceil(67 * 60_000 / boundedRetryDelay({ ok: true, state: "refreshing", retry_after_ms: 30_000 }));
  const searchContinuations = Math.ceil(220_218 / 5_000);
  assert.ok(SG_CRAWL_MAX_COMPLETION_CONTINUATIONS > waitContinuations + searchContinuations);
});

const NOW = Date.parse("2026-08-02T12:00:00Z");

test("keeps a plausible filesystem modification date", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2026-08-01T12:00:00Z"), NOW),
    "2026-08-01T12:00:00.000Z",
  );
});

test("allows up to one day of clock drift", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2026-08-03T12:00:00Z"), NOW),
    "2026-08-03T12:00:00.000Z",
  );
});

test("quarantines a date more than one day in the future", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2049-01-01T04:00:00Z"), NOW),
    null,
  );
});

test("quarantines an invalid date", () => {
  assert.equal(safeFilesystemModifiedAt(new Date("invalid"), NOW), null);
});

// ── Ingestion allow-list ─────────────────────────────────────────

test("ingests the renderable style guide formats", () => {
  for (const name of [
    "guide.ai", "art.PSD", "logo.eps", "manual.pdf",
    "scan.tif", "scan.tiff", "photo.jpg", "photo.JPEG", "mark.png",
  ]) {
    assert.equal(isIngestableFile(name), true, name);
  }
});

test("rejects files that cannot be thumbnailed", () => {
  for (const name of [
    "style.css", "font.ttf", "font.otf", "font.woff2", "bundle.zip",
    "notes.txt", "model.obj", "clip.mp4", "sheet.xlsx", "big.psb",
    "README", "archive.tar.gz",
  ]) {
    assert.equal(isIngestableFile(name), false, name);
  }
});

test("does not treat a dotfile as an extension match", () => {
  assert.equal(isIngestableFile(".png"), false);
});

test("keeps each style-guide ingest write comfortably bounded", () => {
  assert.equal(SG_CRAWL_INGEST_BATCH_SIZE, 100);
});

test("accepts the exact legacy additive completion response", () => {
  assert.equal(completionDisposition({ ok: true }), "complete");
});

test("continues bounded reconciliation and stops attention-required runs", () => {
  assert.equal(completionDisposition({ ok: true, state: "reconciling" }), "continue");
  assert.equal(completionDisposition({ ok: true, state: "refreshing" }), "continue");
  assert.equal(completionDisposition({ ok: true, state: "attention_required" }), "stop");
  assert.equal(completionDisposition({ ok: true, state: "failed" }), "stop");
  assert.equal(boundedRetryDelay({ ok: true, state: "reconciling", retry_after_ms: 90_000 }), 30_000);
  assert.equal(boundedRetryDelay({ ok: true, state: "reconciling", retry_after_ms: 1 }), 250);
});
