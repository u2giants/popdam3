import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("@shared/constants", () => ({
  FORBIDDEN_ROOT_PREFIXES_WIN: ["C:\\"],
  FORBIDDEN_ROOT_PREFIXES_MAC: ["/"],
  ROOT_MARKER_FILENAME: "pop-root.json",
}));

const { validateRoot, writeMarker } = await import("./rootValidator");

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "rootvalidator-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("validateRoot (async, #232)", () => {
  it("accepts a folder carrying the matching marker", async () => {
    await writeMarker(base, "decor");
    await expect(validateRoot(base, "decor")).resolves.toEqual({ ok: true, resolvedPath: base });
  });

  it("reports a wrong root id", async () => {
    await writeMarker(base, "apparel");
    const r = await validateRoot(base, "decor");
    expect(r).toMatchObject({ ok: false, reason: "wrong_root_id", actual: "apparel" });
  });

  it("suggests the root when a subfolder was chosen", async () => {
    await writeMarker(base, "decor");
    const sub = join(base, "a", "b");
    await mkdir(sub, { recursive: true });
    const r = await validateRoot(sub, "decor");
    expect(r).toMatchObject({ ok: false, reason: "too_deep", suggestedPath: base });
  });

  it("suggests the root when a parent folder was chosen", async () => {
    const child = join(base, "Shared with groups", "Team", "Decor");
    await mkdir(child, { recursive: true });
    await writeMarker(child, "decor");
    const r = await validateRoot(base, "decor");
    expect(r).toMatchObject({ ok: false, reason: "too_shallow", suggestedPath: child });
  });

  it("treats an unreadable marker as missing", async () => {
    await writeFile(join(base, "pop-root.json"), "{not json", "utf-8");
    const r = await validateRoot(base, "decor");
    expect(r).toMatchObject({ ok: false, reason: "no_marker" });
  });

  it("flags a SeaDrive account folder without a marker", async () => {
    await mkdir(join(base, "My Libraries"));
    const r = await validateRoot(base, "decor");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/SeaDrive account folder/);
  });
});
