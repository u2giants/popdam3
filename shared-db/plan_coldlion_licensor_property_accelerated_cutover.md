# Implementation plan — accelerated ColdLion Licensor/Property cutover

**Written:** 2026-07-26  
**Documentation corrections:** 2026-07-26 — Kimi critique corrections applied; see STATUS
**Decision owner:** Albert Hazan  
**Repository:** `u2giants/shared-db`  
**Fresh-session starting point (updated 2026-07-29):** **Step 7A** — build and prove the missing recurring production ColdLion feed and monitoring lane on preview. Steps 1–7 proved a safe one-time mirror/link package, but Albert chose a **real recurring ColdLion feed switch** on 2026-07-29 after GLM-5.2 found that the package did not deliver the stated goal. **Do not request Step 8 approval and do not touch production until Step 7A is complete.**

## STATUS

| Step | State | Date | Evidence / next action |
|---|---|---|---|
| 0. Documentation corrections (Kimi critique + active-gate retirement) | ✅ Complete | 2026-07-26 | Kimi P1/P2 corrections and routed-doc retirement completed; implementation Steps 1–10 remain open |
| 1. Reconfirm current state and serialize work | ✅ Complete | 2026-07-27 | Clean worktree from `origin/main`; preview ledger checked (no blocking rows, no duplicate timestamps); identity `Albert Hazan <u2giants@users.noreply.github.com>` confirmed; production never contacted |
| 2. Replace the elapsed-time Phase 6 gate | ✅ Complete | 2026-07-27 | Policy/docs retired 2026-07-26; workflow contracts and static tests now carry invariant-readiness wording. No active 14-day / 2026-08-09 rule remains |
| 3. Build the readiness evaluator | ✅ Complete | 2026-07-27 | `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` — one command; **`ready=true` on preview**; all 542 approved mappings proven by row-by-row identity (all 8 difference buckets 0). Evidence §4.7 |
| 4. Strengthen fail-closed production monitoring | ✅ Preview-proven (production lane still gated by Step 8) | 2026-07-28 | **Breaker now AUTO-TRIPS off the detection path** (migration `20260728134500`) — the 2026-07-27 claim that it protected without a human was FALSE and is corrected in evidence §4.8.1. Adds DELETE/linked-INSERT gap closure, anti-disarm, and a 9-trigger enforcement watchdog readiness blocks on. Alerts now delivered by the detecting run itself (seconds, not the throttled */10 cron); health detection hourly |
| 5. Rehearse the complete cutover and rollback on preview | 🔶 New behaviors rehearsed; app checks are Step 6 | 2026-07-27 | Forced-failure drill, refused real promotion (`run-...-phase4.mjs` exit 1, failed run `15c0b900-…`), append-only evidence, refused unauthorized reset, authorized rollback, proven recovery (542 unchanged, run `5676f13a-…`), protected hashes unchanged throughout. Evidence §4.7.4 |
| 6. Verify the applications at their real maturity levels | ✅ Complete at the accuracy the evidence supports | 2026-07-28 | DB Data Admin **verified** as a real signed-in user on preview (tree/filters/parents/no duplicates/no cross-entity). DAM live subset verified at the data contract (0 orphans, 0 parent mismatches); its **screens deliberately not driven** — no read-only DAM role exists (AGENTS §0.4). DesignFlow PLM, CRM, PM hold **zero rows on preview**: recorded as not exercised, NOT as passed; their 40 FKs and api contracts are proven intact. Live PLM smoke belongs in the Step 9 read-only window. Evidence §4A.3–4A.4 |
| 7. Prepare the production change package | ✅ Complete | 2026-07-28 | Full package: docs/verification/coldlion-licensor-property-step7-production-package-20260728/README.md — bounded 9-migration manifest (+ the 2026-07-28 hardening, recommended together), exact commands naming qsllyeztdwjgirsysgai, pre/post hash captures, secret named-not-created, read-only smoke checklist by maturity, and an operational rollback with no schema drop. Read-only production identity pre-proof: 0 missing / 0 cross-typed / 0 code mismatch |
| 7A. Build the recurring production feed and monitoring lane | ⬜ Open, blocked by another schema workstream | 2026-07-29 | Albert chose a real recurring feed. PR #314 re-issued the ClickUp migration skipped by the historical duplicate timestamp; open correctness PR #311 still owns the schema slot. Start after #311 lands/closes and preview is free. No production write |
| 8. Obtain Albert's production-window approval | ⬜ Blocked by Step 7A | 2026-07-29 | Approval must cover the recurring schedule, production secrets/variables, exact write modes, rollback, and monitoring. A one-time-link approval is no longer acceptable |
| 9. Execute the production cutover | ⬜ Open | 2026-07-26 | Separate fresh session; only after Step 8; mapping-identity proof before any write |
| 10. Run intensified monitoring and close out | ⬜ Open | 2026-07-26 | Hourly cadence + deliberate +1h/+4h/+24h checks, then normal guarded operation |

