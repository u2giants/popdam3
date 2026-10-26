import { describe, expect, it } from "vitest";
import {
  buildModelStamps,
  parseFlag,
  parseNumber01,
  parsePositiveInt,
  resolveTunables,
  sniffMagicBytes,
  validateUploadPayload,
} from "./image-similarity-config.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);

describe("validateUploadPayload", () => {
  it("accepts known magic bytes", () => {
    expect(validateUploadPayload(JPEG)).toMatchObject({ ok: true, format: "JPEG" });
    expect(validateUploadPayload(PNG)).toMatchObject({ ok: true, format: "PNG" });
    expect(validateUploadPayload(WEBP)).toMatchObject({ ok: true, format: "WEBP" });
  });

  it("rejects non-images with 400 (HTML/SVG polyglot, TIFF, PSD)", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]);
    const psd = new TextEncoder().encode("8BPS \x00\x00\x00\x00");
    for (const bad of [html, tiff, psd]) {
      const result = validateUploadPayload(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.httpStatus).toBe(400);
    }
  });

  it("rejects oversize with 413 and empty with 400", () => {
    const oversized = new Uint8Array(15 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff], 0);
    const over = validateUploadPayload(oversized);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.httpStatus).toBe(413);
    const empty = validateUploadPayload(new Uint8Array(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.httpStatus).toBe(400);
  });

  it("sniffs a truncated-but-magicked file as its format (poller re-validates decode)", () => {
    expect(sniffMagicBytes(JPEG.subarray(0, 3))).toBe("JPEG");
    expect(sniffMagicBytes(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("resolveTunables", () => {
  it("falls back to locked defaults on missing rows", () => {
    const t = resolveTunables(null);
    expect(t.floor).toBe(0.9);
    expect(t.dinoWeight).toBe(0.6);
    expect(t.topK).toBe(200);
  });

  it("reads wrapped and raw admin_config values and clamps out-of-range", () => {
    const t = resolveTunables([
      { key: "IMAGE_SIM_FLOOR", value: { value: "0.85" } },
      { key: "IMAGE_SIM_DINO_WEIGHT", value: "7" }, // clamped to 1
      { key: "IMAGE_SIM_TOP_K", value: "5000" }, // clamped to 1000
      { key: "IMAGE_SIM_EMBEDDING_MODEL", value: { value: "stamp-a" } },
    ]);
    expect(t.floor).toBe(0.85);
    expect(t.dinoWeight).toBe(1);
    expect(t.topK).toBe(1000);
    expect(t.modelStamps).toEqual(["stamp-a"]);
  });
});

describe("buildModelStamps", () => {
  it("returns only the current stamp during normal operation", () => {
    expect(buildModelStamps([
      { key: "IMAGE_SIM_EMBEDDING_MODEL", value: "stamp-a" },
      { key: "IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS", value: "stamp-old" },
    ])).toEqual(["stamp-a"]);
  });

  it("adds the previous stamp while a re-embed is in progress (empty-search window)", () => {
    expect(buildModelStamps([
      { key: "IMAGE_SIM_EMBEDDING_MODEL", value: "stamp-a" },
      { key: "IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS", value: "stamp-old" },
      { key: "IMAGE_SIM_REEMBED_IN_PROGRESS", value: true },
    ]).sort()).toEqual(["stamp-a", "stamp-old"]);
  });

  it("is empty before any stamp exists (nothing indexed yet)", () => {
    expect(buildModelStamps(null)).toEqual([]);
  });
});

describe("parse helpers", () => {
  it("parses flags tolerantly", () => {
    expect(parseFlag(true)).toBe(true);
    expect(parseFlag("TRUE")).toBe(true);
    expect(parseFlag("false")).toBe(false);
    expect(parseFlag(undefined)).toBe(false);
  });

  it("clamps numbers into 0..1 and ints into range", () => {
    expect(parseNumber01("1.5", 0.5)).toBe(1);
    expect(parseNumber01(-2, 0.5)).toBe(0);
    expect(parseNumber01("junk", 0.5)).toBe(0.5);
    expect(parsePositiveInt("0", 200, 1000)).toBe(200);
    expect(parsePositiveInt("150", 200, 1000)).toBe(150);
  });
});
