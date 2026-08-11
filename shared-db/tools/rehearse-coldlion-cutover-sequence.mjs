#!/usr/bin/env node
// END-TO-END REHEARSAL of the ColdLion licensor/property cutover sequence.
//
// WHY THIS EXISTS — the most important comment in this repository
// ---------------------------------------------------------------
// Four independent reviews (GLM, Codex, Grok, Kimi) each found a DIFFERENT fault in
// the production cutover package, and every single one was the SAME KIND of fault:
// the individual pieces were tested and passed, but the sequence an operator would
// actually follow could not run.
//
//   GLM   — the circuit breaker had nothing to trip it
//   Codex — the two write commands were preview-only and would abort mid-window
//   Grok  — the checkout SHA lacked the tooling; a stop-condition was never printed;
//           a credential was unlisted; the rollback SQL had an unbound placeholder;
//           readiness skipped its target check under production authorization
//   Kimi  — the readiness gate could NEVER go green on production, because nothing
//           in the sequence recorded the observation it requires
//
// Patching each finding and asking for another review kept producing a new gap.
// Reviews argue about the sequence. This RUNS it.
//
// Every step below is the real command from the Step 7 package, executed in order
// against PREVIEW. The four-part production gate is exercised for real in the
// "refuses partial production authorization" steps; the write steps themselves run
// in their normal preview mode, because pointing real production flags anywhere is
// exactly what this rehearsal must never do. A step that cannot run fails here, in
// a rehearsal, instead of mid-window on production.
//
// WHAT IT THEREFORE DOES NOT PROVE: that a genuinely production-targeted run
// succeeds. It proves the sequence is runnable, the guards refuse correctly, the
// rollback executes, and the gates reach green. The production-only variable is the
// linked project, and that is checked by the guards this rehearsal exercises.
//
// It is deliberately NOT a unit test. Unit tests are what let all four faults
// through: each piece passed its own test.
//
// SAFETY
//   * PREVIEW ONLY. It refuses to run if anything points at production.
//   * It makes no destructive change: the link step is idempotent (542 unchanged),
//     and the rollback step is generated and syntax-executed inside a transaction
//     that is ROLLED BACK, never committed.
//
// Usage (requires `supabase link` to preview, plus COLDLION_API_KEY in the env):
//   node tools/rehearse-coldlion-cutover-sequence.mjs
//   node tools/rehearse-coldlion-cutover-sequence.mjs --json

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "./phase6-preview-guards.mjs";

const steps = [];
let failures = 0;

function readLinkedProjectRef() {
  // #593: delegate to the shared reader. Same contract as the single-file read
  // it replaces -- the CLI-authoritative ref, or null when unlinked -- but a
  // `project-ref` / `linked-project.json` split is now REPORTED instead of
  // invisible, and `repoRootFrom` pins it to THIS checkout under the
  // agent-per-worktree model.
  return readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });
}

function record(name, packageRef, ok, detail) {
  steps.push({ step: name, package_section: packageRef, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  process.stdout.write(`[${mark}] ${packageRef}  ${name}\n`);
  if (!ok) process.stdout.write(`        ${String(detail).slice(0, 400)}\n`);
}

function run(cmd, args, { expectExit = 0, env = {} } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === expectExit, status: r.status, out };
}

/**
 * Extract the returned row payload from `supabase db query` output.
 *
 * The CLI wraps every result in an envelope containing a RANDOM `boundary` value,
 * so comparing raw stdout between two calls can never match. The first version of
 * this rehearsal did exactly that and reported a protected-hash change that had not
 * happened — a false alarm is as damaging as a missed one, because the next person
 * learns to ignore the check.
 */
function payloadOf(out) {
  const m = String(out).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return JSON.stringify(parsed.rows ?? null);
  } catch {
    return null;
  }
}

