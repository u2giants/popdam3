import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupProfileWrites,
  handleStyleGroupProfiles,
  prepareGroupImages,
  profileOneStyleGroup,
  validateStyleGroupProfileData,
  writeStyleGroupProfile,
  AUTHORITATIVE_MODEL,
  AUTHORITATIVE_SOURCE,
  GROUP_PROFILE_SOURCE,
  type StyleGroupProfileData,
  type StyleGroupProfileDependencies,
  type StyleGroupProfileRow,
} from "./ai-style-group-profile.js";
import { isValidAutoResumeCursor } from "../operation-retry.js";
import { readFileSync } from "node:fs";
import type { OpState } from "../types.js";

const GROUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";
const ASSET_C = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "99999999-9999-4999-8999-999999999999";
const MODEL = "test/vision-model";

const GROUP: StyleGroupProfileRow = {
  id: GROUP_ID,
  sku: "SKU-1",
  item_description: "Ceramic mug",
  licensor_name: "Fixture Licensor",
  property_name: "Fixture Property",
  product_category: "Drinkware",
  rich_metadata: null,
  primary_asset_id: ASSET_A,
  group_ai_description: "Existing description",
};

const MEMBERS = [
  { id: ASSET_A, filename: "mug-front.jpg", relative_path: "a/mug-front.jpg", file_type: "jpg", content_type: "photograph", file_size: 10, thumbnail_url: "https://example.test/a.jpg" },
  { id: ASSET_B, filename: "mug-techpack.pdf", relative_path: "a/mug-techpack.pdf", file_type: "pdf", content_type: "technical_document", file_size: 20, thumbnail_url: "https://example.test/b.jpg" },
  { id: ASSET_C, filename: "mug-mockup-back.png", relative_path: "a/mug-mockup-back.png", file_type: "png", content_type: "mockup", file_size: 30, thumbnail_url: "https://example.test/c.jpg" },
];

const PROFILE: StyleGroupProfileData = {
  group_ai_description: "Pastel floral mug artwork program.",
  group_tags: [
    { tag: "Floral", category: "theme", confidence: 0.93, evidence_asset_ids: [ASSET_A, ASSET_C] },
    { tag: "pastel", category: "style", confidence: 0.6, evidence_asset_ids: [ASSET_A, ASSET_B] },
    { tag: "gift", category: "occasion", confidence: 0.95, evidence_asset_ids: [ASSET_A] },
  ],
};

function recordingClient() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, ...params });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function deps(overrides: Partial<StyleGroupProfileDependencies> = {}): StyleGroupProfileDependencies {
  return {
    models: { primary: MODEL, fallback: null, providerPin: null },
    fetchGroups: async () => [GROUP],
    fetchMembers: async () => MEMBERS,
    fetchImages: async (representatives) => ({
      representatives,
      images: representatives.map(() => ({ base64: "AAAA", mimeType: "image/jpeg" })),
      droppedForBudget: 0,
      unavailable: 0,
    }),
    callModel: async () => PROFILE,
    ...overrides,
  };
}

// ── Contract validation ──────────────────────────────────────────────────────

test("group-only categories are enforced and file-only categories are rejected", () => {
  for (const category of ["view", "color", "file_type", "scene", "visible_content"]) {
    assert.throws(
      () => validateStyleGroupProfileData({
        group_ai_description: "x",
        group_tags: [{ tag: "front", category, confidence: 0.9, evidence_asset_ids: [ASSET_A] }],
      }, "unit"),
      /group-only category/,
    );
  }
  assert.doesNotThrow(() => validateStyleGroupProfileData({
    group_ai_description: "x",
    group_tags: [{ tag: "floral", category: "theme", confidence: 0.9, evidence_asset_ids: [ASSET_A] }],
  }, "unit"));
});

test("group profiles require a description and cited asset UUIDs", () => {
  assert.throws(() => validateStyleGroupProfileData({ group_ai_description: "  ", group_tags: [] }, "unit"), /group_ai_description/);
  assert.throws(
    () => validateStyleGroupProfileData({
      group_ai_description: "x",
      group_tags: [{ tag: "floral", category: "theme", confidence: 0.9, evidence_asset_ids: [] }],
    }, "unit"),
    /representative asset UUIDs/,
  );
  assert.throws(
    () => validateStyleGroupProfileData({
      group_ai_description: "x",
      group_tags: [{ tag: "floral", category: "theme", confidence: 0.9, evidence_asset_ids: ["not-a-uuid"] }],
    }, "unit"),
    /representative asset UUIDs/,
  );
});

