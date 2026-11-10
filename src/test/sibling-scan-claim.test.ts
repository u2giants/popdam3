import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Finished sibling-scan rows are never deleted. The claim query must filter to
// open requests, or old finished rows fill its window and nothing is claimed.
it("claim-sibling-scan only reads open requests", () => {
  const src = readFileSync("supabase/functions/agent-api/index.ts", "utf8");
  const start = src.indexOf("async function handleClaimSiblingScan");
  const fn = src.slice(start, src.indexOf("async function", start + 10));
  expect(fn).toContain('.in("value->>status", ["pending", "claimed"])');
});
