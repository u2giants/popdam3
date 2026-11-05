import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { HELPER_VERSION } from "../../apps/popdam-helper/src/shared/constants";
it("reports the installed Helper release version to the server", () => {
  const release = JSON.parse(readFileSync("apps/popdam-helper/package.json", "utf8"));
  expect(HELPER_VERSION).toBe(release.version);
});