// ── Row construction ─────────────────────────────────────────────────────────

test("two distinct evidence assets at >= 0.85 promote to active; everything else stays candidate", () => {
  const writes = buildGroupProfileWrites({ group: GROUP, memberAssetIds: [ASSET_A, ASSET_B, ASSET_C], profile: PROFILE });
  const byTag = new Map(writes.aiTags.map((row) => [row.tag, row]));
  assert.equal(byTag.get("floral")?.status, "active", "0.93 with two assets promotes");
  assert.equal(byTag.get("pastel")?.status, "candidate", "0.6 stays candidate even with two assets");
  assert.equal(byTag.get("gift")?.status, "candidate", "0.95 with one asset stays candidate");
});

test("authoritative product identity is written without AI and cannot be overwritten by the model", () => {
  const withCollision: StyleGroupProfileData = {
    group_ai_description: "desc",
    group_tags: [
      { tag: "Drinkware", category: "product_type", confidence: 0.99, evidence_asset_ids: [ASSET_A, ASSET_B] },
      { tag: "floral", category: "theme", confidence: 0.9, evidence_asset_ids: [ASSET_A, ASSET_B] },
    ],
  };
  const writes = buildGroupProfileWrites({ group: GROUP, memberAssetIds: [ASSET_A, ASSET_B, ASSET_C], profile: withCollision });
  assert.deepEqual(writes.authoritativeTags.map((row) => [row.tag, row.category, row.status]), [["drinkware", "product_type", "active"]]);
  assert.ok(!writes.aiTags.some((row) => row.tag === "drinkware"), "AI cannot emit a competing product identity row");
  assert.deepEqual(writes.aiTags.map((row) => row.tag), ["floral"]);
});

test("authoritative facts are derived from the group, not from the model output", () => {
  const empty: StyleGroupProfileData = { group_ai_description: "  ", group_tags: [] };
  const writes = buildGroupProfileWrites({ group: GROUP, memberAssetIds: [ASSET_A], profile: empty });
  assert.equal(writes.aiTags.length, 0, "a model that returns nothing yields no AI rows");
  assert.deepEqual(writes.authoritativeTags.map((row) => row.tag), ["drinkware"]);
  assert.equal(writes.description, "Existing description", "a blank model description never blanks the group");
});

test("evidence outside the group's own membership is dropped before the write", () => {
  const foreign: StyleGroupProfileData = {
    group_ai_description: "desc",
    group_tags: [
      { tag: "floral", category: "theme", confidence: 0.95, evidence_asset_ids: [ASSET_A, FOREIGN] },
      { tag: "outside", category: "theme", confidence: 0.95, evidence_asset_ids: [FOREIGN] },
    ],
  };
  const writes = buildGroupProfileWrites({ group: GROUP, memberAssetIds: [ASSET_A, ASSET_B, ASSET_C], profile: foreign });
  assert.deepEqual(writes.aiTags.map((row) => row.tag), ["floral"], "a tag with only foreign evidence is discarded");
  assert.deepEqual(writes.aiTags[0].evidence, { asset_ids: [ASSET_A] });
  assert.equal(writes.aiTags[0].status, "candidate", "one surviving evidence asset cannot promote");
  assert.deepEqual(writes.evidenceAssetIds, [ASSET_A]);
});

// ── Atomic writer ────────────────────────────────────────────────────────────

