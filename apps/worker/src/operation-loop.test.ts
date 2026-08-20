import assert from "node:assert/strict";
import test from "node:test";
import { scopeSingleAssetTag } from "./operation-loop.js";

const ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";

test("single-asset operation derives its scope from the operation key", () => {
  const scoped = scopeSingleAssetTag(`ai-tag-single-${ASSET_ID}`, { status: "running" });

  assert.deepEqual(scoped?.params?.asset_ids, [ASSET_ID]);
});

test("single-asset operation key remains authoritative when params disagree", () => {
  const scoped = scopeSingleAssetTag(`ai-tag-single-${ASSET_ID}`, {
    status: "running",
    params: { asset_ids: ["223e4567-e89b-42d3-a456-426614174001"] },
  });

  assert.deepEqual(scoped?.params?.asset_ids, [ASSET_ID]);
});

test("malformed single-asset operation keys are rejected", () => {
  assert.equal(scopeSingleAssetTag("ai-tag-single-not-a-uuid", { status: "running" }), null);
});