This plan complements, and does not replace, the historical evidence in
[`fix_coldlion_licensor_property_phase6_handoff.md`](fix_coldlion_licensor_property_phase6_handoff.md)
and the full original plan in
[`fix_coldlion_licensor_property_cutover.md`](fix_coldlion_licensor_property_cutover.md).
Those files explain what was already built and tested. Where they require 14 distinct scheduled
dates or an earliest exit of 2026-08-09, this plan records Albert's 2026-07-26 decision to replace
that elapsed-time gate, and the 2026-07-26 documentation pass retired it as an active rule across
the named documents — it survives there only as labeled historical evidence. Until Steps 1–5 are
implemented and verified, the existing production prohibition remains in force. The active Phase 6
next action is implementing and proving this readiness plan on preview — not collecting further
elapsed days.

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
- Build a real recurring production lane. A one-time mirror/link run is not a feed switch.
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
- Treating the current one-time 542-link package as completion of the feed switch.

---

## 5. Current state of the code and rollout

The implementer must reverify these facts against the latest `origin/main`; they are accurate as of
2026-07-26:

1. `HANDOFF.md:3` identifies Phase 6 as the current priority.
2. `fix_coldlion_licensor_property_phase6_handoff.md:1` records the complete Phase 6 machinery,
   workflow runs, failures, hashes, schedule, and constraints.
3. `fix_coldlion_licensor_property_cutover.md:753` contains the original §9.4 invariant criteria.
4. `fix_coldlion_licensor_property_cutover.md:1002` defines Phase 6.
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
    unchanged. The authoritative approved set is the frozen artifact
    `docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json` (md5
    `1230f5a12d0f2a3029f1d3df17fc5b5f`), approved by Albert Hazan on 2026-07-25 — the Phase 4
    approval record is `fix_coldlion_licensor_property_phase4_handoff.md` §3 (38 licensor + 504
    property mappings → 271 distinct canonical UUIDs: 19 licensor + 252 property). Do **not**
    confuse it with the Phase 3 placeholder
    `docs/verification/coldlion-licensor-property-phase3-20260725/phase4-approved-mapping.json`,
    whose `approved_mapping_hash` is `d41d8cd98f00b204e9800998ecf8427e` — the md5 of the **empty
    set**, with `approved_by: null`. The Phase 3 file froze the pre-approval empty state; the
    Albert-approved 542-row Phase 4 artifact is the only approved mapping input.
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

1. **Monitoring frequency (decided 2026-07-26):** hourly GitHub Actions health checks as the
   standing cadence, plus deliberate checks at +1 hour, +4 hours, and +24 hours after the
   cutover. No 15-minute cron — overlapping jobs and queue noise do not buy materially faster
   detection for slow-moving data, and the circuit breaker already fails closed independently of
   check frequency. Full ColdLion snapshots remain daily because the data is slow.
2. **Alert transport (decided 2026-07-26; CORRECTED 2026-07-27).** The 2026-07-26 text named
   "the existing Codex heartbeat task" as the primary path. **A repository-wide sweep on
   2026-07-27 found no such task exists here** — no scheduled monitor workflow, no cron
   definition, and no automation prompt in this repo watches this workstream. The named path
   could not be proven because it is not real, so Step 4 item 8's fallback applied and the
   smallest durable channel was built and is now the primary path:

   ```text
   plm.taxonomy_sync_alert (preview)
     -> .github/workflows/coldlion-licensor-property-alert-monitor.yml  (cron */10 * * * *)
     -> a GitHub Issue naming Albert Hazan + a RED failed workflow run
   ```

   Both surfaces are permanent and timestamped, so delivery time is provable after the fact
   instead of asserted. 10 minutes sits inside the 15-minute target with margin for GitHub queue
   delay. Gated by repository variable `COLDLION_ALERT_MONITOR_ENABLED` (default off); production
   ref hard-refused. The named human escalation owner remains **Albert Hazan**, carried in the
   alert payload, the issue body, and the workflow error annotation. No email address is
   fabricated. If a real Codex heartbeat is introduced later, it should consume this issue/run
   surface rather than replace it.
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

