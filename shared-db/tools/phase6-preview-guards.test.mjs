import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  EXPECTED_COLDLION_REFS,
  EXPECTED_LINKED_LICENSORS,
  EXPECTED_LINKED_PROPERTIES,
  COLDLION_SOURCE_NAME,
  DESIGNFLOW_SOURCE_NAME,
  DESIGNFLOW_SOURCE_SYSTEM,
  resolveRunMode,
  describeTarget,
  assertPreviewApplyTarget,
  assertNoProductionEnv,
} from "./phase6-preview-guards.mjs";

test("Phase 4 link pins match the approved set", () => {
  assert.equal(EXPECTED_COLDLION_REFS, 542);
  assert.equal(EXPECTED_LINKED_LICENSORS, 38);
  assert.equal(EXPECTED_LINKED_PROPERTIES, 504);
});

test("source name constants match importer contracts", () => {
  assert.equal(COLDLION_SOURCE_NAME, "coldlion_licensors_properties_api");
  assert.equal(DESIGNFLOW_SOURCE_SYSTEM, "designflow_plm");
  assert.equal(DESIGNFLOW_SOURCE_NAME, "plm_master_data_api");
});

test("resolveRunMode defaults to dry-run", () => {
  const mode = resolveRunMode([], {});
  assert.equal(mode.apply, false);
  assert.equal(mode.willWriteDb, false);
  assert.equal(mode.forceFail, false);
});

test("resolveRunMode detects --apply --linked --force-fail", () => {
  const mode = resolveRunMode(["--apply", "--linked", "--force-fail"], {});
  assert.equal(mode.apply, true);
  assert.equal(mode.linked, true);
  assert.equal(mode.forceFail, true);
});

test("describeTarget never echoes passwords", () => {
  const label = describeTarget("postgresql://user:supersecret@host:6543/db");
  assert.doesNotMatch(label, /supersecret/);
  assert.match(label, /\*\*\*/);
});

test("project refs are fixed", () => {
  assert.equal(PREVIEW_PROJECT_REF, "rjyboqwcdzcocqgmsyel");
  assert.equal(PRODUCTION_PROJECT_REF, "qsllyeztdwjgirsysgai");
});

test("assertPreviewApplyTarget rejects mixed linked+url", () => {
  assert.throws(
    () =>
      assertPreviewApplyTarget({
        apply: true,
        linked: true,
        connString: "postgresql://x",
        linkedProjectRef: PREVIEW_PROJECT_REF,
      }),
    /both --linked and DATABASE_URL/,
  );
});

test("assertNoProductionEnv allows clean env", () => {
  assert.doesNotThrow(() => assertNoProductionEnv({}));
});
