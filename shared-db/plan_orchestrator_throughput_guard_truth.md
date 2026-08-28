# Implementation plan — make throughput guards tell the truth

**Repository:** `u2giants/shared-db`
**Tracking issue:** [#1680](https://github.com/u2giants/shared-db/issues/1680)
**Work class:** repository maintenance only
**Created:** 2026-08-27; revised 2026-08-28 after Grok 4.6 review
**Handoff:** [`HANDOFF.d/2026-08-28T0100Z-edge-dev-codex-throughput-plan-grok-revision.md`](HANDOFF.d/2026-08-28T0100Z-edge-dev-codex-throughput-plan-grok-revision.md)

This plan changes scripts, tests, workflows and documentation. It authorizes no migration, database write, preview apply, production apply, infrastructure mutation or new credential. Under `AGENTS.md` §0.0-C, a repository-maintenance session owns it; the schema orchestrator does not.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Plan, handoff and tracking issue registered | ✅ done 2026-08-27 | registration merge `172d2bb`; manifest-only rewrite merge `d4bbfceb` |
| 1 | Version-keyed manifest for durable apply-time verification targets | ⬜ open | — |
| 2 | Mechanical declaration-presence and manifest-integrity guard | ⬜ open | — |
| 3 | `catalog-truth` command reporting independent file, ledger and catalog states | ⬜ open | — |
| 4 | Credentialed guards add truth context without changing refusals | ⬜ open | — |
| 5 | Permanent false-alarm regression corpus | ⬜ open | — |
| 6 | Blocker ledger and causal measurements | ⬜ open | — |
| 7 | One-command red-check triage | ⬜ open | — |
| 8 | Diagnosis and reviewer-liveness rules | ⬜ open | — |
| 9 | Full verification, landing and post-merge proof | ⬜ open | — |

**Fresh implementation starts at Step 1.** Phase A is Steps 1–5, Phase B is Steps 6–8, and Phase C is Step 9. Start a fresh session at each phase boundary and re-read the remaining plan before acting.

---

# Part 1 — Why

## 1. Ultimate goal

Clearing a database issue should not lose hours to a safety guard making a claim it cannot prove, a diagnosis that cannot be reproduced, or a reviewer wait that has silently failed. When this work is complete:

1. A credentialed guard that discusses live state will show migration-file, migration-ledger and live-catalog evidence independently.
2. Known false alarms will be executable regression tests and cannot quietly return.
3. A session facing a red check can run one command to learn the guard's purpose, known incidents, evidence and next safe action.
4. Reviewer failure is bounded without reducing required review coverage or killing a reviewer that is still making progress.
5. We measure time specifically lost to guards and reviewer failures, separately from owner decisions, deployment windows and unrelated issue age.

No safety check is removed, loosened, bypassed or made fail-open. A wrong explanation becomes accurate; a correct refusal remains. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this repository is

`u2giants/shared-db` governs the structure and cross-application contracts of the shared POP Supabase/PostgreSQL database. It contains forward-only migrations, production and preview verification scripts, GitHub Actions workflows and the operating contract in `AGENTS.md`. AI implementation sessions work in isolated worktrees and land changes through pull requests. This plan may query preview or production only through the existing read-only Management API path.

## 3. Trigger and exact incident shape

Issue #1645 exposed the representative failure. `public.style_group_tags` existed in production, but stripped-text analysis could not see the applied creator because the DDL was passed to a temporary helper:

```sql
select pg_temp.popdam_1479_apply_final_ddl(
  $ddl$create table if not exists public.style_group_tags (...)$ddl$
);
```

The repository has three relevant creators:

- `20260825010603`: plain-text creator, permanently `HARD_BLOCKED`;
- `20260825031841`: dollar-quoted creator, also `HARD_BLOCKED`;
- `20260825082910`: dollar-quoted applied reissue that must be verified.

The existing rescue `_created_by_applied_dynamic_ddl()` in `scripts/production_migration_guard.py` handles the applied case. It may reject but never approve; its silent `continue` must not become a refusal.

Other shapes an implementer must know:

- `20260710135600`, `20260710135900` and `20260710135950` define procedures, call them during the migration, then drop them. Their bodies are apply-time despite being routine bodies.
- `20260825031841` creates and later drops `asset_tags_pending_metadata_normalization_idx`; it is not a durable target.
- `20260621151155` and `20260701154948` dynamically enable RLS through `execute format(...)`; the diagnostic relation scanner does not discover these cases.
- `20260825082910` creates functions through `$applyddl$`, enables RLS through a single-quoted helper argument, creates policies with spaced names, and creates triggers through dynamic SQL.
- `dflow."AdditionalUserEmail"` proves quoted identifiers exist in historical dynamic DDL and cannot be interpolated by the current unquoted `IDENT` validation.

The diagnostic corpus can be explored with:

```bash
python scripts/scan_apply_time_ddl.py
```

Its counts are diagnostic input only. It sees relation-shaped statements, not all functions, policies, RLS changes or triggers. Re-run it before quoting any count, and never treat its output as the manifest authority.

## 4. Scope

**In scope**

- An explicit, version-keyed manifest of durable post-apply verification targets.
- A mechanical guard that requires a manifest key when changed SQL contains dynamic-SQL risk markers, without classifying execution or inferring targets.
- A single command reporting independent migration-file, ledger and live-catalog states.
- Credentialed guard messages that add evidence without changing exits or acceptance.
- A cross-guard false-alarm corpus, blocker ledger, triage command and causal measurement.
- Reviewer liveness, replacement and bounded-retry rules that preserve required coverage.

**Out of scope**

- A PostgreSQL parser, dynamic-DDL target extractor, apply-time/call-time classifier or same-migration durability analyzer.
- Changing `strip_sql()`, `created_objects()`, `available`, `preflight_batch()` or `_created_by_applied_dynamic_ddl()` behavior.
- Making live catalog state an input to migration acceptance.
- Database structure or row changes, applies, credentials or connection methods.
- Replacing working guard engines, reviewer harnesses or issue #1366 coordination machinery.
- Splitting `AGENTS.md`; open separate repository-maintenance work if size becomes blocking.

---

# Part 2 — What is already known

## 5. Current code state

Re-anchor line numbers before editing; function names are the durable anchors.

- `scripts/production_migration_guard.py`: `strip_sql()` deliberately removes dollar bodies. `preflight_batch()` builds local `available` from `created_objects()`. `_created_by_applied_dynamic_ddl()` is the load-bearing #1645 rescue.
- `scripts/production_catalog_verification.py`: `derive_targets(migrations, allowlist)` derives post-apply probes from stripped SQL. Manifest additions must be limited to allowlist versions. `_sql_array()` accepts only unquoted identifiers matching `IDENT`/`ROLE_RE`.
- `scripts/test_production_migration_guard.py`: `test_applied_dynamic_ddl_creation_contradicts_the_refusal` must remain unmodified and green.
- `scripts/check-migration-ledger-drift.mjs`: precedent for independent file/ledger states and exit 2 on unavailable evidence.
- `scripts/check-pr-object-collisions.mjs`: separate Node text analysis; unification is out of scope.
- `scripts/scan_apply_time_ddl.py`: diagnostic scanner only; its relation pattern does not cover RLS, policies, functions or triggers.
- `.github/workflows/tools-offline-tests.yml`: runs `tools/*.test.mjs` plus explicit script checks such as `check-skill-drift`; it does not glob `scripts/*.test.mjs`.
- `.github/workflows/shared-supabase-migrations.yml`: Python suite uses `python -m unittest`, not pytest.
- Reviewer rules are split between `AGENTS.md` and `docs/agents/section-4-anti-collision-rules.md`.
- No manifest, cross-guard corpus, blocker ledger, `catalog-truth` command or `triage-gate` command exists on the starting commit.

## 6. Findings and root cause

### 6.1 Text analysis cannot prove runtime state

`strip_sql()` is correct for batch ordering: treating uncalled routine bodies as apply-time dependencies can manufacture false acceptance. The failure occurs when a consumer silently converts “not derivable from stripped text” into “absent.”

### 6.2 Automatic target discovery is unsafe

Four discovery attempts were wrong through comment pairing, tagged quotes, digit-bearing tags, called routines, quoted identifiers, duplicates and temporary objects. The safe asymmetry is:

- human-reviewed manifest declarations may add post-apply probes for allowlisted versions;
- the manifest is never read by migration acceptance code;
- the presence guard may require a declaration but never infer target names or durability;
- an explicit empty declaration is valid when human review finds no durable target.

### 6.3 Live catalog is necessary but insufficient

Catalog state answers what exists now. It cannot prove reviewed-but-unapplied work exists on `main`. Files cannot prove runtime state. The ledger cannot prove object state. The command must return each source independently and must never convert an unreachable source into absence.

### 6.4 General issue age is not causal throughput evidence

The earlier median 4.0h and p90 60.3h across 400 issues mix guard failures with owner waits and unrelated work. Retain them only as context. Primary measures come from evidenced blocker timestamps and exclude estimates from headline results.

## 7. Rejected approaches

1. **Loosen or remove guards.** Symptom suppression reduces safety.
2. **Keep dollar bodies in `strip_sql()` by default.** Uncalled routine bodies could become false dependencies.
3. **Build `apply_time_ddl_statements()` or a “conservative” apply-time classifier.** Repeatedly misclassified real SQL; Step 2 explicitly forbids it.
4. **Make the presence guard infer object names, calls or same-file drops.** That is the rejected parser under another name.
5. **Have every PR guard query production.** Live production is not authority for unapplied changes.
6. **Treat catalog presence as acceptance evidence.** Catalog truth is explanatory only.
7. **Proceed after reviewer timeout with fewer reviewers.** Timeout never waives coverage.
8. **Hard-kill a slow reviewer at 20 minutes.** A live reviewer may be producing a blocking `REVISE`; replacement is based on no progress plus no verdict.
9. **Use overall issue close time as proof.** It is non-causal.

## 8. Locked decisions and limited judgment

**Locked on 2026-08-28**

- Use `config/apply-time-targets.json`; no automatic target parser.
- The manifest is read only by post-apply verification and `catalog-truth`, scoped to versions in the current allowlist.
- Migration acceptance code must not import, open or parse the manifest.
- All database reads reuse the existing read-only Management API path; unavailable evidence exits 2.
- File, ledger, preview and production outcomes remain separate; no single combined verdict hides the sources.
- False alarms are executable fixtures.
- Migrations, production/data movement and security/RLS work keep two independent reviewers. Scripts/docs/CI-only work requires one.
- Reviewer replacement requires no verdict plus no progress or a concrete transport/coverage failure. A `REVISE` is never replaced. After two replacements on the same head, stop and ask the owner rather than looping.

**Implementer judgment**

- `catalog-truth` and `triage-gate` may be Node commands backed by Python helpers to reuse existing catalog code. Preserve one documented CLI and test the boundary.
- The blocker ledger may add fields but cannot remove Step 6 required fields.
- Automated PR comments are optional; omit them if they need new permissions.

---

# Part 3 — How to build it

## 9. Ordered implementation

### Phase A — truth and regression protection

### Step 1 — Declare durable verification targets

Create `config/apply-time-targets.json`, keyed by 14-digit migration version. Each entry supports:

- `tables`, `views`, `materialized_views`: schema-qualified names;
- `indexes`: schema-qualified index name plus schema-qualified owning relation;
- `functions`: exact PostgreSQL identity signature, including argument types;
- `rls_tables`: schema-qualified table names;
- `policies`: policy name plus schema-qualified table and command when known;
- `triggers`: trigger name plus schema-qualified table;
- `notes`: human provenance, including why an empty declaration is correct.

Seed entries by hand. Use `scan_apply_time_ddl.py` as a search aid only, then inspect at minimum `20260825010603`, `20260825031841`, `20260825082910`, the three `reconcile_*` migrations, `20260621151155`, and `20260701154948`. Explicitly cover the helper-argument, called-procedure, single-quoted RLS, `$applyddl$` function, spaced-policy, trigger and same-file-drop shapes in §3.

Exclude `pg_temp.*`, objects dropped in the same migration, and identifiers the existing verifier cannot safely interpolate. Quoted identifiers and spaced policy names must either use a typed query path that binds them safely or fail manifest validation with an actionable message; never interpolate them into `_sql_array()`.

Update `derive_targets(migrations, allowlist)` to union declarations only for versions present in `allowlist`. An explicit empty entry adds zero probes. Do not change or import manifest code into `production_migration_guard.py`.

**Gate:** focused tests prove allowlist-scoped union, empty declaration behavior, safe identities for every supported kind, and unchanged #1645 rescue. A static test proves migration-acceptance code does not reference the manifest path or loader.

### Step 2 — Require declarations mechanically; never infer targets

Add `scripts/check-apply-time-manifest.mjs` and `scripts/check-apply-time-manifest.test.mjs`.

The guard does **not** classify apply-time versus call-time, extract object names, or decide durability. For every changed migration that still contains a dollar-quoted body or an `execute`, `format`, or `apply_*_ddl` SQL-string risk marker after comments and ordinary string contents are blanked, require a matching version key. An explicit empty declaration is valid:

```json
{
  "notes": "Reviewed: dynamic text is not durable apply-time DDL; no verification targets."
}
```

If classification is uncertain, fail and print the migration path plus: “add or update the version key; list durable targets by hand or record an explicit empty declaration.” Never infer tables, indexes, policies, calls or drops.

Mechanical validation only:

- JSON schema and unique 14-digit keys;
- every key matches one `supabase/migrations/<version>_*.sql` file;
- declared names are valid for their typed query path;
- reject `pg_temp.*` declarations;
- require `notes` for empty declarations;
- no gold-list of inferred objects exists in the guard or its fixtures.

Wire the test and command as explicit steps in `.github/workflows/tools-offline-tests.yml`; do not rely on its `tools/*.test.mjs` glob.

**Gate:** risk-marker fixtures cover bare/tagged/digit quotes, comments, literals, helper arguments, `do $tag$`, called and uncalled routines, single-quoted execute SQL and `execute format`. Each requires a key, never inferred targets. Deleting the `20260825082910` key fails. A static test rejects any target-extraction/gold-list implementation.

### Step 3 — Build typed, three-source catalog truth

Add `scripts/catalog-truth.mjs`:

```bash
node scripts/catalog-truth.mjs --target production public.style_group_tags
```

`--target preview|production|both` is required; default is `both`. One unreachable database does not prevent querying the other when explicitly selected. Any requested source that is unreachable prints `UNVERIFIABLE` and exits 2.

Never collapse sources into one answer:

- **file state per creator/version:** `DECLARED`, `VISIBLE_CREATE`, `NOT_DERIVABLE`, or `HARD_BLOCKED`; list every creator independently;
- **ledger state per creator/version and target:** `APPLIED`, `NOT_APPLIED`, or `UNVERIFIABLE`;
- **catalog state:**
  - table/view/materialized view: typed identity plus `PRESENT`, `ABSENT`, `UNVERIFIABLE`;
  - index: schema-qualified name, owning relation, and `PRESENT`, `WRONG_OWNER`, `ABSENT`, `UNVERIFIABLE`;
  - function: exact identity signature and `PRESENT`, `ABSENT`, `UNVERIFIABLE`;
  - RLS: table plus `ENABLED`, `DISABLED`, `NO_TABLE`, `UNVERIFIABLE`;
  - policy: policy name/table/command plus `PRESENT`, `MISMATCH`, `ABSENT`, `UNVERIFIABLE`;
  - trigger: trigger/table plus `PRESENT`, `ABSENT`, `UNVERIFIABLE`.

Manifest `DECLARED` is file-source metadata only. It can never produce catalog `PRESENT`. `NOT_APPLIED` is a version/target ledger state, not an object state. Reuse the existing read-only Management API implementation and hard-blocked version source.

**Gate:** mocked source tests cover applied reissue after two hard-blocked creators, merged-but-unapplied, empty ledger, unknown object, selected-target reachability, preview unreachable/production present, wrong index owner, function overloads, RLS disabled, missing RLS table, policy mismatch and credential failure. Empty/unreadable ledger and requested-database failures exit 2.

### Step 4 — Enrich messages; never alter refusals

Inventory credentialed guards that say “missing,” “never created” or “not applied.” Record audited call sites in `docs/verification/throughput-guard-truth-audit-20260828.md`.

Credentialed guards may add three-source text to failure output. They may not change exit codes, `available`, `created_objects()`, `preflight_batch()` decisions, or the applied-dynamic rescue. Offline PR checks print `NOT_DERIVABLE` and the exact `catalog-truth` command; they do not query preview or production.

There is no exception or test-driven hatch for changing a refusal in this plan. Any proposed behavior change becomes a separately reviewed issue.

**Gate:** snapshot tests prove every audited guard's exit code is unchanged and only its explanatory text changes. `test_applied_dynamic_ddl_creation_contradicts_the_refusal` remains byte-for-byte unmodified and green. Static tests prove catalog output never enters `available`.

### Step 5 — Build the false-alarm corpus

Create fixtures under `scripts/fixtures/guard-false-alarms/` with an index containing incident, guard, expected verdict and source evidence. Include:

- #1645 helper-argument DDL and all three creators;
- comment/string phantom DDL; bare, tagged and digit-bearing quotes;
- called versus uncalled routine bodies;
- quoted identifiers and spaced policy names;
- same-migration temporary-object cleanup;
- single-quoted RLS, `execute format`, `$applyddl$` functions and dynamic triggers;
- previously fixed cancelled-work and `ON UPDATE CASCADE` false alarms.

Each applicable guard test consumes shared fixtures. Wire the corpus runner explicitly in the appropriate workflow.

**Gate:** revert one historical narrowing locally, prove the corpus fails, restore it, and record the exact command/output summary in the verification document. The corpus does not contain inferred manifest target gold-lists.

### Phase B — triage, measurement and operating rules

### Step 6 — Record blockers and causal time

Create `config/blocker-ledger.json`, `scripts/check-blocker-ledger.mjs` and `scripts/guard-throughput-report.mjs`. Required fields:

- `id`, `opened_at`, `resolved_at`, `first_red_check_at`, `diagnosis_proved_at`;
- `class`: `guard-false-alarm`, `guard-true-block`, `reviewer-harness`, `credential`, or `other`;
- `issue_or_pr`, `guard`, `symptom`, `proof_command`;
- `resolution`, `fixed_by`, `corpus_fixture`;
- `active_minutes_lost`, `wall_minutes_blocked`, `estimate`.

Unknown timestamps and durations remain `null`; never invent them. Headline diagnosis metrics include only entries with both timestamps, `estimate=false`, after `triage-gate` exists, matching the same `class`, excluding `other`, owner waits and deployment windows. Print `n=` with every figure. Do not publish a percentage until `n>=20` under that filter.

Primary measures:

- median/p90 wall minutes by blocker class;
- median evidenced active minutes;
- false-alarm recurrence after fixture landing;
- median first-red-to-proved-diagnosis time.

Initial success target: zero known recurrence, every diagnosis has a proof command, and a 50% reduction in median diagnosis time when the comparable evidenced sample reaches 20. Estimated rows are ranking evidence only and never headline results. Overall issue age remains separately labelled context.

**Gate:** validation rejects missing fields, dangling fixtures, invalid SHAs and impossible timestamp order. Report tests prove null/estimated/incomparable rows are excluded and every result prints sample size.

### Step 7 — Add one-command triage

Add `scripts/triage-gate.mjs <guard-or-check> [object] [--target preview|production|both]`. It prints the guard purpose/owner, matching corpus and ledger entries, proof command, typed catalog truth when requested, one safe next action, and `NO KNOWN MATCH` without guessing.

It is read-only and does not mutate GitHub, databases or the ledger.

**Gate:** tests cover known false alarm, known true block, unknown guard, selected-target unavailable catalog and object-free offline use.

### Step 8 — Write diagnosis and reviewer-liveness rules

Update both `AGENTS.md` and `docs/agents/section-4-anti-collision-rules.md`:

- no root-cause claim without a rerunnable command or verification artifact;
- after ten minutes without proof, label it `working hypothesis`;
- run `triage-gate` first for a red guard;
- scripts/docs/CI-only changes require one independent reviewer;
- migrations, data movement, production applies and security/RLS changes require two;
- probe wrapper liveness using process/session updates and non-empty stream before waiting;
- replace only when there is no verdict and no progress, or a concrete transport/coverage/truncated-output failure;
- never replace a `REVISE`, never proceed below required coverage, and after two replacements on the same head stop and ask the owner.

Do not introduce a fixed 20-minute hard kill. Update the active-plan router wording in `AGENTS.md` to “make throughput guards tell the truth,” not merely “cut issue lead time.” Update issue #1680 to match the final design.

**Gate:** explicit searches prove both documents carry equivalent safety rules; `node scripts/check-skill-drift.mjs --require-skills` and its test pass.

### Phase C — final verification and landing

### Step 9 — Verify and ship

Run focused tests after each step. Once the tree is frozen, run:

```bash
node --test scripts/*.test.mjs tools/*.test.mjs
```

```bash
python -m unittest scripts/test_*.py
```

Run every repository-required check named by `AGENTS.md`, confirm no migration changed, obtain required independent review, commit owned files, open the PR and merge only after checks pass. Verify the merge SHA and post-merge `main` checks. Update this STATUS table with artifact-backed evidence and close #1680 only when all deliverables exist.

**Gate:** merged commit on `main`, required checks green, no database mutation, and every STATUS row cites a file, test, run or SHA.

## 10. Required tests

- `scripts/test_production_catalog_verification.py`: allowlist-scoped manifest union; explicit empty declaration; typed targets; safe quoted/spaced identities; no global probes.
- Static migration-guard test: `production_migration_guard.py` does not import/open/parse `config/apply-time-targets.json`; bogus manifest data never reaches `created_objects()` or `available`.
- `scripts/check-apply-time-manifest.test.mjs`: risk-marker declaration requirement, empty declaration, helper/single-quoted/format shapes, no inferred target gold-list, key deletion bite.
- `scripts/catalog-truth.test.mjs`: every typed per-source state, hard-blocked plus applied reissue, empty ledger, selected-target failure and exit 2 behavior.
- Guard snapshots: Step 4 changes wording only; existing exits and #1645 rescue are unchanged.
- False-alarm corpus runner: fixtures reach real guards and fail when a historical narrowing is reverted.
- `scripts/check-blocker-ledger.test.mjs`: fields, timestamps, sources, SHAs, nulls and estimate handling.
- `scripts/guard-throughput-report.test.mjs`: filters, sample size, median/p90 and no headline estimates.
- `scripts/triage-gate.test.mjs`: false alarm, true block, unknown guard and selected-target outage.
- Full Node and unittest suites remain green.

## 11. Constraints and gotchas

- Work in an isolated worktree from current `origin/main`; preserve unrelated work.
- Repository maintenance only; no migration, DB write, apply or new credential.
- Manifest is one-way post-apply verification input, scoped to allowlisted versions.
- Migration acceptance and live catalog truth never consume manifest declarations as evidence of presence.
- Requested unavailable authority is `UNVERIFIABLE`, exit 2, never `ABSENT`.
- Do not quote scan counts without rerunning the scan.
- Use explicit workflow steps for new `scripts/` tests; `tools/*.test.mjs` glob does not include them.
- Use `python -m unittest`, matching current CI.
- Stage owned files only and verify committer identity before commit.
- Once scripts/workflows change, this is not documentation-only; normal checks and review apply.

## 12. Access and environment

- GitHub: authenticated `gh`, repository `u2giants/shared-db`, base `main`.
- Databases: shared preview and production through existing Management API `database/query` with `read_only: true`.
- Secrets: existing 1Password vault `vibe_coding` references only; no new secret. Never print values.
- Runtime: repository Node and Python.
- Worktree convention: `C:\repos\shared-db-worktrees\<name>`.

---

# Part 4 — Landing it

## 13. Definition of done, risks and open questions

### Definition of done

- [ ] Manifest contains manually verified typed targets and explicit empty declarations where appropriate.
- [ ] Manifest is used only for allowlisted post-apply probes and file-source declarations.
- [ ] Mechanical presence guard requires keys but never infers execution, targets or durability.
- [ ] `catalog-truth` reports typed, independent file/ledger/catalog states and selected-target outages correctly.
- [ ] Credentialed guards add context without changing exits, availability or the #1645 rescue.
- [ ] Historical false alarms are executable and the corpus is proven to bite.
- [ ] Ledger and triage commands are read-only, tested and evidence-based.
- [ ] Headline measurement excludes estimates and prints comparable sample size.
- [ ] Reviewer replacement preserves coverage and never replaces a substantive `REVISE`.
- [ ] Full suites and required checks pass; no migration/database mutation occurred.
- [ ] PR merged, post-merge checks green, issue #1680 and STATUS current.

### Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Manifest misses a target | Key requirement, human review, corpus and explicit audit | Remove affected verification claim until declaration is corrected; never widen acceptance |
| Manifest data manufactures acceptance | Static no-import test and one-way integration | Revert manifest consumer immediately |
| Presence guard becomes a parser | No classification/extraction; empty keys allowed | Revert guard and retain manifest loader only |
| Catalog outage reads as absence | Typed `UNVERIFIABLE`, exit 2 | Revert message integration; keep standalone typed command |
| Quoted/spaced identity breaks SQL | Typed validation/binding, reject unsafe input | Remove unsupported type until safely bound |
| Metrics present guesses as fact | Evidence timestamps, estimate exclusion, `n=` | Withdraw claim; retain raw ledger |
| Reviewer replacement hides `REVISE` | Verdict-aware replacement and two-attempt cap | Revert reviewer rule change |

### Open questions

No owner decision is required before implementation. Language/module boundaries and optional PR comments remain implementer choices under §8. Unsupported identifier forms fail validation rather than being silently skipped. Any proposed change to a guard refusal or acceptance path is a new issue, not an interpretation of this plan.

## Self-audit

1. **Can a fresh session execute this without chat context? Yes.** §§1–8 give the goal, repository, exact #1645 helper shape, three creators, called-procedure and RLS/function/trigger traps, current code, rejected designs and locked decisions. §9 gives ordered file-level steps and gates; §§10–13 cover tests, access, landing and rollback.
2. **Does it preserve every relevant nuance? Yes.** §§3, 5–8 retain the facts removed by the prior rewrite, distinguish declaration presence from target inference, protect the existing rescue, type every truth state, and define reviewer replacement without a fixed kill timer.
3. **Is the goal sufficient for judgment calls? Yes.** §1 makes truthful evidence without weakened refusal controlling; §§4, 8 and 13 require fail-loud behavior and route any acceptance change to a new issue.

All 13 required sections are present. Every implementation step names files or functions, behavior, dependencies and a verification gate. Tests are behavior-specific; secrets are locations only; definition of done includes commit, merge and post-merge proof.
