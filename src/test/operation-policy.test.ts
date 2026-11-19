import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { getLane as uiLane } from "../components/settings/diagnostics/types";
import { getLane as edgeLane } from "../../supabase/functions/_shared/operation-constants";

it.each([uiLane, edgeLane])("keeps DAM and PopSG in the same manual-start lane", (getLane) => {
  expect(getLane("embed-dam-search")).toBe("search-index");
  expect(getLane("sg-embed-search")).toBe("search-index");
  expect(getLane("future-operation")).toBe("future-operation");
  expect(getLane("ai-tag-single-fixture")).toBe("ai-tag-single-fixture");
});

it.each(["js", "d.ts"])("ships the same operation policy %s to Railway", (extension) => {
  const canonical = readFileSync(`supabase/functions/_shared/operation-policy.${extension}`, "utf8");
  const vendored = readFileSync(`apps/worker/vendor/operation-policy.${extension}`, "utf8");
  expect(vendored).toBe(canonical);
});
