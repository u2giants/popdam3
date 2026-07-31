# Step 7A verification — the real recurring production ColdLion Licensor/Property feed

**Date:** 2026-07-29
**Environment:** PREVIEW `rjyboqwcdzcocqgmsyel` only. Production `qsllyeztdwjgirsysgai` was never
linked, never pushed to, never queried and never written during this work.
**Plan:** [`plan_coldlion_licensor_property_accelerated_cutover.md`](../../../plan_coldlion_licensor_property_accelerated_cutover.md)
Step 7A.
**Human response owner:** Albert Hazan.

---

## 0. What changed, in plain English

Before this step, the ColdLion Licensor/Property work could do a **one-time** job: copy the ERP's
list once and link 542 of its rows to our master records. That was proven and safe — but it is
**not** what "move the feed from DesignFlow to ColdLion" means. A feed has to run every day,
by itself, forever, and be trusted to change our master data without a person watching.

Step 7A builds that recurring feed and proves it on the practice database. It is still switched
**off** for production, and turning it on is Albert's separate decision (Step 8).

The single most important thing this step produced is not the feed — it is **four real defects
the rehearsal caught before anyone was asked to approve production.** One of them would have
quietly done nothing forever; another would have quietly ignored records the ERP stopped
sending. Both would have looked healthy.

---

## 1. The seven build items

| # | Item | Where | State |
|---|---|---|---|
| 1 | Production-only recurring workflow | `.github/workflows/coldlion-licensor-property-production.yml` | ✅ exists, **DISABLED** |
| 2 | Separate production schedule map + tests | `tools/coldlion-production-schedule-map.mjs` (+ `.test.mjs`) | ✅ |
| 3 | Guarded recurring promotion contract | `tools/coldlion-recurring-promotion.mjs` (+ `.test.mjs`), `tools/promote-coldlion-source-owned.mjs` | ✅ |
| 4 | Additive migration for source-owned values + promotion audit | 4 migrations, see §3 | ✅ applied to preview |
| 5 | Readiness fails without the recurring lane | `tools/coldlion-production-lane-readiness.mjs`, wired into `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` | ✅ |
| 6 | Two-cycle + fault-case preview rehearsal | `tools/rehearse-coldlion-recurring-cycles.mjs` | ✅ 14/14 |
| 7 | Docs, handoff, plan, AGENTS routing, evidence | this file + updates listed in §8 | ✅ |

---

## 2. The field-ownership split the feed enforces

| Owned by ColdLion (promotable) | Owned by Supabase (never written by the feed) |
|---|---|
| `core.taxonomy_source_ref.source_name` | `core.licensor.id`, `core.property.id` |
| `core.taxonomy_source_ref.source_code` | `core.property.licensor_id` (the parent edge) |
| `core.licensor.name` — **only** under the one approved rule | `core.licensor.status`, `core.property.status` |
| `core.property.name` — **only** under the one approved rule | `core.licensor.code`, `core.property.code` |

ColdLion's API supplies neither the parent edge nor any active/inactive flag, so it can never be
their author. **Absence from ColdLion is never delete and never inactivate. Presence is never
activate. A new ColdLion record is never auto-created.**

### The one approved deterministic rule

`coldlion_source_name_normalized_equivalent_v1` — apply ColdLion's name over the curated display
name **only when the two are the same name presented differently** (identical after casefold,
accent fold, `&`→`and`, punctuation/whitespace collapse). So `BATMAN` → `Batman` and
`TOM AND JERRY` → `Tom & Jerry` are applied.

A normalized-**different** name quarantines as `source_name_divergence`. That is the deliberate
hard line: from the payload alone, a genuine ERP rename is indistinguishable from a re-pointed
code — the `FR` class of bug that can attach a ColdLion *property* to the FRIENDS TV *licensor*.
ColdLion's new value is still recorded in the provenance layer, so nothing upstream is lost; a
human simply confirms the identity before a canonical name changes.

---

## 3. The four migrations, and why there are four

Step 7A budgeted **one** additive migration. It took four, and every extra one is a forward
correction of a defect the rehearsal caught. None of the earlier files was edited, because each
had already been applied to preview and AGENTS.md §4 rule 4 forbids editing an applied
migration — and here that rule is also the only thing that *works*: preview's ledger already
records those versions, so editing a file could never repair preview because the CLI would never
re-run it. Same pattern as the existing `20260727223000`, `20260727224500`, `20260728134500`.