**Files (illustrative, not exhaustive — the repo-wide sweep below is the authoritative gate):**

- `plan_coldlion_licensor_property_accelerated_cutover.md` (this file);
- `fix_coldlion_licensor_property_cutover.md`;
- `fix_coldlion_licensor_property_phase6_handoff.md`;
- `fix_coldlion_licensor_property_phase4_handoff.md`;
- `HANDOFF.md`;
- `AGENTS.md`;
- `docs/master-data-cutover-scoreboard.md`;
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
**Verification gate (authoritative):** a repo-wide `rg` sweep over the **whole repository** — not
just the illustrative file list above — finds no *active* instruction that requires 14 qualifying
days or 2026-08-09, while explicitly labeled historical records remain. The file list is
illustrative; the sweep is the gate, and it must cover docs, handoffs, plans, workflows, tools,
and tests. Static tests prove schedule jobs remain preview-guarded and append-only. The
automation view shows the updated policy. (Known remainder after the 2026-07-27 documentation
pass: historical verification artifacts may retain the retired rule when explicitly labeled as
historical. Workflow comments and static tests must describe invariant readiness, not elapsed time.)

### Step 3 — Build one thin deterministic readiness evaluator

**Recommended files:**

- new `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs`;
- new `tools/evaluate-coldlion-licensor-property-cutover-readiness.test.mjs`;
- reuse `tools/phase6-preview-guards.mjs`;
- reuse `tools/phase6-cli-result-parse.mjs`;
- add a read-only database function/view only if existing Phase 6 functions cannot support the
  exact mapping-identity proof; any database addition must be a new timestamped migration.

The evaluator is a thin composer, not a second monitoring system. It must invoke and preserve the
results of the existing strict health/comparison tools, print their target, run IDs, hashes,
counts, alerts, and blocking reasons, then add only two genuinely new checks:

1. production execution requires the exact separately approved authorization flag and project ref;
2. the frozen 542-row approved mapping is re-resolved by full typed source identity to the exact
   intended canonical UUID set. Every source row must resolve to exactly one intended production
   canonical row. Any missing row, ambiguity, UUID difference, entity-type difference, or
   unexpected production baseline difference blocks readiness. Counts alone never pass.

It must reject malformed, duplicate, missing, ambiguous, stale, or environment-mismatched data and
exit nonzero. It must never infer readiness from row counts alone.

**Dependency:** Step 2 policy must be settled first.  
**Verification gate:** existing health/comparison suites remain green. New fixtures prove only the
new logic: preview is the default, production requires exact authorization, all 542 typed source
identities resolve to the approved UUIDs, and a missing/ambiguous/different mapping blocks with a
specific reason. Existing tools continue covering pagination, freshness, hashes, malformed output,
duplicate keys, unexplained differences, and permitted source-owned name changes.

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
5. hourly GitHub health checks plus deliberate checks at +1 hour, +4 hours, and +24 hours;
6. an operational circuit breaker that prevents further ColdLion canonical promotion after any
   protected invariant, parsing, completeness, authentication, or pagination failure;
7. continued mirror/failure evidence where safe, without deleting or overwriting failed rows;
8. a loud GitHub Actions failure plus durable database alert containing run ID, environment,
   failed invariant, last green run, and the exact first response. A preview forced-failure drill
   must prove the current Codex heartbeat receives the failure within **15 minutes** and names
   **Albert Hazan** as the human escalation owner. If that path cannot meet the target, this step
   must add and prove the smallest durable notification channel before production approval;
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
unchanged. The drill must prove delivery to the named Codex heartbeat within 15 minutes and record
Albert Hazan as escalation owner. A recovery drill proves an authorized re-enable succeeds after a
green evaluation.

### Step 5 — Rehearse the complete cutover and rollback on preview

**Environment:** preview `rjyboqwcdzcocqgmsyel` only.

1. Cite and reuse the already-green Phase 2B, Phase 4, and Phase 6 evidence for full snapshots,
   identical replay, 542-link idempotency, parsing failures, protected hashes, and append-only
   forced-failure records. Do not rerun a test merely to duplicate preserved proof.