test("the governed RPC is the only writer, once per source, with the same final description", async () => {
  const client = recordingClient();
  const writes = buildGroupProfileWrites({ group: GROUP, memberAssetIds: [ASSET_A, ASSET_B, ASSET_C], profile: PROFILE });
  await writeStyleGroupProfile(client, { groupId: GROUP_ID, model: MODEL, ...writes });

  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.every((call) => call.name === "replace_style_group_ai_profile"));
  assert.equal(client.calls[0].p_source, AUTHORITATIVE_SOURCE);
  assert.equal(client.calls[0].p_model, AUTHORITATIVE_MODEL);
  assert.equal(client.calls[1].p_source, GROUP_PROFILE_SOURCE);
  assert.equal(client.calls[1].p_model, MODEL);
  assert.equal(client.calls[0].p_description, client.calls[1].p_description);
  assert.equal(client.calls[1].p_description, PROFILE.group_ai_description);
});

test("a failed atomic write surfaces as an error instead of a partial success", async () => {
  const failing = { rpc: () => Promise.resolve({ data: null, error: { message: "invalid group tag" } }) };
  await assert.rejects(
    () => writeStyleGroupProfile(failing, {
      groupId: GROUP_ID, model: MODEL, description: "d", authoritativeTags: [], aiTags: [], evidenceAssetIds: [],
    }),
    /Atomic group profile write failed/,
  );
});

// ── One group end to end ─────────────────────────────────────────────────────

test("a tech-pack / photo / mockup group yields one group summary and no file-scoped tags", async () => {
  const client = recordingClient();
  const result = await profileOneStyleGroup(GROUP, MODEL, deps({ client }));
  assert.deepEqual(result, { outcome: "profiled" });
  const aiCall = client.calls[1];
  const tags = aiCall.p_tags as Array<{ category: string }>;
  assert.ok(tags.length > 0);
  for (const row of tags) {
    assert.ok(!["file_type", "view", "color", "scene", "visible_content"].includes(row.category), `${row.category} must not reach the group`);
  }
  assert.equal(typeof aiCall.p_description, "string");
});

test("reruns are idempotent — the same input produces the same rows", async () => {
  const first = recordingClient();
  const second = recordingClient();
  await profileOneStyleGroup(GROUP, MODEL, deps({ client: first }));
  await profileOneStyleGroup(GROUP, MODEL, deps({ client: second }));
  assert.deepEqual(first.calls, second.calls);
});

test("a group with no usable representative image is left untouched so it stays eligible", async () => {
  const client = recordingClient();
  let modelCalled = false;
  const result = await profileOneStyleGroup(GROUP, MODEL, deps({
    client,
    fetchImages: async (representatives) => ({ representatives, images: [], droppedForBudget: 0, unavailable: representatives.length }),
    callModel: async () => { modelCalled = true; return PROFILE; },
  }));
  assert.equal(result.outcome, "visual_analysis_unavailable");
  assert.equal(modelCalled, false, "no model call without an image");
  // The governed RPC stamps group_ai_tagged_at unconditionally, so writing here
  // would exclude the group from every later default run once its thumbnails recover.
  assert.equal(client.calls.length, 0, "an unanalyzable group is never marked profiled");
});

test("a group with no members at all is left untouched", async () => {
  const client = recordingClient();
  const result = await profileOneStyleGroup(GROUP, MODEL, deps({
    client,
    fetchMembers: async () => [],
  }));
  assert.equal(result.outcome, "visual_analysis_unavailable");
  assert.equal(client.calls.length, 0);
});

// ── Bounded payload ──────────────────────────────────────────────────────────

