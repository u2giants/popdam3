import { describe, expect, it } from "vitest";
import { filterStyleTrackerCandidates, scoreStyleTrackerCandidate } from "@/lib/style-tracker-candidates";

const candidate = (label: string, score = 0, table = "licensor") => ({
  target_schema: "core",
  target_table: table,
  target_id: label,
  target_label: label,
  score,
});

describe("style tracker candidate filtering", () => {
  it("keeps NBC as the only plausible licensor candidate for NBC Universal", () => {
    const results = filterStyleTrackerCandidates("NBC Universal", [
      candidate("NBC"),
      candidate("DTR - NO LICENSE"),
      candidate("AARDMAN ANIMATIONS"),
      candidate("CARE BEARS"),
      candidate("COCA COLA"),
      candidate("DC"),
      candidate("DISNEY"),
      candidate("FRIENDS TV"),
      candidate("HARRY POTTER"),
      candidate("MARVEL"),
      candidate("PAW PATROL"),
      candidate("PEANUTS WORLDWIDE"),
    ]);

    expect(results.map((item) => item.target_label)).toEqual(["NBC"]);
  });

  it("accepts exact and near-exact fuzzy candidates", () => {
    expect(scoreStyleTrackerCandidate("DISNY", "DISNEY")).toBeGreaterThanOrEqual(0.65);
    expect(filterStyleTrackerCandidates("DISNY", [candidate("DISNEY"), candidate("MARVEL")]).map((item) => item.target_label)).toEqual(["DISNEY"]);
  });

  it("does not rescue unrelated all-mode candidates just because the database returned them", () => {
    const results = filterStyleTrackerCandidates("NBC Universal", [
      candidate("NBC", 0.1),
      candidate("MARVEL", 0.35),
      candidate("DISNEY", 0.35),
    ]);

    expect(results.map((item) => item.target_label)).toEqual(["NBC"]);
  });

  it.each([
    ["Disney", ["DISNEY", "MARVEL", "NBC"], ["DISNEY"]],
    ["Walt Disney", ["DISNEY", "MARVEL", "NBC"], ["DISNEY"]],
    ["Marvel Entertainment", ["MARVEL", "DISNEY", "NBC"], ["MARVEL"]],
    ["DC Comics", ["DC", "DISNEY", "NBC"], ["DC"]],
    ["Warner Bros", ["WARNER BROTHERS", "DISNEY", "MARVEL"], ["WARNER BROTHERS"]],
  ])("keeps plausible licensor matches for %s", (rawValue, labels, expected) => {
    expect(filterStyleTrackerCandidates(rawValue, labels.map((label) => candidate(label))).map((item) => item.target_label)).toEqual(expected);
  });

  it.each([
    ["Ross", ["Ross Stores", "Target", "Walmart"], ["Ross Stores"]],
    ["Ross Stores Inc", ["Ross Stores", "Target", "Walmart"], ["Ross Stores"]],
    ["Target Corp", ["Target", "Walmart", "Ross Stores"], ["Target"]],
    ["Wal Mart", ["Walmart", "Target", "Ross Stores"], ["Walmart"]],
  ])("keeps plausible customer matches for %s", (rawValue, labels, expected) => {
    const results = filterStyleTrackerCandidates(rawValue, labels.map((label) => candidate(label, 0, "customer")));
    expect(results.map((item) => item.target_label)).toEqual(expected);
  });
});