| Version | Purpose |
|---|---|
| `20260729230000` | The additive schema: `plm.coldlion_promotion_audit`, `plm.coldlion_promotion_quarantine` (both append-only), `plm.coldlion_normalize_name()`, `plm.promote_coldlion_source_owned()` + `public` wrapper, two `api.*` admin readers, breaker watchdog extended 9 → 11 triggers |
| `20260729234500` | **Fault 1 + 2** fix |
| `20260729235500` | **Fault 3** fix |
| `20260730000500` | **Fault 4** fix |

### The four defects — all found by the rehearsal, none by unit tests

Every one of these existed while the JavaScript unit tests were green. That is the exact failure
mode recorded at the top of `tools/rehearse-coldlion-cutover-sequence.mjs`: each piece passed its
own test, but the sequence could not run.

1. **Fault 1 — `42703`, fatal.** The decision query referenced its own select-list alias
   `present_this_cycle` inside a `WHERE` clause. PostgreSQL does not allow that, so the promotion
   function **raised on every call and had never once executed.**
2. **Fault 2 — the dangerous one.** The collision rule quarantined any canonical row reachable
   from more than one typed key. Against preview it quarantined **542 of 542 approved rows — the
   entire feed** — because multi-key fan-in is the *approved design*: Albert's approved Phase 4
   mapping deliberately points 542 ColdLion source rows at 271 canonical rows, and every canonical
   row is fed by both `CW001` and `SP001`. Hidden behind Fault 1, this would have looked "safe"
   while silently promoting nothing, forever.
   **Corrected rule:** fan-in quarantines *only* when the contributing source rows propose
   **different** names — the only case where promotion would have to pick a winner.
   **A future session must not simplify this back to `key_count > 1`; that disables the feed.**
3. **Fault 3 — `42702`, fatal.** `sync_run_id` is both a `RETURNS TABLE` output column and a real
   column of the audit table, making two counting sub-selects ambiguous. Only reachable once
   Faults 1–2 were fixed, which is why it appeared on the second rehearsal cycle.
4. **Fault 4 — a silent failure.** `present_this_cycle` was a bare comparison, so a `NULL`
   `last_sync_run_id` made it `NULL`, and `not present_this_cycle` evaluated to `NULL` rather than
   `TRUE`. The `missing_source_record` arm never fired and the row fell through every other arm:
   **a record ColdLion stopped sending was silently neither promoted nor flagged.** Proven on
   preview — nulling one approved row's run id produced zero `missing_source_record` quarantines.
   Fixed by coalescing to `false`. This defeats the locked decision "absence never means delete or
   inactive", which only holds if absence is actually *detected*.

### A fifth defect, in the runner (not a migration)

`tools/promote-coldlion-source-owned.mjs` called `public.record_taxonomy_sync_alert` with the
wrong argument order (the signature is `severity, source_name, reason, …`). The durable alert
therefore failed to record and **the circuit breaker did not trip.** Fixed by switching to named
arguments. A repo-wide sweep confirmed this runner was the **only** miscalled site: all three
internal SQL callers (`20260726180000` lines 720 and 1020, `20260727221500` line 178) correctly
pass `'critical'` first, and the `public` wrapper forwards by matching parameter names.

Once fixed, the full fail-closed chain fired end to end, unprompted:
**promotion failure → durable critical alert → autotrip trigger → breaker tripped → next
promotion refused.** That is unplanned but genuine proof of the breaker chain.

---

## 4. Two-cycle rehearsal result — 14/14

`node tools/rehearse-coldlion-recurring-cycles.mjs` against preview:

```
[PASS] cycle 1 runs clean and establishes the approved links and source-owned values
[PASS] cycle 2 is IDEMPOTENT — identical counts, zero further promotions
[PASS] a legitimate ColdLion presentation change IS applied and audited
[PASS] a normalized-DIFFERENT name quarantines instead of overwriting the curated name
[PASS] renaming ONE ARM of an approved fan-in escalates to a cross-division COLLISION
[PASS] a NEW ColdLion record quarantines and is never auto-created
[PASS] a MISSING record quarantines; absence never deletes or inactivates
[PASS] a RE-KEYED record quarantines
[PASS] a row that loses its approved link is treated as unapproved, never promoted
[PASS] fan-in with CONFLICTING source names quarantines (fan-in alone does not)
[PASS] a STATUS change caused BY the promotion trips the protected-invariant guard and aborts
[PASS] a PARENT-EDGE change caused BY the promotion trips the protected-invariant guard and aborts
[PASS] a TRIPPED breaker refuses the next promotion outright
[PASS] protected hashes and DesignFlow refs are readable after the whole rehearsal
14/14 steps passed
```

