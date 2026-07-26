# Implementation plan — accelerated ColdLion Licensor/Property cutover

**Written:** 2026-07-26  
**Decision owner:** Albert Hazan  
**Repository:** `u2giants/shared-db`  
**Fresh-session starting point:** Step 1 — reconcile this plan with the latest `main`, then replace
the obsolete 14-day Phase 6 exit gate before making any production change.

## STATUS

| Step | State | Date | Evidence / next action |
|---|---|---|---|
| 1. Reconfirm current state and serialize work | ⬜ Open | 2026-07-26 | Start here in a fresh implementation session |
| 2. Replace the elapsed-time Phase 6 gate | ⬜ Open | 2026-07-26 | Update the plan, handoff, workflow contracts, and monitoring language |
| 3. Build the readiness evaluator | ⬜ Open | 2026-07-26 | One command must prove or deny cutover readiness |
| 4. Strengthen fail-closed production monitoring | ⬜ Open | 2026-07-26 | Alerts, circuit breaker, and response evidence |
| 5. Rehearse the complete cutover and rollback on preview | ⬜ Open | 2026-07-26 | Preview `rjyboqwcdzcocqgmsyel` only |
| 6. Verify the applications at their real maturity levels | ⬜ Open | 2026-07-26 | PLM live; DAM partial; CRM/PM development |
| 7. Prepare the production change package | ⬜ Open | 2026-07-26 | Read-only production inventory plus bounded apply manifest |
| 8. Obtain Albert's production-window approval | ⬜ Open | 2026-07-26 | Exact migrations/actions/rollback named before approval |
| 9. Execute the production cutover | ⬜ Open | 2026-07-26 | Separate fresh session; only after Step 8 |
| 10. Run intensified monitoring and close out | ⬜ Open | 2026-07-26 | 24-hour watch, then normal guarded operation |