2. Capture a fresh preview baseline.
3. Exercise only the new production-authorization guard in safe preview mode.
4. Run the new exact 542-row mapping-identity proof against preview.
5. Exercise the new circuit breaker, alert delivery, authorized re-enable, and operational
   rollback.
6. Restore the preview fixture without deleting failure evidence.
7. Run the thin readiness evaluator.
8. Write a dated append-only verification artifact that links the reused proof and records the new
   commands, run IDs, hashes, delivery timing, expected failures, and recovery evidence.

**Dependency:** Steps 3–4.  
**Fresh-session cut:** use a separate session for this operational rehearsal.  
**Verification gate:** the evaluator reports `ready=true`; all protected hashes match; every
forced failure remains in evidence; rollback returns the operational path to a green state; no
production credential, URL, project ref, or mutation appears in logs.

### Step 6 — Verify applications at their real maturity levels

Application checks must use existing test accounts from 1Password vault `vibe_coding`; never write
credentials into evidence.

1. **DesignFlow PLM — primary compatibility gate.** Against its approved
   nonproduction/preview-connected sandbox, verify Licensor and Property selectors, item
   creation/reference validation,
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
“DesignFlow PLM behavior verified against preview-connected sandbox; DAM live subset verified;
CRM/PM development compatibility verified.” The later production smoke is separately and
explicitly read-only.

### Step 7 — Prepare the bounded production change package

**No production mutation is authorized in this step.**

1. Create a detached temporary worktree from the exact proposed `origin/main` commit.
2. Read-only compare the full local migration list with the production migration ledger.
3. Produce an explicit allowlist of only the migrations required for the approved
   Licensor/Property cutover. Expected candidates are `20260724060000`, `20260724061000`,
   `20260726180000`, the Phase 4 linking migration identified by the Phase 4 evidence, and any new
   Step 3/4 migration; the read-only ledger/object comparison decides the final manifest.
4. Exclude every unrelated pending migration. Never use `--include-all`.
5. Prepare the read-only production identity command that re-resolves all 542 rows from
   `docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json`
   (hash `1230f5a12d0f2a3029f1d3df17fc5b5f`) to the exact approved canonical UUIDs.
6. Propose GitHub Actions secret `SUPABASE_DB_PASSWORD_PRODUCTION`, sourced from 1Password vault
   `vibe_coding`, item `Supabase DB Password - shared POP database`. Its creation/use is a named
   production action requiring Step 8 approval; do not create or read it during packaging.
7. Produce the exact workflow/CLI commands that Step 9 will run, with project ref displayed before
   execution and secret references by 1Password/GitHub name only.
8. Prepare the pre-cutover export/hash command, post-cutover verification command, application
   smoke checklist, circuit-breaker command, and rollback commands.
9. Record the expected database object changes and explicitly state that canonical data rows,
   statuses, and parents are not expected to change except the already approved source refs/links.

**Dependency:** Steps 5–6 green and CI merged to `main`.  
**Fresh-session cut:** end the implementation/rehearsal session after this package is reviewed.  
**Verification gate:** a second read-only review shows the manifest contains only the named
Licensor/Property migrations and actions; every command names
`qsllyeztdwjgirsysgai`; no command includes `--include-all`; rollback is executable without a
schema drop; every approved mapping row has a prepared identity proof; and the proposed production
secret action is named but not executed.

### Step 7A — Build and prove the real recurring production feed

**Why this step was added:** GLM-5.2's 2026-07-28 review correctly found that Steps 1–7 built a
safe one-time ColdLion mirror and 542-link package, not the routine feed switch stated in §1.
Albert chose the real recurring feed on 2026-07-29. The goal wins: Step 8 is blocked until this
missing lane exists and is proven.

**Serialization gate before editing:** PR #300 is closed and superseded. PR #314 merged the
additive `20260728174500_clickup_incremental_task_import_reissue.sql`, which re-issues the ClickUp
migration silently skipped when the PopDAM migration claimed the shared historical version
`20260728160000`. The two applied/history files keep their original names because applied
migrations are immutable; do **not** rename or delete either one. Open correctness PR #311 still
owns the shared schema slot. Wait for #311 to land or close, confirm preview has no unmerged
rehearsal rows, and only then create a Step 7A branch or migration. Never use migration repair to
rewrite this history.

Build these concrete pieces:

