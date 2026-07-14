import assert from "node:assert/strict";
import test from "node:test";
import { AiTagCursorError, decodeAiTagCursor, encodeAiTagCursor, isAiTagCursor } from "./ai-tag-cursor.js";

const ID = "123e4567-e89b-42d3-a456-426614174000";

test("AI tag cursor round trips", () => {
  const encoded = encodeAiTagCursor({ tier: 2, id: ID });
  assert.equal(encoded, `ai1:2:${ID}`);
  assert.deepEqual(decodeAiTagCursor(encoded), { tier: 2, id: ID });
  assert.equal(isAiTagCursor(encoded), true);
});

test("zero starts a new run and positive numeric cursors are legacy", () => {
  assert.equal(decodeAiTagCursor(0), null);
  assert.throws(
    () => decodeAiTagCursor(60),
    (error: unknown) => error instanceof AiTagCursorError && error.code === "legacy_cursor",
  );
});

test("malformed and unknown-version cursors are rejected", () => {
  for (const raw of ["ai2:2:" + ID, "ai1:nope:" + ID, "ai1:2:not-a-uuid"]) {
    assert.throws(() => decodeAiTagCursor(raw), AiTagCursorError);
    assert.equal(isAiTagCursor(raw), false);
  }
});
