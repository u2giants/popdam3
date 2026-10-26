import { describe, expect, it } from "vitest";
import { conceptMatchScore, sortByConceptThenRank } from "./search-concept-rank";

describe("conceptMatchScore", () => {
  it("scores spider-man mats as character + product", () => {
    expect(conceptMatchScore("spiderman floor covering", "Marvel Spiderman Crumb Rubber Mat Door Mat")).toBe(4);
  });
  it("scores deadpool mats as product only", () => {
    expect(conceptMatchScore("spiderman floor covering", "Deadpool Welcome Coir Mat")).toBe(2);
  });
  it("scores spider-man clocks as character only", () => {
    expect(conceptMatchScore("spiderman floor covering", "Spider-Man Wall Clock")).toBe(2);
  });
});

describe("sortByConceptThenRank", () => {
  const rows = [
    { id: "deadpool-mat", text: "Deadpool Welcome Coir Mat" },
    { id: "spider-clock", text: "Spider-Man Wall Clock" },
    { id: "spider-mat", text: "Marvel Spiderman Outdoor Mat" },
    { id: "kitchen-rug", text: "Eat The Universe Popsicles Runner Rug" },
  ];
  it("puts spider-man mats first for spiderman floor covering", () => {
    const sorted = sortByConceptThenRank(rows, "spiderman floor covering", (r) => r.text);
    expect(sorted[0].id).toBe("spider-mat");
  });
  it("leaves order alone for a plain SKU query", () => {
    const sorted = sortByConceptThenRank(rows, "3FZ93MVGR01", (r) => r.text);
    expect(sorted.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});
