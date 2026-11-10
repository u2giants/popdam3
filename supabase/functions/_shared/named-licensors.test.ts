import { describe, expect, it } from "vitest";
import { namedLicensorIds, withSemanticLicensorScope } from "./named-licensors.ts";

const licensors = [
  { id: "b", name: "Acme Studios" },
  { id: "a", name: "ZORB" },
  { id: "c", name: "" },
];

describe("namedLicensorIds", () => {
  it("finds a whole licensor name anywhere in the search, ignoring case and punctuation", () => {
    expect(namedLicensorIds(["acme-studios toy chest"], licensors)).toEqual(["b"]);
    expect(namedLicensorIds(["Toy chest ZORB"], licensors)).toEqual(["a"]);
  });
  it("needs word boundaries and the whole name", () => {
    expect(namedLicensorIds(["zorbing ball"], licensors)).toEqual([]);
    expect(namedLicensorIds(["acme toy chest"], licensors)).toEqual([]);
  });
  it("also reads the corrected spelling and never matches a blank name", () => {
    expect(namedLicensorIds(["zorrb rug", "zorb rug", null], licensors)).toEqual(["a"]);
    expect(namedLicensorIds(["", null, undefined], licensors)).toEqual([]);
  });
});

describe("withSemanticLicensorScope", () => {
  it("adds the scope only to picture searches that name a licensor", () => {
    expect(withSemanticLicensorScope({ stage: "x" }, ["a"], true)).toEqual({ stage: "x", semanticLicensorIds: ["a"] });
    expect(withSemanticLicensorScope({ stage: "x" }, ["a"], false)).toEqual({ stage: "x" });
    expect(withSemanticLicensorScope({ stage: "x" }, [], true)).toEqual({ stage: "x" });
  });
  it("leaves an explicit licensor filter alone", () => {
    expect(withSemanticLicensorScope({ licensorId: "z" }, ["a"], true)).toEqual({ licensorId: "z" });
  });
});
