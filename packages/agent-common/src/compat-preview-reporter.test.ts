import test from "node:test";
import assert from "node:assert/strict";
import { CompatPreviewReporter, type CompatPreviewFlag } from "./compat-preview-reporter";

const flag = (id: string): CompatPreviewFlag => ({ id, thumbnail_url: `https://t/${id}`, relative_path: `p/${id}.ai` });

test("progress sends only flags recorded since the previous write", async () => {
  const progressCalls: Array<{ scanned: number; ids: string[] }> = [];
  const reporter = new CompatPreviewReporter({
    progress: async (scanned, flagged) => { progressCalls.push({ scanned, ids: flagged.map(f => f.id) }); },
    complete: async () => {},
    onProgressError: () => assert.fail("no progress error expected"),
  });
  reporter.record(flag("a"));
  await reporter.reportProgress(10);
  reporter.record(flag("b"));
  reporter.record(flag("c"));
  await reporter.reportProgress(20);
  await reporter.reportProgress(30);
  assert.deepEqual(progressCalls, [
    { scanned: 10, ids: ["a"] },
    { scanned: 20, ids: ["b", "c"] },
    { scanned: 30, ids: [] },
  ]);
  assert.equal(reporter.undelivered, 0);
});

test("a failed progress write is reported and its flags are retried, not dropped", async () => {
  const sent: string[][] = [];
  const errors: Array<{ scanned: number; message: string }> = [];
  let fail = true;
  const reporter = new CompatPreviewReporter({
    progress: async (_scanned, flagged) => {
      if (fail) throw new Error("gateway 502");
      sent.push(flagged.map(f => f.id));
    },
    complete: async () => {},
    onProgressError: (error, scanned) => errors.push({ scanned, message: (error as Error).message }),
  });
  reporter.record(flag("a"));
  await reporter.reportProgress(10);
  assert.deepEqual(errors, [{ scanned: 10, message: "gateway 502" }]);
  assert.equal(reporter.undelivered, 1);

  fail = false;
  reporter.record(flag("b"));
  await reporter.reportProgress(20);
  assert.deepEqual(sent, [["a", "b"]]);
  assert.equal(reporter.undelivered, 0);
});

test("finish sends only undelivered flags and propagates completion errors", async () => {
  const completions: Array<{ scanned: number; ids: string[]; error?: string }> = [];
  let failComplete = false;
  const reporter = new CompatPreviewReporter({
    progress: async () => {},
    complete: async (scanned, flagged, error) => {
      if (failComplete) throw new Error("complete failed");
      completions.push({ scanned, ids: flagged.map(f => f.id), error });
    },
    onProgressError: () => {},
  });
  reporter.record(flag("a"));
  await reporter.reportProgress(5);
  reporter.record(flag("b"));
  await reporter.finish(9);
  assert.deepEqual(completions, [{ scanned: 9, ids: ["b"], error: undefined }]);

  failComplete = true;
  reporter.record(flag("c"));
  await assert.rejects(reporter.finish(12), /complete failed/);
  assert.equal(reporter.undelivered, 1);
});