This plan complements, and does not replace, the historical evidence in
[`fix_coldlion_licensor_property_phase6_handoff.md`](fix_coldlion_licensor_property_phase6_handoff.md)
and the full original plan in
[`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md).
Those files explain what was already built and tested. Where they require 14 distinct scheduled
dates or an earliest exit of 2026-08-09, this plan records Albert's 2026-07-26 decision to replace
that elapsed-time gate. Until Steps 1–5 are implemented and verified, the existing production
prohibition remains in force.

---

## 1. The ultimate goal

Move the routine Licensor and Property master-data feed from DesignFlow to ColdLion promptly,
without waiting 14 days merely to observe slow-moving data, while protecting the stable records
and relationships every POP application relies on.

ColdLion is POP's ERP and is the canonical upstream source for Licensor and Property source
identity and descriptions. If ColdLion exposes a real source change, the integration must accept
that source truth within the explicitly allowed fields. If the integration breaks, loses data,
cross-matches entities, changes protected relationships, or causes an application regression,
that is our defect: the system must detect it quickly, stop unsafe work, alert loudly, and support
a rehearsed operational rollback.

The replacement safety model is:

1. prove the complete behavior on preview;
2. evaluate concrete invariants rather than elapsed calendar time;
3. cut over once in an explicitly approved production window;
4. fail closed before protected canonical data can be damaged;
5. watch the first production cycle intensively and react immediately;
6. retain DesignFlow only for relationship/status facts that ColdLion does not supply until a
   separate curation replacement is proven.

**If a step conflicts with this goal, the goal wins—stop and flag it.**

---

## 2. What this application is

`u2giants/shared-db` is the source-of-truth repository for the hosted Supabase database shared by
POP's applications. It contains timestamped PostgreSQL migrations, database tests, Node-based
integration runners, GitHub Actions workflows, and the DB Data Admin application.

The relevant data path is:

```text
ColdLion ERP merch-group dictionaries
  → ingest.raw_record
  → plm.erp_licensor / plm.erp_property
  → guarded source references and typed links
  → core.licensor / core.property
  → application-facing database views and APIs
```

The canonical application records are `core.licensor` and `core.property`. Their UUIDs must remain
stable. ColdLion is canonical for source identities and descriptions, but its API does **not**
provide:

- the Property-to-Licensor parent relationship; or
- active/inactive lifecycle status.

Those two facts remain curated in Supabase and are currently corroborated by DesignFlow. This is
not a matter of preferring DesignFlow over ColdLion; the required facts are absent from ColdLion.

Environments:

| Environment | Identifier / location | Permitted use in this plan |
|---|---|---|
| Preview Supabase | `rjyboqwcdzcocqgmsyel` | All implementation, destructive drills, rollback rehearsal, and integration proof |
| Production Supabase | `qsllyeztdwjgirsysgai` | Read-only inventory until Step 8 approval; bounded changes only in Step 9 |
| Repository | `https://github.com/u2giants/shared-db` | Branch + PR; AI merges after required gates |
| DesignFlow PLM | six `popcre/designflow-*` repos/services | Only fully live application; primary real-world regression gate |
| DAM | PopDAM runtime and database paths | Partially live; verify only the live Licensor/Property-dependent paths |
| CRM | PopCRM development environment | Development compatibility check, not a live-production claim |
| PM/PIM | PopPIM development environment | Development compatibility check, not a live-production claim |
| DB Data Admin | `apps/db-data-admin/` | Administrative data-contract and tree/filter verification surface |

The implementation sessions must use fresh context at the natural cut points identified in Step 9.

---

## 3. What triggered this work

The original Phase 6 plan required at least 14 consecutive calendar days and 14 distinct green
scheduled observation dates, with the earliest exit stated as 2026-08-09. The machinery was
completed and enabled on preview on 2026-07-26.

Albert clarified on 2026-07-26 that:

1. ColdLion Licensor/Property data changes very slowly, so 14 days are unlikely to exercise a
   meaningful data change;
2. ColdLion is the ERP and canonical upstream source, so a legitimate difference is not evidence
   that ColdLion is wrong;
3. if the cutover fails, the integration on our side must be fixed;
4. DesignFlow PLM is the only fully live application;
5. CRM and PM are still in development; and
6. DAM is only partially live.

Therefore the calendar delay has poor risk-reduction value. The safer and faster approach is to
prove deterministic invariants and rollback behavior, then monitor the actual production rollout
closely.

---

## 4. Scope

### In scope

- Replace the 14-day/2026-08-09 Phase 6 exit rule with a concrete readiness gate.
- Preserve all existing Phase 4 and Phase 6 preview evidence, including failed runs and drills.
- Create one repeatable readiness evaluator for the complete cutover preconditions.
- Strengthen fail-closed monitoring and alerting for the production ColdLion lane.
- Rehearse the exact production cutover and operational rollback on preview.
- Define application checks that match each application's actual maturity.
- Prepare a bounded production migration/apply manifest that excludes unrelated backlog.
- Perform the production cutover only after Albert approves the exact window and actions.
- Watch the first production execution and the following 24 hours intensively.
- Update the original plan, dedicated handoff, verification evidence, and repository router so a
  fresh session cannot accidentally restore the obsolete waiting rule.

### Not in this plan

- Starting Phase 8 or dropping `plm.licensor_import` / `plm.property_import`.
- Removing DesignFlow as the temporary provider/comparison source for parent and lifecycle facts.
- Changing curated active/inactive statuses or Property parent assignments.
- Creating the unapproved ColdLion-only records from Phase 5.
- Linking NASA or any other mapping Albert did not approve.
- Rebuilding ColdLion, correcting its source data, or introducing a second upstream.
- Replacing the shared canonical UUIDs.
- Refactoring the item, style-guide, character, likeness, or royalty models.
- Declaring CRM, PM, or all of DAM production-proven when they are not fully live.
- Promoting unrelated pending migrations with `--include-all`.

---

## 5. Current state of the code and rollout

The implementer must reverify these facts against the latest `origin/main`; they are accurate as of
2026-07-26:

1. `HANDOFF.md:3` identifies Phase 6 as the current priority.
2. `fix_coldlion_licensor_property_phase6_handoff.md:1` records the complete Phase 6 machinery,
   workflow runs, failures, hashes, schedule, and constraints.
3. `fix_coldlion_licensor_property_cutover.md:742` contains the original §9.4 invariant criteria.
4. `fix_coldlion_licensor_property_cutover.md:991` defines Phase 6.
5. `.github/workflows/coldlion-licensor-property-phase6-parallel.yml` runs four preview lanes:
   DesignFlow, ColdLion `mirror_only`, daily comparison, and health.
6. `tools/compare-coldlion-designflow-daily.mjs` records an append-only comparison and fails closed.
7. `tools/check-coldlion-designflow-sync-health.mjs` checks lane freshness/failures and returns
   nonzero on unhealthy results.
8. `tools/phase6-preview-guards.mjs` prevents Phase 6 tools from targeting production.
9. `tools/phase6-cli-result-parse.mjs` parses the actual Supabase CLI output and rejects malformed
   or duplicate keys.
10. Migration
    `supabase/migrations/20260726180000_coldlion_licensor_property_phase6_parallel_run.sql`
    is applied to preview and must never be edited.
11. `PHASE6_SCHEDULE_ENABLED=true` has enabled the preview schedule since
    `2026-07-26T13:27:41Z`.
12. Phase 4 linked only the approved 542 exact-compatible ColdLion source rows on preview:
    38 Licensor rows and 504 Property rows. Canonical UUID, status, and parent hashes stayed
    unchanged.
13. Phase 5 is not needed because Albert approved no canonical creations.
14. Production has not received Phase 4 or Phase 6 cutover work under this workstream.
15. Existing proof includes:
    - green DesignFlow and ColdLion runs;
    - green comparison and health runs;
    - a preserved pre-fix parser failure;
    - forced comparison and health failure drills that exited nonzero;
    - idempotent repeated linking;
    - canonical UUID/status/parent preservation;
    - preview rollback evidence from Phase 4.

The existing recurring monitor may continue collecting preview evidence while this plan is
implemented, but its count of qualifying days is no longer the proposed readiness decision.
Do not delete its observations; historical evidence remains valuable.

---

## 6. Key findings and root cause

1. **The 14-day gate measures time more than risk.** ColdLion Licensor/Property data is
   slow-moving, so 14 identical days add little proof beyond deterministic replay/idempotency
   tests already performed.
2. **ColdLion is source truth for the fields it actually supplies.** A name or source-identity
   difference must be handled as an expected upstream change, subject to the field allowlist—not
   treated automatically as unexplained drift.
3. **The highest-risk failure is our mapping/promotion logic.** Cross-entity matching (`FR`),
   incomplete pagination, malformed output, accidental UUID/status/parent mutation, or a bad
   migration could break consumers even if ColdLion is correct.
4. **Protected facts remain outside ColdLion.** Because ColdLion does not supply lifecycle or
   parent relationships, the cutover must not let its lane change them. DesignFlow remains a
   temporary comparison/input for those fields.
5. **Application confidence must match reality.** DesignFlow PLM is the primary live behavior
   check. DAM can prove only its live subset. CRM and PM can prove compatibility in development,
   not absence of a production regression.
6. **Rapid detection must be paired with safe behavior.** An alert without a fail-closed write
   path is too late. The importer must finish raw/mirror recording while refusing unsafe canonical
   mutation when an invariant fails.
7. **Existing append-only evidence is the right design.** Failures and same-day drills must never
   be overwritten by a later green observation.
8. **The real GitHub Actions parser failure is important evidence.** Run `30203386465` proved that
   environment-specific output can break a runner even when the database result is green; the
   strict parser fix must remain tested.

---

## 7. Approaches considered and rejected

| Approach | Decision | Why |
|---|---|---|
| Wait for 14 calendar days of mostly identical data | **Rejected 2026-07-26** | It delays business value without materially exercising slow-moving source data |
| Treat DesignFlow as the canonical judge of ColdLion names/identities | **Rejected** | ColdLion is the ERP and source truth for those fields |
| Remove DesignFlow entirely during this cutover | **Rejected** | ColdLion lacks parent and lifecycle facts; Phase 8 is separate |
| Trust row counts alone | **Rejected** | Matching counts can hide wrong identities, cross-entity links, changed UUIDs, or missing pages |
| Continue after an alert and fix data later | **Rejected** | Protected canonical mutations must fail closed before damage |
| Automatically roll back database schema on any alert | **Rejected** | Schema rollback can be more dangerous than disabling the source schedule; operational rollback is the first response |
| Automatically overwrite names, statuses, and parents from one payload | **Rejected** | Only explicit source-owned fields may update; status/parents are not in ColdLion |
| Use `--include-all` to apply production backlog | **Rejected** | It could promote unrelated migrations from other workstreams |
| Rewrite the applied `20260726180000` migration | **Rejected** | Applied migrations are immutable; corrections require a new timestamped migration |
| Overwrite daily evidence by date | **Rejected** | Same-day failure/drill evidence would disappear |
| Route scheduled jobs by wall-clock time | **Rejected** | Delayed GitHub jobs can run in the wrong lane; exact schedule strings are required |
| Treat every application as fully live | **Rejected** | It would make false verification claims and misdirect regression effort |
| Edge Function + Vault + `pg_net` for the existing Phase 6 machinery | **Previously rejected** | The repository already standardized this work on GitHub Actions and Node runners |

---

## 8. Design decisions

### Locked decisions

1. **ColdLion is canonical for Licensor/Property source identity and descriptions** (Albert,
   2026-07-26).
2. **No 14-day waiting requirement** once the replacement invariant, rehearsal, monitoring, and
   approval gates in this plan pass (Albert, 2026-07-26).
3. `core.licensor` / `core.property` remain the application-facing canonical layer with stable
   UUIDs.
4. `core.property.licensor_id` and canonical status remain curated Supabase facts because
   ColdLion does not provide them.
5. Existing approved mapping scope remains exactly 542 source rows; no Phase 5 creates and no
   additional links are implied.
6. Production is read-only until Albert approves the exact production window and bounded action.
7. The importer and monitoring fail closed; no silent fallback.
8. Failures and drills remain append-only evidence.
9. DesignFlow PLM is the primary live application gate; DAM is partial; CRM and PM are
   development compatibility gates.
10. Phase 8 is out of scope.

### Open implementation judgments

These do not require a new business decision if the implementer follows the stated criteria:

1. **Monitoring frequency:** use the lowest frequency that detects a failed cutover promptly
   without creating overlapping jobs. Recommendation: health evaluation every 15 minutes for the
   first 24 hours, then hourly; full ColdLion snapshots remain daily because the data is slow.
2. **Alert transport:** reuse the repository's existing durable database alert and GitHub Actions
   failure surfaces. Add another channel only if the existing path cannot notify Albert/engineering
   promptly and durably.
3. **Circuit-breaker implementation:** prefer disabling only the ColdLion promotion/schedule path
   while leaving mirrors/evidence intact. It may be implemented as a repository variable checked by
   the job plus a database guard; never delete data automatically.
4. **One actual scheduled preview cycle:** it is useful as a scheduler wiring check but is not an
   elapsed-time gate. If the scheduled cycle has already run when implementation starts, reuse its
   preserved evidence.

---

## 9. Numbered implementation plan

### Step 1 — Reconfirm current state and serialize work

**Files/surfaces:** repository state, open PRs, GitHub Actions, preview migration ledger, latest
Phase 4/6 evidence.

1. Read `AGENTS.md`, `HANDOFF.md` current priority,
   `fix_coldlion_licensor_property_phase6_handoff.md`, this plan, and the complete
   `fix_coldlion_licensor_property_cutover.md`.
2. Run the shared-db in-flight checks from `AGENTS.md` §6.
3. Pull the latest `origin/main` without overwriting concurrent work.
4. Confirm commit identity with `git var GIT_COMMITTER_IDENT`.
5. Read-only inspect production migration history only to determine the pending Phase 4/6
   manifest. Do not link, push, call mutation endpoints, or load unsuffixed production secrets.
6. Reconfirm preview project ref in every planned command.
7. Record any new scheduled preview success or failure without rewriting existing evidence.

**Dependency:** none.  
**Fresh-session cut:** start the implementation here.  
**Verification gate:** a dated preflight note lists the branch, open related PRs, current preview
migrations, production pending manifest, latest preview run IDs, and confirms no production
mutation occurred. If another licensor/property schema change is in flight, stop and serialize it.

### Step 2 — Replace the elapsed-time Phase 6 exit gate

**Files:**

- `fix_coldlion_licensor_property_cutover.md`;
- `fix_coldlion_licensor_property_phase6_handoff.md`;
- `HANDOFF.md`;
- `AGENTS.md`;
- `docs/verification/coldlion-licensor-property-phase6-20260726/README.md`;
- `.github/workflows/coldlion-licensor-property-phase6-parallel.yml`;
- related static tests in `tools/coldlion-licensor-property-phase6.test.mjs` and
  `tools/phase6-schedule-map.test.mjs`.

1. Preserve the old 14-day requirement as historical context with its retirement date and reason.
2. Replace the active exit gate with the readiness conditions in Step 5:
   - complete guarded preview snapshot;
   - identical replay/idempotency proof;
   - complete pagination/division/type proof;
   - approved-link stability;
   - protected hash stability;
   - forced-failure and rollback rehearsal;
   - application checks by actual maturity;
   - monitoring/circuit-breaker proof;
   - no unexplained difference under the corrected ownership model.
3. Remove `2026-08-09` as an active blocker while preserving it in the historical decision record.
4. Make clear that a legitimate ColdLion source-name/source-identity change is not a failure; the
   failure is unsafe or incorrect handling by our integration.
5. Keep production prohibited until Step 8 approval.
6. Update the existing heartbeat/automation prompt so it evaluates readiness and failures rather
   than counting toward an obsolete 14-day gate. Keep it preview-only until production approval.

**Dependency:** Step 1.  
**Verification gate:** `rg` finds no active instruction that requires 14 qualifying days or
2026-08-09, while the historical record remains. Static tests prove schedule jobs remain
preview-guarded and append-only. The automation view shows the updated policy.

### Step 3 — Build one deterministic readiness evaluator

**Recommended files:**

- new `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`;
- new `tools/evaluate-coldlion-licensor-property-cutover-readiness.test.mjs`;
- reuse `tools/phase6-preview-guards.mjs`;
- reuse `tools/phase6-cli-result-parse.mjs`;
- add a read-only database function/view only if existing Phase 6 functions cannot return every
  required fact; any database addition must be a new timestamped migration.

The evaluator must accept an explicit environment/project ref and default to preview. It must
refuse production unless a separately named execution flag is supplied in the approved Step 9
session. It must output a machine-readable and human-readable readiness result containing:

- target project ref and environment;
- latest successful ColdLion and DesignFlow run IDs/timestamps;
- complete division/type/page accounting;
- mirror counts and source snapshot hash;
- approved-link counts (38 Licensor / 504 Property unless later approved evidence changes them);
- canonical Licensor/Property counts;
- canonical UUID hashes;
- separate status hashes;
- Property parent-edge hash;
- ColdLion and DesignFlow source-reference counts;
- unresolved/quarantined/new-candidate changes;
- unexpected canonical writes grouped by field;
- latest non-drill comparison result;
- outstanding alerts/failures;
- rollback rehearsal identifier;
- application-check evidence identifiers;
- overall `ready: true|false`;
- explicit blocking reasons.

It must reject malformed, duplicate, missing, ambiguous, stale, or environment-mismatched data and
exit nonzero. It must never infer readiness from row counts alone.

**Dependency:** Step 2 policy must be settled first.  
**Verification gate:** unit fixtures cover green, missing page, wrong project, stale run, changed
UUID, changed status, changed parent, unexpected link, malformed CLI result, duplicate key,
unexplained difference, and preserved legitimate source-owned name change. A green preview
evaluation exits 0; every unsafe fixture exits nonzero with a specific blocking reason.

### Step 4 — Strengthen fail-closed production monitoring and rapid response

**Files/surfaces:**

- `.github/workflows/coldlion-licensor-property-phase6-parallel.yml` or a clearly named
  production successor workflow;
- `tools/check-coldlion-designflow-sync-health.mjs`;
- `tools/compare-coldlion-designflow-daily.mjs`;
- new timestamped SQL only if a circuit-breaker/audit field is missing;
- operational runbook section in the Phase 6/7 handoff.

Implement:

1. a production workflow that requires an explicit repository variable such as
   `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true`; default is off;
2. exact project-ref guards that make preview and production lanes unambiguous;
3. a concurrency group preventing overlapping importer/promoter runs;
4. daily full ColdLion snapshot and weekly full reconciliation;
5. intensified health checks every 15 minutes for the first 24 hours after cutover, then hourly;
6. an operational circuit breaker that prevents further ColdLion canonical promotion after any
   protected invariant, parsing, completeness, authentication, or pagination failure;
7. continued mirror/failure evidence where safe, without deleting or overwriting failed rows;
8. a loud GitHub Actions failure plus durable database alert containing run ID, environment,
   failed invariant, last green run, and the exact first response;
9. no automatic status, parent, UUID, deletion, or broad schema rollback;
10. a response runbook:
    - disable the ColdLion production schedule/promotion variable;
    - leave mirrors and evidence intact;
    - confirm DesignFlow/curated parent and status paths remain available;
    - compare protected hashes;
    - classify application impact;
    - fix forward through shared-db;
    - re-enable only after preview reproduction and verification.

**Dependency:** Step 3 defines the readiness/invariant contract.  
**Verification gate:** preview forced-failure drills prove the job exits nonzero, writes a durable
alert, prevents the next promotion attempt, retains evidence, and leaves UUID/status/parent hashes
unchanged. A recovery drill proves an authorized re-enable succeeds after a green evaluation.

### Step 5 — Rehearse the complete cutover and rollback on preview

**Environment:** preview `rjyboqwcdzcocqgmsyel` only.

1. Capture a fresh baseline of canonical counts, UUIDs, status, parents, source refs, links,
   mirrors, alerts, and latest successful runs.
2. Run a complete ColdLion full snapshot.
3. Run it identically again and prove idempotency.
4. Run `link_approved` with exactly the frozen 542-row approved mapping and prove it remains
   unchanged/idempotent.
5. Simulate a legitimate source-owned name change and prove only the permitted mirror/source field
   changes; protected canonical facts do not.
6. Simulate incomplete pagination, missing division/type, malformed output, and unexpected
   protected-field drift. Prove every case fails closed and alerts.
7. Exercise the circuit breaker and operational rollback.
8. Restore the preview fixture to its documented baseline without deleting failure evidence.
9. Run the Step 3 readiness evaluator.
10. Write a dated append-only verification artifact containing commands, run IDs, hashes,
    expected failures, and recovery evidence.

**Dependency:** Steps 3–4.  
**Fresh-session cut:** use a separate session for this operational rehearsal.  
**Verification gate:** the evaluator reports `ready=true`; all protected hashes match; every
forced failure remains in evidence; rollback returns the operational path to a green state; no
production credential, URL, project ref, or mutation appears in logs.

### Step 6 — Verify applications at their real maturity levels

Application checks must use existing test accounts from 1Password vault `vibe_coding`; never write
credentials into evidence.

1. **DesignFlow PLM — primary live gate.** Against its approved nonproduction/preview-connected
   environment, verify Licensor and Property selectors, item creation/reference validation,
   existing item display, tracking references, and a representative UUID-deep-link or saved
   selection. Confirm no application error logs attributable to the cutover.
2. **DAM — partial-live gate.** Identify and verify only the currently live paths that read
   Licensor/Property data, including any asset/style-guide lookup in active use. State explicitly
   which DAM areas were not tested because they are not live or not dependent.
3. **CRM — development compatibility.** Verify its development Licensor/Property consumers if any.
   Record “not applicable” with code-search evidence if CRM has no dependency.
4. **PM/PIM — development compatibility.** Verify development pickers and saved UUID references.
5. **DB Data Admin — administrative contract.** Verify Licensor/Property tree, filters, linked
   parent display, inactive visibility rules, and absence of duplicate/cross-entity rows.

**Dependency:** Step 5 green preview state.  
**Verification gate:** the evidence names environment, URL, tested path, expected result, actual
result, and screenshot/HTTP/log proof for each applicable check. The conclusion must say:
“DesignFlow PLM live behavior verified; DAM live subset verified; CRM/PM development compatibility
verified,” not “all production applications verified.”

### Step 7 — Prepare the bounded production change package

**No production mutation is authorized in this step.**

1. Create a detached temporary worktree from the exact proposed `origin/main` commit.
2. Read-only compare the full local migration list with the production migration ledger.
3. Produce an explicit allowlist of only the migrations required for the approved
   Licensor/Property cutover.
4. Exclude every unrelated pending migration. Never use `--include-all`.
5. Produce the exact workflow/CLI commands that Step 9 will run, with project ref displayed before
   execution and secret references by 1Password/GitHub name only.
6. Prepare the pre-cutover export/hash command, post-cutover verification command, application
   smoke checklist, circuit-breaker command, and rollback commands.
7. Record the expected database object changes and explicitly state that canonical data rows,
   statuses, and parents are not expected to change except the already approved source refs/links.

**Dependency:** Steps 5–6 green and CI merged to `main`.  
**Fresh-session cut:** end the implementation/rehearsal session after this package is reviewed.  
**Verification gate:** a second read-only review shows the manifest contains only the named
Licensor/Property migrations and actions; every command names
`qsllyeztdwjgirsysgai`; no command includes `--include-all`; rollback is executable without a
schema drop.

### Step 8 — Obtain Albert's production-window approval

Present Albert one concise approval request naming:

- exact production project `qsllyeztdwjgirsysgai`;
- exact migration versions;
- exact data modes (`mirror_only`, approved 542-row `link_approved`, or other explicitly justified
  mode);
- schedule/variable to be enabled;
- expected application-visible effect;
- maximum likely blast radius;
- pre-cutover backup/hash evidence;
- monitoring period and alert behavior;
- exact operational rollback.

**Dependency:** Step 7.  
**Verification gate:** Albert explicitly approves the named production window and actions in the
current chat. General statements such as “go ahead with the project” do not count.

### Step 9 — Execute the production cutover

**Use a fresh session. Re-read every downstream step and the latest status table before acting.**

1. Re-run identity, clean-worktree, in-flight PR, and production-target checks.
2. Capture the secure pre-cutover export and public non-secret hashes.
3. Run a bounded production dry-run from the detached worktree and compare it byte-for-byte with
   the approved manifest.
4. Stop if any additional migration/action appears.
5. Apply only the approved migrations.
6. Verify actual database objects, not only the migration ledger.
7. Run one full guarded ColdLion `mirror_only` snapshot.
8. Run only the approved linking/promotion mode and mapping set.
9. Verify canonical UUID, status, and parent hashes.
10. Run the readiness evaluator in its explicitly production-authorized mode.
11. Run the application checks from Step 6 against their appropriate real environments, with
    DesignFlow PLM as the primary live gate.
12. Enable the normal production schedule and intensified health monitoring.
13. If any protected gate fails, execute the operational rollback immediately; do not improvise a
    schema/data cleanup.

**Dependency:** explicit Step 8 approval.  
**Verification gate:** migration objects exist; run accounting is successful; approved links only;
protected hashes are unchanged; DesignFlow PLM live checks pass; applicable DAM live checks pass;
CRM/PM development checks pass; monitoring is active; GitHub Actions and database alerts are
green. Report PR, merge SHA, workflow IDs, sync UUIDs, and evidence path.

### Step 10 — Intensified monitoring, reaction, and closeout

For the first 24 hours:

1. evaluate health every 15 minutes without rerunning the slow full import each time;
2. inspect the first scheduled ColdLion full snapshot and comparison;
3. inspect DesignFlow relationship/status preservation;
4. watch application error telemetry for DesignFlow PLM and the live DAM subset;
5. keep CRM/PM checks in their development environments;
6. preserve every success and failure append-only;
7. disable the ColdLion production schedule/promotion immediately on a protected invariant failure;
8. reproduce and fix the defect on preview before re-enabling production.

After one fully successful scheduled production cycle and 24 hours with no unexplained alert,
reduce health evaluation to hourly while retaining daily full snapshots and weekly reconciliation.
This is an operational stabilization gate, not permission to start Phase 8.

**Dependency:** Step 9.  
**Verification gate:** the evidence contains the first production scheduled run, 24-hour health
summary, alert review, application telemetry checks, and either a clean stabilization conclusion or
the complete failure/rollback/fix-forward record. Update all plan/handoff STATUS sections and
remove the old monitoring automation only when the work is genuinely complete.

---

## 10. Tests required

### Existing suites that must stay green

- `node --test tools/phase6-preview-guards.test.mjs`
- `node --test tools/phase6-schedule-map.test.mjs`
- `node --test tools/phase6-cli-result-parse.test.mjs`
- `node --test tools/coldlion-licensor-property-phase6.test.mjs`
- `node --test tools/compare-coldlion-designflow-daily.test.mjs`
- `node --test tools/check-coldlion-designflow-sync-health.test.mjs`
- `bash scripts/check-sql.sh`
- relevant rolled-back Supabase SQL contract tests, including
  `supabase/tests/coldlion_licensor_property_phase6_contracts.sql`

### New readiness-evaluator tests

Add named cases proving:

1. `green_complete_preview_is_ready`;
2. `wrong_project_ref_is_blocked`;
3. `production_requires_explicit_authorization`;
4. `missing_page_is_blocked`;
5. `missing_required_division_or_type_is_blocked`;
6. `stale_or_failed_lane_is_blocked`;
7. `uuid_hash_change_is_blocked`;
8. `status_hash_change_is_blocked`;
9. `parent_hash_change_is_blocked`;
10. `unexpected_link_count_or_mapping_hash_is_blocked`;
11. `legitimate_source_owned_name_change_is_allowed`;
12. `canonical_name_or_curated_field_change_is_blocked`;
13. `malformed_cli_output_is_blocked`;
14. `duplicate_cli_key_is_blocked`;
15. `unexplained_reconciliation_difference_is_blocked`;
16. `preserved_failure_does_not_get_overwritten_by_green_run`;
17. `elapsed_time_alone_never_sets_ready`.

### New circuit-breaker tests

Prove:

1. an invariant failure writes durable evidence and disables further promotion;
2. mirror evidence remains available;
3. protected canonical fields remain unchanged;
4. a second scheduled attempt cannot promote while disabled;
5. an explicit authorized re-enable after a green preview evaluation works;
6. preview and production variables/project refs cannot be crossed;
7. concurrent jobs do not overlap.

### Operational integration tests

On preview, capture one successful complete cycle, one identical replay, each forced failure,
rollback, recovery, and one scheduled-event routing proof. Production integration tests occur only
inside the approved Step 9 window.

---

## 11. Constraints, standing rules, and gotchas

1. Shared-db uses branch + PR; the AI merges after the documented checklist passes.
2. Verify `git var GIT_COMMITTER_IDENT` before the first commit. It must be
   `Albert Hazan <u2giants@users.noreply.github.com>`.
3. Do not edit applied migrations. Add a new timestamped migration for database corrections.
4. Preview first; production is read-only until Step 8 approval.
5. Never use `--include-all`.
6. Do not run direct ad-hoc DDL or dashboard schema edits.
7. Keep canonical UUIDs stable.
8. ColdLion must never update canonical status or Property parent relationships.
9. ColdLion absence must never delete or inactivate canonical rows.
10. ColdLion presence must never activate a canonical row.
11. Natural keys require company + division + merch-group type + code; never match on code alone.
12. `FR` cannot cross-match a ColdLion Property to the FRIENDS TV Licensor.
13. NASA, ZAG, FRIDA KAHLO, ColdLion-only candidates, and all other unapproved records remain
    outside the approved mapping/create set.
14. Failures survive rollback and are never overwritten.
15. Exact GitHub schedule strings select lanes; never use wall-clock routing.
16. GitHub's Supabase CLI output can contain Go-style `map[...]`; keep the strict real-output parser
    fixtures and fail closed.
17. Serialize 1Password reads. Values never enter files, logs, commands visible in process listings,
    or commits.
18. Use the Supabase CLI/linked workflow path; `psql` is not installed on this Windows machine.
19. DesignFlow PLM is the only fully live application. Never overstate CRM, PM, or DAM verification.
20. Phase 8 is a separate decision and implementation.
21. Any new upstream field or semantics that contradict the allowlist blocks promotion until the
    plan is updated.
22. A full source change is not automatically a failure; unsafe handling, unexplained loss,
    ambiguity, or protected-field mutation is.

---

## 12. Access and environment

Expected authenticated tools on this Windows machine:

- `gh` for repository, PR, Actions, variables, and run inspection;
- `supabase` for linked preview/approved production migration operations;
- `op` / 1Password integration for serialized secret access;
- local Node.js for runners/tests;
- browser tooling for application smoke checks and screenshots.

Secret locations, names only:

- 1Password vault: `vibe_coding`;
- `Supabase CLI Personal Access Token`;
- `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`;
- `Supabase DB Password - shared POP database` — access only in the approved production session;
- GitHub Actions secrets:
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PREVIEW`, `COLDLION_API_KEY`,
  `DESIGNFLOW_API_KEY`;
- dflow sandbox test login in `vibe_coding`.

Before trusting any tool, exercise the real read-only operation. A working `--version` does not
prove authentication or environment access.

Target branch policy:

- planning/implementation in `shared-db`: `codex/<topic>` branch → PR to `main` → AI merge;
- DesignFlow application changes, if a defect requires them, stay on Albert's sandbox branch and
  require Uma's PR review to `develop`;
- no consumer application code change is assumed by this plan unless a smoke test proves one is
  required.

---

## 13. Definition of done, risks, and open questions

### Definition of done

- [ ] The active 14-day/2026-08-09 gate is replaced everywhere by the concrete readiness gate.
- [ ] Historical 14-day evidence and every failed/drill run remain preserved.
- [ ] The deterministic readiness evaluator passes all green and failure fixtures.
- [ ] Production monitoring, circuit breaker, durable alerts, and recovery are proven on preview.
- [ ] The complete cutover and rollback are rehearsed on preview.
- [ ] DesignFlow PLM live behavior gate is evidenced.
- [ ] DAM's applicable live subset is evidenced without overclaiming.
- [ ] CRM and PM development compatibility is evidenced.
- [ ] DB Data Admin verification is evidenced.
- [ ] The bounded production manifest excludes unrelated migrations and never uses `--include-all`.
- [ ] Albert explicitly approves the exact production window and actions.
- [ ] The production cutover is applied only as approved.
- [ ] Canonical UUID, status, and Property parent hashes remain unchanged.
- [ ] Only approved links/updates occur.
- [ ] The first scheduled production cycle and 24-hour intensified watch complete successfully, or
      any failure has a preserved rollback/fix-forward record.
- [ ] Plan, cutover doc, handoff, AGENTS router, and verification evidence reflect the final state.
- [ ] Changes are committed with Albert's identity, pushed, PR checks are green, PR is merged, and
      the exact merged SHA is verified.
- [ ] Phase 8 remains unstarted unless separately planned and approved.

### Principal risks and responses

| Risk | Prevention / response |
|---|---|
| Incomplete ColdLion page/division/type silently accepted | Independent runner/database completeness gates; fail closed |
| Legitimate ERP change treated as an error | Field-ownership allowlist distinguishes source-owned changes from protected invariants |
| Cross-entity or ambiguous match | Composite typed keys; quarantine; approved mapping hash |
| UUID/status/parent corruption | Before/after hashes, transaction guard, circuit breaker, operational rollback |
| Production migration backlog promoted accidentally | Detached bounded worktree; explicit allowlist; never `--include-all` |
| Alert arrives after repeated damage | Promotion is disabled on first protected failure; health checks intensified for 24 hours |
| DesignFlow removal loses parent/status source | DesignFlow deprecation explicitly out of scope |
| False claim that all apps are production-proven | Maturity-specific evidence language is mandatory |
| Monitoring itself parses output incorrectly | Strict real-output fixtures, duplicate-key rejection, nonzero on malformed data |
| Automated rollback worsens incident | Disable schedule/promotion first; retain schema, mirrors, and evidence; fix forward via shared-db |

### Open questions

No business decision is required to write or implement Steps 1–7. Step 8 intentionally remains an
approval gate because it is the first authorization for production mutation.

The implementer may discover that the existing durable alert surface cannot notify engineering
quickly enough. If so, add the smallest durable notification path compatible with existing
infrastructure, document its owner, and prove it with a forced-failure drill. Do not delay the
readiness evaluator while debating a broad observability redesign.

---

## Mandatory plan self-audit

### 1. Could a brand-new AI session execute this plan without asking Albert anything?

**Yes, through the production approval boundary.** Sections 1–4 explain the business goal,
application, trigger, and scope. Sections 5–8 preserve the exact current state, findings, rejected
approaches, and locked/open decisions. Section 9 gives file-level ordered steps and a verification
gate for every step. Section 12 identifies environments, tools, branches, and secret locations.
Step 8 correctly reserves the one decision that cannot be inferred: authorization for the exact
production mutation window.

### 2. Does the plan carry all background, nuance, and reasoning from the planning session?

**Yes.** Sections 3, 6, 7, and 8 preserve Albert's correction that ColdLion is the slow-moving
canonical ERP, why elapsed time has low proof value, why DesignFlow still supplies facts ColdLion
lacks, the real application maturity levels, the parser and evidence-design failures already
learned, and the rejected unsafe shortcuts. Sections 9–11 translate those findings into concrete
implementation, tests, rollback, and operational constraints.

### 3. Is the ultimate goal clear enough for correct judgment if a step is wrong?

**Yes.** Section 1 states the desired business outcome, the corrected authority boundary, the
replacement safety model, and the instruction that the goal wins over a conflicting step.
Sections 6 and 8 give the decision rules needed to distinguish a legitimate ColdLion change from
an integration defect, and Section 13 defines the completion and risk criteria.

### Objective checklist

- [x] All 13 sections are present.
- [x] The ultimate goal is first, in plain business English, with the goal-wins instruction.
- [x] A fresh session can proceed without this chat.
- [x] Rejected approaches and failures are recorded with reasons.
- [x] Every implementation step names concrete files/surfaces and a verification gate.
- [x] Locked and open decisions are labeled.
- [x] Out-of-scope work is explicit.
- [x] Tests are named by behavior.
- [x] Unfamiliar identifiers, paths, environments, and roles are defined.
- [x] Secrets are referenced by vault/item/secret name only.
- [x] Definition of done includes commit, push, PR, CI, production verification, monitoring, and
      documentation.

**Self-audit result: PASS — 2026-07-26.**
