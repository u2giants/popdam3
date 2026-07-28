#!/usr/bin/env node
// Operational runner for Phase 4 ColdLion licensor/property APPROVED LINKING.
//
// Reads the frozen human-approved mapping file
//   docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json
// independently RECOMPUTES the mapping hash/count/distinct from the file's mappings,
// and refuses to proceed unless they are exactly the pinned approved Phase 4 set
// (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, 542 mappings, 271 distinct canonical
// UUIDs — Albert Hazan's approval of the 542 exact-compatible proposed mappings).
// It then calls
//   public.sync_coldlion_licensors_properties(input, 'link_approved', expected)
// where `expected` is the separate contract argument the database PINS to the same
// approved set — a tampered file fails here before any SQL is built, and would fail
// again inside the database even if it somehow got through.
//
// Reuses the shared helpers (runSql, buildFailedSyncRunSql, sqlDollarQuote) and the
// Phase 2 runner's connection/target guards (resolveRunMode, describeTarget,
// assertPreviewApplyTarget) so connection, secret handling, and the preview-only
// apply boundary are not forked. No ColdLion API call is needed: Phase 4 consumes
// the frozen approval artifact, not the network.
//
// Usage:
//   node tools/run-coldlion-licensor-property-phase4.mjs                      # dry-run: validate + print SQL, no DB
//   DATABASE_URL=postgres://... node tools/run-coldlion-licensor-property-phase4.mjs --apply
//   node tools/run-coldlion-licensor-property-phase4.mjs --apply --linked     # linked preview project only
//
// --apply is preview-only: production ref/URL is rejected by assertPreviewApplyTarget.
// The runner never prints credentials (describeTarget redacts connection strings).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import {
  buildFailedSyncRunSql,
  runSql,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertPreviewApplyTarget,
  describeTarget,
  resolveRunMode,
} from "./sync-coldlion-licensors-properties.mjs";
import {
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";

// =====================================================================================
// PINNED APPROVED SET — the only payload this runner will ever send. Mirrors the pin
// inside plm.link_coldlion_licensors_properties_approved (migration 20260726030000).
// =====================================================================================
export const SOURCE_NAME = "coldlion_licensors_properties_link_approved";
export const APPROVED_HASH = "1230f5a12d0f2a3029f1d3df17fc5b5f";
export const APPROVED_COUNT = 542;
export const APPROVED_DISTINCT = 271;
export const APPROVED_BY = "Albert Hazan";
export const APPROVED_SCHEMA = "coldlion_phase4_approved_mapping_input/v1";
export const APPROVED_MAPPING_PATH = fileURLToPath(
  new URL(
    "../docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json",
    import.meta.url,
  ),
);

export { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF, assertPreviewApplyTarget, describeTarget, resolveRunMode };

// =====================================================================================
// Pure helpers (no DB, no network) — unit tested.
// =====================================================================================

// Frozen encoding (Phase 3/4 document): sort by composite key in code-unit order
// (SQL COLLATE "C"), map to '<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>',
// join by newline, md5 utf8 hex.
export function compositeKeyOf(m) {
  return [m?.company_code, m?.division_code, m?.mg_type_code, m?.mg_code]
    .map((v) => String(v ?? ""))
    .join("/");
}

export function encodeMappings(mappings) {
  return mappings
    .slice()
    .sort((a, b) => {
      const ka = compositeKeyOf(a);
      const kb = compositeKeyOf(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((m) => `${m.entity_type}|${compositeKeyOf(m)}|${m.canonical_id}`)
    .join("\n");
}

export function computeMappingHash(mappings) {
  return createHash("md5").update(encodeMappings(mappings), "utf8").digest("hex");
}

// The exact DB payload shape: only the fields the link_approved contract reads.
export function buildLinkInput(doc) {
  return {
    approved_by: doc.approved_by,
    approved_at_utc: doc.approved_at_utc,
    mappings: doc.mappings,
  };
}

// The separate expected-contract argument, RECOMPUTED from the mappings — never
// trusting the file's declared fields.
export function buildExpectedContract(mappings) {
  return {
    hash: computeMappingHash(mappings),
    count: mappings.length,
    distinct_canonical: new Set(mappings.map((m) => m.canonical_id)).size,
  };
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Full validation + pin. Throws on ANY deviation; returns { input, expected } for
// the exact approved set only.
/**
 * @param {object} doc the frozen approved-mapping artifact
 * @param {{allowProduction?: boolean}} opts allowProduction is set ONLY by a fully
 *   authorized production run (see tools/coldlion-production-authorization.mjs).
 *
 * The artifact is stamped `"target": "rjyboqwcdzcocqgmsyel"` because it was approved
 * during the preview phase. The 542 mappings themselves are ENVIRONMENT-INDEPENDENT:
 * a read-only check on 2026-07-28 confirmed all 542 canonical UUIDs exist on
 * production too, with 0 missing, 0 cross-typed and 0 code mismatches, and the
 * frozen md5 covers only `<entity_type>|<composite>|<canonical_id>` — never the
 * target. So accepting the same artifact for production changes nothing about WHAT
 * is approved; it only changes WHERE, and only behind the four-part production
 * authorization. Without that authorization the preview-only rule is unchanged.
 */
export function validateApprovedMapping(doc, { allowProduction = false } = {}) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("approved mapping file must be a JSON object");
  }
  if (doc.schema !== APPROVED_SCHEMA) {
    throw new Error(`approved mapping schema must be ${APPROVED_SCHEMA}, got ${JSON.stringify(doc.schema)}`);
  }
  if (doc.target === PRODUCTION_PROJECT_REF && !allowProduction) {
    throw new Error(`approved mapping target is production ${PRODUCTION_PROJECT_REF}; production requires explicit authorization`);
  }
  if (doc.target !== PREVIEW_PROJECT_REF && doc.target !== PRODUCTION_PROJECT_REF) {
    throw new Error(`approved mapping target must be preview ${PREVIEW_PROJECT_REF} or production ${PRODUCTION_PROJECT_REF}, got ${JSON.stringify(doc.target)}`);
  }
  if (doc.approved_by !== APPROVED_BY) {
    throw new Error(`approved_by must be ${JSON.stringify(APPROVED_BY)} (the recorded Phase 4 approver), got ${JSON.stringify(doc.approved_by)}`);
  }
  if (typeof doc.approved_at_utc !== "string" || doc.approved_at_utc.trim() === "") {
    throw new Error("approved_at_utc is required (the human approval timestamp)");
  }
  if (!Array.isArray(doc.mappings)) {
    throw new Error("approved mapping mappings must be an array");
  }
  for (const m of doc.mappings) {
    if (
      !m || typeof m !== "object"
      || (m.entity_type !== "licensor" && m.entity_type !== "property")
      || typeof m.company_code !== "string" || m.company_code.trim() === ""
      || typeof m.division_code !== "string" || m.division_code.trim() === ""
      || !/^[0-9]{2}$/.test(String(m.mg_type_code ?? ""))
      || typeof m.mg_code !== "string" || m.mg_code.trim() === ""
      || !UUID_RE.test(String(m.canonical_id ?? ""))
    ) {
      throw new Error(`approved mapping shape invalid: ${JSON.stringify(m)}`);
    }
  }
  const keys = doc.mappings.map(compositeKeyOf);
  if (new Set(keys).size !== keys.length) {
    throw new Error("duplicate composite source key in the approved mapping file");
  }

  const expected = buildExpectedContract(doc.mappings);

  // Pin: recomputed values AND the file's declared fields must all be the exact
  // approved set. A NASA row, an extra row, a removed row, or a single flipped
  // UUID breaks at least one of these.
  if (expected.count !== APPROVED_COUNT || doc.mapping_count !== APPROVED_COUNT) {
    throw new Error(
      `approved mapping count does not match the pinned approved Phase 4 set: recomputed ${expected.count}, declared ${JSON.stringify(doc.mapping_count)}, pinned ${APPROVED_COUNT}`,
    );
  }
  if (expected.distinct_canonical !== APPROVED_DISTINCT || doc.distinct_canonical !== APPROVED_DISTINCT) {
    throw new Error(
      `approved mapping distinct canonical count does not match the pinned approved Phase 4 set: recomputed ${expected.distinct_canonical}, declared ${JSON.stringify(doc.distinct_canonical)}, pinned ${APPROVED_DISTINCT}`,
    );
  }
  if (expected.hash !== APPROVED_HASH || doc.approved_mapping_hash !== APPROVED_HASH) {
    throw new Error(
      `approved mapping hash does not match the pinned approved Phase 4 set: recomputed ${expected.hash}, declared ${JSON.stringify(doc.approved_mapping_hash)}, pinned ${APPROVED_HASH} — refusing unapproved or tampered input`,
    );
  }

  return { input: buildLinkInput(doc), expected };
}

export function loadApprovedMapping(path = APPROVED_MAPPING_PATH, opts = {}) {
  return validateApprovedMapping(JSON.parse(readFileSync(path, "utf8")), opts);
}

// `select * from public.sync_coldlion_licensors_properties($in$::jsonb, 'link_approved', $exp$::jsonb);`
export function buildLinkSql(input, expected) {
  return `select * from public.sync_coldlion_licensors_properties(${sqlDollarQuote("p4_input", input)}::jsonb, 'link_approved', ${sqlDollarQuote("p4_expected", expected)}::jsonb);\n`;
}

// =====================================================================================
// Operational entrypoint.
// =====================================================================================

function readLinkedProjectRefSafely() {
  try {
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch {
    return null;
  }
}

async function main() {
  const { apply, linked, connString, target } = resolveRunMode(process.argv.slice(2), process.env);
  // Read tolerantly: an absent supabase/.temp/project-ref must NOT crash before the
  // authorization check runs. A raw ENOENT stack in a production window is exactly
  // the confusing failure that tempts an operator to improvise a bypass; a clear
  // "you are missing X" refusal does not.
  const linkedProjectRef = linked ? readLinkedProjectRefSafely() : null;
  const auth = resolveProductionAuthorization(process.argv.slice(2), process.env);
  assertColdlionApplyTarget({
    apply, linked, connString, linkedProjectRef,
    argv: process.argv.slice(2), env: process.env, assertPreviewApplyTarget,
  });

  let stage = "load-approved-mapping";
  try {
    const { input, expected } = loadApprovedMapping(APPROVED_MAPPING_PATH, {
      allowProduction: auth.requested && auth.authorized,
    });
    const sql = buildLinkSql(input, expected);

    process.stdout.write(`${JSON.stringify({
      target,
      authorized_target: describeAuthorizedTarget(process.argv.slice(2), process.env),
      production_authorized: auth.requested && auth.authorized,
      mode: apply ? "apply" : "dry-run (no DB write)",
      source_name: SOURCE_NAME,
      approved_mapping: APPROVED_MAPPING_PATH,
      approved_by: input.approved_by,
      approved_at_utc: input.approved_at_utc,
      expected,
    }, null, 2)}\n`);

    if (apply) {
      stage = "apply";
      process.stdout.write(runSql(sql, { linked }));
    } else {
      process.stdout.write("Dry-run SQL (no database write performed; re-run with --apply to link):\n");
      process.stdout.write(sql);
    }
  } catch (error) {
    if (apply) {
      try { runSql(buildFailedSyncRunSql(SOURCE_NAME, stage, error?.message ?? String(error)), { linked }); }
      catch (recErr) { process.stderr.write(`WARNING: could not record durable failure: ${recErr?.message ?? recErr}\n`); }
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ColdLion licensor/property Phase 4 link failed: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
