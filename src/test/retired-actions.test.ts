import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");
it("retains worker classification and removes only its retired HTTP stub", () => {
  expect(read("supabase/functions/admin-api/index.ts")).not.toContain("handleClassifyErpCategories");
  expect(read("supabase/functions/admin-api/index.ts")).not.toContain('"classify-erp-categories"');
  expect(read("apps/worker/src/operation-loop.ts")).toContain('case "erp-classify"');
});
it("has no no-op Helper logs route or unused client", () => {
  expect(read("supabase/functions/helper-api/index.ts")).not.toContain('"/logs"');
  expect(read("apps/popdam-helper/src/main/damClient.ts")).not.toContain("sendLog");
});
