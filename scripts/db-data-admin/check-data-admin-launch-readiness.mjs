#!/usr/bin/env node
// DB Data Admin production launch readiness gate (issue #729).
//
// Validates the evidence that must hold before https://data.designflow.app is
// launched (or re-launched) from this repository. Invoked by the
// `workflow_dispatch`-only `deploy-production` job in
// .github/workflows/db-data-admin.yml.
//
// Two phases:
//
//   gate    — checked BEFORE any Coolify mutation (PATCH domain/image, POST
//             deploy). Validates the dispatch context, the read-only Supabase
//             evidence (migration-ledger membership for batches B8 and B9, the
//             required tables and Product Depth picker/mutation functions, and
//             that at least one active admin has access), and that the Coolify
//             application is the exact production target. Records the prior
//             immutable image tag for rollback.
//
//   domains — checked AFTER attaching the domain and image tag, from a fresh
//             re-read of the Coolify application. Rejects extra or sslip.io
//             domains and requires the exact sha-<commit> image tag.
//
// The pure validator checkLaunchReadiness(ctx) is unit-tested in
// scripts/tests/check-data-admin-launch-readiness.test.mjs. The CLI entry
// (main) parses raw API response files written by the curl steps in the
// workflow; the parsers are exercised in CI, not by the offline tests.
//
// This script never prints row identities or values — only counts, object names
// (schema.table / schema.function) and migration version strings.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXPECTED_PROJECT_REF = "qsllyeztdwjgirsysgai";
export const EXPECTED_CONFIRMATION = "launch-data-designflow-app";
export const EXPECTED_APP_UUID = "zeoy8qfjqffu8ym533cc7dl4";
export const EXPECTED_DOMAIN = "https://data.designflow.app";

// A production launch depends on these migration versions being present in the
// Supabase migration ledger (supabase_migrations.schema_migrations.version).
export const BATCH_B8 = [
  "20260809170000",
  "20260809170100",
  "20260809170200",
  "20260809170300",
  "20260809170400",
  "20260809170500",
];
export const BATCH_B9 = [
  "20260810010000",
  "20260810020000",
  "20260810030000",
  "20260810050000",
  "20260810060000",
  "20260810070000",
  "20260810080000",
  "20260810090000",
  "20260810100000",
  "20260810110000",
  "20260810120000",
  "20260810130000",
  "20260810160000",
  "20260810170000",
];

export const REQUIRED_TABLES = ["core.product_size", "core.product_depth"];
// The Product Depth picker (api..._list), the two mutations (upsert +
// set_status) and the authorization guard the mutations `perform`.
export const REQUIRED_FUNCTIONS = [
  "api.db_data_admin_product_depth_list",
  "api.db_data_admin_upsert_product_depth",
  "api.db_data_admin_set_product_depth_status",
  "app.require_db_data_admin_product_depth_access",
];

const SHA_RE = /^[0-9a-f]{40}$/;

function diff(wanted, have) {
  const set = new Set((have ?? []).map(String));
  return wanted.filter((v) => !set.has(String(v)));
}

