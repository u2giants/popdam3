import { describe, expect, it, vi } from "vitest";
import { checkoutBatch, parseCheckoutBatch } from "../../apps/popdam-helper/src/shared/checkoutBatch";

describe("Helper batch checkout", () => {
  const a = "a".repeat(32), b = "b".repeat(32), c = "c".repeat(32);
  it("accepts bounded distinct tokens and rejects malformed, empty, duplicate and oversized input", () => {
    expect(parseCheckoutBatch(`${a},${b}`)).toEqual([a, b]);
    for (const input of ["", "bogus", `${a},${a}`, Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(32, "0")).join(",")]) {
      expect(parseCheckoutBatch(input)).toBeNull();
    }
  });
  it("continues later files when an earlier checkout fails and reports the failure", async () => {
    const checkout = vi.fn(async (token: string) => { if (token === b) throw new Error("Locked"); });
    await expect(checkoutBatch([a, b, c], checkout)).rejects.toThrow("1 file(s)");
    expect(checkout.mock.calls.map(([token]) => token)).toEqual([a, b, c]);
  });
});
