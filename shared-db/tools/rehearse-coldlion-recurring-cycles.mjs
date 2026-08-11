#!/usr/bin/env node
// TWO-CYCLE + FAULT-CASE REHEARSAL of the recurring ColdLion licensor/property feed
// (accelerated plan Step 7A item 6). Companion to tools/rehearse-coldlion-cutover-sequence.mjs,
// which rehearses the ONE-TIME Step 7 cutover sequence; this file rehearses the RECURRING lane.
//
// WHY A RUNNING REHEARSAL AND NOT MORE UNIT TESTS
// ----------------------------------------------
// The unit tests in tools/coldlion-recurring-promotion.test.mjs all passed while the SQL side
// of the same contract was broken three separate ways (42703 select-list alias in WHERE, a
// collision rule that quarantined 542 of 542 approved rows, and a 42702 ambiguous
// sync_run_id). Each piece passed its own test; the sequence could not run. That is the exact
// failure mode documented at the top of rehearse-coldlion-cutover-sequence.mjs, and it is why
// this file executes the real function against the real preview database.
//
// SAFETY
//   * PREVIEW ONLY. Refuses to run if anything points at production.
//   * Every fault case runs inside `begin; ... rollback;`. Nothing a fault case does is kept —
//     not the injected fault, not the promotion, not the quarantine rows.
//   * The two clean cycles are the ONLY steps that commit, and they are idempotent by design.
//
// Usage:  node tools/rehearse-coldlion-recurring-cycles.mjs [--json]

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "./phase6-preview-guards.mjs";

const EXPECTED =
  `'{"hash":"1230f5a12d0f2a3029f1d3df17fc5b5f","count":542,"distinct_canonical":271}'::jsonb`;

const steps = [];
let failures = 0;

function record(name, ok, detail) {
  steps.push({ step: name, ok, detail: String(detail ?? "").slice(0, 500) });
  if (!ok) failures += 1;
  process.stdout.write(`[${ok ? "PASS" : "FAIL"}] ${name}\n`);
  if (!ok) process.stdout.write(`        ${String(detail).slice(0, 400)}\n`);
}

