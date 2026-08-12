// Offline contract tests for the DB Data Admin production launch readiness gate.
// Run with: node --test scripts/tests/check-data-admin-launch-readiness.test.mjs
//
// These cover every refusal path the gate must enforce plus a full success
// fixture. They never touch the network: they call the pure validator
// checkLaunchReadiness(ctx) directly with hand-built evidence.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLaunchReadiness,
  BATCH_B8,
  BATCH_B9,
  EXPECTED_APP_UUID,
  EXPECTED_CONFIRMATION,
  EXPECTED_DOMAIN,
  EXPECTED_PROJECT_REF,
  REQUIRED_FUNCTIONS,
  REQUIRED_TABLES,
  parseSupabaseEvidence,
} from "../check-data-admin-launch-readiness.mjs";
import { readFileSync } from "node:fs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const SHORT = SHA.slice(0, 7);

function gateCtx(overrides = {}) {
  return {
    phase: "gate",
    event: "workflow_dispatch",
    ref: "refs/heads/main",
    sha: SHA,
    originMainSha: SHA,
    inputs: { project_ref: EXPECTED_PROJECT_REF, confirmation: EXPECTED_CONFIRMATION },
    ledger: [...BATCH_B8, ...BATCH_B9, "20260621150714_foundation"],
    tables: [...REQUIRED_TABLES],
    functions: [...REQUIRED_FUNCTIONS],
    adminCount: 3,
    coolify: { uuid: EXPECTED_APP_UUID, priorImageTag: "sha-deadbee" },
    ...overrides,
  };
}

function domainsCtx(overrides = {}) {
  return {
    phase: "domains",
    sha: SHA,
    coolify: { imageTag: `sha-${SHORT}`, domains: [EXPECTED_DOMAIN] },
    ...overrides,
  };
}

function failsWith(ctx, needle, message) {
  const r = checkLaunchReadiness(ctx);
  assert.equal(r.ok, false, message ?? `expected failure but got ok; needle="${needle}"`);
  assert.ok(
    r.errors.some((e) => e.includes(needle)),
    `expected an error mentioning "${needle}", got: ${JSON.stringify(r.errors)}`,
  );
}

test("success: a fully-evidenced main dispatch passes both phases", () => {
  const gate = checkLaunchReadiness(gateCtx());
  assert.equal(gate.ok, true, `gate should pass: ${JSON.stringify(gate.errors)}`);
  const domains = checkLaunchReadiness(domainsCtx());
  assert.equal(domains.ok, true, `domains should pass: ${JSON.stringify(domains.errors)}`);
});

// --- Refusal: push / wrong inputs / wrong ref / wrong SHA -------------------

test("refusal: an ordinary push never passes the gate", () => {
  failsWith(gateCtx({ event: "push" }), "workflow_dispatch");
});

test("refusal: wrong project_ref input", () => {
  failsWith(
    gateCtx({ inputs: { project_ref: "rjyboqwcdzcocqgmsyel", confirmation: EXPECTED_CONFIRMATION } }),
    EXPECTED_PROJECT_REF,
  );
});

test("refusal: wrong confirmation input", () => {
  failsWith(
    gateCtx({ inputs: { project_ref: EXPECTED_PROJECT_REF, confirmation: "launch-it-now" } }),
    EXPECTED_CONFIRMATION,
  );
});

test("refusal: dispatch not from main", () => {
  failsWith(gateCtx({ ref: "refs/heads/develop" }), "refs/heads/main");
});

test("refusal: checked-out SHA differs from origin/main tip", () => {
  failsWith(gateCtx({ originMainSha: OTHER_SHA }), "origin/main");
});

test("refusal: malformed SHA", () => {
  failsWith(gateCtx({ sha: "not-a-sha", originMainSha: "not-a-sha" }), "40-char");
});

// --- Refusal: missing migration / object / admin count ----------------------

test("refusal: a B8 migration version missing from the ledger", () => {
  const ledger = gateCtx().ledger.filter((v) => v !== "20260809170500");
  failsWith(gateCtx({ ledger }), "B8");
});

