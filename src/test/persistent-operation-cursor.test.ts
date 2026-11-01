import { describe, expect, it } from "vitest";
import { isResumableOperationCursor } from "@/hooks/usePersistentOperation";

describe("persistent operation cursor validation", () => {
  const cursor = "ai1:2:123e4567-e89b-42d3-a456-426614174000";

  it("accepts an opaque AI keyset cursor", () => {
    expect(isResumableOperationCursor("ai-tag-untagged", cursor)).toBe(true);
  });

  it("rejects legacy positive offsets and malformed strings for AI tagging", () => {
    expect(isResumableOperationCursor("ai-tag-untagged", 60)).toBe(false);
    expect(isResumableOperationCursor("ai-tag-all", "not-a-cursor")).toBe(false);
  });

  it("retains numeric cursor support for existing operations", () => {
    expect(isResumableOperationCursor("erp-enrichment", 60)).toBe(true);
  });
  it("allows resuming an AI run stopped during its first page (cursor 0), so its saved provider job is kept", () => {
    expect(isResumableOperationCursor("ai-tag-untagged", 0)).toBe(true);
    expect(isResumableOperationCursor("ai-tag-group-profiles", 0)).toBe(true);
    expect(isResumableOperationCursor("ai-tag-group-profiles", 3)).toBe(false);
  });
});

describe("reprocess-metadata fill mode cursor", () => {
  it("resumes a UUID keyset cursor and still resumes numeric offsets", () => {
    expect(isResumableOperationCursor("reprocess-metadata", "123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isResumableOperationCursor("reprocess-metadata", 500)).toBe(true);
    expect(isResumableOperationCursor("reprocess-metadata", "garbage")).toBe(false);
  });
});

describe("erp-enrichment apply cursor (#630)", () => {
  it("resumes its canonical-item UUID keyset cursor instead of restarting from cursor 0", () => {
    expect(isResumableOperationCursor("erp-enrichment", "22d04f21-aa69-4443-a2b2-913253903176")).toBe(true);
    expect(isResumableOperationCursor("erp-enrichment", "not-a-uuid")).toBe(false);
  });
});
