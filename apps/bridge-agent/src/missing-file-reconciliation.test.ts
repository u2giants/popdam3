import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileMissingFiles, type ReconcileOptions } from "./missing-file-reconciliation.js";

const enoent = () => Object.assign(new Error("gone"), { code: "ENOENT" });

interface World {
  live: Array<{ id: string; relative_path: string }>;
  onDisk: Set<string>;
  seen?: string[];
  rootEntries?: () => string[];
  statError?: (path: string) => Error | undefined;
  options?: Partial<ReconcileOptions>;
  pageSize?: number;
}

async function run(world: World) {
  const retired: string[] = [];
  const pageSize = world.pageSize ?? 2;
  const result = await reconcileMissingFiles({
    mountRoot: "/mnt",
    scanRoots: ["/mnt/Decor"],
    seenPaths: new Set(world.seen ?? [...world.onDisk]),
    skippedDirs: [],
    skippedDirsTruncated: false,
    minMissingAllowance: 2,
    ...world.options,
  }, {
    listLivePaths: async (afterId) => {
      const start = afterId ? world.live.findIndex((a) => a.id === afterId) + 1 : 0;
      const assets = world.live.slice(start, start + pageSize);
      return { assets, next_after_id: start + pageSize < world.live.length ? assets[assets.length - 1].id : null };
    },
    retire: async (assets) => {
      retired.push(...assets.map((a) => a.asset_id));
      return { retired: assets.length };
    },
    stat: async (path) => {
      const custom = world.statError?.(path);
      if (custom) throw custom;
      if (!world.onDisk.has(path.replace("/mnt/", ""))) throw enoent();
    },
    readdir: async () => (world.rootEntries ?? (() => ["x"]))(),
  });
  return { result, retired };
}

const live = (...paths: string[]) => paths.map((p, i) => ({ id: `id${i}`, relative_path: p }));

test("retires only records whose file is gone", async () => {
  const { result, retired } = await run({
    live: live("Decor/a.psd", "Decor/b.psd", "Decor/c.psd", "Decor/d.psd", "Decor/e.psd"),
    onDisk: new Set(["Decor/a.psd", "Decor/c.psd", "Decor/d.psd", "Decor/e.psd"]),
  });
  assert.deepEqual(retired, ["id1"]);
  assert.equal(result.live_under_roots, 5);
  assert.equal(result.retired, 1);
});

test("counts records the cloud keeps because no surviving copy proves a move (#1198)", async () => {
  const pageSize = 2;
  const result = await reconcileMissingFiles({
    mountRoot: "/mnt",
    scanRoots: ["/mnt/Decor"],
    seenPaths: new Set(["Decor/a.psd"]),
    skippedDirs: [],
    skippedDirsTruncated: false,
    minMissingAllowance: 10,
  }, {
    listLivePaths: async (afterId) => {
      const all = live("Decor/a.psd", "Decor/b.psd", "Decor/c.psd", "Decor/d.psd");
      const start = afterId ? all.findIndex((a) => a.id === afterId) + 1 : 0;
      const assets = all.slice(start, start + pageSize);
      return { assets, next_after_id: start + pageSize < all.length ? assets[assets.length - 1].id : null };
    },
    retire: async (assets) => ({ retired: 0, kept: assets.length }),
    stat: async (path) => {
      if (path !== "/mnt/Decor/a.psd") throw enoent();
    },
    readdir: async () => ["x"],
  });
  assert.equal(result.missing, 3);
  assert.equal(result.retired, 0);
  assert.equal(result.kept, 3);
});

test("clears the missing mark when the walk sees the file again (#1198)", async () => {
  const clears: string[] = [];
  const result = await reconcileMissingFiles({
    mountRoot: "/mnt",
    scanRoots: ["/mnt/Decor"],
    seenPaths: new Set(["Decor/a.psd", "Decor/b.psd"]),
    skippedDirs: [],
    skippedDirsTruncated: false,
    minMissingAllowance: 10,
  }, {
    listLivePaths: async () => ({
      assets: [
        { id: "id0", relative_path: "Decor/a.psd", file_missing_at: "2026-11-19T00:00:00Z" },
        { id: "id1", relative_path: "Decor/b.psd" },
        { id: "id2", relative_path: "Decor/c.psd", file_missing_at: "2026-11-19T00:00:00Z" },
      ],
      next_after_id: null,
    }),
    retire: async (assets, clearMissingFlags) => {
      clears.push(...(clearMissingFlags ?? []));
      return { retired: 0, kept: assets.length, cleared: (clearMissingFlags ?? []).length };
    },
    stat: async () => { throw enoent(); },
    readdir: async () => ["x"],
  });
  // a.psd is seen again (mark cleared); b.psd is seen and unmarked (nothing to
  // do); c.psd is missing and stays on the retire path.
  assert.deepEqual(clears, ["id0"]);
  assert.equal(result.cleared_missing_flags, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.kept, 1);
});

test("keeps a file that exists even though the walk did not list it", async () => {
  const { retired } = await run({
    live: live("Decor/a.psd", "Decor/sub/deep.psd"),
    onDisk: new Set(["Decor/a.psd", "Decor/sub/deep.psd"]),
    seen: ["Decor/a.psd"],
  });
  assert.deepEqual(retired, []);
});

