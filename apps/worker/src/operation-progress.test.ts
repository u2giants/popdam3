import assert from "node:assert/strict";
import test from "node:test";
import { detectFailureKillSwitch, mergeProgress } from "./operation-progress.js";

for (const [key, success] of [
  ["ai-tag-parallel", "tagged"], ["ai-tag-group-profiles", "profiled"],
  ["ai-tag-bakeoff", "evaluated"], ["refresh-group-metadata", "unchanged"],
  ["propagate-group-tags", "refreshed"], ["shorten-item-descriptions", "shortened"],
  ["tag-popsg-files", "processed"],
]) {
  test(key + " measures the complete batches at the 50% threshold", () => {
    for (const failed of [1, 5, 20]) {
      for (const extra of [0, 1]) {
        let progress = {};
        for (let i = 0; i < 20; i += failed) {
          progress = mergeProgress(key, progress, {
            ok: true, done: false, [success]: failed + (i === 0 ? extra : 0), failed,
            failure_samples: Array.from({ length: failed }, () => ({ error: "timeout" })),
          });
        }
        const reason = detectFailureKillSwitch(progress);
        if (extra) assert.equal(reason, null);
        else assert.match(reason ?? "", /same error/);
      }
    }
  });
}

test("legacy samples age out before repeated errors can stop a run", () => {
  const samples = Array.from({ length: 10 }, () => ({ error: "timeout" }));
  for (const legacy of [samples, samples.map(sample => ({ ...sample, seen: 10 }))]) {
    const batch = { ok: true, done: false, failed: 10, failure_samples: samples };
    const mixed = mergeProgress("ai-tag-all", { failed: 10, failure_samples: legacy }, batch);
    assert.equal(detectFailureKillSwitch(mixed), null);
    assert.match(detectFailureKillSwitch(mergeProgress("ai-tag-all", mixed, batch)) ?? "", /same error/);
  }
});
