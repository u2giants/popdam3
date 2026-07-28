// Tests for explicit production authorization on the ColdLion WRITE runners.
//
// The bug these exist for: the Step 7 production package instructed an operator to
// run both write runners against production, where their own preview-only guards
// aborted them. A guard that fails mid-window invites a panic bypass, so production
// is now a first-class authorized mode instead of something to be defeated.

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_AUTHORIZATION_VARIABLE,
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";

import { validateApprovedMapping, loadApprovedMapping } from "./run-coldlion-licensor-property-phase4.mjs";

const FULL = [
  "--apply", "--linked", "--production", "--production-authorized",
  "--project-ref", PRODUCTION_PROJECT_REF,
];
const ENV_ON = { [PRODUCTION_AUTHORIZATION_VARIABLE]: "true" };

// A stand-in for the runner's real preview guard, so we can prove delegation.
function previewGuard({ apply, linked, linkedProjectRef }) {
  if (!apply) return;
  if (!linked || linkedProjectRef !== PREVIEW_PROJECT_REF) {
    throw new Error("preview guard rejected");
  }
}

test("no production flags means the old preview-only behaviour, unchanged", () => {
  const auth = resolveProductionAuthorization([], {});
  assert.deepEqual(auth, { requested: false, authorized: false, missing: [], blocking_reason: null });

  // Delegation: a preview apply still passes, a non-preview apply still fails.
  assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PREVIEW_PROJECT_REF,
    argv: ["--apply", "--linked"], env: {}, assertPreviewApplyTarget: previewGuard,
  });
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PRODUCTION_PROJECT_REF,
    argv: ["--apply", "--linked"], env: {}, assertPreviewApplyTarget: previewGuard,
  }), /preview guard rejected/);
});

test("production requires all four parts and names what is missing", () => {
  const cases = [
    [["--production"], {}, ["--production-authorized", "--project-ref", PRODUCTION_AUTHORIZATION_VARIABLE]],
    [["--production", "--production-authorized"], {}, ["--project-ref", PRODUCTION_AUTHORIZATION_VARIABLE]],
    [["--production", "--production-authorized", "--project-ref", PRODUCTION_PROJECT_REF], {}, [PRODUCTION_AUTHORIZATION_VARIABLE]],
    [["--production", "--project-ref", PRODUCTION_PROJECT_REF], ENV_ON, ["--production-authorized"]],
    [["--production", "--production-authorized", "--project-ref", PREVIEW_PROJECT_REF], ENV_ON, ["--project-ref"]],
  ];
  for (const [argv, env, expectMentions] of cases) {
    const auth = resolveProductionAuthorization(argv, env);
    assert.equal(auth.requested, true);
    assert.equal(auth.authorized, false, `must not authorize: ${argv.join(" ")}`);
    for (const m of expectMentions) {
      assert.ok(auth.blocking_reason.includes(m),
        `blocking reason must name ${m}; got ${auth.blocking_reason}`);
    }
  }
});

test("all four parts authorize, and only then", () => {
  const auth = resolveProductionAuthorization(FULL, ENV_ON);
  assert.deepEqual(auth, { requested: true, authorized: true, missing: [], blocking_reason: null });
  assert.match(describeAuthorizedTarget(FULL, ENV_ON), /PRODUCTION qsllyeztdwjgirsysgai/);
  assert.match(describeAuthorizedTarget([], {}), /preview rjyboqwcdzcocqgmsyel/);
});

test("an authorized production write still demands a linked production session", () => {
  // Correct: linked to production.
  assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PRODUCTION_PROJECT_REF,
    argv: FULL, env: ENV_ON, assertPreviewApplyTarget: previewGuard,
  });

  // A raw DATABASE_URL is an unreviewable target -> refused.
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: true, connString: "postgres://u:p@host:5432/db", linkedProjectRef: PRODUCTION_PROJECT_REF,
    argv: FULL, env: ENV_ON, assertPreviewApplyTarget: previewGuard,
  }), /DATABASE_URL/);

  // Authorized for production but actually linked to preview -> refused.
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PREVIEW_PROJECT_REF,
    argv: FULL, env: ENV_ON, assertPreviewApplyTarget: previewGuard,
  }), /not qsllyeztdwjgirsysgai/);

  // Not linked at all -> refused.
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: false, connString: null, linkedProjectRef: null,
    argv: FULL, env: ENV_ON, assertPreviewApplyTarget: previewGuard,
  }), /without --linked/);

  // Partial authorization never reaches the target check.
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PRODUCTION_PROJECT_REF,
    argv: ["--apply", "--linked", "--production"], env: {}, assertPreviewApplyTarget: previewGuard,
  }), /Refusing --production/);
});

test("a production project ref without --production is refused, not silently ignored", () => {
  const auth = resolveProductionAuthorization(["--project-ref", PRODUCTION_PROJECT_REF], {});
  assert.equal(auth.authorized, false);
  assert.match(auth.blocking_reason, /without --production/);
  assert.throws(() => assertColdlionApplyTarget({
    apply: true, linked: true, connString: null, linkedProjectRef: PREVIEW_PROJECT_REF,
    argv: ["--apply", "--linked", "--project-ref", PRODUCTION_PROJECT_REF], env: {},
    assertPreviewApplyTarget: previewGuard,
  }), /ambiguous target/);
});

test("a dry run is never blocked by target rules", () => {
  assertColdlionApplyTarget({
    apply: false, linked: false, connString: null, linkedProjectRef: null,
    argv: ["--production", "--production-authorized", "--project-ref", PRODUCTION_PROJECT_REF],
    env: ENV_ON, assertPreviewApplyTarget: previewGuard,
  });
});

test("the frozen approved artifact is accepted for production ONLY when allowed", () => {
  // This is the exact defect Codex found: the shipped artifact is stamped preview,
  // so the production run aborted before writing anything.
  const doc = JSON.parse(JSON.stringify(loadApprovedMapping().input));
  const full = {
    schema: "coldlion_phase4_approved_mapping_input/v1",
    target: PREVIEW_PROJECT_REF,
    approved_by: "Albert Hazan",
    approved_at_utc: "2026-07-25",
    approved_mapping_hash: "1230f5a12d0f2a3029f1d3df17fc5b5f",
    mapping_count: 542,
    distinct_canonical: 271,
    mappings: doc.mappings,
  };

  // Preview-stamped artifact is fine in both modes: the approved SET is the same.
  assert.doesNotThrow(() => validateApprovedMapping(full));
  assert.doesNotThrow(() => validateApprovedMapping(full, { allowProduction: true }));

  // A production-stamped artifact needs the authorization.
  const prodStamped = { ...full, target: PRODUCTION_PROJECT_REF };
  assert.throws(() => validateApprovedMapping(prodStamped), /requires explicit authorization/);
  assert.doesNotThrow(() => validateApprovedMapping(prodStamped, { allowProduction: true }));

  // Any other target is still refused outright, in both modes.
  const wrong = { ...full, target: "some-other-project" };
  assert.throws(() => validateApprovedMapping(wrong), /must be preview/);
  assert.throws(() => validateApprovedMapping(wrong, { allowProduction: true }), /must be preview/);

  // Authorization does NOT relax the content pin: a tampered set still fails.
  const tampered = { ...full, mappings: full.mappings.slice(0, 541) };
  assert.throws(() => validateApprovedMapping(tampered, { allowProduction: true }), /count/);
});