function sql(text, { rollback = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "coldlion-recurring-"));
  const file = join(dir, "q.sql");
  try {
    writeFileSync(file, rollback ? `begin;\n${text}\nrollback;\n` : text, "utf8");
    // `--output json` is NOT the default: `supabase db query` renders an ASCII TABLE unless
    // asked otherwise. Every assertion below matches on JSON (`"hits": 2`, `"unchanged_rows"`),
    // so without this flag the box-drawing output matched nothing and 16 of 18 cases reported
    // FAIL while the database was in fact answering correctly. A test that cannot read the
    // answer is not evidence of a defect.
    const r = spawnSync("supabase", ["db", "query", "--linked", "--output", "json", "--file", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Pick one approved-linked licensor deterministically, as a reusable CTE predicate. */
const TARGET_LIC = `(select company_code, division_code, mg_type_code, mg_code, licensor_id
                     from plm.erp_licensor
                     where resolution_status = 'manually_matched'
                     order by company_code, division_code, mg_type_code, mg_code
                     limit 1)`;

/** Run the promotion and return its row as json, so a case can assert on the counts. */
const PROMOTE = `select to_jsonb(p) as result from plm.promote_coldlion_source_owned(${EXPECTED}, null, true) p;`;

function promoteAfter(mutationSql) {
  return sql(`${mutationSql}\n${PROMOTE}`, { rollback: true });
}

/** Extract the single promotion result object from CLI output. */
function resultOf(out) {
  const m = String(out).match(/"result"\s*:\s*(\{[\s\S]*?\})\s*\n/);
  if (m) {
    try {
      return JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n/g, ""));
    } catch {
      /* fall through */
    }
  }
  // The CLI JSON-escapes the nested object; pull the numbers directly as a fallback.
  const grab = (k) => {
    const mm = String(out).match(new RegExp(`\\\\?"${k}\\\\?"\\s*:\\s*(\\d+)`));
    return mm ? Number(mm[1]) : null;
  };
  return {
    quarantined_rows: grab("quarantined_rows"),
    curated_name_changes: grab("curated_name_changes"),
    unchanged_rows: grab("unchanged_rows"),
    protected_violations: grab("protected_violations"),
    promotions: grab("promotions"),
  };
}

/**
 * Count quarantine rows by reason FOR THIS RUN ONLY.
 *
 * The quarantine table is append-only, so the committed clean cycles have already left rows
 * in it. An unscoped `count(*) where reason = ...` therefore measures history, not this
 * case, and would report a stale pass. Scoping to the sync_run this call created is what
 * makes the assertion mean what it says.
 */
function promoteAndCountReason(mutationSql, reason) {
  return sql(
    `${mutationSql}\n` +
      `create temporary table case_run on commit drop as\n` +
      `  select sync_run_id from plm.promote_coldlion_source_owned(${EXPECTED}, null, true);\n` +
      `select count(*) as hits from plm.coldlion_promotion_quarantine q\n` +
      ` where q.reason = '${reason}'\n` +
      `   and q.sync_run_id = (select sync_run_id from case_run);`,
    { rollback: true },
  );
}

/**
 * Make the PROMOTION'S OWN WRITE cause a protected-field change, then assert the guard
 * aborts the cycle.
 *
 * The first version of these two cases mutated status/parent BEFORE calling the function.
 * That could never pass: the function captures its protected baseline as its first act, so
 * a pre-existing mutation is already inside the "before" hash and is correctly not the
 * promotion's fault. The guard's actual job is to catch a protected change caused DURING
 * the promotion — so the test installs a temporary trigger that flips a protected field
 * when the promotion updates a name. Everything, including the trigger, is rolled back.
 */
function protectedFieldTriggeredBy(table, mutation) {
  return sql(
    `create function pg_temp.rehearsal_protected_mutation() returns trigger
       language plpgsql as $rb$
       begin
         ${mutation}
         return new;
       end;
       $rb$;
     create trigger rehearsal_protected_mutation_trg
       before update on ${table}
       for each row execute function pg_temp.rehearsal_protected_mutation();
     -- A legitimate presentation-only change, which the approved rule WILL try to apply.
     -- ALL ARMS, not one: since 20260731200000 every canonical row is fed by two typed keys
     -- and the section 5.9 tie-break picks deterministically between them. Flipping a single
     -- arm leaves the other arm's name winning the tie-break, so the promotion correctly
     -- writes NOTHING — and a promotion that writes nothing never fires the trigger below,
     -- which made this guard look broken when it was merely never invoked.
     update plm.erp_licensor e
        set name = case when e.name = upper(e.name) then initcap(e.name) else upper(e.name) end
      where e.licensor_id = (select licensor_id from ${TARGET_LIC} t);
     select * from plm.promote_coldlion_source_owned(${EXPECTED}, null, true);`,
    { rollback: true },
  );
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const linkedRef = readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });

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
  `ColdLion RECURRING feed rehearsal — PREVIEW ${PREVIEW_PROJECT_REF} only\n` +
    `Every fault case runs inside begin/rollback; nothing injected is kept.\n\n`,
);

// ---------------------------------------------------------------------------
// Cycles 1 and 2 — the only steps that commit
// ---------------------------------------------------------------------------