test("refusal: a B9 migration version missing from the ledger", () => {
  const ledger = gateCtx().ledger.filter((v) => v !== "20260810120000");
  failsWith(gateCtx({ ledger }), "B9");
});

test("refusal: a required table absent", () => {
  failsWith(gateCtx({ tables: ["core.product_size"] }), "core.product_depth");
});

test("refusal: a required Product Depth function absent", () => {
  const functions = gateCtx().functions.filter(
    (f) => f !== "api.db_data_admin_upsert_product_depth",
  );
  failsWith(gateCtx({ functions }), "db_data_admin_upsert_product_depth");
});

test("refusal: zero active admins", () => {
  failsWith(gateCtx({ adminCount: 0 }), "admin");
});

test("refusal: missing evidence is fail-closed (empty ledger/objects)", () => {
  failsWith(
    {
      phase: "gate",
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      sha: SHA,
      originMainSha: SHA,
      inputs: { project_ref: EXPECTED_PROJECT_REF, confirmation: EXPECTED_CONFIRMATION },
      coolify: { uuid: EXPECTED_APP_UUID },
    },
    "B8",
  );
});

// --- Refusal: wrong Coolify uuid / wrong domain / wrong tag -----------------

test("refusal: wrong Coolify app uuid", () => {
  failsWith(
    gateCtx({ coolify: { uuid: "x".repeat(24), priorImageTag: "sha-deadbee" } }),
    EXPECTED_APP_UUID,
  );
});

test("refusal: prior rollback tag is not immutable", () => {
  failsWith(
    gateCtx({ coolify: { uuid: EXPECTED_APP_UUID, priorImageTag: "latest" } }),
    "immutable",
  );
});

test("Supabase Management API direct-row response parses exact evidence", () => {
  const parsed = parseSupabaseEvidence([
    {
      evidence: {
        ledger: [...BATCH_B8, ...BATCH_B9],
        tables: [...REQUIRED_TABLES],
        functions: [...REQUIRED_FUNCTIONS],
        admin_count: 4,
      },
    },
  ]);
  assert.deepEqual(parsed.ledger, [...BATCH_B8, ...BATCH_B9]);
  assert.deepEqual(parsed.tables, REQUIRED_TABLES);
  assert.deepEqual(parsed.functions, REQUIRED_FUNCTIONS);
  assert.equal(parsed.adminCount, 4);
});

test("workflow exports dispatch inputs and ordinary pushes cannot run production", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/db-data-admin.yml", import.meta.url), "utf8");
  assert.match(workflow, /deploy-production:\s*\n\s*if: github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /INPUT_PROJECT_REF: \$\{\{ inputs\.project_ref \}\}/);
  assert.match(workflow, /INPUT_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.match(workflow, /\{docker_registry_image_tag: \$t, domains: \$d\}/);
  assert.match(workflow, /Recheck main tip immediately before public exposure/);
  assert.doesNotMatch(workflow, /deploy-production:\s*\n\s*if: github\.event_name == 'push'/);
});

test("refusal: sslip.io auto-host present after attach", () => {
  failsWith(
    domainsCtx({
      coolify: {
        imageTag: `sha-${SHORT}`,
        domains: [EXPECTED_DOMAIN, "http://zeoy8qfjqffu8ym533cc7dl4.178.156.180.212.sslip.io"],
      },
    }),
    "sslip.io",
  );
});

test("refusal: extra non-sslip domain after attach", () => {
  failsWith(
    domainsCtx({
      coolify: { imageTag: `sha-${SHORT}`, domains: [EXPECTED_DOMAIN, "https://other.example.com"] },
    }),
    "exactly",
  );
});

test("refusal: wrong image tag after attach", () => {
  failsWith(
    domainsCtx({ coolify: { imageTag: "latest", domains: [EXPECTED_DOMAIN] } }),
    `sha-${SHORT}`,
  );
});

test("refusal: domains phase with no domains at all", () => {
  failsWith(domainsCtx({ coolify: { imageTag: `sha-${SHORT}`, domains: [] } }), "exactly");
});