Both clean cycles returned identically — **560 source rows, 542 linked, 542 unchanged, 18
quarantined (`new_source_record`, the deliberately unapproved ColdLion-only candidates such as
NASA / ZAG / FRIDA KAHLO), 0 curated name changes, 0 protected violations** — which is the
idempotency proof. The SQL result matched the independent JavaScript planner exactly; the
promotion function aborts if the two ever disagree.

Every fault case runs inside `begin; … rollback;`. Nothing injected was kept.

### Two rehearsal-design corrections worth recording

- The protected-invariant cases originally mutated status/parent **before** calling the function,
  which can never trip the guard: the function captures its baseline as its first act, so a
  pre-existing change is correctly not the promotion's fault. They now install a temporary
  trigger so the **promotion's own write** causes the protected change. That is the real test.
- Quarantine assertions originally counted the whole append-only table, which includes rows from
  earlier committed cycles, so they measured history rather than the case. They are now scoped to
  the `sync_run_id` the case created.

---

## 5. Readiness

`node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs --apply --linked`
→ **`ready=true`** on preview, including all eight new production-lane checks:

`production_workflow_exists`, `production_workflow_targets_only_production`,
`production_schedule_map_is_valid`, `all_required_production_secret_names_are_wired`,
`every_production_runner_call_has_four_part_authorization`,
`disabled_lane_skips_loudly_without_fallback`,
`production_enable_variable_is_intentionally_off_before_approval`,
`recurring_promotion_contract_passes`, `recurring_promotion_objects_exist_in_the_database`.

The enable-variable check is **conditional on a durable Step 8 approval artifact**: with no
approval on file the variable must be off, and once
`docs/verification/coldlion-licensor-property-step8-approval-*/approval.json` exists either state
is accepted. A flat "must be false" rule would turn readiness permanently red the moment Step 8
legitimately enables the lane, training whoever is on call to ignore a red gate.

Offline suite: **192 tests, 192 pass.** `bash scripts/check-sql.sh` passes. No duplicate migration
versions.

---

## 6. Production safety — the state this leaves behind

- `.github/workflows/coldlion-licensor-property-production.yml` **exists and is DISABLED.**
- Repository variable `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` **was not created** and must
  stay absent until Step 8.
- Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PRODUCTION`, `COLDLION_API_KEY` are
  referenced **by name only**. None was created, read, or printed.
- **No production write, link, query, or migration occurred.**
- While disabled the workflow skips with a `::warning::` on every trigger and performs no work.
  It has **no preview fallback and no dry-run fallback** — a lane that quietly dry-runs is a lie.
- The gate job holds no production environment and no production DB password; the production job
  cannot start unless the gate says the lane is enabled.

---

## 7. What preview now contains that `main` does not

Relevant to any other session using preview as a baseline:

- The four migrations above, all additive.
- `plm.taxonomy_breaker_enforcement_status()` now reports **`expected_count: 11`** (was 9) —
  expected, not drift.
- Append-only evidence from the committed clean cycles: rows in `plm.coldlion_promotion_audit`
  and `plm.coldlion_promotion_quarantine`, and `ingest.sync_run` rows under
  `coldlion_licensors_properties_promote_source_owned`.
- The circuit breaker was auto-tripped by a genuine failure and then **reset with recorded
  authorization** after the defect was fixed; it is `closed`.
- Two critical alerts raised by the failed runs were **acknowledged** after the fix.
- Health is green: `ok: true`, 38 linked licensors / 504 linked properties / 542 ColdLion refs.
- **No canonical row, name, status, parent edge or UUID was changed at any point.**

---

## 8. Documents updated

- This evidence file (new).
- `plan_coldlion_licensor_property_accelerated_cutover.md` — STATUS table, Step 7A closeout,
  Steps 8–10 drift review.
- `docs/verification/coldlion-licensor-property-step7-production-package-20260728/README.md` —
  the one-time package is explicitly **not** the feed switch.
- `fix_coldlion_licensor_property_phase6_handoff.md` — recurring-lane pointer.
- `AGENTS.md` §6.1 — routing.
- `HANDOFF.md` — ColdLion section only.
