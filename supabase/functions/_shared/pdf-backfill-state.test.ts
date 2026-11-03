import { describe, expect, it } from "vitest";
import { isPdfBackfillComplete, isPdfRescanMode, isPdfRescanQuietHour } from "./pdf-backfill-state.ts";

describe("PDF backfill completion", () => {
  it("remains running while authoritative work remains", () => {
    expect(isPdfBackfillComplete(2)).toBe(false);
    expect(isPdfBackfillComplete(1)).toBe(false);
  });

  it("completes only when the authoritative remainder drains", () => {
    expect(isPdfBackfillComplete(0)).toBe(true);
  });
});

describe("PDF rescan state", () => {
  it("recognises rescan mode only when set", () => {
    expect(isPdfRescanMode({ mode: "indra_rescan" })).toBe(true);
    expect(isPdfRescanMode({})).toBe(false);
    expect(isPdfRescanMode(undefined)).toBe(false);
  });

  it("yields around the nightly grouping job in New York time", () => {
    expect(isPdfRescanQuietHour(new Date("2026-11-03T06:00:00Z"))).toBe(true); // 1:00 AM EST
    expect(isPdfRescanQuietHour(new Date("2026-11-03T05:29:00Z"))).toBe(false); // 12:29 AM EST
    expect(isPdfRescanQuietHour(new Date("2026-11-03T08:00:00Z"))).toBe(false); // 3:00 AM EST
    expect(isPdfRescanQuietHour(new Date("2026-11-03T15:00:00Z"))).toBe(false);
  });
});
