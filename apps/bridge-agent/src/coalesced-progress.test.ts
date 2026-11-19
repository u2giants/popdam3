import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoalescedReporter } from "./coalesced-progress";

describe("createCoalescedReporter", () => {
  it("keeps one call in flight and sends only the latest waiting value", async () => {
    const sent: number[] = [];
    let concurrent = 0;
    let peak = 0;
    const r = createCoalescedReporter<number>(async (v) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((res) => setTimeout(res, 10));
      sent.push(v);
      concurrent--;
    });
    for (let i = 1; i <= 100; i++) r.report(i);
    await r.idle();
    assert.equal(peak, 1);
    assert.deepEqual(sent, [1, 100]);
  });

  it("keeps reporting after a failed send", async () => {
    const sent: number[] = [];
    const r = createCoalescedReporter<number>(async (v) => {
      if (v === 1) throw new Error("timeout");
      sent.push(v);
    });
    r.report(1);
    r.report(2);
    await r.idle();
    assert.deepEqual(sent, [2]);
  });
});
