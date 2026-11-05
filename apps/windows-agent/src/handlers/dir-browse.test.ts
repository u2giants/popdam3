import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("windows actual browse handler contains filesystem access and preserves browsing", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "popdam-windows-browse-"));
  const root = path.join(base, "nas");
  const child = path.join(root, "child");
  const sibling = path.join(base, "nas-sibling");
  const secondary = path.join(base, "secondary-scan");
  await Promise.all([mkdir(child, { recursive: true }), mkdir(sibling), mkdir(secondary)]);
  await Promise.all([
    writeFile(path.join(root, "visible.txt"), "visible"),
    writeFile(path.join(child, "nested.txt"), "nested"),
    writeFile(path.join(sibling, "outside-secret.txt"), "never report this entry"),
    writeFile(path.join(secondary, "scan-visible.txt"), "scan"),
    writeFile(path.join(base, "agent-config.json"), "{}"),
  ]);
  // A real directory link, not a mocked realpath response; junctions also work
  // on Windows without enabling developer-mode symlink privileges.
  await symlink(sibling, path.join(root, "escape"), "junction");
  const env = {
    POPDAM_DATA_FILE: path.join(base, "agent-config.json"),
    SUPABASE_URL: "http://127.0.0.1:1", POPDAM_SERVER_URL: "http://127.0.0.1:1",
    AGENT_KEY: "synthetic-browse-test-key", NAS_CONTAINER_MOUNT_ROOT: root,
    SCAN_ROOTS: [root, secondary].join(","),
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const fetchBefore = globalThis.fetch;
  type Report = { action: string; request_id: string; path: string; entries: Array<{ name: string; is_dir: boolean; size?: number; modified?: string }> };
  const reports: Report[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:1/functions/v1/agent-api");
    assert.equal(init?.method, "POST");
    const report = JSON.parse(String(init?.body)) as Report;
    assert.equal(report.action, "report-dir-browse", "no claim or other operation may run");
    reports.push(report);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  t.after(async () => {
    globalThis.fetch = fetchBefore;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  });
  const { handleDirBrowse } = await import("./dir-browse");
  async function browse(target: string) {
    const before = reports.length;
    const requestId = `synthetic-${before}`;
    await handleDirBrowse({ request_id: requestId, path: target }, () => root);
    assert.equal(reports.length, before + 1, "exactly one report reaches the real API client");
    const report = reports.at(-1)!;
    assert.equal(report.request_id, requestId);
    assert.equal(report.path, target.trim());
    return report.entries;
  }
  await t.test("configured root remains browsable with real file metadata", async () => {
    const entries = await browse(root);
    assert.ok(entries.some(entry => entry.name === "child" && entry.is_dir));
    const file = entries.find(entry => entry.name === "visible.txt");
    assert.equal(file?.size, 7); assert.ok(file?.modified);
  });
  await t.test("valid child remains browsable", async () => {
    const entries = await browse(`  ${child}  `);
    assert.deepEqual(entries.map(entry => entry.name), ["nested.txt"]);
    assert.equal(entries[0].size, 6);
  });
  await t.test("sibling with matching root prefix is rejected", async () => {
    assert.deepEqual(await browse(sibling), []);
  });
  await t.test("literal parent traversal outside root is rejected", async () => {
    assert.deepEqual(await browse(`${root}${path.sep}..${path.sep}nas-sibling`), []);
  });
  await t.test("real link outside root is rejected", async () => {
    assert.deepEqual(await browse(path.join(root, "escape")), []);
  });
  await t.test("empty path still lists mount-root entries", async () => {
    const entries = await browse("   ");
    assert.ok(entries.some(entry => entry.name === "child" && entry.is_dir));
    assert.ok(entries.some(entry => entry.name === "visible.txt" && !entry.is_dir));
    assert.ok(entries.every(entry => entry.size === undefined));
    assert.ok(entries.every(entry => entry.name !== "outside-secret.txt"));
  });
  
});
