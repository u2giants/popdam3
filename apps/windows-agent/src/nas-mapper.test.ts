import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSmbMappingScript } from "./nas-mapper";

test("mapping script reads credentials from env, not literals", () => {
  const s = buildSmbMappingScript(true, true);
  assert.match(s, /\$env:POPDAM_NAS_PASS/);
  assert.match(s, /\$p\.LocalPath=\$env:POPDAM_NAS_DRIVE/);
  assert.match(s, /New-SmbMapping @p/);
});

test("UNC mode without username omits LocalPath and credentials", () => {
  const s = buildSmbMappingScript(false, false);
  assert.doesNotMatch(s, /LocalPath|Password|UserName/);
});
