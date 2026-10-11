import assert from "node:assert/strict";
import test from "node:test";
import { withDependencyTimeout } from "./bounded-dependency.js";

test("withDependencyTimeout returns a completed dependency result", async () => {
  assert.equal(await withDependencyTimeout("model config", Promise.resolve("ok"), 20), "ok");
});

test("withDependencyTimeout rejects a hung dependency with a visible stage", async () => {
  const never = new Promise<string>(() => undefined);
  // The real worker has a referenced polling loop. Keep that condition here
  // while exercising the real unreferenced dependency timeout.
  const keepAlive = setTimeout(() => undefined, 1_000);
  try {
    await assert.rejects(
      withDependencyTimeout("model config", never, 5),
      /model config timed out after 5ms/,
    );
  } finally {
    clearTimeout(keepAlive);
  }
});

test("withDependencyTimeout preserves an upstream error", async () => {
  await assert.rejects(
    withDependencyTimeout("model config", Promise.reject(new Error("database unavailable")), 20),
    /database unavailable/,
  );
});
