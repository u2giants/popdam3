import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  authoritativeTagsAreCurrent,
  deriveRefreshTags,
  handleRefreshGroupMetadata,
  needsProvenanceRestore,
  LEGACY_PROPAGATION_DEPRECATION,
  REFRESH_GROUP_METADATA_OP_KEY,
  type RefreshDependencies,
  type RefreshGroupRow,
} from "./group-metadata-refresh.js";
import { handlePropagateGroupTags } from "./tag-propagation.js";
import type { OpState } from "../types.js";

const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const GROUP: RefreshGroupRow = {
  id: GROUP_A,
  product_category: "Drinkware",
  group_ai_description: "Pastel floral mug artwork program.",
  group_ai_description_source: "group_ai",
  group_ai_description_model: "qwen/qwen3-vl-32b-instruct",
  group_ai_evidence_asset_ids: ["11111111-1111-4111-8111-111111111111"],
  group_ai_tagged_at: "2026-08-26T12:00:00.000Z",
};

/**
 * Records every RPC and every attempted table write. Any attempt to reach an
 * asset table is captured so the isolation tests can prove it never happens.
 */
function recordingClient() {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function deps(overrides: Partial<RefreshDependencies> = {}): RefreshDependencies {
  return {
    fetchGroups: async () => [GROUP],
    fetchAuthoritativeTags: async () => [],
    restoreProvenance: async () => {},
    ...overrides,
  };
}

// ── Derivation and reconciliation ───────────────────────────────────────────

test("authoritative facts are derived from the group's own columns", () => {
  assert.deepEqual(
    deriveRefreshTags(GROUP).map((row) => [row.tag, row.category, row.status]),
    [["drinkware", "product_type", "active"]],
  );
  assert.deepEqual(deriveRefreshTags({ ...GROUP, product_category: null }), []);
});

test("a group whose stored facts already match is left alone apart from its search entry", async () => {
  const client = recordingClient();
  const result = await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({
    client,
    fetchAuthoritativeTags: async () => [
      { style_group_id: GROUP_A, tag: "drinkware", category: "product_type", status: "active" },
    ],
  }));
  assert.equal(result.unchanged, 1);
  assert.equal(result.refreshed, 0);
  assert.deepEqual(client.rpcCalls.map((call) => call.name), ["refresh_dam_search_documents_batch"]);
  assert.deepEqual(client.rpcCalls[0].params.p_asset_ids, [], "a refresh never touches asset documents");
  assert.deepEqual(client.rpcCalls[0].params.p_style_group_ids, [GROUP_A]);
});

test("a stale authoritative row from an earlier run is cleared by the reconciling write", async () => {
  const client = recordingClient();
  // The group's product_category was cleared, so the desired set is empty and the
  // old row must be removed. The RPC's own DELETE does that when it is called
  // with the same source and model.
  const cleared = { ...GROUP, product_category: null };
  const result = await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({
    client,
    fetchGroups: async () => [cleared],
    fetchAuthoritativeTags: async () => [
      { style_group_id: GROUP_A, tag: "drinkware", category: "product_type", status: "active" },
    ],
  }));
  assert.equal(result.refreshed, 1);
  const write = client.rpcCalls.find((call) => call.name === "replace_style_group_ai_profile");
  assert.ok(write, "the reconciling write must happen");
  assert.deepEqual(write.params.p_tags, [], "an empty tag set is what clears the stale row");
  assert.equal(write.params.p_source, "authoritative");
});

test("a refresh passes the group's own summary straight back and never blanks it", async () => {
  const client = recordingClient();
  await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({ client }));
  const write = client.rpcCalls.find((call) => call.name === "replace_style_group_ai_profile");
  assert.equal(write?.params.p_description, GROUP.group_ai_description);
});

test("an AI-written summary keeps its provenance after a refresh", async () => {
  assert.equal(needsProvenanceRestore(GROUP), true);
  assert.equal(needsProvenanceRestore({ ...GROUP, group_ai_description_source: "authoritative", group_ai_description_model: "derived" }), false);
  assert.equal(needsProvenanceRestore({ ...GROUP, group_ai_description: null }), false);

  const restored: string[] = [];
  await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({
    client: recordingClient(),
    restoreProvenance: async (groupId) => { restored.push(groupId); },
  }));
  assert.deepEqual(restored, [GROUP_A], "the vision model's provenance is restored, not relabelled 'derived'");
});

test("comparison ignores ordering and casing but not a genuine difference", () => {
  const desired = deriveRefreshTags(GROUP);
  assert.equal(authoritativeTagsAreCurrent(desired, [
    { tag: "Drinkware", category: "product_type", status: "active" },
  ]), true);
  assert.equal(authoritativeTagsAreCurrent(desired, []), false);
  assert.equal(authoritativeTagsAreCurrent(desired, [
    { tag: "drinkware", category: "theme", status: "active" },
  ]), false, "the same text under a different category is a real difference");
  assert.equal(authoritativeTagsAreCurrent(desired, [
    { tag: "drinkware", category: "product_type", status: "rejected" },
  ]), false, "a tombstone is not an active fact");
});

