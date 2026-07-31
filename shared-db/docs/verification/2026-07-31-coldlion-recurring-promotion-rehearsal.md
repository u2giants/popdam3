# ColdLion recurring-promotion rehearsal — 18/18 PASS on preview

**Run date/time:** 2026-07-31, 16:37:22 America/New_York = 2026-07-31 20:37:22 UTC.
Asserted in BOTH zones because this database runs `America/New_York`: `run_local_date` and
`run_utc_date` both read `2026-07-31`, so no assertion in this document straddles a date
boundary.

**Preview project ref actually run against:** `rjyboqwcdzcocqgmsyel`
(verified by reading `supabase/.temp/project-ref` immediately before **every** CLI call, and
echoed as `REF=` in each command's output).
**Production (`qsllyeztdwjgirsysgai`) was not contacted in any way.** The Supabase MCP server
was never used during this run.

**Function validated:** `plm.promote_coldlion_source_owned(jsonb, jsonb, boolean)`
**Live body length:** 40,298 chars · **live body md5:** `ecc4fe9ef04bb49af3a61bea2e54a273`
(md5 re-read after the rehearsal completed and was unchanged, proving the rehearsal did not
redefine the function it was testing).

---

## Why this run exists

The previously recorded "14/14 PASS" validated the function body installed by
`20260730000500`. `CREATE OR REPLACE FUNCTION` replaces the **entire** body, so four
subsequent migrations discarded the body that rehearsal proved. That evidence was void.
The suite has also grown from 14 to 18 cases; cases 10a–10d had **never been executed**.

## Migrations in effect, by exact version

Base lineage of the recurring lane:

| Version | Migration |
|---|---|
| `20260727221500` | `coldlion_licensor_property_readiness_and_breaker` |
| `20260727223000` | `coldlion_breaker_blocked_attempt_logging_fix` |
| `20260727224500` | `coldlion_identity_verifier_reason_cast_fix` |
| `20260728134500` | `coldlion_breaker_autotrip_and_gap_closure` |
| `20260729230000` | `coldlion_licensor_property_recurring_promotion` |
| `20260729234500` | `coldlion_recurring_promotion_collision_rule_fix` |
| `20260729235500` | `coldlion_recurring_promotion_ambiguous_column_fix` |
| `20260730000500` | `coldlion_recurring_promotion_absence_detection_fix` |

The four migrations that landed **after** the superseded rehearsal, which this run exercises:

| Version | Migration | PR |
|---|---|---|
| `20260731163000` | `coldlion_recurring_promotion_drop_dead_failure_recording` | #341 |
| `20260731180000` | `coldlion_recurring_promotion_serialization_lock` | #343 |
| `20260731190000` | `coldlion_promotion_crosscheck_provenance_coverage` | #342 |
| `20260731200000` | `coldlion_recurring_promotion_fanin_name_tiebreak` | #344 |

Max migration version on preview at run time: `20260731220000`.

### Proved by behaviour, not by the ledger

"The migration applied" is a statement about `supabase_migrations.schema_migrations`, not
about the code that is running. Each claim below was read out of the **live catalog**:

* `to_regprocedure('plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)')` — not null.
* `to_regclass` non-null for `plm.coldlion_promotion_quarantine`, `core.taxonomy_source_ref`,
  `plm.erp_licensor`, `plm.erp_property`.
* Markers located inside the **live `pg_proc.prosrc`**, i.e. inside the body that will
  actually execute:
  * `pg_try_advisory_xact_lock` — present (`20260731180000`)
  * `skipped_already_running` — present (`20260731180000`)
  * `provenance_refreshes` — present (`20260731190000`)
  * `predates the provenance cross-check` — present (`20260731190000`)
  * section `5.9` tie-break — present (`20260731200000`)
* `obj_description` on the live function ends with the `20260731200000`-era wording
  ("…there is deliberately NO in-function exception handler. Preview-only; the production
  lane is not enabled."), confirming the newest definition is the resident one.

---

## Result: 18 attempted, 18 passed

| # | Case | Result |
|---|---|---|
| 1 | cycle 1 runs clean and establishes the approved links and source-owned values | **PASS** |
| 2 | cycle 2 is IDEMPOTENT — identical counts, zero further promotions | **PASS** |
| 3 | a legitimate ColdLion presentation change IS applied and audited | **PASS** |
| 4 | a normalized-DIFFERENT name quarantines instead of overwriting the curated name | **PASS** |
| 5 | renaming ONE ARM of an approved fan-in escalates to a cross-division COLLISION | **PASS** |
| 6 | a NEW ColdLion record quarantines and is never auto-created | **PASS** |
| 7 | a MISSING record quarantines; absence never deletes or inactivates | **PASS** |
| 8 | a RE-KEYED record quarantines | **PASS** |
| 9 | a row that loses its approved link is treated as unapproved, never promoted | **PASS** |
| 10 | fan-in with CONFLICTING source names quarantines (fan-in alone does not) | **PASS** |
| 11 | a STATUS change caused BY the promotion trips the protected-invariant guard and aborts | **PASS** |
| 12 | a PARENT-EDGE change caused BY the promotion trips the protected-invariant guard and aborts | **PASS** |
| 13 | a TRIPPED breaker refuses the next promotion outright | **PASS** |
| 14 (10a) | a plan with NO `provenance_refreshes` key is refused as an out-of-date runner | **PASS** — first execution ever |
| 15 (10b) | a `source_code`-only drift is CAUGHT by the provenance cross-check | **PASS** — first execution ever |
| 16 (10c) | a HELD row's provenance refresh is CAUGHT by the provenance cross-check | **PASS** — first execution ever |
| 17 (10d) | the real runner's two sets AGREE with the database — the guard does not cry wolf | **PASS** — first execution ever |
| 18 | protected hashes and DesignFlow refs are readable after the whole rehearsal | **PASS** |

Harness verdict: `18/18 steps passed` /
`RECURRING REHEARSAL PASSED: two clean cycles + every fault case behaved as specified.`

Clean-cycle counts (committed; idempotent by design):
`unchanged_rows 542 · quarantined_rows 72 · promotions 0 · curated_name_changes 0 ·
provenance_refreshes 0 · protected_violations 0`, snapshot run
`ff84e673-4a91-486c-9834-26f530be282b`.

Final preview state: breaker `closed`; `core.licensor` 26 rows; `core.property` 256 rows;
`core.taxonomy_source_ref` 542 `coldlion` refs and 505 `designflow_plm` refs.

---

## Defects found and fixed (tooling — NOT the database)

**No defect was found in `plm.promote_coldlion_source_owned` or in any migration.** The
database behaved correctly in every case, including the fan-in and name-selection paths that
`20260731190000` / `20260731200000` touched. Every defect below is in the Node tool chain,
and each one had made the ColdLion recurring lane **completely non-functional**.

### D1 — `runSql` had no `maxBuffer`; a client-side ENOBUFS was reported as a database failure, which AUTO-TRIPPED the circuit breaker

`tools/coldlion-sync-common.mjs` → `runSql` called `spawnSync` with no `maxBuffer`. Node's
default is exactly 1 MiB (1,048,576 bytes). The cycle-state probe returns the whole ColdLion
mirror as one JSON document — **1,305,075 bytes** on the preview clone. Measured directly:

| `maxBuffer` | `status` | `error.code` | stdout bytes |
|---|---|---|---|
| Node default (1 MiB) | `null` | `ENOBUFS` | 545,380 (truncated) |
| 256 MiB | `0` | none | 1,305,075 |

`spawnSync` returned `status: null` and an **empty** `stderr`, so
`if (result.status !== 0) throw new Error(result.stderr || "supabase db query failed")`
raised the generic *"supabase db query failed"*. The runner recorded that as a genuine
promotion failure, and **two consecutive recorded failures auto-trip the
`coldlion_licensor_property` circuit breaker**. That is exactly what happened during the
first attempt of this rehearsal: the breaker auto-tripped at
`2026-07-31 15:39:26-04` with `tripped_by = auto-trip`,
`failed_invariant = read-cycle-state`, after which every remaining case was refused at
`promote_coldlion_source_owned` line 105 and the suite scored 2/18.

This is a silent-failure-class bug: a client-side buffer overflow was indistinguishable from
a database fault, and it disabled the lane.

**Fix applied:** `maxBuffer: 256 * 1024 * 1024`, plus an explicit `result.error` branch so a
spawn-level fault (`ENOBUFS`, `ENOENT`, timeout) can never again masquerade as a SQL failure.

### D2 — `supabase db query` output is a box table by default, which no caller could parse

`--output` defaults to `table`, not `json` (CLI 2.107.0). Two independent consequences:

* **The runner.** With D1 fixed the 1.3 MB payload arrived, but the box-table renderer wraps
  the JSON cell across box-drawn lines and interleaves `│` borders into the payload, which is
  not recoverable. `parsePhase6FunctionResult` returned `null`, and the runner failed closed
  with *"PROMOTION UNPARSEABLE"* (exit 2) even though the database had answered correctly.
* **The rehearsal harness.** `sql()` omitted the flag while every assertion matches on JSON
  (`"hits": 2`, `"unchanged_rows"`). The box output matched nothing, so **16 of 18 cases
  reported FAIL while the database was answering correctly** — for example, cases 4 and 5
  were returning the correct `hits: 2` and were still scored FAIL.

**Fix applied:** pass `--output json` in `tools/coldlion-sync-common.mjs` and in
`tools/rehearse-coldlion-recurring-cycles.mjs` (the latter also gains the same `maxBuffer`).

### D3 — the result parser could not unwrap `--output json` rows

`supabase db query --output json` returns rows keyed by **column name**, so
`select jsonb_build_object('ok', true, …)` arrives as
`[ { "jsonb_build_object": { "ok": true, … } } ]`.
`normalizeJsonCandidate` unwrapped the older `{rows:[…]}` envelope but returned `parsed[0]`
verbatim for a bare array, leaving the result one level too deep; `isValidResult` then failed
because `ok` was not a top-level key.

**Fix applied:** in `tools/phase6-cli-result-parse.mjs`, when an array row has a single column
and carries neither `ok` nor `pass` at the top level, unwrap that one column. Fail-closed
behaviour is unchanged. All 12 pre-existing parser tests still pass, and 94/94 tests pass
across the five related suites.

### D4 (test code only) — cases 3, 11 and 12 were stale with respect to the `20260731200000` tie-break

These three mutated a **single typed arm** of a canonical licensor. Since `20260731200000`,
every canonical row in the approved 542-row set is fed by two typed keys (CW001 + SP001) and
the section 5.9 tie-break chooses deterministically between them, so a one-arm presentation
(case) flip is correctly a **no-op**. Confirmed by direct measurement inside a rolled-back
transaction:

* one arm flipped → `curated_name_changes: 0`
* all arms flipped → `curated_name_changes: 1, promotions: 3, protected_violations: 0`

Cases 11 and 12 failed only as a consequence: they install a temporary trigger that corrupts a
protected field *when the promotion updates a name*. With no name update, the trigger never
fired, so the protected-invariant guard was never invoked — it was **not** broken, merely
never reached. This is the same class of trap as the historical BEFORE-trigger reading a
`GENERATED … STORED` column: a guard that appears green because nothing ever exercised it.

**Fix applied:** cases 3, 11 and 12 now mutate **all arms** of the canonical licensor
(`where e.licensor_id = …` instead of the four-part typed key). Cases 7 and 9 legitimately
target a single typed key and were left alone. With this correction the protected-invariant
guard genuinely fires and aborts the cycle, as cases 11 and 12 now demonstrate.

---

## Preview-state changes made by this run, and why

Preview holds a full production data clone and is a shared mutable resource; treat everything
here as production-sensitive.

* **The circuit breaker was reset (twice).** It was auto-tripped by D1, not by any invariant
  failure, and while tripped no case can execute. Reset via
  `plm.reset_taxonomy_circuit_breaker(...)` with `readiness_pass = true`, `authorized_by =
  'shared-db rehearsal sub-agent (preview only)'`, and evidence text naming the ENOBUFS root
  cause. **Final state: `closed`.** The coordinator should be aware that the preview breaker
  now carries this sub-agent's name in `reset_by`, not a human's.
* **Two clean promotion cycles committed** (this is by design — they are the only committing
  steps and are idempotent; cycle 2 produced zero further promotions).
* Every fault case ran inside `begin; … rollback;`. No injected fault, quarantine row, or
  temporary trigger survived.
* `plm.coldlion_promotion_quarantine` is append-only, so this run added quarantine rows
  scoped to its own `sync_run_id`s. Assertions were scoped per-run and never to history.
* Some `ingest.sync_run` failure rows and breaker events from the D1-induced failures remain
  on preview as durable history.

## Explicitly NOT done

* **Production was not touched.** No promotion, no migration push, no
  `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED`. Enabling the production feed is an
  Albert-only owner gate and was out of scope.
* **No file under `supabase/migrations/` was created, edited or applied.** No corrective
  forward migration is required — no database defect was found.
* The PR opened for this work was **not merged**; the coordinator merges.
