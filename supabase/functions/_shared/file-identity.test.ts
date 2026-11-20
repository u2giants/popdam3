import { describe, expect, it } from "vitest";
import { artworkMatchTier, type FileIdentity, moveMatchTier } from "./file-identity.ts";

const rec = (over: Partial<FileIdentity>): FileIdentity => ({
  id: "a1",
  relative_path: "Decor/x/old-name.ai",
  filename: "old-name.ai",
  file_size: 100,
  quick_hash: "qh",
  nas_volume: "mac",
  nas_ino: "123456789012345",
  content_sha256: "sha",
  is_deleted: false,
  ...over,
});

describe("moveMatchTier (the record follows the file)", () => {
  it("same inode proves a same-volume rename even when the name changed", () => {
    const renamed = rec({ id: "b1", relative_path: "Decor/y/new-name.ai", filename: "new-name.ai" });
    expect(moveMatchTier(rec({}), renamed)).toBe("inode");
    expect(moveMatchTier(renamed, rec({}))).toBe("inode");
  });

  it("same inode proves a folder move", () => {
    const moved = rec({ id: "b1", relative_path: "Decor/other/old-name.ai" });
    expect(moveMatchTier(rec({}), moved)).toBe("inode");
  });

  it("refuses the inode when both the name and the size differ (inode reuse)", () => {
    const reuse = rec({ id: "z1", relative_path: "Decor/y/unrelated.pdf", filename: "unrelated.pdf", file_size: 7, content_sha256: "other" });
    expect(moveMatchTier(rec({}), reuse)).toBeNull();
    // size agreeing is enough (a renamed file keeps its size)
    const renamedSameSize = rec({ id: "z2", relative_path: "Decor/y/new-name.ai", filename: "new-name.ai" });
    expect(moveMatchTier(rec({}), renamedSameSize)).toBe("inode");
  });

  it("content tier needs the exact disk basename — a renamed copy is its own file", () => {
    const old = rec({ nas_volume: null, nas_ino: null });
    const crossVolumeMove = rec({ id: "b1", nas_volume: "backup", nas_ino: "999", relative_path: "other/old-name.ai" });
    const renamedCopy = rec({ id: "c1", nas_volume: "backup", nas_ino: "998", relative_path: "other/copy-name.ai", filename: "copy-name.ai" });
    expect(moveMatchTier(old, crossVolumeMove)).toBe("content_hash");
    expect(moveMatchTier(old, renamedCopy)).toBeNull();
  });

  it("no identity on either side means no move proof", () => {
    const bare = rec({ nas_volume: null, nas_ino: null, content_sha256: null });
    const otherBare = rec({ id: "b1", nas_volume: null, nas_ino: null, content_sha256: null, relative_path: "Decor/y/old-name.ai" });
    expect(moveMatchTier(bare, otherBare)).toBeNull();
  });
});

describe("artworkMatchTier (does the artwork survive elsewhere)", () => {
  it("content identity is name-free: a renamed copy still holds the artwork", () => {
    const old = rec({ nas_volume: null, nas_ino: null });
    const renamedCopy = rec({ id: "c1", nas_volume: "backup", nas_ino: "998", relative_path: "other/copy-name.ai", filename: "copy-name.ai" });
    expect(artworkMatchTier(old, renamedCopy)).toBe("content_hash");
  });

  it("falls back to the colliding hint (name, size, quick_hash)", () => {
    const old = rec({ nas_volume: null, nas_ino: null, content_sha256: null });
    const hintTwin = rec({ id: "h1", nas_volume: null, nas_ino: null, content_sha256: null, relative_path: "Decor/y/old-name.ai" });
    expect(artworkMatchTier(old, hintTwin)).toBe("hint");
  });

  it("quick_hash alone is not proof — the name and size must agree", () => {
    const old = rec({ nas_volume: null, nas_ino: null, content_sha256: null });
    const collision = rec({
      id: "h2",
      nas_volume: null,
      nas_ino: null,
      content_sha256: null,
      relative_path: "Decor/y/other-name.ai",
      filename: "other-name.ai",
    });
    expect(artworkMatchTier(old, collision)).toBeNull();
  });

  it("0-byte files never prove by hint (constant hash)", () => {
    const empty = rec({ nas_volume: null, nas_ino: null, content_sha256: null, file_size: 0, quick_hash: "empty-hash" });
    const emptyTwin = rec({
      id: "e1",
      nas_volume: null,
      nas_ino: null,
      content_sha256: null,
      file_size: 0,
      quick_hash: "empty-hash",
      relative_path: "Decor/y/old-name.ai",
    });
    expect(artworkMatchTier(empty, emptyTwin)).toBeNull();
  });
});