test("ignores records outside the scanned roots", async () => {
  const { result, retired } = await run({
    live: live("Decor/a.psd", "Other/gone.psd"),
    onDisk: new Set(["Decor/a.psd"]),
  });
  assert.deepEqual(retired, []);
  assert.equal(result.live_under_roots, 1);
});

test("retires nothing when a root is empty or unreadable", async () => {
  const { result, retired } = await run({
    live: live("Decor/a.psd"),
    onDisk: new Set(),
    seen: [],
    rootEntries: () => [],
  });
  assert.deepEqual(retired, []);
  assert.equal(result.refused, "root_unreadable");
});

test("retires nothing when the share drops during the check", async () => {
  let reads = 0;
  const { result, retired } = await run({
    live: live("Decor/a.psd"),
    onDisk: new Set(),
    seen: [],
    rootEntries: () => (++reads === 1 ? ["x"] : []),
  });
  assert.deepEqual(retired, []);
  assert.equal(result.refused, "root_unreadable");
});

test("retires nothing when too large a share is missing", async () => {
  const paths = Array.from({ length: 20 }, (_, i) => `Decor/f${i}.psd`);
  const { result, retired } = await run({
    live: live(...paths),
    onDisk: new Set(paths.slice(0, 10)),
  });
  assert.deepEqual(retired, []);
  assert.equal(result.missing, 10);
  assert.equal(result.refused, "too_many_missing");
});

test("only a real not-found counts as missing", async () => {
  const { retired } = await run({
    live: live("Decor/a.psd", "Decor/locked/b.psd"),
    onDisk: new Set(["Decor/a.psd"]),
    statError: (p) => (p.includes("locked") ? Object.assign(new Error("denied"), { code: "EACCES" }) : undefined),
  });
  assert.deepEqual(retired, []);
});

test("leaves records under a folder the walk could not read", async () => {
  const { retired } = await run({
    live: live("Decor/a.psd", "Decor/bad/b.psd", "Decor/c.psd"),
    onDisk: new Set(["Decor/a.psd", "Decor/c.psd"]),
    options: { skippedDirs: ["Decor/bad"] },
  });
  assert.deepEqual(retired, []);
});

test("retires nothing when the skipped-folder list was cut short", async () => {
  const { result } = await run({
    live: live("Decor/a.psd", "Decor/b.psd"),
    onDisk: new Set(["Decor/a.psd"]),
    options: { skippedDirsTruncated: true },
  });
  assert.equal(result.refused, "skipped_dirs");
});

test("a name differing only by case or Unicode form is present", async () => {
  const { retired } = await run({
    live: live("Decor/Café.psd", "Decor/b.psd", "Decor/c.psd"),
    onDisk: new Set(["Decor/b.psd", "Decor/c.psd"]),
    seen: ["Decor/café.psd", "Decor/b.psd", "Decor/c.psd"],
  });
  assert.deepEqual(retired, []);
});

test("a failed retirement batch keeps what was already retired (#1117)", async () => {
  const paths = Array.from({ length: 6 }, (_, i) => `Decor/f${i}.psd`);
  const calls: string[][] = [];
  const result = await reconcileMissingFiles({
    mountRoot: "/mnt",
    scanRoots: ["/mnt/Decor"],
    seenPaths: new Set(),
    skippedDirs: [],
    skippedDirsTruncated: false,
    minMissingAllowance: 10,
    retireBatchSize: 2,
  }, {
    listLivePaths: async () => ({ assets: live(...paths), next_after_id: null }),
    retire: async (assets) => {
      calls.push(assets.map((a) => a.asset_id));
      if (calls.length === 2) throw new Error("canceling statement due to statement timeout");
      return { retired: assets.length };
    },
    stat: async () => { throw enoent(); },
    readdir: async () => ["x"],
  });
  assert.equal(result.refused, "retire_failed");
  assert.equal(result.retired, 2);
  assert.equal(result.missing, 6);
  assert.match(result.retire_error ?? "", /statement timeout/);
  assert.equal(calls.length, 2);
});

test("a partial retirement reported by the cloud stops the run with its count", async () => {
  const paths = Array.from({ length: 6 }, (_, i) => `Decor/f${i}.psd`);
  let calls = 0;
  const result = await reconcileMissingFiles({
    mountRoot: "/mnt",
    scanRoots: ["/mnt/Decor"],
    seenPaths: new Set(),
    skippedDirs: [],
    skippedDirsTruncated: false,
    minMissingAllowance: 10,
    retireBatchSize: 3,
  }, {
    listLivePaths: async () => ({ assets: live(...paths), next_after_id: null }),
    retire: async () => (++calls === 1 ? { retired: 1, error: "statement timeout" } : { retired: 3 }),
    stat: async () => { throw enoent(); },
    readdir: async () => ["x"],
  });
  assert.equal(result.refused, "retire_failed");
  assert.equal(result.retired, 1);
  assert.equal(calls, 1);
});