// ── The isolation guarantee ─────────────────────────────────────────────────

const ASSET_FIELDS = [
  "asset_tags",
  "asset_characters",
  "licensor_id",
  "property_id",
  "ai_description",
  "scene_description",
  "content_type",
  "asset_type",
  "art_source",
  "design_style",
  "big_theme",
  "little_theme",
  "cover_description",
  "is_licensed",
];

test("neither the new operation nor the legacy alias ever reaches an asset row", async () => {
  for (const run of [handleRefreshGroupMetadata, handlePropagateGroupTags]) {
    const client = recordingClient();
    await run({ status: "running", cursor: 0 } as OpState, deps({ client }));
    const serialized = JSON.stringify(client.rpcCalls);
    for (const field of ASSET_FIELDS) {
      assert.ok(!serialized.includes(field), `${run.name} must never write ${field}`);
    }
    for (const call of client.rpcCalls) {
      assert.ok(
        ["replace_style_group_ai_profile", "refresh_dam_search_documents_batch"].includes(call.name),
        `unexpected write: ${call.name}`,
      );
      if (call.name === "refresh_dam_search_documents_batch") {
        assert.deepEqual(call.params.p_asset_ids, []);
      }
    }
  }
});

test("the refresh handler's source contains no asset table access at all", () => {
  const source = readFileSync(fileURLToPath(new URL("./group-metadata-refresh.ts", import.meta.url)), "utf8");
  for (const table of ["\"assets\"", "\"asset_tags\"", "\"asset_characters\""]) {
    assert.ok(!source.includes(`from(${table})`), `the refresh must not query or write ${table}`);
  }
});

test("no production path still calls the legacy copy helper", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  // git grep exits 1 when there is no match, which is the outcome we want.
  let hits = "";
  try {
    hits = execFileSync("git", [
      "grep", "-l", "-e", "propagateGroupTags", "-e", "_shared/tag-propagation",
      "--", "src", "apps", "supabase/functions",
    ], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    const status = (error as { status?: number }).status;
    assert.equal(status, 1, `git grep failed unexpectedly: ${String(error)}`);
  }
  // supabase/migrations is deliberately excluded: it is historical-only per
  // CLAUDE.md and is never executed by this application.
  assert.equal(hits, "", `the legacy copy helper still has callers:\n${hits}`);
});

// ── Compatibility alias ─────────────────────────────────────────────────────

test("the legacy operation key still works and says it is deprecated", async () => {
  const client = recordingClient();
  const result = await handlePropagateGroupTags({ status: "running", cursor: 0 } as OpState, deps({ client }));
  assert.equal(result.ok, true);
  assert.equal(result.deprecated, true);
  assert.match(String(result.deprecation_notice), /deprecated/);
  assert.match(String(result.deprecation_notice), new RegExp(REFRESH_GROUP_METADATA_OP_KEY));
  assert.equal(result.refreshed, 1, "the capability itself is preserved, not removed");
  assert.equal(LEGACY_PROPAGATION_DEPRECATION, result.deprecation_notice);
});

// ── Batch behavior ──────────────────────────────────────────────────────────

test("the pass keysets by group ID and confirms completion with an empty page", async () => {
  const second: RefreshGroupRow = { ...GROUP, id: GROUP_B };
  const page = await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({
    client: recordingClient(),
    fetchGroups: async () => [GROUP, second],
  }));
  assert.equal(page.done, false);
  assert.equal(page.refreshed, 2);
  assert.equal(page.nextOffset, GROUP_B);

  const empty = await handleRefreshGroupMetadata({ status: "running", cursor: GROUP_B } as OpState, deps({
    client: recordingClient(),
    fetchGroups: async () => [],
  }));
  assert.equal(empty.done, true);
  assert.equal(empty.refreshed, 0);
});

test("one failing group is sampled and does not abort the page", async () => {
  const second: RefreshGroupRow = { ...GROUP, id: GROUP_B };
  const client = {
    rpc(name: string, params: Record<string, unknown>) {
      if (name === "replace_style_group_ai_profile" && params.p_style_group_id === GROUP_A) {
        return Promise.resolve({ data: null, error: { message: "invalid group tag" } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  const result = await handleRefreshGroupMetadata({ status: "running", cursor: 0 } as OpState, deps({
    client,
    fetchGroups: async () => [GROUP, second],
  }));
  assert.equal(result.refreshed, 1);
  assert.equal(result.failed, 1);
  assert.equal((result.failure_samples as unknown[]).length, 1);
  assert.equal(result.nextOffset, GROUP_B);
});