// Pure validator. Returns { ok, errors, checks }. `checks` carries counts/object
// names only (never row values) so it is safe to print into CI logs.
export function checkLaunchReadiness(ctx) {
  const errors = [];
  const checks = [];
  const phase = ctx?.phase === "domains" ? "domains" : "gate";

  const sha = String(ctx?.sha ?? "");
  if (!SHA_RE.test(sha)) {
    errors.push(`sha is not a 40-char lowercase hex commit: "${sha}"`);
  }

  if (phase === "gate") {
    if (ctx?.event !== "workflow_dispatch") {
      errors.push(
        `event must be workflow_dispatch (got "${ctx?.event ?? ""}") — ordinary pushes must never deploy production`,
      );
    }
    if (ctx?.ref !== "refs/heads/main") {
      errors.push(`dispatch must run from refs/heads/main (got "${ctx?.ref ?? ""}")`);
    }
    if (ctx?.inputs?.project_ref !== EXPECTED_PROJECT_REF) {
      errors.push(
        `inputs.project_ref must be ${EXPECTED_PROJECT_REF} (got "${ctx?.inputs?.project_ref ?? ""}")`,
      );
    }
    if (ctx?.inputs?.confirmation !== EXPECTED_CONFIRMATION) {
      errors.push(
        `inputs.confirmation must be ${EXPECTED_CONFIRMATION} (got "${ctx?.inputs?.confirmation ?? ""}")`,
      );
    }
    if (SHA_RE.test(sha) && String(ctx?.originMainSha ?? "") !== sha) {
      errors.push(
        `checked-out SHA ${sha} does not equal origin/main tip "${ctx?.originMainSha ?? ""}" — refusing to deploy a non-tip commit`,
      );
    }

    const ledger = Array.isArray(ctx?.ledger) ? ctx.ledger.map(String) : [];
    const b8Missing = diff(BATCH_B8, ledger);
    const b9Missing = diff(BATCH_B9, ledger);
    checks.push(
      `ledger versions present: ${ledger.length} (require B8×${BATCH_B8.length} + B9×${BATCH_B9.length})`,
    );
    if (b8Missing.length) errors.push(`batch B8 missing ledger versions: ${b8Missing.join(", ")}`);
    if (b9Missing.length) errors.push(`batch B9 missing ledger versions: ${b9Missing.join(", ")}`);

    const tablesMissing = diff(REQUIRED_TABLES, ctx?.tables);
    if (tablesMissing.length) errors.push(`required tables absent: ${tablesMissing.join(", ")}`);

    const fnsMissing = diff(REQUIRED_FUNCTIONS, ctx?.functions);
    if (fnsMissing.length) {
      errors.push(`required Product Depth picker/mutation functions absent: ${fnsMissing.join(", ")}`);
    }

    const adminCount = Number(ctx?.adminCount);
    checks.push(`active app.app_access rows for app 'admin': ${Number.isFinite(adminCount) ? adminCount : "none"}`);
    if (!(Number.isFinite(adminCount) && Number.isInteger(adminCount) && adminCount > 0)) {
      errors.push(`need >0 active app.app_access rows for app 'admin', got ${ctx?.adminCount ?? "none"}`);
    }

    const uuid = String(ctx?.coolify?.uuid ?? "");
    if (uuid !== EXPECTED_APP_UUID) {
      errors.push(`coolify app uuid must be ${EXPECTED_APP_UUID} (got "${uuid}")`);
    }
    const prior = String(ctx?.coolify?.priorImageTag ?? ctx?.coolify?.imageTag ?? "");
    if (!/^sha-[0-9a-f]{7}$/.test(prior)) {
      errors.push(`prior rollback image tag must be an immutable sha-<7> tag (got "${prior}")`);
    } else {
      checks.push(`prior image tag recorded for rollback: ${prior}`);
    }
  }

  if (phase === "domains") {
    const wantTag = `sha-${sha.slice(0, 7)}`;
    const imageTag = String(ctx?.coolify?.imageTag ?? "");
    if (imageTag !== wantTag) {
      errors.push(`coolify image tag must be ${wantTag} (got "${imageTag}")`);
    }
    const domains = Array.isArray(ctx?.coolify?.domains) ? ctx.coolify.domains : [];
    checks.push(`coolify domains attached: ${JSON.stringify(domains)}`);
    const sslip = domains.filter((d) => String(d).includes("sslip.io"));
    if (sslip.length) errors.push(`coolify domains include sslip.io auto-host: ${sslip.join(", ")}`);
    const expected = [EXPECTED_DOMAIN];
    const same =
      domains.length === expected.length && domains.every((d, i) => d === expected[i]);
    if (!same) {
      errors.push(
        `coolify domains must be exactly [${EXPECTED_DOMAIN}] (no extras), got ${JSON.stringify(domains)}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, checks };
}

// --- Raw API response parsers (exercised in CI, not by the offline tests) ----

function asObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

// Supabase Management API `POST /v1/projects/{ref}/database/query` returns one
// result set per statement. A single SELECT aliased `as evidence` lands at
// response[0].rows[0].evidence (the API may return jsonb as an object or a
// JSON string — both are handled).
export function parseSupabaseEvidence(raw) {
  let rows;
  if (Array.isArray(raw)) {
    rows = raw;
  } else {
    rows = raw?.rows ?? raw?.Rows ?? raw?.result ?? raw?.data ?? [];
  }
  const row = rows[0] ?? {};
  const evidence = asObject(row.evidence ?? row) ?? {};
  return {
    ledger: Array.isArray(evidence.ledger) ? evidence.ledger.map(String) : [],
    tables: Array.isArray(evidence.tables) ? evidence.tables.map(String) : [],
    functions: Array.isArray(evidence.functions) ? evidence.functions.map(String) : [],
    adminCount: Number.isFinite(Number(evidence.admin_count)) ? Number(evidence.admin_count) : -1,
  };
}

function parseDomains(value) {
  if (!value) return [];
  return Array.from(
    new Set(
      String(value)
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

// Coolify `GET /api/v1/applications/{uuid}` returns the application object.
// `docker_registry_image_tag` is the deployed image tag; `fqdn` is the
// comma/newline-separated domain string (the doc's "domains" wording).
export function parseCoolifyApp(raw) {
  const app = asObject(raw) ?? {};
  const tag = String(app.docker_registry_image_tag ?? app.image_tag ?? "");
  return {
    uuid: String(app.uuid ?? ""),
    imageTag: tag,
    priorImageTag: tag,
    domains: parseDomains(app.fqdn ?? app.domains),
  };
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--phase") out.phase = argv[++i];
    else if (a === "--supabase") out.supabase = argv[++i];
    else if (a === "--coolify") out.coolify = argv[++i];
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const phase = args.phase === "domains" ? "domains" : "gate";
  const ctx = {
    phase,
    event: process.env.GITHUB_EVENT_NAME ?? "",
    ref: process.env.GITHUB_REF ?? "",
    sha: process.env.GITHUB_SHA ?? "",
    originMainSha: process.env.ORIGIN_MAIN_SHA ?? "",
    inputs: {
      project_ref: process.env.INPUT_PROJECT_REF ?? "",
      confirmation: process.env.INPUT_CONFIRMATION ?? "",
    },
  };
  if (args.supabase) Object.assign(ctx, parseSupabaseEvidence(readJson(args.supabase)));
  if (args.coolify) ctx.coolify = parseCoolifyApp(readJson(args.coolify));

  const result = checkLaunchReadiness(ctx);
  for (const c of result.checks) console.log(c);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::${e}`);
    console.error(
      `::error::launch readiness (${phase}) FAILED with ${result.errors.length} problem(s). Production was not deployed.`,
    );
    process.exit(1);
  }
  console.log(`launch readiness (${phase}): PASS`);
}

// Guard against the Windows entry-point trap (AGENTS.md §10.3): use
// pathToFileURL, never a hand-built file:// string.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
