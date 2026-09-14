import { describe, expect, it } from "vitest";
import { isPdfBackfillComplete } from "./pdf-backfill-state.ts";

describe("PDF backfill completion", () => {
  it("remains running while authoritative work remains", () => {
    expect(isPdfBackfillComplete(2)).toBe(false);
    expect(isPdfBackfillComplete(1)).toBe(false);
  });

  it("completes only when the authoritative remainder drains", () => {
    expect(isPdfBackfillComplete(0)).toBe(true);
  });
});
