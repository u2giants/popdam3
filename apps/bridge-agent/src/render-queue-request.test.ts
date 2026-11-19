import assert from "node:assert/strict";
import { test } from "node:test";
import { renderQueueReason, requestRender, type RenderReasonInput } from "./render-queue-request.js";

const base: RenderReasonInput = {
  defer: false, deferReason: null, isNewOrChanged: false, thumbnailUrl: null,
  thumbnailError: null, fileType: "ai", finalFallbackOnLocalFailure: false,
};

test("deferred new file is queued with the defer reason", () => {
  assert.equal(renderQueueReason({ ...base, defer: true, deferReason: "offload", isNewOrChanged: true }), "offload");
});

test("unchanged no_pdf_compat retry is queued", () => {
  assert.equal(renderQueueReason({ ...base, thumbnailError: "no_pdf_compat" }), "no_pdf_compat");
});

test("known-blank renders are never queued", () => {
  assert.equal(renderQueueReason({ ...base, thumbnailError: "blank_render", finalFallbackOnLocalFailure: true }), null);
});

test("a file that already has a thumbnail is not queued", () => {
  assert.equal(renderQueueReason({ ...base, thumbnailUrl: "x.jpg", thumbnailError: "no_pdf_compat" }), null);
});

test("policy fallback queues any local failure", () => {
  assert.equal(renderQueueReason({ ...base, fileType: "psd", thumbnailError: "decode_failed", finalFallbackOnLocalFailure: true }), "local_thumb_failed");
});

test("a queue failure is recorded as a scan error, not swallowed", async () => {
  const errors: string[] = [];
  const ok = await requestRender("a1", "Decor/x.ai", "no_pdf_compat", {
    queueRender: async () => { throw new Error("500 boom"); },
    recordError: (m) => errors.push(m),
  });
  assert.equal(ok, false);
  assert.deepEqual(errors, ["render queue failed for Decor/x.ai (no_pdf_compat): 500 boom"]);
});

test("a successful queue records nothing", async () => {
  const errors: string[] = [];
  const ok = await requestRender("a1", "Decor/x.ai", "no_pdf_compat", { queueRender: async () => "job", recordError: (m) => errors.push(m) });
  assert.equal(ok, true);
  assert.equal(errors.length, 0);
});