1. Add `.github/workflows/coldlion-licensor-property-production.yml`. It must be a separate
   production-only workflow, never a relaxed copy of the preview guard. It must:
   - target only `qsllyeztdwjgirsysgai` and refuse every other project ref;
   - use GitHub environment `production`;
   - require repository variable `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true`;
   - use secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PRODUCTION`, and
     `COLDLION_API_KEY`, referenced by name only;
   - run with one non-cancelling concurrency group so snapshot, promotion, comparison, and health
     cannot overlap;
   - provide manual `workflow_dispatch` jobs for `coldlion`, `promote`, `compare`, `health`, and
     `readiness`;
   - schedule a daily full ColdLion snapshot followed by approved promotion and comparison, plus
     hourly health checks;
   - invoke every write runner with the full four-part production authorization and exact project
     ref;
   - deliver a GitHub issue from the detecting run on failure and name Albert Hazan as response
     owner;
   - skip loudly while disabled, and never silently fall back to preview or dry-run behavior.
2. Add a production schedule-map module and tests rather than using wall-clock time. Follow
   `tools/phase6-schedule-map.mjs`, but keep preview and production maps separate so a delayed
   runner cannot choose the wrong job.
3. Add a guarded recurring promotion mode. `mirror_only` may refresh all valid ColdLion mirror
   rows, but promotion may update only source-owned fields that this plan explicitly assigns to
   ColdLion. It must:
   - preserve canonical UUIDs, `core.property.licensor_id`, and status;
   - resolve every row by the full typed key `(company, division, mgTypeCode, mgCode)`, never code
     alone;
   - update an existing canonical name/description only through an explicitly approved,
     deterministic rule with an audit record;
   - quarantine new, missing, ambiguous, cross-typed, re-keyed, or parentless records;
   - never auto-create canonical licensors/properties and never auto-inactivate a missing source
     row;
   - trip the circuit breaker and fail before partial canonical promotion on any protected
     invariant.
4. If the existing schema cannot record source-owned descriptive values and their promotion audit
   without overloading the curated display name, author one new additive migration under
   `supabase/migrations/` after the timestamp collision is resolved. Never edit an applied
   migration. Prefer explicit source fields/audit columns or a typed source table over JSON/EAV.
5. Extend `tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs` so production readiness
   fails unless the production workflow exists, its schedule map is valid, its enable variable is
   intentionally off before approval, all required secret names are wired, the breaker watchdog
   is enforced, and the recurring promotion contract passes.
6. Extend `tools/rehearse-coldlion-cutover-sequence.mjs` to rehearse two consecutive scheduled
   cycles on preview:
   - cycle 1 establishes the approved links and source-owned values;
   - cycle 2 proves idempotency;
   - a controlled legitimate ColdLion name change proves the allowed update path;
   - a new record, missing record, code collision, cross-division collision, wrong type, and
     attempted parent/status mutation each quarantine or fail closed as specified;
   - rollback disables the recurring lane and withdraws only ColdLion promotion/link state,
     without deleting canonical rows or DesignFlow refs.
7. Update the Step 7 production package, the Phase 6 handoff, the cutover plan, `AGENTS.md` routing,
   and verification evidence. Remove every statement that a one-time 542-link run completes the
   feed switch.

**Locked decisions:**

- ColdLion owns its source identity, codes, and source descriptions.
- `core.*` UUIDs remain stable.
- Supabase owns status and Property-to-Licensor parents because ColdLion does not provide them.
- DesignFlow remains a temporary comparison/provider for those missing facts; removing it is
  Phase 8.
- New ColdLion records require review. Absence from ColdLion never means delete or inactive.
- Production automation is disabled until Step 8 explicitly approves its secrets, variable,
  schedule, modes, window, and rollback.

**Required tests:**

- production workflow hard-refuses preview and arbitrary refs;
- missing enable variable or any named secret fails loudly;
- scheduled events map to the exact intended job;
- concurrency prevents overlapping write cycles;
- all production runner calls contain the four authorization parts;
- cycle 2 is idempotent;
- legitimate source-owned descriptive change is audited and applied;
- UUID, parent, and status mutations are refused;
- new/missing/ambiguous/cross-typed/colliding records quarantine;
- alert delivery failure keeps the workflow red;
- rollback leaves 26/256 canonical identities, DesignFlow refs, parents, and statuses unchanged.

**Dependency:** Steps 1–7 complete; open schema PRs serialized; duplicate migration timestamps
eliminated; preview free of another workstream's unmerged ledger rows.

**Fresh-session cut:** this is a separate implementation phase. Re-read this section and the
latest STATUS table at its start. Stop after the workflow, promotion contract, two-cycle preview
rehearsal, and independent review are merged and documented. Do not continue into Step 8 in the
same session. At Step 7A closeout, re-read every downstream section from Step 8 through the end of
this plan and report or correct any drift caused by the implementation or anything learned during
it before handing off the next phase.

**Verification gate:** CI is green; SQL checks pass; two preview cycles and all fault cases above
are proven; the production workflow targets only production but remains disabled; no production
secret/variable was created and no production write occurred; an independent review returns no
Critical or High finding; and a fresh-session audit can execute the revised Step 8–10 package
without guessing.

### Step 8 — Obtain Albert's production-window approval

Present Albert one concise approval request naming:

- exact production project `qsllyeztdwjgirsysgai`;
- exact migration versions;
- exact data modes (`mirror_only`, approved 542-row `link_approved`, or other explicitly justified
  mode);
- exact recurring schedules and `COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED` variable to be
  enabled;
- creation/use of GitHub secret `SUPABASE_DB_PASSWORD_PRODUCTION` from the named 1Password item;
- use of existing `SUPABASE_ACCESS_TOKEN` and `COLDLION_API_KEY` secrets, with confirmation that
  no value is copied into docs, logs, commands, or commits;
- the exact 542-row production identity proof and its blocking rules;
- expected application-visible effect;
- maximum likely blast radius;
- pre-cutover backup/hash evidence;
- monitoring period and alert behavior;
- exact operational rollback.

**Dependency:** Step 7A complete and independently reviewed.
**Verification gate:** Albert explicitly approves the named production window and actions in the
current chat. General statements such as “go ahead with the project” do not count. Before the
fresh Step 9 session, copy Albert's exact approval text, timestamp, project, migrations, modes,
secret action, window, monitoring, and rollback into this plan's STATUS area and a dated
`docs/verification/` approval artifact. Do not fabricate or pre-fill approval.

### Step 9 — Execute the production cutover

**Use a fresh session. Re-read every downstream step and the latest status table before acting.**

1. Re-run identity, clean-worktree, in-flight PR, and production-target checks.
2. Capture the secure pre-cutover export and public non-secret hashes.
3. Verify the durable Step 8 approval record exactly matches the planned session.
4. Run the read-only 542-row production identity proof. Stop before any write on any missing row,
   ambiguity, UUID/entity mismatch, or unexpected baseline difference and return the difference to
   Albert.
5. Create/use `SUPABASE_DB_PASSWORD_PRODUCTION` only if the durable approval explicitly includes
   that action.
6. Run a bounded production dry-run from the detached worktree and compare it byte-for-byte with
   the approved manifest.
7. Stop if any additional migration/action appears.
8. Apply only the approved migrations.
9. Verify actual database objects, not only the migration ledger.
10. Run one full guarded ColdLion `mirror_only` snapshot.
11. Run only the approved linking mode and exact identity-proven mapping set.
12. Verify canonical UUID, status, and parent hashes.
13. Run the readiness evaluator in its explicitly production-authorized mode.
14. Run **read-only** production smoke checks: selectors load, existing item display, tracking
    references, saved UUID/deep links, the applicable live DAM subset, and named log sources. Do
    not create or modify a production item. CRM/PM remain development checks.
15. Enable the normal production schedule and hourly health monitoring.
16. If any protected gate fails, execute the operational rollback immediately; do not improvise a
    schema/data cleanup.

**Dependency:** explicit Step 8 approval.  
**Verification gate:** migration objects exist; run accounting is successful; approved links only;
protected hashes are unchanged; DesignFlow PLM live checks pass; applicable DAM live checks pass;
CRM/PM development checks pass; monitoring is active; GitHub Actions and database alerts are
green. Report PR, merge SHA, workflow IDs, sync UUIDs, and evidence path.

### Step 10 — Intensified monitoring, reaction, and closeout

For the first 24 hours:

1. evaluate health hourly without rerunning the slow full import each time;
2. perform deliberate named checks at +1 hour, +4 hours, and +24 hours;
3. inspect the first scheduled ColdLion full snapshot and comparison;
4. inspect DesignFlow relationship/status preservation;
5. watch named application log sources for DesignFlow PLM and the live DAM subset;
6. keep CRM/PM checks in their development environments;
7. preserve every success and failure append-only;
8. disable the ColdLion production schedule/promotion immediately on a protected invariant failure;
9. reproduce and fix the defect on preview before re-enabling production.

After one fully successful scheduled production cycle and 24 hours with no unexplained alert,
retain hourly health evaluation, daily full snapshots, and weekly reconciliation.
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

### New thin-readiness tests

Add only the new cases; existing health/comparison suites retain their current responsibilities:

1. `preview_composes_existing_green_results`;
2. `production_requires_exact_authorization`;
3. `all_542_typed_source_rows_resolve_to_approved_uuids`;
4. `missing_ambiguous_or_different_mapping_blocks`;
5. `row_counts_without_identity_proof_never_pass`.

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
- proposed production GitHub secret `SUPABASE_DB_PASSWORD_PRODUCTION`, sourced from
  `vibe_coding` item `Supabase DB Password - shared POP database`; it does not exist by authority
  of this plan and may be created/used only if Step 8 explicitly approves it;
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

- [x] The active 14-day/2026-08-09 documentation gate is retired in routed docs; workflow
      contracts/static tests still belong to implementation Step 2.
- [x] Historical 14-day evidence and every failed/drill run remain preserved.
- [x] The deterministic readiness evaluator passes all green and failure fixtures.
      (`ready=true` on preview 2026-07-27; 127 offline tests + rolled-back SQL contracts green.)
- [ ] The real recurring production workflow, promotion contract, monitoring, alerts, and recovery
      are built and proven through two complete preview cycles (Step 7A).
- [x] The complete cutover and rollback are rehearsed on preview — for the NEW behaviors.
      Application-maturity checks remain Step 6.
- [~] DesignFlow PLM live behaviour gate: NOT evidenced on preview (plm.item is 0 rows there). Deferred to the Step 9 read-only production smoke. Recorded as untested, not passed.
- [x] DAM's applicable live subset is evidenced at the data-contract level (0 orphans, 0 parent mismatches). Screens deliberately not driven — no read-only DAM role exists.
- [~] CRM and PM: zero rows on preview, so not exercised. Their FK/api dependency is proven intact. No production-proven claim is made.
- [x] DB Data Admin verification is evidenced (real signed-in user, preview).
- [x] The bounded production manifest excludes unrelated migrations and never uses `--include-all` on the full repo set.
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
| Alert arrives after repeated damage | Promotion is disabled on first protected failure; hourly health plus +1h/+4h/+24h named checks; delivery drill must reach the heartbeat within 15 minutes |
| DesignFlow removal loses parent/status source | DesignFlow deprecation explicitly out of scope |
| False claim that all apps are production-proven | Maturity-specific evidence language is mandatory |
| Monitoring itself parses output incorrectly | Strict real-output fixtures, duplicate-key rejection, nonzero on malformed data |
| Automated rollback worsens incident | Disable schedule/promotion first; retain schema, mirrors, and evidence; fix forward via shared-db |
| One-time link is mistaken for a feed switch | Step 7A blocks approval until recurring production automation and permitted canonical-field behavior are proven |
| Concurrent migration silently skips | Keep the historical duplicate immutable; PR #314 re-issued the skipped SQL as `20260728174500`. Serialize with open correctness PR #311 and verify real objects, not only the ledger |

### Open questions

Albert decided on 2026-07-29 that the goal is a real recurring ColdLion feed, not a one-time link.
No further business decision is required to implement and preview-prove Step 7A. Step 8 remains
the first authorization for production secrets, variables, schedules, and mutation. The concrete
engineering blocker is serialization: PR #314 resolved the skipped ClickUp execution with a new
forward migration, but open correctness PR #311 still owns the schema slot. Step 7A waits for it.

---

## Mandatory plan self-audit

### 1. Could a brand-new AI session execute this plan without asking Albert anything?

**Yes, through the production approval boundary.** Sections 1–4 explain the business goal,
application, trigger, and scope. Sections 5–8 preserve the exact current state, findings, rejected
approaches, and locked/open decisions. Section 9 gives file-level ordered steps and a verification
gate for every step. Section 12 identifies environments, tools, branches, and secret locations.
Step 7A now specifies the missing recurring feed, promotion, monitoring, fault cases, tests, and
serialization gate. Step 8 correctly reserves the one decision that cannot be inferred:
authorization for the exact production mutation window and automation.

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

**Self-audit result: PASS — re-audited 2026-07-29 after the recurring-feed decision and GLM-5.2 critique.**