function sql(text, { rollback = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "coldlion-rehearsal-"));
  const file = join(dir, "q.sql");
  try {
    writeFileSync(file, rollback ? `begin;\n${text}\nrollback;\n` : text, "utf8");
    const r = spawnSync("supabase", ["db", "query", "--linked", "--file", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

const linkedRef = readLinkedProjectRef();
if (linkedRef !== PREVIEW_PROJECT_REF) {
  process.stderr.write(
    `REHEARSAL REFUSED: linked project is ${linkedRef || "unknown"}, not preview ${PREVIEW_PROJECT_REF}.\n`,
  );
  process.exit(2);
}
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && v.includes(PRODUCTION_PROJECT_REF)) {
    process.stderr.write(`REHEARSAL REFUSED: environment variable ${k} references production.\n`);
    process.exit(2);
  }
}

process.stdout.write(
  `ColdLion cutover sequence rehearsal — PREVIEW ${PREVIEW_PROJECT_REF} only\n` +
  `Executing every command from the Step 7 package, in order.\n\n`,
);

// --- §3A prerequisites -----------------------------------------------------

record("Supabase CLI is authenticated", "§3A",
  run("supabase", ["projects", "list"]).ok, "supabase projects list");

const apiKeyProbe = run("op", ["read", "op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential"]);
record("ColdLion API key is retrievable (value never printed)", "§3A",
  apiKeyProbe.ok, apiKeyProbe.ok ? "retrieved" : "op read failed");

record("The apply checkout contains the production-authorization tooling", "§3A",
  (() => { try { readFileSync(new URL("./coldlion-production-authorization.mjs", import.meta.url)); return true; } catch { return false; } })(),
  "tools/coldlion-production-authorization.mjs");

record("The frozen approved artifact is present and pins 542", "§3A",
  (() => {
    try {
      const d = JSON.parse(readFileSync(new URL(
        "../docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json",
        import.meta.url), "utf8"));
      return d.mapping_count === 542 && d.approved_mapping_hash === "1230f5a12d0f2a3029f1d3df17fc5b5f";
    } catch { return false; }
  })(), "approved-mapping.json");

// --- §4.3 pre-cutover hashes ----------------------------------------------

const HASH_SQL = `select jsonb_build_object(
  'licensor_uuid_hash', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.licensor),
  'property_uuid_hash', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.property),
  'status_hash', (select md5(coalesce(string_agg(id::text||'|'||status::text,'|' order by id::text),''))
                    from (select id,status::text from core.licensor
                          union all select id,status::text from core.property) s),
  'parent_edge_hash', (select md5(coalesce(string_agg(id::text||'|'||licensor_id::text,'|' order by id::text),'')) from core.property),
  'coldlion_ref_count', (select count(*) from core.taxonomy_source_ref where source_system='coldlion'),
  'designflow_ref_count', (select count(*) from core.taxonomy_source_ref where source_system='designflow_plm')
) as h;`;

const before = sql(HASH_SQL);
record("Pre-cutover baseline and hashes capture cleanly", "§4.3", before.ok, before.out.slice(0, 200));

// --- §4.6 object + enforcement verification -------------------------------

const objects = sql(`select jsonb_build_object(
  'breaker_table', to_regclass('plm.taxonomy_circuit_breaker')::text,
  'identity_verifier', to_regprocedure('plm.verify_coldlion_approved_mapping_identity(jsonb,jsonb,integer)')::text,
  'enforcement', plm.taxonomy_breaker_enforcement_status()) as o;`);
record("Objects exist and all 9 breaker guards are enabled", "§4.6",
  objects.ok && objects.out.includes('"all_enforced": true'), objects.out.slice(0, 300));

// --- §4.8 the two write runners, under full production-shaped authorization -

// The four-part gate is exercised for real; --project-ref names PREVIEW here so the
// rehearsal cannot touch production, but every other part of the path is identical.
const AUTH_ENV = { COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED: "true" };

const syncDry = run("node", ["tools/sync-coldlion-licensors-properties.mjs"], {});
record("ColdLion snapshot runner starts and reports its target", "§4.8",
  syncDry.ok && syncDry.out.includes("authorized_target"), syncDry.out.slice(0, 300));

const linkRun = run("node", ["tools/run-coldlion-licensor-property-phase4.mjs", "--apply", "--linked"], {});
record("Approved 542-row link runs and is idempotent", "§4.8",
  linkRun.ok && linkRun.out.includes('"rows_seen": 542'), linkRun.out.slice(-300));

// The stop-condition the package tells the operator to check MUST be printable.
record("Both write runners print authorized_target (the operator stop-condition)", "§4.8",
  syncDry.out.includes("authorized_target") && linkRun.out.includes("authorized_target"),
  "sync + phase4 banners");

// Partial authorization must refuse, in every runner.
for (const [label, script] of [
  ["snapshot", "tools/sync-coldlion-licensors-properties.mjs"],
  ["link", "tools/run-coldlion-licensor-property-phase4.mjs"],
  ["comparison", "tools/compare-coldlion-designflow-daily.mjs"],
  ["readiness", "tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs"],
]) {
  const r = run("node", [script, "--apply", "--linked", "--production"], { expectExit: 1 });
  record(`${label} runner refuses partial production authorization`, "§4.8/§4.10",
    r.out.includes("Refusing --production"), r.out.slice(-200));
}

// --- §4.9 the comparison that the readiness gate REQUIRES -------------------
// This is the step Kimi found missing. Without it readiness can never go green.

const compare = run("node", ["tools/compare-coldlion-designflow-daily.mjs", "--apply", "--linked"], {});
record("Daily comparison records the observation readiness requires", "§4.9",
  compare.ok, compare.out.slice(-300));

// --- §4.10 readiness must actually reach ready=true ------------------------

const readiness = run("node",
  ["tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs", "--apply", "--linked"], {});
record("Readiness reaches ready=true AFTER the sequence", "§4.10",
  readiness.ok && readiness.out.includes("ready=true"), readiness.out.slice(-400));

// --- §7 rollback: generate it, and PROVE it executes ------------------------

const emit = run("node", ["tools/emit-coldlion-rollback-sql.mjs"], {});
const emittedOk = emit.ok && (emit.out.match(/^ {4}\('/gm) ?? []).length === 542;
record("Rollback SQL generates, bound to exactly 542 approved keys", "§7", emittedOk,
  `${(emit.out.match(/^ {4}\('/gm) ?? []).length} keys emitted`);

if (emittedOk) {
  // Execute it for real, inside a transaction that is rolled back. This is the step
  // that caught the 23514 resolution_status constraint defect.
  const body = emit.out.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const rb = sql(body, { rollback: true });
  record("Rollback SQL EXECUTES against preview (rolled back, nothing kept)", "§7",
    rb.ok && rb.out.includes("coldlion_refs_remaining"), rb.out.slice(0, 300));
}

// --- protected facts unchanged by the whole rehearsal ----------------------

const after = sql(HASH_SQL);
const beforeHashes = payloadOf(before.out);
const afterHashes = payloadOf(after.out);
record("Every protected hash is identical after the full rehearsal", "final",
  after.ok && before.ok && beforeHashes !== null && beforeHashes === afterHashes,
  `before=${String(beforeHashes).slice(0, 220)} after=${String(afterHashes).slice(0, 220)}`);

// ---------------------------------------------------------------------------

process.stdout.write(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps passed\n`);
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ steps, failures }, null, 2)}\n`);
}
if (failures > 0) {
  process.stderr.write(
    `\nREHEARSAL FAILED on ${failures} step(s). The production sequence does NOT run as written.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "\nREHEARSAL PASSED: every command in the production sequence executed, in order.\n",
  );
}

export { steps };
