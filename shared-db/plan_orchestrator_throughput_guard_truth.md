# Implementation plan — make throughput guards tell the truth

**Repository:** `u2giants/shared-db`
**Tracking issue:** [#1680](https://github.com/u2giants/shared-db/issues/1680)
**Work class:** repository maintenance only
**Created:** 2026-08-27; rewritten 2026-08-27 after independent review
**Handoff:** [`HANDOFF.d/2026-08-28T0006Z-edge-dev-codex-throughput-plan-rewrite.md`](HANDOFF.d/2026-08-28T0006Z-edge-dev-codex-throughput-plan-rewrite.md)

This plan changes scripts, tests, workflows and documentation. It authorizes no migration, database write, preview apply or production apply. Under `AGENTS.md` §0.0-C, a repository-maintenance session owns it; the schema orchestrator does not.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Plan, handoff and tracking issue registered | ✅ done 2026-08-27 | merge commit `172d2bb`; this rewrite replaces the rejected parser design |
| 1 | Version-keyed manifest for durable apply-time targets | ⬜ open | — |
| 2 | Offline staleness and integrity guard for the manifest | ⬜ open | — |
| 3 | `catalog-truth` command reporting file, ledger and live catalog truth | ⬜ open | — |
| 4 | Credentialed guards distinguish absent, present and unverifiable | ⬜ open | — |
| 5 | Permanent false-alarm regression corpus | ⬜ open | — |
| 6 | Blocker ledger and guard-causal measurements | ⬜ open | — |
| 7 | One-command red-check triage | ⬜ open | — |
| 8 | Diagnosis and reviewer-wait rules | ⬜ open | — |
| 9 | Full verification, landing and post-merge proof | ⬜ open | — |

**Fresh implementation starts at Step 1.** Phase A is Steps 1–5, Phase B is Steps 6–8, and Phase C is Step 9. Start a fresh session at each phase boundary and re-read the remaining plan before acting.

---

# Part 1 — Why

## 1. Ultimate goal

Clearing a database issue should not lose hours to a safety guard making a claim it cannot prove, a diagnosis that cannot be reproduced, or a reviewer wait that has silently stalled. When this work is complete:

1. A credentialed guard that says an object is missing will have checked the migration files, migration ledger and live catalog.
2. A known false alarm will have an executable regression test and cannot quietly return.
3. A session facing a red check can run one command to learn the guard's purpose, live truth, known incidents and next safe action.
4. Reviewer failure is bounded without reducing required review coverage.
5. We can measure time specifically lost to guard and reviewer failures, separately from owner decisions, deployment windows and unrelated issue age.

No safety check is removed, loosened, bypassed or made fail-open. A wrong guard becomes accurate; an inconvenient but correct guard remains. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this repository is

`u2giants/shared-db` governs the structure and cross-application contracts of the shared POP Supabase/PostgreSQL database. It contains forward-only migrations, production and preview verification scripts, GitHub Actions workflows and the operating contract in `AGENTS.md`. AI implementation sessions work in isolated worktrees and land changes through pull requests. The database environments are shared preview and production; this plan may query them only through the existing read-only Management API path.

## 3. Trigger and reproduction

Issue #1645 exposed the representative failure: `public.style_group_tags` existed in production, but text analysis could not see durable objects created inside tagged dollar-quoted SQL. The visible plain-text creator was hard-blocked, so the resulting explanation blamed the wrong migration.

The historical corpus is reproducible with:

```bash
python scripts/scan_apply_time_ddl.py
```

The current scan reports eight migrations, 210 creation statements and 201 unique relation names hidden from the normal stripped-SQL path. These figures are diagnostic input, not an instruction to build a general SQL parser. Re-run the command before quoting them.

## 4. Scope

**In scope**

- An explicit, version-keyed manifest of durable targets created through apply-time dynamic SQL.
- An offline guard that validates the manifest and fails when a new migration adds dynamic DDL without declaring its durable verification targets.
- A single three-source truth command: migration files on `origin/main`, migration ledger and live catalogs.
- Clear absent/present/unverifiable outcomes in credentialed guard failures.
- A cross-guard false-alarm corpus, blocker ledger, triage command and causal measurement.
- Reviewer liveness and timeout rules that preserve the required reviewer count.

**Out of scope**

- A general PostgreSQL parser or another heuristic extractor for dynamic SQL.
- Changing `strip_sql()` defaults or feeding manifest targets into batch availability decisions.
- Database structure or row changes, applies, credentials or connection methods.
- Replacing working guard engines, reviewer harnesses or the coordination machinery completed under issue #1366.
- Splitting `AGENTS.md`; open a separate repository-maintenance issue if size becomes blocking.

---

# Part 2 — What is already known

## 5. Current code state

Re-anchor line numbers before editing; use names, not historical line offsets.

- `scripts/production_migration_guard.py`: `strip_sql()` deliberately removes dollar-quoted bodies. `_created_by_applied_dynamic_ddl()` already rescues the applied #1645 case and is load-bearing.
- `scripts/production_catalog_verification.py`: `derive_targets()` derives post-apply probes from stripped SQL. It therefore under-verifies durable targets created by dynamic SQL. The existing Management API query path is read-only and must be reused.
- `scripts/check-pr-object-collisions.mjs`: separate Node text analysis used for collision detection. Do not unify parsers in this work.
- `scripts/check-migration-ledger-drift.mjs`: already compares `origin/main` with `supabase_migrations.schema_migrations` in both directions.
- `scripts/scan_apply_time_ddl.py`: diagnostic scanner used to identify the initial manifest population. It is not production authority.
- `scripts/test_production_migration_guard.py`: contains the applied dynamic-DDL rescue regression. It must remain unchanged and green.
- No apply-time target manifest, cross-guard corpus, blocker ledger, `catalog-truth` command or `triage-gate` command exists on the starting commit.

## 6. Findings and root cause

### 6.1 Text analysis cannot prove runtime state

`strip_sql()` is correct for batch ordering: treating uncalled routine bodies as apply-time dependencies can manufacture a false acceptance. The failure occurs when downstream consumers silently convert “not derivable from stripped text” into “absent.” Those are different claims.

### 6.2 Automatic discovery is too risky here

Four successive attempts to enumerate dynamic DDL were wrong in different ways: comment pairing, tagged quotes, tags containing digits, called temporary procedures, quoted identifiers, duplicate names and same-migration cleanup. A false positive fed into batch availability could admit a migration whose dependency is not actually present. The safe design is therefore asymmetric:

- the manifest may add post-apply probes;
- it must never add objects to `created_objects()` or `available`;
- a missing or stale declaration must fail a pull request, not guess.

### 6.3 Live catalog is necessary but insufficient

The live catalog answers what is applied now. It cannot prove whether reviewed work exists on `main` but was never applied. Conversely, migration files cannot prove what production currently contains. The command must return all three sources independently and must never translate an unreachable source into “absent.”

### 6.4 General issue age is not a causal throughput measure

The earlier baseline—median 4.0h, p90 60.3h over 400 closed issues—mixes guard failures with owner decisions, planned waits, application work and production authorization. Keep it only as context. The plan succeeds on guard-caused time recorded in the blocker ledger, plus recurrence and triage-time measures defined in Step 6.

## 7. Rejected approaches

1. **Loosen or remove guards.** Rejected because it suppresses symptoms and reduces safety.
2. **Keep dollar-quoted bodies in `strip_sql()` by default.** Rejected because uncalled routine bodies are not apply-time dependencies and could create false acceptance.
3. **Build `apply_time_ddl_statements()` or another general parser.** Rejected after repeated misclassification. The executable plan contains no parser step or parser acceptance test.
4. **Have every pull-request guard query production.** Rejected because live production is not authority for an unapplied pull request. Only credentialed checks that make runtime-state claims consult catalog truth.
5. **Treat the catalog alone as “work done.”** Rejected because merged-but-unapplied migrations are invisible there.
6. **Proceed after a reviewer timeout with fewer reviewers than required.** Rejected. Timeout replaces a stalled reviewer; it never waives review coverage.
7. **Use overall issue close time as proof.** Rejected as non-causal; it remains a secondary business trend only.

## 8. Locked decisions and limited judgment

**Locked on 2026-08-27**

- Use `config/apply-time-targets.json`, not automatic dynamic-DDL parsing.
- The manifest feeds only post-apply target derivation and catalog reporting. It never feeds batch availability or creator acceptance.
- All added database access is read-only through the existing Management API path; source failures exit 2.
- Truth is three independent sources: `origin/main`, ledger and catalog.
- False alarms are executable fixtures, not prose.
- Migration, production/data-movement and security/RLS changes keep two independent reviewers. Scripts/docs/CI-only changes require one.
- A required reviewer timeout triggers a replacement reviewer. Work cannot proceed below the required count.

**Implementer judgment**

- `catalog-truth` and `triage-gate` may be Node commands backed by a Python helper if that avoids duplicating the existing Management API code. Preserve one documented command-line entry point and test the boundary.
- The blocker ledger may contain extra fields, but the required fields in Step 6 cannot be removed.
- Automated pull-request comments are optional and should be omitted unless they require no new permissions and remain concise.

---

# Part 3 — How to build it

## 9. Ordered implementation

### Phase A — truth and regression protection

### Step 1 — Declare durable apply-time targets

Create `config/apply-time-targets.json`, keyed by the 14-digit migration version. Each entry must support:

- `tables`: schema-qualified table names;
- `indexes`: index name plus owning table;
- `rls_tables`: tables whose RLS state must be verified;
- `policies`: policy name plus table;
- `notes`: short provenance explaining why the declaration is needed.

Seed it from `python scripts/scan_apply_time_ddl.py`, then manually verify every retained target against its migration. Exclude `pg_temp.*`, routines used only during apply, and objects dropped by the same migration. Include the durable `public.style_group_tags` targets from `20260825082910` and the dynamic RLS/policy cases identified by the existing scan.

Update `derive_targets()` in `scripts/production_catalog_verification.py` to union these declarations into post-apply probes. Do not import the manifest into `scripts/production_migration_guard.py`; do not change `created_objects()`, `available`, `strip_sql()` or `_created_by_applied_dynamic_ddl()`.

**Gate:** focused tests prove that `derive_targets()` includes the manifest targets while the existing applied dynamic-DDL rescue test passes unchanged.

### Step 2 — Make the manifest fail loud

Add `scripts/check-apply-time-manifest.mjs` and its Node test. It must:

- validate JSON shape and unique, valid version keys;
- require every key to match a real migration file;
- reject `pg_temp.*` and any declared object dropped by the same migration;
- inspect changed migration files in a pull request and fail if they contain executable dollar-quoted DDL without a corresponding manifest update;
- allow dollar-quoted prose, comments and routine bodies that do not execute during apply without forcing false declarations;
- print the migration and a precise manual action when it cannot classify safely.

The staleness gate may use conservative detection, but uncertain input must fail for human declaration; it must never infer targets or feed acceptance decisions. Add it to `.github/workflows/tools-offline-tests.yml`.

**Gate:** fixtures cover bare and tagged dollar quotes, digit-bearing tags, comments, string literals, uncalled routines, called apply-time routines, quoted identifiers and same-migration drops. Demonstrate that deleting the `20260825082910` manifest entry makes the test fail.

### Step 3 — Build three-source catalog truth

Add `scripts/catalog-truth.mjs` with this interface:

```bash
node scripts/catalog-truth.mjs public.style_group_tags
```

For every requested object, report independently:

1. migration files on `origin/main` that create or declare it, including hard-blocked status;
2. whether each relevant version is in the target ledger;
3. whether the object exists in preview and production now.

Reuse the existing read-only Management API implementation. Accept tables, indexes, views, functions, policies and RLS-state targets. Use explicit outcomes `PRESENT`, `ABSENT`, `NOT_APPLIED`, `NOT_DERIVABLE` and `UNVERIFIABLE`; never collapse them. If either database or GitHub authority cannot be read, print the failed source and exit 2.

**Gate:** tests mock all three sources and cover present, absent, merged-but-unapplied, applied reissue after a hard-blocked creator, unknown object and credential failure.

### Step 4 — Correct credentialed guard conclusions

Inventory guards and workflows that currently make a runtime claim such as “missing,” “never created” or “not applied.” Only credentialed runtime checks are changed. Their failure output must either embed the three-source result or print the exact `catalog-truth` command needed to obtain it. Exit codes and safety refusals remain unchanged unless a test proves the old refusal was based solely on a false runtime claim.

Do not add live database calls to offline pull-request checks. Those should say `NOT_DERIVABLE` and direct the operator to the truth command rather than asserting absence.

**Gate:** search for runtime-absence wording, record the audited call sites in `docs/verification/throughput-guard-truth-audit-20260827.md`, and add a test for every changed message and outcome.

### Step 5 — Build the false-alarm corpus

Create fixtures under `scripts/fixtures/guard-false-alarms/` with an index containing incident, guard, expected verdict and source evidence. Include at minimum:

- #1645 dynamic DDL and hard-blocked/reissue history;
- comment and string-literal phantom DDL;
- bare, tagged and digit-bearing dollar quotes;
- called versus uncalled routine bodies;
- quoted identifiers;
- same-migration temporary object cleanup;
- previously fixed cancelled-work and `ON UPDATE CASCADE` false alarms.

Each applicable guard test consumes the shared fixture rather than duplicating prose. Add a corpus runner to `tools-offline-tests.yml`.

**Gate:** revert one historical narrowing locally, prove the corpus fails, restore it, and record that command and output summary in the verification document.

### Phase B — triage, measurement and operating rules

### Step 6 — Record blockers and causal time

Create `config/blocker-ledger.json` and `scripts/check-blocker-ledger.mjs`. Required fields:

- `id`, `opened_at`, `resolved_at`;
- `class`: `guard-false-alarm`, `guard-true-block`, `reviewer-harness`, `credential`, or `other`;
- `issue_or_pr`, `guard`, `symptom`, `proof_command`;
- `resolution`, `fixed_by`, `corpus_fixture`;
- `active_minutes_lost`, `wall_minutes_blocked`, and `estimate`.

Backfill known incidents only where source evidence exists. Unknown duration stays `null`; never invent it. `active_minutes_lost` and `wall_minutes_blocked` are estimates for prioritization, not audited labor records.

Add `scripts/guard-throughput-report.mjs`. Primary measures are:

- median and p90 wall minutes per resolved guard/reviewer blocker;
- median active minutes lost;
- false-alarm recurrence count after a fixture lands;
- median time from first red check to a proved diagnosis.

Keep overall issue lead time as a separately labelled context metric; do not claim causation from it. Initial success targets: zero known false-alarm recurrences, all blocker diagnoses carrying a proof command, and a 50% reduction in median diagnosis time after at least 20 comparable resolved entries. Do not evaluate the percentage before that sample exists.

**Gate:** ledger validation rejects missing fields, dangling fixtures, invalid SHAs and impossible timestamps; report tests use fixed data and prove null estimates are excluded.

### Step 7 — Add one-command triage

Add `scripts/triage-gate.mjs <guard-or-check> [object]`. It must print:

- the guard's purpose and owning script;
- whether the failure matches a known corpus or ledger entry;
- the proof command and, when an object is supplied, the three-source truth result;
- one safe next action;
- `NO KNOWN MATCH` for unknown failures without guessing a root cause.

It must not mutate GitHub, the database or the ledger.

**Gate:** tests cover known false alarm, known true block, unknown guard, unreachable catalog and object-free offline use.

### Step 8 — Write diagnosis and reviewer rules

Update `AGENTS.md` in the existing diagnosis/review section, staying within roughly 4 KB:

- no root-cause statement without a rerunnable proof command or verification artifact;
- after ten minutes without proof, label the claim `working hypothesis`;
- run `triage-gate` first for a red guard;
- scripts/docs/CI-only changes require one independent reviewer;
- migrations, data movement, production applies and security/RLS changes require two;
- probe reviewer liveness before waiting;
- cap each reviewer round at 20 minutes;
- on timeout, record the blocker and dispatch a replacement; never proceed with fewer reviewers than required.

Update issue #1680 so its summary no longer says “exactly three migrations” and reflects the manifest design and causal measures.

**Gate:** `check-skill-drift`, relevant documentation checks and a direct search prove the commands and reviewer-preservation wording are present.

### Phase C — final verification and landing

### Step 9 — Verify and ship

Run all focused tests after each step and the full suites once the tree is frozen:

```bash
node --test scripts/*.test.mjs
```

```bash
python -m pytest scripts/ -q
```

Run repository-required checks named by `AGENTS.md`, confirm no migration file changed, obtain the required independent review, commit only owned files, open the pull request and merge it after required checks pass. Verify the merge SHA and post-merge `main` checks. Update this STATUS table with artifact-backed evidence and close #1680 only when all deliverables exist.

**Gate:** merged commit on `main`, required checks green, no database mutation, and every STATUS row cites a file, test, run or SHA.

## 10. Required tests

- `scripts/test_production_catalog_verification.py`: manifest targets are added to post-apply probes; absent manifest entries do not affect availability; #1645 rescue remains green.
- `scripts/check-apply-time-manifest.test.mjs`: schema, file existence, staleness, uncertain classification, quoted identifiers, temporary drops and bite proof.
- `scripts/catalog-truth.test.mjs`: all outcome combinations and exit 2 for an unavailable authority.
- Existing guard tests: every changed runtime conclusion preserves correct refusals and exit codes.
- Shared false-alarm corpus runner: each historical fixture reaches the intended guard and fails when its fix is reverted.
- `scripts/check-blocker-ledger.test.mjs`: required fields, source references, timestamps, SHAs and null estimates.
- `scripts/guard-throughput-report.test.mjs`: median/p90 and diagnosis-time math on fixed fixtures.
- `scripts/triage-gate.test.mjs`: known false alarm, true block, unknown guard and unavailable catalog.
- Full Node and Python suites remain green.

## 11. Constraints and gotchas

- Work only in an isolated worktree cut from current `origin/main`; preserve unrelated work.
- This is repository maintenance, not schema-orchestrator work.
- No migration, database write, preview apply, production apply or new credential.
- Read-only target proof still applies before every catalog query.
- The manifest is one-way verification input only. Feeding it to batch availability is a release blocker.
- Unreachable authority is `UNVERIFIABLE`, exit 2—never `ABSENT`.
- Do not quote diagnostic scan counts without rerunning the scan.
- Stage owned files only. Confirm committer identity before the first commit.
- This is not documentation-only once scripts or workflow files change; normal checks apply.

## 12. Access and environment

- GitHub: authenticated `gh`, repository `u2giants/shared-db`, base `main`.
- Databases: shared preview and production through the existing Management API `database/query` path with `read_only: true`.
- Secrets: existing 1Password vault `vibe_coding` references only; never print or add values. No new secret is required.
- Local runtime: Node and Python already used by the repository suites.
- Worktree convention: `C:\repos\shared-db-worktrees\<name>`.

---

# Part 4 — Landing it

## 13. Definition of done, risks and open questions

### Definition of done

- [ ] Manifest exists, contains only manually verified durable targets, and is used only by post-apply verification.
- [ ] Staleness guard is required in offline CI and demonstrably fails when a declaration is removed.
- [ ] `catalog-truth` reports file, ledger and preview/production truth with explicit unverifiable outcomes.
- [ ] Credentialed guards no longer state runtime absence from text alone.
- [ ] Historical false alarms are executable fixtures and the corpus is proven to bite.
- [ ] Ledger and triage commands exist, are tested and are read-only.
- [ ] Measurement separates guard-caused delay from overall issue age.
- [ ] Reviewer timeout rules preserve the required reviewer count.
- [ ] Full test suite and required checks pass; no migration or database mutation occurred.
- [ ] PR is merged, post-merge checks are green, issue #1680 and this STATUS table are current.

### Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Manifest goes stale | Required fail-loud PR guard | Revert manifest consumer and guard together; existing verification remains unchanged |
| Manifest creates false acceptance | Never imported into availability/creator code; regression test | Revert manifest integration immediately |
| Catalog credential failure is misreported as absence | Explicit `UNVERIFIABLE`, exit 2 test | Revert affected message integration, retain standalone command |
| Corpus passes without exercising guards | Bite proof for a reverted fix | Remove invalid fixture claims and repair the runner before merge |
| Metrics are presented as audited time | Separate active/wall estimates and nullable evidence | Withdraw the report claim; retain raw ledger evidence |
| Reviewer timeout weakens review | Replacement required; count cannot drop | Revert documentation that permits any waiver |

### Open questions

No owner decision is required before implementation. The implementation choices left open are only language/module boundaries and optional PR comments, governed by §8. If Step 2 cannot distinguish executable apply-time dynamic DDL conservatively without becoming a parser, it must fail on uncertainty and require a manifest declaration; do not broaden inference.

## Self-audit

1. **Can a fresh session execute this without the planning chat? Yes.** §§1–8 explain the business goal, repository, incident, current code, evidence, rejected designs and locked decisions. §9 provides ordered file-level work and gates; §§10–13 cover tests, access, rules, landing and rollback.
2. **Does it preserve the important nuance? Yes.** §§6–8 retain the four failed discovery attempts as the reason for the manifest, protect the existing #1645 rescue, keep live catalog separate from file/ledger truth, and forbid reducing reviewer coverage.
3. **Is the goal sufficient for judgment calls? Yes.** §1 makes accuracy without safety loss controlling; §§4, 8 and 13 bound every remaining judgment and require fail-loud behavior when classification is uncertain.

All 13 required sections are present. The plan is self-contained, names rejected approaches, distinguishes locked and open decisions, gives every step a verification gate, specifies tests and access without exposing secrets, and includes commit, merge and post-merge proof.
