import test from "node:test";
import assert from "node:assert/strict";
import {
  hasReceipt,
  verifyPreimage,
  appendPayload,
  assetOutcome,
  pgTimestamp,
} from "./relink-existing-ai-characters-safety.mjs";
const pre = {
  asset: { id: "a" },
  tags: [
    {
      id: "t",
      source: "ai",
      status: "active",
      created_by: null,
      model: null,
      created_at: "2020-01-01",
    },
  ],
  links: [{ character_id: "old", source: "manual" }],
  legacy: [{ name: "old" }],
};
test("all receipt statuses protect assets, including accepted and completed", () => {
  for (const status of ["pending", "accepted", "completed", "failed"])
    assert.equal(
      hasReceipt({ task: { status, external_job: { asset_ids: ["a"] } } }, "a"),
      true,
    );
  assert.equal(
    hasReceipt({ task: { external_job: { asset_ids: ["A"] } } }, "a"),
    true,
  );
  assert.equal(
    hasReceipt(
      { task: { status: "running", params: { asset_ids: ["a"] } } },
      "a",
    ),
    false,
  );
});
test("NULL model remains unknown and original AI timestamp is preserved", () => {
  const entry = {
    preimage: pre,
    sourceTagId: "t",
    model: null,
    assetId: "a",
    characterId: "new",
    licensorId: "lic",
    character: { status: "active", licensor_id: "lic" },
  };
  assert.deepEqual(appendPayload(entry), {
    asset_id: "a",
    character_id: "new",
    source: "ai",
    model: null,
    tagged_at: "2020-01-01",
  });
  assert.equal(pre.links[0].source, "manual");
  assert.throws(() => appendPayload({ ...entry, model: "invented" }));
});
test("any changed source tag, asset, canonical or legacy link fails before append", () => {
  verifyPreimage(pre, structuredClone(pre), {});
  for (const key of ["asset", "tags", "links", "legacy"]) {
    const changed = structuredClone(pre);
    if (key === "asset") changed.asset.id = "different";
    else changed[key].push({ different: true });
    assert.throws(() => verifyPreimage(pre, changed, {}));
  }
  assert.throws(() =>
    verifyPreimage(pre, pre, { owner: { external_job: { asset_ids: ["a"] } } }),
  );
});

test("overlapping resolver work cannot assign another asset its append outcome", async () => {
  const manifest = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const oldStart = manifest.length;
  const noMatch = (async () => {
    await gate;
    return assetOutcome(manifest, "no-match");
  })();
  const match = (async () => {
    manifest.push({ assetId: "matched", characterId: "new" });
    release();
    return assetOutcome(manifest, "matched");
  })();
  const [empty, linked] = await Promise.all([noMatch, match]);
  assert.equal(
    manifest.length - oldStart,
    1,
    "the old global delta falsely reports an append for the no-match resolver",
  );
  assert.equal(empty.outcome, "no_missing_unambiguous_new_character");
  assert.equal(empty.appends, 0);
  assert.equal(linked.outcome, "append_missing_links");
  assert.equal(linked.appends, 1);
  assert.equal(empty.appends + linked.appends, manifest.length);
});

test("post-read transport failure preserves saved insert response and exact recovery preimage", async () => {
  const { appendWithCustody } = await import(
    "./relink-existing-ai-characters-safety.mjs"
  );
  const record = {
      preimage: structuredClone(pre),
      payload: [{ asset_id: "a", character_id: "new" }],
    },
    saved = [];
  await assert.rejects(
    appendWithCustody({
      record,
      persist: () => saved.push(structuredClone(record)),
      append: async () => ({
        data: [{ asset_id: "a", character_id: "new" }],
        error: null,
      }),
      readPostimages: [
        async () => ({ data: { id: "a" }, error: null }),
        async () => {
          throw Object.assign(Error("injected post-read failure"), {
            code: "ECONNRESET",
          });
        },
      ],
      verify: (raw) => {
        assert.equal(raw[1].status, "rejected");
        throw Error("post-read not verified");
      },
    }),
  );
  const last = saved.at(-1);
  assert.deepEqual(last.preimage, pre);
  assert.equal(last.insertResponse.data[0].character_id, "new");
  assert.equal(last.rawPostReads[1].error.code, "ECONNRESET");
  assert.equal(last.phase, "raw_postimages_saved");
  assert.equal(saved[0].phase, "intent_saved");
});

test("unknown insert outcome is recorded without claiming rollback or replaying", async () => {
  const { appendWithCustody } = await import(
    "./relink-existing-ai-characters-safety.mjs"
  );
  let calls = 0;
  const record = { preimage: pre },
    saved = [];
  await assert.rejects(
    appendWithCustody({
      record,
      persist: () => saved.push(structuredClone(record)),
      append: async () => {
        calls++;
        throw Object.assign(Error("lost response"), { code: "ECONNRESET" });
      },
      readPostimages: [],
      verify: () => {},
    }),
  );
  assert.equal(calls, 1);
  assert.equal(saved.at(-1).phase, "unconfirmed_commit");
  assert.deepEqual(saved.at(-1).preimage, pre);
});

test("timestamp equality preserves all six fractional digits and nested JSON arrays retain order", () => {
  assert.equal(
    pgTimestamp("2020-01-01T00:00:00.123456+00:00"),
    pgTimestamp("2019-12-31T19:00:00.123456-05:00"),
  );
  assert.notEqual(
    pgTimestamp("2020-01-01T00:00:00.123456Z"),
    pgTimestamp("2020-01-01T00:00:00.123457Z"),
  );
  const expected = structuredClone(pre);
  expected.tags[0].evidence = ["first", "second"];
  const changed = structuredClone(expected);
  changed.tags[0].evidence.reverse();
  assert.throws(() => verifyPreimage(expected, changed, {}), /tags/);
  const unordered = structuredClone(expected);
  unordered.tags.push({ id: "other" });
  const reordered = structuredClone(unordered);
  reordered.tags.reverse();
  verifyPreimage(unordered, reordered, {});
});
