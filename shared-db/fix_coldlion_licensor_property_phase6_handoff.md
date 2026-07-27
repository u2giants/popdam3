# Handoff — ColdLion licensor/property Phase 6 (IN PROGRESS)

> **Planning update — 2026-07-26:** Albert rejected the 14-day elapsed-time wait. ColdLion is the
> canonical ERP source and its Licensor/Property data changes slowly, so the replacement safety
> model is deterministic readiness proof plus rapid fail-closed monitoring and rollback. The
> fresh-session implementation brief is
> [`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md).
> Read its STATUS table first. This decision does not itself authorize production: the existing
> production prohibition stays in force until the replacement preview and approval gates pass.

## 1. What this application is

`u2giants/shared-db` owns the shared Supabase schema and data-integration contracts. Licensors and
Properties live in `core.licensor` / `core.property`. **Phase 6** built the preview-only
parallel-run machinery: scheduled ColdLion `mirror_only` + DesignFlow master-data sync + daily
comparison + health/alerts. The elapsed-time gate was retired on 2026-07-26; the machinery and
append-only evidence now support the accelerated invariant-readiness plan.

## 2. What we set out to do this session, and why

The business goal was to prove that ColdLion can refresh Licensor and Property source data beside
the still-enabled DesignFlow lane without changing the canonical records every POP application
uses. Technically, this session built and proved the preview-only Phase 6 observation machinery:
scheduled dual-lane refreshes, append-only daily comparisons against the exact Phase 4 baseline,
health checks, durable alerts, forced-failure drills, and fail-closed GitHub Actions handling. This
was required before any separately approved production source cutover can be considered.

What a developer walking in today must know:

| Fact | Value |
|---|---|
| Preview | `rjyboqwcdzcocqgmsyel` |
| Production | `qsllyeztdwjgirsysgai` — **never touched in Phase 6** |
| Migration | `20260726180000` **applied** — **never edit that file** |
| Machinery (6A) | **COMPLETE** |
| GitHub workflow proof | **COMPLETE** (after parser-fix PR #233) |
| Schedules | **ACTIVE** (`PHASE6_SCHEDULE_ENABLED=true` since 2026-07-26T13:27:41Z) |
| Phase 6 overall | **IN PROGRESS** — preview readiness gates PROVEN 2026-07-27; application-maturity checks and production packaging still open |
| Historical schedule start | **2026-07-26**; retained as evidence, not an exit clock |
| Active exit gate | Plan Steps 6–8: application checks at real maturity, bounded production package, and Albert's durable production-window approval |
| **Exact next action** | **Plan Step 6 — verify DesignFlow PLM (primary live gate), the DAM live subset, CRM/PM development compatibility, and DB Data Admin. Do not execute Phase 7.** |

### 2026-07-27 update — accelerated readiness proven on preview

| Item | Result |
|---|---|
| Readiness command | `node tools/evaluate-coldlion-licensor-property-cutover-readiness.mjs --apply --linked` → **exit 0, `ready=true`** (preview) |
| 542-row identity proof | **542/542 exact**; 271 distinct canonical UUIDs; SQL-recomputed hash `1230f5a12d0f2a3029f1d3df17fc5b5f`; missing/extra/duplicate/changed/cross-typed/link-mismatch/canonical-missing all **0** |
| Circuit breaker | `plm.taxonomy_circuit_breaker` + append-only `plm.taxonomy_circuit_breaker_event`; enforced by triggers on `core.taxonomy_source_ref` (ColdLion rows) and `plm.erp_licensor`/`plm.erp_property` link changes |
| Forced-failure drill | Real promotion attempt refused: `run-coldlion-licensor-property-phase4.mjs` **exit 1**, failed run `15c0b900-d8eb-4925-a1ac-6323eaec5572` retained; trip event `aedace23-…`, blocked event `a97fc56d-…`, critical alert `de27d819-…` naming **Albert Hazan** |
| Rollback rehearsal | Unauthorized reset **refused**; authorized reset closed the lane (event `19f8e231-…`); recovery run `5676f13a-…` re-linked **542 unchanged / 0 changed**; every protected hash byte-identical before, during, and after |
| Alert delivery | The plan's named "Codex heartbeat" **does not exist in this repo**. Built `.github/workflows/coldlion-licensor-property-alert-monitor.yml` (cron `*/10`, gated by `COLDLION_ALERT_MONITOR_ENABLED`) → GitHub issue naming Albert Hazan + red run |
| New migrations | `20260727221500`, `20260727223000`, `20260727224500` — **all applied to preview; never edit them** |
| Tests | 127 offline tests green; `scripts/check-sql.sh` green; `supabase/tests/coldlion_licensor_property_readiness_breaker_contracts.sql` PASS (rolled back) |
| Production | **Not accessed. Not linked. Not queried.** Phase 7 **not started** |

Two defects this work found in itself — both worth remembering, both caught by its own
tests, both documented in evidence §4.7.5:

1. **A trigger cannot durably log the exception it raises** — the write is rolled back with
   the statement. The breaker triggers now refuse only; the caller records the blocked attempt.
2. **`text[] || '<bare literal>'` is parsed as an array literal** (`22P02`). It only bit the
   duplicate/ambiguity branches, so the verifier would have crashed exactly when it had found a
   real problem. Explicit `::text` fixes it.

Full evidence: `docs/verification/coldlion-licensor-property-phase6-20260726/README.md` §4.7.

Full evidence IDs:
[`docs/verification/coldlion-licensor-property-phase6-20260726/README.md`](docs/verification/coldlion-licensor-property-phase6-20260726/README.md).

## 3. Current state (2026-07-26) — machinery + workflow COMPLETE; observation gate open

### Headline

| Item | Status |
|---|---|
| Phase 6A schema + tools | **COMPLETE** (applied + contracts) |
| GHA secrets | `COLDLION_API_KEY`, `DESIGNFLOW_API_KEY` set from 1Password (names only); plus existing Supabase preview secrets |
| Parser fix | PR **#233**, merge **`18ab164ce503ba875413a7d4573597032c56be81`** |
| Workflow integration proof | **COMPLETE** (see §3.2) |
| Preview schedules | **ACTIVE** |
| Historical observation clock | Started 2026-07-26; elapsed-time requirement retired |
| Phase 6 exit | **Not yet** — accelerated readiness gates remain **IN PROGRESS** |
| Phase 7 / 8 | **Forbidden until Phase 6 exits + Albert production window** |

### Entry prerequisites

| Gate | Status |
|---|---|
| Phase 3 complete | Yes |
| Phase 4 542 links | Yes (preview) |
| Phase 5 | NOT NEEDED |
| Schedules/alerts tested | **Yes** — GHA green + force-fail drills |
| Accelerated invariant-readiness gates | **In progress** |

### Final baseline snapshot (2026-07-26 09:28 EDT)

Canonical **26/256**; mirror **44/516**; refs **1047** = **542** ColdLion + **505** DesignFlow;
links **38/504**. Hashes:

| Hash | Value |
|---|---|
| Licensor UUID | `590ea83ea6df1487fcfc1e18b3ef6a0d` |
| Property UUID | `e0e6c36eb02bb2d320c0deaff7aa8f8c` |
| Licensor status | `d9b07759bf80ff227e2fa9bd635d2138` |
| Property status | `f436d4acd79761fedbfc9b5796ac7bce` |
| Parent-edge | `7459f6826cc59468779e7ead33ec0edc` |
| Combined status | `5960fa4c08b5da2d0880c138e3e32ef7` |
| Source-ref | `5585216ad77d3aec0f1dbbba802f1e36` |

### 3.1 Source names

| Lane | `source_system` / `source_name` |
|---|---|
| ColdLion | `coldlion` / `coldlion_licensors_properties_api` |
| DesignFlow | `designflow_plm` / `plm_master_data_api` |
| Comparison | `shared_db` / `coldlion_designflow_daily_comparison` |
| Health | `shared_db` / `coldlion_designflow_sync_health` |

### 3.2 Final GHA workflow proof (COMPLETE)

| Workflow run | Job | Outcome | DB IDs |
|---|---|---|---|
| **30203333356** | DesignFlow | **PASS** | run `0a3c5474-2f33-49a4-926a-ef888ddbb826` |
| **30203361246** | ColdLion mirror_only | **PASS** | run `9b0b9f1c-f4b6-46b4-ba8a-4f1320470b4b` (560 unchanged; snapshot `a69332e05d9064723ffa1dfbd870506c`) |
| **30203386465** | Comparison (pre-parser-fix) | Runner exit **2**; **DB green** observation `bf9e8daf-84d9-49a1-8958-39aa987adeb4` | Retained as caught parser failure |
| **30203975505** | Green comparison (post-fix) | **PASS** exit 0 | comparison `a3776002-637b-4ca8-b0f4-a6d026a7f1c9`; observation **`16373e68-6f72-43ad-8219-7c999799675d`** pass true |
| **30204001916** | Green health (post-fix) | **PASS** exit 0 | health **`0332f071-b632-4fe4-ad7b-3d48168451da`** ok true |
| **30204031010** | Forced comparison | **PASS-as-drill** exit **1** (`pass=false`) | comparison `9bb99f4b-524f-4e25-9f6e-601afce92aed`; drill obs **`ca8d6615-5fcd-4243-ab7a-de1db23842a1`** |
| **30204054859** | Forced health | **PASS-as-drill** exit **1** (`ok=false`) | health **`7f5fa415-6d9e-4cf3-b131-b278e830dae5`** |

Parser fix path: Go-style `map[...]` box cells, fail-closed on garbage, **duplicate keys rejected**.

### 3.3 Schedule

| Item | Value |
|---|---|
| Variable | `PHASE6_SCHEDULE_ENABLED=true` |
| Enabled at | **2026-07-26T13:27:41Z** |
| Cadence | DesignFlow `30 3 * * *`; ColdLion `0 4 * * *`; compare `0 5 * * *`; health `15 */6 * * *` (exact `github.event.schedule` match) |

### Design notes still in force

1. Append-only UUID observations; drills never overwrite green daily rows.
2. Phase 4 baseline pins on every non-drill observation.
3. Schedule dispatch: exact cron string only (no wall-clock).
4. CLI parse fail-closed (exit 2 on unparseable; never treat exit 2 as success).
5. Never edit applied migration `20260726180000`.

## 4. What we tried / rejected (history)

| Approach | Outcome |
|---|---|
| Edge Function + Vault + pg_net for Phase 6A | Rejected — used GHA + existing Node runners |
| Date PK + ON CONFLICT UPDATE | Rejected — erase same-day green evidence |
| Wall-clock schedule mapping | Rejected |
| JSON-only CLI parse | **Failed in production GHA** (run 30203386465) → fixed PR #233 |
| Editing applied migration | Forbidden |

## 5. Root causes and key findings

- Audit evidence must be append-only and compared with the frozen Phase 4 baseline; a date-keyed
  upsert or a first-run-derived baseline can erase or legitimize drift.
- GitHub's Ubuntu Supabase CLI renders JSONB as a Unicode box table containing Go-style `map[...]`,
  not reliably as JSON. The shared strict parser must retain exact real-output fixtures and fail
  closed with exit 2 on ambiguity or malformed output.
- Scheduled job selection must use the exact `github.event.schedule` string; wall-clock inspection
  can misroute a delayed cron run.
- A forced-failure drill is valid only when stored separately from non-drill evidence and when it
  exits nonzero without changing canonical or mirror data.
- Elapsed days are not an active exit gate. Existing scheduled observations remain useful evidence,
  but readiness requires the accelerated plan's deterministic identity, invariant, rollback, alert,
  and approval gates.

## 6. Exact next steps (updated 2026-07-27)

Items 1–3 below are **DONE** — see the 2026-07-27 update in §2 and evidence §4.7.

1. ~~Implement the thin readiness composer and exact 542-row mapping-identity proof on preview.~~ **Done.**
2. ~~Prove the circuit breaker, alert delivery, authorized re-enable, and rollback.~~ **Done on preview.**
3. ~~Preserve all successes, failures, parser errors, and drills append-only.~~ **Done — nothing was overwritten.**
4. **NEXT — plan Step 6:** verify the applications at their real maturity levels. DesignFlow PLM
   is the only fully live application and is the primary gate; DAM's live subset only; CRM and
   PM are development compatibility checks; plus DB Data Admin's Licensor/Property tree/filters.
   Never overstate CRM/PM/DAM coverage.
5. Then plan Step 7: the bounded production package (detached worktree, explicit allowlist,
   never `--include-all`).
6. Then plan Step 8: Albert's durable, explicit production-window approval.
7. **Do not execute Phase 7 or Phase 8** before 4–6 are complete.

**Alert delivery was measured and passed:** alert `821d2c5b-…` fired 2026-07-27T22:30:00Z and
was delivered to GitHub issue **#279** at 22:41:27Z by monitor run **30311589271** — **11m27s,
inside the 15-minute target** — with **Albert Hazan** named as human response owner in the issue
body, the alert payload, and the workflow error annotation. The alert was acknowledged (never
deleted), the breaker reset under authorization, and readiness re-evaluated `ready=true`.

**One item is genuinely NOT yet proven, and must not be reported as if it were:** run
30311589271 was a `workflow_dispatch`. As of 2026-07-27T23:09Z GitHub had not yet fired any
`schedule` run of the new monitor workflow (normal for a newly added cron). So the delivery
**mechanism** is proven; the **unattended cadence** is not. Close it with:

```bash
gh run list --repo u2giants/shared-db --workflow coldlion-licensor-property-alert-monitor.yml --json event,createdAt,conclusion,databaseId
```

Confirm at least one `"event":"schedule"` row roughly 10 minutes apart and record the interval in
evidence §4.7.6. If GitHub cannot hold the cadence, attach the alert check as an extra job on the
already-proven Phase 6 schedule rather than relaxing the 15-minute target.

## 7. Constraints and gotchas

- Preview only for Phase 6 observation until Phase 7 is separately approved.
- Never `--include-all` promote unrelated migrations to production.
- NASA unlinked; Phase 5 creates blocked; 542 ColdLion links preserved.
- Secret **names** only in docs; values live in GitHub secrets / 1Password `vibe_coding`.

## 8. Access and environment

- Preview pooler port 6543; 1Password vault `vibe_coding` for local work.
- GHA uses repo secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PREVIEW`,
  `COLDLION_API_KEY`, `DESIGNFLOW_API_KEY`.

## 9. Open questions and risks

- Scheduled preview observations may continue as supporting evidence; they are not a calendar gate.
- Production promotion of Phase 4+6 migrations = separate approved window (not this phase).
- A failed or missing scheduled day can extend or reset the qualifying window under cutover §9.4;
  never infer a pass from elapsed calendar time alone.
- Phase 7 remains an owner-approved production-window decision, not an automatic next action when
  the monitoring period ends.

## Forward-impact audit

- Phase 7 may begin only after Phase 6 exit evidence + Albert production approval.
- Phase 8 still requires Phase 7 stability + relationship/status curation ownership.
- No app consumer deploy required for observation machinery.

## Handoff self-audit

1. **Could a street-new developer continue without asking a question? Yes.** §§1–3 explain the
   application, objective, environments, completed machinery, immutable baseline, schedule state,
   and exact present gate; §§5–9 supply root causes, next actions, constraints, access, and risks.
2. **Could that developer continue as effectively as this session? Yes.** §3 records every workflow
   and database evidence ID, exact hashes/counts, source names, schedule cadence, applied migration,
   parser correction, and the authoritative verification artifact.
3. **Are failed attempts and their causes preserved? Yes.** §4 records the rejected Edge/Vault
   design, overwriteable date-key evidence, wall-clock routing, the real GitHub Actions parser
   failure, its run ID, and why the applied migration cannot be edited.
4. **Is every next step concrete and verifiable? Yes.** §6 requires deterministic readiness,
   exact mapping identity, breaker/alert/rollback proof, preserved observations, and explicit
   durable production approval before Phase 7.
5. **Are unfamiliar identifiers, paths, and environments explained? Yes.** §§1–3 and §§7–8 define
   the repository, schemas, preview/production refs, evidence path, migration, source names,
   GitHub variable/secrets, and 1Password location without exposing values.

Final synthesis:

1. **Is this handoff comprehensive enough that a brand-new developer with no project or chat
   context could pick up where this session left off and not skip a beat? Yes.** §§1–5 establish
   the full purpose, verified state, failure history, root causes, and the only authorized next
   action.
2. **Is it detailed enough for that developer to continue with all knowledge needed from this
   session and the relevant background? Yes.** §§3–4 preserve the operational evidence and
   non-obvious parser/evidence-design lessons; §§7–9 preserve every active boundary and risk.
3. **Is every relevant background, goal, outcome, current state, failed attempt, decision,
   constraint, risk, next action, and verification item present? Yes.** These map respectively to
   §§1–2, §2, §3, §3, §4, §§3 and 7, §7, §9, §6, and §3. No gap remains.

The self-audit passed on 2026-07-26. The plan's mandatory forward-impact instruction is present in
`fix_coldlion_licensor_property_cutover.md` under “Mandatory fresh-session and forward-impact
protocol”; the next session must reread Phases 7–8 and report any downstream drift before ending.