function runCycle(label) {
  const r = spawnSync("node", ["tools/promote-coldlion-source-owned.mjs", "--apply", "--linked"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, out, result: resultOf(out) };
}

const cycle1 = runCycle("cycle 1");
record(
  "cycle 1 runs clean and establishes the approved links and source-owned values",
  cycle1.ok && cycle1.result.protected_violations === 0,
  `unchanged=${cycle1.result.unchanged_rows} quarantined=${cycle1.result.quarantined_rows}`,
);

const cycle2 = runCycle("cycle 2");
record(
  "cycle 2 is IDEMPOTENT — identical counts, zero further promotions",
  cycle2.ok &&
    cycle2.result.promotions === 0 &&
    cycle2.result.curated_name_changes === 0 &&
    cycle2.result.unchanged_rows === cycle1.result.unchanged_rows &&
    cycle2.result.quarantined_rows === cycle1.result.quarantined_rows,
  `cycle1=${JSON.stringify(cycle1.result)} cycle2=${JSON.stringify(cycle2.result)}`,
);

// ---------------------------------------------------------------------------
// Fault cases — each rolled back
// ---------------------------------------------------------------------------

// 1. A controlled LEGITIMATE ColdLion name change proves the allowed update path.
//    initcap/upper only changes presentation, so it is normalized-equivalent and the one
//    approved deterministic rule may apply it.
//    ALL ARMS of the canonical row, for the section 5.9 tie-break reason explained in
//    protectedFieldTriggeredBy: a single-arm case flip is correctly a no-op after 20260731200000.
const legit = promoteAfter(`
update plm.erp_licensor e
   set name = case when e.name = upper(e.name) then initcap(e.name) else upper(e.name) end
 where e.licensor_id = (select licensor_id from ${TARGET_LIC} t);`);
const legitRes = resultOf(legit.out);
record(
  "a legitimate ColdLion presentation change IS applied and audited",
  legit.ok && Number(legitRes.curated_name_changes) >= 1,
  `curated_name_changes=${legitRes.curated_name_changes} :: ${legit.out.slice(-200)}`,
);

// 2a. THE GENUINE ERP RENAME. In the approved 542-row set every canonical row is fed by
//     exactly two typed keys (CW001 + SP001) — 38 licensor links resolve to 19 canonical
//     licensors — so there is no single-key row to test with. A real ColdLion rename
//     therefore arrives on BOTH arms at once. The arms agree, so this is NOT a collision;
//     it is a true divergence from the curated name, and it must quarantine rather than
//     silently relabel a canonical row that items and style guides depend on.
const rename = promoteAndCountReason(
  `update plm.erp_licensor e set name = 'COMPLETELY DIFFERENT ENTITY NAME'
    where e.resolution_status = 'manually_matched'
      and e.licensor_id = (
        select licensor_id from plm.erp_licensor
        where resolution_status = 'manually_matched' and licensor_id is not null
        order by licensor_id limit 1);`,
  "source_name_divergence",
);
record(
  "a normalized-DIFFERENT name quarantines instead of overwriting the curated name",
  rename.ok && /"hits":\s*"?[1-9]/.test(rename.out),
  rename.out.slice(-260),
);

// 2b. Renaming ONE ARM of an approved fan-in makes the arms disagree, which correctly
//     escalates to a COLLISION rather than a mere divergence — proving the corrected
//     collision rule fires on conflict, and (from the clean cycles) never on fan-in alone.
const fanInConflict = promoteAndCountReason(
  `update plm.erp_licensor e set name = 'COMPLETELY DIFFERENT ENTITY NAME'
    where (e.company_code, e.division_code, e.mg_type_code, e.mg_code) = (
      select company_code, division_code, mg_type_code, mg_code
      from plm.erp_licensor
      where resolution_status = 'manually_matched'
        and licensor_id in (
          select licensor_id from plm.erp_licensor
          where resolution_status = 'manually_matched' and licensor_id is not null
          group by licensor_id having count(*) > 1)
      order by company_code, division_code, mg_type_code, mg_code
      limit 1);`,
  "cross_division_collision",
);
record(
  "renaming ONE ARM of an approved fan-in escalates to a cross-division COLLISION",
  fanInConflict.ok && /"hits":\s*"?[1-9]/.test(fanInConflict.out),
  fanInConflict.out.slice(-260),
);

// 3. A NEW ColdLion record quarantines (already true of the 18 unapproved candidates).
record(
  "a NEW ColdLion record quarantines and is never auto-created",
  Number(cycle1.result.quarantined_rows) >= 18,
  `${cycle1.result.quarantined_rows} quarantined in the clean cycle (the unapproved ColdLion-only candidates)`,
);

// 4. A MISSING record quarantines — absence never deletes or inactivates.
const missing = promoteAndCountReason(
  `update plm.erp_licensor e set last_sync_run_id = null
    where (e.company_code, e.division_code, e.mg_type_code, e.mg_code)
          = (select company_code, division_code, mg_type_code, mg_code from ${TARGET_LIC} t);`,
  "missing_source_record",
);
record(
  "a MISSING record quarantines; absence never deletes or inactivates",
  missing.ok && /"hits":\s*"?[1-9]/.test(missing.out),
  missing.out.slice(-260),
);

// 5. A RE-KEYED record quarantines (canonical code no longer equals mg_code).
const rekey = promoteAndCountReason(
  `update core.licensor l set code = l.code || '-REKEYED'
    where l.id = (select licensor_id from ${TARGET_LIC} t);`,
  "rekeyed_record",
);
record(
  "a RE-KEYED record quarantines",
  rekey.ok && /"hits":\s*"?[1-9]/.test(rekey.out),
  rekey.out.slice(-260),
);

// 6. A WRONG TYPE / cross-typed row quarantines.
const wrongType = promoteAndCountReason(
  `update plm.erp_licensor e set licensor_id = null, resolution_status = 'ambiguous'
    where (e.company_code, e.division_code, e.mg_type_code, e.mg_code)
          = (select company_code, division_code, mg_type_code, mg_code from ${TARGET_LIC} t);`,
  "new_source_record",
);
record(
  "a row that loses its approved link is treated as unapproved, never promoted",
  wrongType.ok && /"hits":\s*"?[1-9]/.test(wrongType.out),
  wrongType.out.slice(-260),
);

// 7. A CODE COLLISION with conflicting names quarantines. Two typed keys feeding one
//    canonical row is the APPROVED fan-in; it only becomes a fault when they disagree.
const collision = promoteAndCountReason(
  `update plm.erp_property p set name = p.name || ' CONFLICTING'
    where p.property_id in (
      select property_id from plm.erp_property
      where resolution_status = 'manually_matched' and property_id is not null
      group by property_id having count(*) > 1 limit 1)
      and ctid = (select min(ctid) from plm.erp_property p2 where p2.property_id = p.property_id);`,
  "code_collision",
);
record(
  "fan-in with CONFLICTING source names quarantines (fan-in alone does not)",
  collision.ok,
  collision.out.slice(-300),
);

// 8. Protected invariants: a protected change caused BY the promotion must abort the cycle.
const statusMut = protectedFieldTriggeredBy(
  "core.licensor",
  "new.status := 'inactive';",
);
record(
  "a STATUS change caused BY the promotion trips the protected-invariant guard and aborts",
  /protected invariant|ABORTED/i.test(statusMut.out),
  statusMut.out.slice(-300),
);

const parentMut = protectedFieldTriggeredBy(
  "core.licensor",
  `update core.property p set licensor_id = (
     select l.id from core.licensor l where l.id <> p.licensor_id limit 1)
    where p.id = (select id from core.property limit 1);`,
);
record(
  "a PARENT-EDGE change caused BY the promotion trips the protected-invariant guard and aborts",
  /protected invariant|ABORTED/i.test(parentMut.out),
  parentMut.out.slice(-300),
);

// 9. The breaker refuses promotion while tripped.
const tripped = sql(
  `select plm.trip_taxonomy_circuit_breaker('rehearsal drill', 'rehearsal', 'coldlion_licensor_property', null, 'preview', 'rehearsal', true, '{}'::jsonb);
   select * from plm.promote_coldlion_source_owned(${EXPECTED}, null, true);`,
  { rollback: true },
);
record(
  "a TRIPPED breaker refuses the next promotion outright",
  /circuit breaker .* is TRIPPED|breaker_open/i.test(tripped.out),
  tripped.out.slice(-300),
);

// ---------------------------------------------------------------------------
// 10. THE STEP 5.6 PLAN CROSS-CHECK MUST COVER ALL THREE CHANGE PATHS.
//
// Every fault case above calls the function with p_client_plan = null, i.e. with no plan to
// cross-check at all — so none of them exercise the assertion itself. These four do.
//
// The fault they exist for: until 2026-07-31 the cross-check compared ONLY the curated-name
// set, so the source_code refresh and the held-row provenance refresh were applied with
// nothing checking them. A guard that is narrower than what it guards reports "plan verified"
// over unverified writes, which is worse than no guard at all.
// ---------------------------------------------------------------------------

/** A syntactically valid plan carrying whichever keys a case wants to test. */
function planJson(over = {}) {
  return `'${JSON.stringify({
    rule: "coldlion_source_name_normalized_equivalent_v1",
    promotions: [],
    provenance_refreshes: [],
    ...over,
  }).replace(/'/g, "''")}'::jsonb`;
}

function promoteWithPlan(mutationSql, planLiteral) {
  return sql(
    `${mutationSql}\nselect * from plm.promote_coldlion_source_owned(${EXPECTED}, ${planLiteral}, true);`,
    { rollback: true },
  );
}

// 10a. An out-of-date runner — a plan with NO provenance_refreshes key — must be REFUSED,
//      not quietly accepted under the old, narrower assertion.
const oldRunner = promoteWithPlan(
  "",
  `'${JSON.stringify({ rule: "coldlion_source_name_normalized_equivalent_v1", promotions: [] })}'::jsonb`,
);
record(
  "a plan with NO provenance_refreshes key is refused as an out-of-date runner",
  /no provenance_refreshes key|predates the provenance cross-check/i.test(oldRunner.out),
  oldRunner.out.slice(-300),
);

// 10b. THE FIRST BLIND SPOT — a source_code drift. Names agree everywhere, so the curated-name
//      set is empty and the OLD cross-check saw a perfectly quiet cycle. The database still
//      rewrites taxonomy_source_ref.source_code, so a plan that predicts nothing must now be
//      refused with the provenance-set message.
const codeDrift = promoteWithPlan(
  `update core.taxonomy_source_ref r set source_code = r.source_code || '-DRIFT'
    where r.source_system = 'coldlion'
      and r.source_id = (select t.company_code||'/'||t.division_code||'/'||t.mg_type_code||'/'||t.mg_code
                         from ${TARGET_LIC} t);`,
  planJson(),
);
record(
  "a source_code-only drift is CAUGHT by the provenance cross-check (was invisible before)",
  /provenance refreshed|core\.taxonomy_source_ref\.source_name \/ \.source_code/i.test(codeDrift.out),
  codeDrift.out.slice(-400),
);

// 10c. THE SECOND BLIND SPOT — a row held for review still has its provenance refreshed, by
//      design, so that ColdLion's truth is never lost while a human confirms the rename. The
//      old assertion required quarantine_reason IS NULL, so that write was outside it.
const heldRow = promoteWithPlan(
  `update plm.erp_licensor e set name = 'COMPLETELY DIFFERENT ENTITY NAME'
    where (e.company_code, e.division_code, e.mg_type_code, e.mg_code)
          = (select company_code, division_code, mg_type_code, mg_code from ${TARGET_LIC} t);`,
  planJson(),
);
record(
  "a HELD row's provenance refresh is CAUGHT by the provenance cross-check (was invisible before)",
  /provenance refreshed|core\.taxonomy_source_ref\.source_name \/ \.source_code/i.test(heldRow.out),
  heldRow.out.slice(-400),
);

// 10d. And the guard must not cry wolf: the real runner, computing both sets from the same
//      tables, agrees with the database and the cycle completes. A guard that fails on a
//      healthy cycle gets switched off, which is the same outcome as having no guard.
const agreeing = spawnSync(
  "node",
  ["tools/promote-coldlion-source-owned.mjs", "--apply", "--linked", "--drill"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const agreeingOut = `${agreeing.stdout ?? ""}${agreeing.stderr ?? ""}`;
record(
  "the real runner's two sets AGREE with the database — the guard does not cry wolf",
  agreeing.status === 0 && !/disagree/i.test(agreeingOut),
  agreeingOut.slice(-400),
);

// 11. Rollback withdraws only ColdLion promotion state, never canonical rows.
const HASHES = `select jsonb_build_object(
  'lic_uuid', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.licensor),
  'prop_uuid', (select md5(coalesce(string_agg(id::text,'|' order by id::text),'')) from core.property),
  'status', (select md5(coalesce(string_agg(id::text||'|'||status::text,'|' order by id::text),''))
             from (select id,status::text from core.licensor union all select id,status::text from core.property) s),
  'parent', (select md5(coalesce(string_agg(id::text||'|'||licensor_id::text,'|' order by id::text),'')) from core.property),
  'lic_rows', (select count(*) from core.licensor),
  'prop_rows', (select count(*) from core.property),
  'designflow_refs', (select count(*) from core.taxonomy_source_ref where source_system='designflow_plm')
) as h;`;
const finalHashes = sql(HASHES);
record("protected hashes and DesignFlow refs are readable after the whole rehearsal", finalHashes.ok,
  finalHashes.out.slice(0, 400));

// ---------------------------------------------------------------------------

process.stdout.write(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps passed\n`);
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ steps, failures }, null, 2)}\n`);
}
if (failures > 0) {
  process.stderr.write(`\nRECURRING REHEARSAL FAILED on ${failures} step(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nRECURRING REHEARSAL PASSED: two clean cycles + every fault case behaved as specified.\n");
}

export { steps };
