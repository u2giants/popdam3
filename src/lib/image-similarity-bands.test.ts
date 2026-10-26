import { describe, expect, it } from "vitest";
import { bandForScore, BAND_LABELS, IMAGE_SIM_DEFAULTS } from "./image-similarity-config";

// Plan Step 10: band tests at exactly 0.98 / 0.94 / 0.90 / 0.89 (hidden).
// The RPC returns percentages (0-100), so the boundaries land at 98.0/94.0/90.0.

describe("bandForScore", () => {
  it("labels 98.0 and above as same export", () => {
    expect(bandForScore(100)).toBe("same_export");
    expect(bandForScore(98.0)).toBe("same_export");
    expect(bandForScore(97.9)).not.toBe("same_export");
  });

  it("labels 94.0..97.9 as same artwork", () => {
    expect(bandForScore(94.0)).toBe("same_art");
    expect(bandForScore(97.9)).toBe("same_art");
    expect(bandForScore(93.9)).not.toBe("same_art");
  });

  it("labels 90.0..93.9 as close match", () => {
    expect(bandForScore(90.0)).toBe("close");
    expect(bandForScore(93.9)).toBe("close");
  });

  it("hides 89.9 and below at the default floor", () => {
    expect(bandForScore(89.9)).toBeNull();
    expect(bandForScore(50)).toBeNull();
    expect(bandForScore(0)).toBeNull();
  });

  it("shows a review band only when the floor is lowered below the close band", () => {
    expect(bandForScore(89.9, { floor: 0.85 })).toBe("review");
    expect(bandForScore(85.0, { floor: 0.85 })).toBe("review");
    expect(bandForScore(84.9, { floor: 0.85 })).toBeNull();
    expect(BAND_LABELS.review).toBe("Below bands — review");
  });

  it("keeps the locked default cutoffs", () => {
    expect(IMAGE_SIM_DEFAULTS.bandSameExport).toBe(0.98);
    expect(IMAGE_SIM_DEFAULTS.bandSameArt).toBe(0.94);
    expect(IMAGE_SIM_DEFAULTS.bandClose).toBe(0.9);
    expect(IMAGE_SIM_DEFAULTS.floor).toBe(0.9);
    expect(IMAGE_SIM_DEFAULTS.dinoWeight).toBe(0.6);
    expect(IMAGE_SIM_DEFAULTS.topK).toBe(200);
  });

  it("supports admin-retuned bands without a redeploy", () => {
    expect(bandForScore(96.0, { sameExport: 0.95, sameArt: 0.92, close: 0.88, floor: 0.88 })).toBe("same_export");
    expect(bandForScore(92.5, { sameExport: 0.95, sameArt: 0.92, close: 0.88, floor: 0.88 })).toBe("same_art");
    expect(bandForScore(88.0, { sameExport: 0.95, sameArt: 0.92, close: 0.88, floor: 0.88 })).toBe("close");
    expect(bandForScore(87.0, { sameExport: 0.95, sameArt: 0.92, close: 0.88, floor: 0.80 })).toBe("review");
  });
});
