import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { withDependencyTimeout } from "./bounded-dependency.js";

test("withDependencyTimeout returns a completed dependency result", async () => {
  assert.equal(await withDependencyTimeout("model config", Promise.resolve("ok"), 20), "ok");
});

test("withDependencyTimeout rejects a hung dependency with a visible stage", async () => {
  const never = new Promise<string>(() => undefined);
  await assert.rejects(
    withDependencyTimeout("model config", never, 5),
    /model config timed out after 5ms/,
  );
});

test("withDependencyTimeout preserves an upstream error", async () => {
  await assert.rejects(
    withDependencyTimeout("model config", Promise.reject(new Error("database unavailable")), 20),
    /database unavailable/,
  );
});


test("pending dependency reaches its deadline when it is the process's only live handle", () => {
  const moduleUrl = new URL("./bounded-dependency.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { withDependencyTimeout } from ${JSON.stringify(moduleUrl)}; withDependencyTimeout("native deadline", new Promise(() => {}), 15).catch(() => console.log("deadline settled"));`],
    { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "deadline settled");
});
