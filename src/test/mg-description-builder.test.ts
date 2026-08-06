import { describe, expect, it } from "vitest";
import { getMg01Options, getMg02Options, getMg03Options } from "@/lib/mg-lookup";

describe("Master Data MG description options", () => {
  it("provides the three human-readable MG levels in dependent order", () => {
    const mg01 = getMg01Options().find((option) => option.code === "B");
    expect(mg01?.name).toBe("Framed");

    const mg02 = getMg02Options(mg01?.code).find((option) => option.code === "G");
    expect(mg02?.name).toBe("Glass");

    const mg03 = getMg03Options(mg01?.code, mg02?.code).find((option) => option.code === "F");
    expect(mg03?.name).toBe("Printed");
  });

  it("does not offer child choices until their parents are selected", () => {
    expect(getMg02Options(null)).toEqual([]);
    expect(getMg03Options("B", null)).toEqual([]);
  });
});