test("prepareGroupImages enforces the actual downloaded-byte ceiling", async () => {
  const originalFetch = globalThis.fetch;
  const body = new Uint8Array(1024);
  globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  const six = Array.from({ length: 6 }, (_, index) => ({
    ...MEMBERS[0],
    id: `0000000${index}-0000-4000-8000-000000000000`,
    thumbnail_url: `https://example.test/${index}.jpg`,
  }));
  try {
    const prepared = await prepareGroupImages(six, 4200);
    assert.equal(prepared.images.length, 4, "four 1KB images fill the ~4KB ceiling");
    assert.equal(prepared.droppedForBudget, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prepareGroupImages treats a 403/404 thumbnail as unavailable, not a failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("gone", { status: 404 })) as typeof fetch;
  try {
    const prepared = await prepareGroupImages(MEMBERS);
    assert.equal(prepared.images.length, 0);
    assert.equal(prepared.unavailable, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Operation batch behavior ─────────────────────────────────────────────────

test("the normal pass keysets by style group ID and confirms completion with an empty page", async () => {
  const client = recordingClient();
  const page = await handleStyleGroupProfiles({ status: "running", cursor: 0 } as OpState, deps({ client }));
  assert.equal(page.ok, true);
  assert.equal(page.done, false, "a full page never terminates the run early");
  assert.equal(page.profiled, 1);
  assert.equal(page.nextOffset, GROUP_ID);

  const empty = await handleStyleGroupProfiles(
    { status: "running", cursor: GROUP_ID } as OpState,
    deps({ client, fetchGroups: async () => [] }),
  );
  assert.equal(empty.done, true);
});

test("a failing group is recorded as a sample and does not abort the page", async () => {
  const other = { ...GROUP, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const result = await handleStyleGroupProfiles({ status: "running", cursor: 0 } as OpState, deps({
    client: recordingClient(),
    fetchGroups: async () => [GROUP, other],
    callModel: async (group) => {
      if (group.id === GROUP.id) throw new Error("model exploded");
      return PROFILE;
    },
  }));
  assert.equal(result.profiled, 1);
  assert.equal(result.failed, 1);
  assert.equal((result.failure_samples as unknown[]).length, 1);
  assert.equal(result.nextOffset, other.id);
});

// ── Restart-safe durable batch ───────────────────────────────────────────────

test("durable mode prepares group items on the shared external_job state machine", async () => {
  const originalFetch = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return new Response(JSON.stringify({
      data: [{
        id: "test/vision-model",
        architecture: { input_modalities: ["text", "image"] },
        supported_parameters: ["tools", "tool_choice", "structured_outputs", "response_format"],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await handleStyleGroupProfiles(
      { status: "running", cursor: 0, run_id: "run1" } as OpState,
      deps({ client: recordingClient(), apiKey: "test-key", models: { primary: "test/vision-model:batch", fallback: null, providerPin: null }, batchSize: 5 }),
    );
    assert.equal(result.ok, true);
    const job = result.external_job as { phase: string; scope: string; group_items: Array<{ style_group_id: string; status: string }>; next_cursor: string };
    assert.equal(job.phase, "prepared");
    assert.equal(job.scope, "style_group");
    assert.deepEqual(job.group_items.map((item) => [item.style_group_id, item.status]), [[GROUP_ID, "prepared"]]);
    assert.equal(job.next_cursor, GROUP_ID);
    assert.ok(!posts.some((call) => call.startsWith("POST")), "preparation never submits to the provider");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a restarted worker polls the saved batch ID instead of submitting a replacement", async () => {
  const posts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    posts.push(`${method} ${url}`);
    return new Response(JSON.stringify({ id: "batch_saved", status: "in_progress" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const resumed: OpState = {
      status: "running",
      cursor: 0,
      run_id: "run1",
      state_revision: 3,
      external_job: {
        version: 1,
        phase: "pending",
        model: "test/vision-model:batch",
        output_method: "json_schema",
        provider_batch_id: "batch_saved",
        submitted_at: new Date(Date.now() - 60_000).toISOString(),
        lease_token: "lease-1",
        page_cursor: 0,
        next_cursor: GROUP_ID,
        scope: "style_group",
        group_items: [{ style_group_id: GROUP_ID, custom_id: "popdam-group:run1:g:json_schema:0", status: "submitted" }],
        items: [],
      },
    } as unknown as OpState;
    const result = await handleStyleGroupProfiles(resumed, deps({
      client: recordingClient(),
      apiKey: "test-key",
      models: { primary: "test/vision-model:batch", fallback: null, providerPin: null },
    }));
    assert.equal(result.ok, true);
    assert.equal(result.done, false);
    assert.equal((result.external_job as { provider_batch_id: string }).provider_batch_id, "batch_saved");
    assert.ok(posts.some((call) => call.startsWith("GET") && call.includes("batch_saved")), `expected a poll, saw ${posts.join(", ")}`);
    assert.ok(!posts.some((call) => call.startsWith("POST")), `no replacement submission may occur, saw ${posts.join(", ")}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a prepared durable job asks the loop for a submission lease before any provider POST", async () => {
  {
    const prepared: OpState = {
      status: "running",
      cursor: 0,
      run_id: "run1",
      external_job: {
        version: 1,
        phase: "prepared",
        model: "test/vision-model:batch",
        output_method: "json_schema",
        page_cursor: 0,
        next_cursor: GROUP_ID,
        scope: "style_group",
        group_items: [{ style_group_id: GROUP_ID, custom_id: "popdam-group:run1:g:json_schema:0", status: "prepared" }],
        items: [],
      },
    } as unknown as OpState;
    const result = await handleStyleGroupProfiles(prepared, deps({
      client: recordingClient(),
      apiKey: "test-key",
      models: { primary: "test/vision-model:batch", fallback: null, providerPin: null },
    }));
    assert.equal(result.state_transition, "claim_submission");
  }
});

test("an ambiguous durable submission fails closed and never resubmits", async () => {
  {
    const ambiguous: OpState = {
      status: "running",
      cursor: 0,
      external_job: { version: 1, phase: "ambiguous_submission", model: "test/vision-model:batch", scope: "style_group", group_items: [], items: [] },
    } as unknown as OpState;
    const result = await handleStyleGroupProfiles(ambiguous, deps({
      client: recordingClient(),
      apiKey: "test-key",
      models: { primary: "test/vision-model:batch", fallback: null, providerPin: null },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error_code, "contract_error");
  }
});


test("a single oversized thumbnail is dropped even when it is the first representative", async () => {
  const originalFetch = globalThis.fetch;
  const big = new Uint8Array(4096);
  globalThis.fetch = (async () => new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } })) as typeof fetch;
  try {
    const prepared = await prepareGroupImages(MEMBERS.slice(0, 1), 8192);
    assert.equal(prepared.images.length, 0, "4KB exceeds a quarter of the 8KB ceiling");
    assert.equal(prepared.droppedForBudget, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("soft-deleted members are excluded from the default member query", () => {
  const source = readFileSync(new URL("./ai-style-group-profile.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function defaultFetchMembers");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.match(body, /\.eq\("is_deleted", false\)/, "a deleted file must never become a representative or evidence");
});

test("the profiling cursor auto-resumes after a worker restart", () => {
  assert.equal(isValidAutoResumeCursor("ai-tag-group-profiles", GROUP_ID), true);
  assert.equal(isValidAutoResumeCursor("ai-tag-group-profiles", "not-a-uuid"), false);
  assert.equal(isValidAutoResumeCursor("ai-tag-group-profiles", 0), true, "the initial numeric cursor still resumes");
});

test("a group touched only by the safe refresh is still eligible for profiling", () => {
  // The governed RPC stamps group_ai_tagged_at on EVERY write, including the
  // Step 6 refresh. Keying default eligibility off that timestamp would let one
  // bulk refresh silently exclude most of the library from ever being profiled,
  // so eligibility is decided by provenance instead.
  const source = readFileSync(new URL("./ai-style-group-profile.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function defaultFetchGroups");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(
    !/\.is\("group_ai_tagged_at", null\)/.test(body),
    "eligibility must not be decided by group_ai_tagged_at",
  );
  assert.match(body, /group_ai_description_source\.is\.null/);
  assert.match(body, /group_ai_description_source\.neq\.\$\{GROUP_PROFILE_SOURCE\}/);
});

test("the profile pass and the refresh agree on the authoritative provenance", async () => {
  const policy = await import("../tagging-metadata-policy.js");
  assert.equal(AUTHORITATIVE_SOURCE, policy.AUTHORITATIVE_TAG_SOURCE);
  assert.equal(AUTHORITATIVE_MODEL, policy.AUTHORITATIVE_TAG_MODEL);
  // The group RPC's DELETE is scoped by source AND model, so a drift between the
  // worker and the edge refresh would strand rows written under the old value.
  const edge = readFileSync(
    new URL("../../../../supabase/functions/_shared/admin-handlers/tag-propagation-handlers.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/=\s*"authoritative"/.test(edge), "the edge path must import the shared constant, not redeclare it");
  assert.ok(!/=\s*"derived"/.test(edge), "the edge path must import the shared constant, not redeclare it");
  assert.match(edge, /AUTHORITATIVE_TAG_SOURCE/);
});
