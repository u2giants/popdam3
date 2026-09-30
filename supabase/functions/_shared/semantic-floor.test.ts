import { parseSemanticFloor } from "./semantic-floor.ts";

describe("parseSemanticFloor", () => {
  it("returns null when unset", () => {
    expect(parseSemanticFloor(null)).toBeNull();
    expect(parseSemanticFloor(undefined)).toBeNull();
    expect(parseSemanticFloor({ value: null })).toBeNull();
    expect(parseSemanticFloor("")).toBeNull();
    expect(parseSemanticFloor({ value: "  " })).toBeNull();
  });
  it("accepts raw and wrapped numbers in 0..1", () => {
    expect(parseSemanticFloor(0.42)).toBe(0.42);
    expect(parseSemanticFloor({ value: 0.3 })).toBe(0.3);
    expect(parseSemanticFloor("0.5")).toBe(0.5);
    expect(parseSemanticFloor(0)).toBe(0);
    expect(parseSemanticFloor(1)).toBe(1);
  });
  it("rejects invalid values", () => {
    expect(parseSemanticFloor(-0.1)).toBeNull();
    expect(parseSemanticFloor(1.5)).toBeNull();
    expect(parseSemanticFloor("abc")).toBeNull();
    expect(parseSemanticFloor(true)).toBeNull();
    expect(parseSemanticFloor({ value: [0.3] })).toBeNull();
  });
});
