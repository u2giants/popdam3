import assert from "node:assert/strict";
import { test } from "node:test";
import { retireConfirmedStaleRecords } from "./stale-record-retirement.js";

const enoent = () => Object.assign(new Error("gone"), { code: "ENOENT" });

async function run(stat: (path: string) => Promise<unknown>) {
  const retired: string[] = [];
  await retireConfirmedStaleRecords([{ id: "s", relative_path: "Decor/old/a.pdf" }], "n", "/mnt/Decor/new/a.pdf", "/mnt", {
    stat,
    retire: async (id) => {
      retired.push(id);
      return { retired: true };
    },
    warn: () => {},
  });
  return retired;
}

test("retires when only the stale path is gone", async () => {
  const retired = await run(async (p) => {
    if (p === "/mnt/Decor/old/a.pdf") throw enoent();
  });
  assert.deepEqual(retired, ["s"]);
});

test("keeps the record when the file still exists", async () => {
  assert.deepEqual(await run(async () => {}), []);
});

test("keeps the record on an unmounted share", async () => {
  assert.deepEqual(await run(async () => {
    throw enoent();
  }), []);
});

test("keeps the record on any error other than ENOENT", async () => {
  const retired = await run(async (p) => {
    if (p === "/mnt/Decor/old/a.pdf") throw Object.assign(new Error("io"), { code: "EIO" });
  });
  assert.deepEqual(retired, []);
});
