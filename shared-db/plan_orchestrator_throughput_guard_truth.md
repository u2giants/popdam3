# Implementation plan — make throughput guards tell the truth

**Repository:** `u2giants/shared-db`
**Tracking issue:** [#1680](https://github.com/u2giants/shared-db/issues/1680)
**Work class:** repository maintenance only
**Created:** 2026-08-27; consensus revision 2026-08-28 after Claude Opus 5 and Grok 4.6 adjudication
**Handoff:** [`HANDOFF.d/2026-08-28T0230Z-edge-dev-codex-throughput-plan-consensus.md`](HANDOFF.d/2026-08-28T0230Z-edge-dev-codex-throughput-plan-consensus.md)

This plan changes scripts, tests, workflows and documentation. It authorizes no migration, database write, preview apply, production apply, infrastructure mutation or new credential. Under `AGENTS.md` §0.0-C, a repository-maintenance session owns it; the schema orchestrator does not.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Plan, handoff and tracking issue registered | ✅ done 2026-08-27 | registration merge `172d2bb`; rewrite merge `d4bbfceb`; reviewed revision merge `9bcbd305` |
| 1 | Extend the existing version-keyed, hash-bound verification sidecars | ⬜ open | — |
| 2 | Mechanical sidecar-presence and integrity guard | ⬜ open | — |
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

- `20260710135600`, `20260710135900` and `20260710135950` define procedures, call them during the migration, then drop them. Their bodies are apply-time despite being routine bodies. `20260710135700` separately uses `execute format(...)` to enable RLS and requires the same explicit review discipline.
- `20260727154500` has the same create-call-drop procedure shape and contains many dynamic executions; it is a mandatory legacy seed too.
- `20260825031841` creates and later drops `asset_tags_pending_metadata_normalization_idx`; it is not a durable target.
- `20260621151155` and `20260701154948` dynamically enable RLS through `execute format(...)`; the diagnostic relation scanner does not discover these cases.
- `20260825082910` creates functions through `$applyddl$`, enables RLS through a single-quoted helper argument, creates policies with spaced names, and creates triggers through dynamic SQL.
- `dflow."AdditionalUserEmail"` proves quoted identifiers exist in historical dynamic DDL and cannot be interpolated by the current unquoted `IDENT` validation.

The diagnostic corpus can be explored with:

```bash
python scripts/scan_apply_time_ddl.py
```

Its counts are diagnostic input only. It sees relation-shaped statements, not all functions, policies, RLS changes or triggers. Re-run it before quoting any count, and never treat its output as sidecar authority.

## 4. Scope

**In scope**

- The existing version-keyed, migration-hash-bound sidecars as the sole declaration store for durable post-apply verification contracts.
- A mechanical guard that requires a sidecar when migration SQL contains dynamic-SQL risk markers, without classifying execution or inferring targets.
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
- `scripts/production_catalog_verification.py`: `derive_targets(migrations, allowlist)` derives post-apply probes from stripped SQL. `load_behavior_sidecars()` already loads only allowlisted `<version>.json` files, validates their shape, and binds each to the canonical migration's LF-normalized SHA-256. `CATALOG_CONTRACTS` already verifies exact function identities, triggers, spaced policy names, and RLS state without unsafe generic identifier interpolation. `_sql_array()` accepts only unquoted identifiers matching `IDENT`/`ROLE_RE`.
- `scripts/production-verification-sidecars/20260825082910.json`: already supplies the durable #1645 post-apply contract. Two other sidecars prove the store also supports exact-row-count behavior checks.
- `scripts/test_production_migration_guard.py`: `test_applied_dynamic_ddl_creation_contradicts_the_refusal` must remain unmodified and green.
- `scripts/check-migration-ledger-drift.mjs`: precedent for independent file/ledger states and exit 2 on unavailable evidence.
- `scripts/check-pr-object-collisions.mjs`: separate Node text analysis; unification is out of scope.
- `scripts/scan_apply_time_ddl.py`: diagnostic scanner only; its relation pattern does not cover RLS, policies, functions or triggers.
- `.github/workflows/tools-offline-tests.yml`: runs `tools/*.test.mjs` plus explicit script checks, has a shallow checkout, and runs on both pull requests and pushes to `main`. A changed-file guard cannot be added there without explicit history/base/push semantics.
- `.github/workflows/shared-supabase-migrations.yml`: checkout uses full history for migration comparisons; Python tests already use `python -m unittest scripts/test_*.py`.
- `.github/workflows/production-catalog-verification-recovery.yml`: re-runs `production_catalog_verification.py` against historical allowlists and is a compatibility consumer of every sidecar-schema/contract change.
- `.github/workflows/guarded-migration-merge.yml`: workflow-dispatch merge lane that checks out the detached reviewed head and reruns guards immediately before merge.
- Reviewer rules are split between `AGENTS.md` and `docs/agents/section-4-anti-collision-rules.md`.
- No sidecar-presence requirement, cross-guard corpus, blocker ledger, `catalog-truth` command or `triage-gate` command exists on the starting commit.

## 6. Findings and root cause

### 6.1 Text analysis cannot prove runtime state

`strip_sql()` is correct for batch ordering: treating uncalled routine bodies as apply-time dependencies can manufacture false acceptance. The failure occurs when a consumer silently converts “not derivable from stripped text” into “absent.”

### 6.2 Automatic target discovery is unsafe

Four discovery attempts were wrong through comment pairing, tagged quotes, digit-bearing tags, called routines, quoted identifiers, duplicates and temporary objects. The existing sidecars already provide the safe asymmetry:

- human-reviewed, hash-bound sidecars may add post-apply checks for allowlisted versions;
- sidecars are never read by migration acceptance code;
- the presence guard may require a declaration but never infer target names or durability;
- an explicit empty sidecar is valid when human review finds no durable target, but must carry marker-line evidence and a substantive reason while remaining hash-bound.

### 6.3 Live catalog is necessary but insufficient

Catalog state answers what exists now. It cannot prove reviewed-but-unapplied work exists on `main`. Files cannot prove runtime state. The ledger cannot prove object state. The command must return each source independently and must never convert an unreachable source into absence.

### 6.4 General issue age is not causal throughput evidence

The earlier median 4.0h and p90 60.3h across 400 issues mix guard failures with owner waits and unrelated work. Retain them only as context. Primary measures come from evidenced blocker timestamps and exclude estimates from headline results.

### 6.5 Broad `execute` matching is operationally unacceptable

A preliminary case-insensitive audit found that roughly 44% of the 554 migrations contain the token `execute`, including ordinary grants, triggers and call-time routine bodies. This estimate explains the adoption cost; it is not verification evidence and must not be repeated as an exact count. Because enforcement covers changed migrations plus mandatory versions, future dynamic routine bodies may deliberately require reviewed sidecars even when uncalled. Before CI is enabled, the implemented detector must emit `docs/verification/throughput-guard-truth-baseline-20260828.json` containing its exact command, source SHA, total files, matched paths and count. The human audit Markdown cites that JSON. Correct the plan if the artifact exposes an unexpectedly broad or missed class.

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
10. **Create `config/apply-time-targets.json`.** This duplicates the existing stronger sidecar store, cannot safely fit the current `Targets`/`build_catalog_sql` model for triggers, policies, exact routine identities and quoted names, and creates cross-language drift.
11. **Stop after two replacement reviewers.** Existing tooling already exhausts active reviewers, uses Codex overflow once, and then fails closed; an earlier owner stop reduces throughput without improving coverage.
12. **Wire every new test as an explicit workflow line.** The repository has already lost tests that way; durable discovery is a glob plus a named-file presence assertion.
13. **Match privilege/trigger `EXECUTE` or dollar bodies indiscriminately.** Historical migrations commonly contain those static forms. Exclude only the proven-static privilege and trigger tokens; retain every other `execute` plus established apply-DDL helper calls.

## 8. Locked decisions and limited judgment

**Locked on 2026-08-28**

- Use `scripts/production-verification-sidecars/<version>.json` as the only declaration store; do not create `config/apply-time-targets.json` and do not build an automatic target parser.
- Sidecars remain read only by post-apply verification and diagnostic commands, scoped to versions in the current allowlist and bound to the canonical migration SHA-256.
- Migration acceptance code must not import, open or parse sidecars.
- The migration-lane author owns the sidecar and any verifier-owned catalog contract for that migration in the same pull request. Required independent reviewers must explicitly review every dynamic marker's disposition and every catalog-contract query; a reviewed-empty declaration is not clerical boilerplate.
- All database reads reuse the existing read-only Management API path; unavailable evidence exits 2.
- File, ledger, preview and production outcomes remain separate; no single combined verdict hides the sources.
- False alarms are executable fixtures.
- Migrations, production/data movement and security/RLS work keep two independent reviewers. Scripts/docs/CI-only work requires one.
- Reviewer replacement follows the existing tool-enforced route: never replace a substantive `REVISE`; skip providers already failed on the exact head; after all active rotation providers fail, use Codex overflow once; if overflow also fails, refuse and return the exact blocker to the owner.

**Implementer judgment**

- `catalog-truth` and `triage-gate` may be Node commands backed by Python helpers to reuse existing catalog code. Preserve one documented CLI and test the boundary.
- The blocker ledger may add fields but cannot remove Step 6 required fields.
- Automated PR comments are optional; omit them if they need new permissions.

---

# Part 3 — How to build it

## 9. Ordered implementation

### Phase A — truth and regression protection

### Step 1 — Extend the existing sidecar contract, not the target parser

Keep `scripts/production-verification-sidecars/<version>.json` as the sole declaration store and extend its Python validator only enough to permit an explicit reviewed-empty declaration:

```json
{
  "schema_version": 1,
  "migration_version": "20260825031841",
  "migration_sha256": "<canonical LF-normalized migration SHA-256>",
  "marker_schema_version": 1,
  "checks": [],
  "marker_reviews": [
    {
      "line_start": 42,
      "line_end": 87,
      "disposition": "no_durable_target",
      "reason": "All objects created by this reviewed block are dropped before the migration commits."
    }
  ]
}
```

Required top-level keys remain `schema_version` (exactly `1`), `migration_version`, `migration_sha256` and `checks`. Every risk-marked migration also requires `marker_schema_version` (initially exactly `1`) and `marker_reviews`, a non-empty array of non-overlapping line ranges covering every detected marker line exactly once. Each range records either `disposition: "checks"` plus one or more `check_id` values present in that sidecar, or `disposition: "no_durable_target"` plus a substantive reason of at least 40 non-whitespace characters. Unknown, stale, overlapping or uncovered marker lines fail, and a review cannot cite an absent check. Checks may also exist for independent post-apply behavior not caused by a marker; they need not be reverse-linked. Marker coverage and check provenance are intentionally one-way.

An empty `checks` array is valid only when every marker review is `no_durable_target`. Non-risk existing sidecars remain valid without `marker_reviews`. Grouped ranges make the largest dynamic files reviewable without allowing one trivial check to discharge hundreds of unrelated statements.

Detector semantics are versioned. Any change to comment/string blanking, static-token exclusions or helper matching must bump the detector constant and `marker_schema_version`, regenerate the baseline artifact, scan the entire sidecar store, migrate every affected sidecar in the same PR, and show the old-versus-new marker-set diff. Unsupported or mixed detector versions fail; there is no silent compatibility fallback.

A reviewed-empty sidecar contributes zero checks to `load_behavior_sidecars()` and **must not** soften the existing enforcing-mode “THIS STEP PROVED NOTHING” refusal when no real derived target or check exists. It retains version match, allowlist scoping and LF-canonical migration-hash binding. Update top-level validation to distinguish the conditional key while rejecting every other key.

Non-empty sidecars continue using verifier-owned `catalog_contract` entries for exact identities and `exact_row_count` where already appropriate. Do not add generic table/function/policy/trigger data to `Targets`, `derive_targets()` or `_sql_array()`. Do not use the in-migration `-- catalog-verification: no-op` declaration for these dynamic migrations: that separate mechanism correctly accepts only pure-data migrations and rejects `create`, `grant` and `do` shapes.

Preserve the repository's existing catalog-contract retirement model; do not add `superseded_by`. When a later migration intentionally retires an asserted object, its reviewed PR updates the verifier-owned `CATALOG_CONTRACTS` assertion exactly as the issue #1467 precedent documents: remove the obsolete assertion rather than invert it, and prove the historical recovery allowlist remains green against current catalog truth. The offline checker rejects a sidecar contract ID absent from `CATALOG_CONTRACTS`; contract-removal tests must cover both the retiring migration's final state and the historical recovery workflow. Never delete the sidecar or migration evidence.

Seed or confirm sidecars by hand for the mandatory versions in Step 2. Use `scan_apply_time_ddl.py` only to locate candidates. The existing `20260825082910.json` is authoritative for #1645 and must be extended only if a reviewed contract is actually missing. Exclude `pg_temp.*` and same-migration drops; express quoted identifiers, exact overloaded routines, spaced policies, triggers and RLS only through verifier-owned catalog contracts with safely authored SQL.

**Gate:** `python -m unittest scripts/test_production_catalog_verification.py scripts/test_production_catalog_verification_noop_narrowing.py` proves allowlist scoping, CRLF/LF canonical hash equivalence, hash mismatch refusal, conditional keys, complete/non-overlapping marker-review coverage for empty and non-empty sidecars, absent-check refusal, unchanged non-risk sidecars, empty-sidecar preservation of the enforcing-mode “proved nothing” refusal, unchanged pure-data no-op narrowing, contract-retirement behavior, historical recovery-allowlist compatibility and unchanged #1645 behavior. A static test proves `production_migration_guard.py` never references the sidecar directory or loader.

### Step 2 — Require sidecars mechanically; never infer targets

Add `scripts/check-production-verification-sidecars.mjs` and `scripts/throughput-guard/check-production-verification-sidecars.test.mjs`.

Put the live guard in the `validate` job of `.github/workflows/shared-supabase-migrations.yml`, whose checkout already uses `fetch-depth: 0`. Do not put it in the shallow tools workflow. Its in-scope migration set is the union of:

- added, modified or renamed `supabase/migrations/*.sql` files on the candidate side (`git diff --name-only --diff-filter=AMR <merge-base>..HEAD -- supabase/migrations`); and
- the mandatory scan versions `20260621151155`, `20260701154948`, `20260710135600`, `20260710135700`, `20260710135900`, `20260710135950`, `20260727154500`, `20260807030000`, `20260823233716`, `20260825010603`, `20260825031841`, `20260825050407`, and `20260825082910`, even when untouched. This includes every existing sidecar version, all known create-call-drop reconciliations, dynamic RLS examples and all #1645 creators.

“Mandatory scan version” does not itself mean “sidecar required.” A sidecar is required when that version (or another changed migration) has at least one surviving marker, or when the version already owns a sidecar whose integrity must remain enforced. A mandatory version with no marker and no existing sidecar passes without creating boilerplate.

For pull requests, resolve `origin/${GITHUB_BASE_REF}` using the same candidate loop as `scripts/check-sql.sh`, compute `git merge-base <resolved-base> HEAD`, and diff `<merge-base>..HEAD`; exit 2 as `UNVERIFIABLE` if either ref cannot be resolved. For every `workflow_dispatch`, pass `--base origin/main` explicitly: a dispatch may target a feature branch, so it must validate that branch's candidate migrations; a dispatch on `main` naturally has an empty diff. Local default performs full-store/mandatory validation only, while `--base <ref>` explicitly enables a candidate diff. `.github/workflows/shared-supabase-migrations.yml` intentionally has no push trigger.

For each in-scope migration, use a small lexical blanker: remove comments and replace contents of ordinary single-quoted strings with spaces while preserving quote delimiters; retain dollar bodies. Thus PL/pgSQL `EXECUTE 'ddl'` retains the outside keyword, while a privilege-name literal `'EXECUTE'` contains no token. Then remove only proven-static forms, case-insensitively. For `GRANT`/`REVOKE`, tokenize one SQL statement bounded by its next semicolon and remove `EXECUTE` only when it is a privilege token in that statement; never match across a statement separator. Also remove trigger `EXECUTE FUNCTION` / `EXECUTE PROCEDURE` (the exclusion begins at `EXECUTE`, so an intervening trigger `WHEN` clause is irrelevant). Every remaining `\bexecute\b` is a marker. Also mark, case-insensitively, any called identifier matching `\b[a-z0-9_]*apply[a-z0-9_]*ddl\b\s*\(` so `popdam_1479_apply_final_ddl(...)` is caught even though its body says `execute p_sql`. A dollar body or bare `format` alone is not a marker. This is conservative token-shape detection only; it must not decide whether a routine is called, extract targets, analyze call graphs, or infer drops.

This is prospective enforcement plus a reviewed historical seed, not an exhaustive retrofit of all 554 migrations. Historical files outside the 13 mandatory scans remain unguarded until changed; bare `DO $$`/dollar bodies without `EXECUTE` or an apply-DDL helper (for example `20260825041343`) deliberately do not trigger. State this limitation in diagnostics and the audit; never claim complete historical dynamic-SQL coverage.

If a required sidecar is missing, fail with the migration path and: “Add a hash-bound sidecar; record durable checks by hand or a reviewed-empty declaration covering every marker line.” Full-tree sidecar validation remains independent of the diff and rejects orphan sidecars, version/filename mismatch, SHA mismatch, duplicate check IDs, unknown keys and invalid empty declarations; extra valid sidecars on non-risk migrations remain legal.

Python owns sidecar schema, LF-canonical hashing, `dynamic_execution_marker_lines(sql)`, and empty-declaration rules. Refactor a pure, credential-free `validate_behavior_sidecar(repo, migration_version, migration_path, seen_ids)` primitive inside `scripts/production_catalog_verification.py`; normal `load_behavior_sidecars()` and a new offline `scripts/check_production_verification_sidecars.py` must both call it with their own cross-file accumulator. The offline checker accepts explicit scan versions, validates every sidecar in the full store, recomputes markers for each sidecar's migration under its declared detector version, enforces marker reviews whenever markers exist, and separately detects orphan sidecars. A missing migration/version produces an actionable `GuardError` and exit 2, never `KeyError`/traceback. It must not call `parse_allowlist`, reject `HARD_BLOCKED` scan versions, enter the credentialed `main()` path, or require `SUPABASE_ACCESS_TOKEN`.

`scripts/check-production-verification-sidecars.mjs` is a thin CLI that resolves the comparison base/changed set, invokes the offline Python checker and passes through its diagnostics and exit class. Export pure functions such as `resolveBase({candidateRefs, git})` and inject fake refs/git only through function arguments in unit tests; do not add an environment-variable seam. Missing Python, import failure or malformed Python output exits 2. Node must not implement SHA-256, copy the Python schema, or reinterpret Python failures.

Update the actual atomic supersession implementation in `scripts/manage-migration-author-lanes.mjs`: `supersedeActiveClaimVersion()` and `--supersede-active-claim-version` must rename the matching sidecar alongside the migration, update `migration_version`, recompute the LF-canonical hash, and update any version-keyed contract lookup inside the existing rename/rollback transaction. Extend `scripts/manage-migration-author-lanes.test.mjs` with sidecar rename/re-key success, no-sidecar compatibility, and rollback after partial failure. The guard refuses an orphaned old sidecar or missing new one.

The per-file Python primitive validates one sidecar and accepts a caller-owned `seen_ids` accumulator. Normal allowlist loading and the offline full-store checker each own that accumulator and therefore enforce repository-wide unique `check_id` values without duplicating schema logic. The offline checker also proves every required version has a sidecar. Removing any of the three pre-existing sidecars must fail.

Also run the same guard in `.github/workflows/guarded-migration-merge.yml` against the detached exact reviewed head immediately before merge, beside its existing SQL, collision and lease reruns. Invoke it with `--base origin/main`, which that workflow already fetches and proves as the merge base. The merge lane must not fall into base-free workflow-dispatch mode or rely on a stale earlier PR check; any head mismatch or unavailable comparison exits 2.

Pin Python 3.12 in every sidecar consumer: the `verify` job (“Tools offline tests”), the shared-migrations `validate` job, the guarded-merge exact-head rerun, and `production-catalog-verification-recovery.yml`. Before changing enforcing workflows, run the existing `scripts/test_*.py` suite once on the current runner-default interpreter and once on 3.12; record both versions/results and require identical passing behavior. Any difference blocks the pin until corrected. In the `verify` job, place the new Python setup and `node --test scripts/throughput-guard/*.test.mjs` **after** the existing `actions/setup-node@v4` Node 22 step and before the later ai-devops checkout. Add named-file presence assertions incrementally in the same step/PR that creates each file: Step 2 sidecar test only; Step 3 catalog-truth test; Step 4 audit-completeness test plus its real checker; Step 5 corpus test; Step 6 ledger/report/stub tests plus the real ledger checker; Step 7 triage test. Never require a future-phase artifact. In `.github/workflows/shared-supabase-migrations.yml`, extend the named Python-suite presence list with `scripts/test_check_production_verification_sidecars.py`; execution remains the glob. Keep tests offline and independent of secrets/database access. Do not glob the 27 existing top-level `scripts/*.test.mjs` files into the shallow tools job.

Before merging the workflow guard, re-list every open pull request and inspect its changed migration files. On 2026-08-28 the live open migration PRs were #1731, #1727, #1712, #1670 and #1660; this list is evidence, not a frozen allowlist. For each still-open exact head, run the detector and either prove no marker, add/review the required sidecar on that branch, or let the PR merge before the guard. Comment the exact requirement and proof on any affected open PR. Do not merge the guard while an already-authorized migration branch would become unknowingly blocked on rebase.

**Gate:** before enabling CI, commit the baseline JSON and audit Markdown; run the offline full-tree integrity checker; prove all three existing sidecars pass; size every mandatory version by marker count, review-range count and real-check count; and clear the fresh live open-PR audit above. Fixtures cover pull-request merge-base, workflow-dispatch without a base, local explicit-base/default, and unresolved pull-request base; grant/revoke execute; trigger `execute function` with and without intervening `WHEN`; bare/tagged/digit dollar bodies; comments; helper calls including `popdam_1479_apply_final_ddl`; `execute p_sql`; called/uncalled routines; and quoted/format dynamic execute. Every remaining `execute` or apply-DDL helper call in the changed set or mandatory versions requires a fully covered sidecar. Removing any existing sidecar fails. Wrapper tests pass through Python failures unchanged. The Step 2 test and its presence assertion both run in CI without future files.

### Step 3 — Build typed, three-source catalog truth

Add `scripts/catalog-truth.mjs`:

```bash
node scripts/catalog-truth.mjs --target production public.style_group_tags
```

`--target preview|production|both` is optional and defaults to `both`. One unreachable database does not prevent querying the other when explicitly selected. Any requested source that is unreachable prints `UNVERIFIABLE` and exits 2.

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

Sidecar `DECLARED` is file-source metadata only. It can never produce catalog `PRESENT`. `NOT_APPLIED` is a version/target ledger state, not an object state. Reuse the existing read-only Management API implementation. Import Python's `HARD_BLOCKED` source through a small helper using the same fail-closed pattern as `check-migration-ledger-drift.mjs`; never copy the set into Node.

**Gate:** mocked source tests cover applied reissue after two hard-blocked creators, merged-but-unapplied, empty ledger, unknown object, selected-target reachability, preview unreachable/production present, wrong index owner, function overloads, RLS disabled, missing RLS table, policy mismatch and credential failure. Empty/unreadable ledger and requested-database failures exit 2.

### Step 4 — Enrich messages; never alter refusals

Add `scripts/check-throughput-truth-audit.mjs` and its test under `scripts/throughput-guard/`. It mechanically scans all supported source files under `scripts/**` and `.github/workflows/**` for “missing,” “never created,” “not applied,” `NOT_DERIVABLE`, or the affected refusal helpers. The directory/extensions are code constants tested against repository discovery, not a checked-in mutable allowlist. Record every discovered call site in `docs/verification/throughput-guard-truth-audit-20260828.md` as enriched or explicitly excluded with a reason. The checker fails on discovered-but-unlisted, listed-but-nonexistent, or a new nested guard file; tests prove attempts to narrow discovery fail.

Credentialed guards may add three-source text to failure output. They may not change exit codes, `available`, `created_objects()`, `preflight_batch()` decisions, or the applied-dynamic rescue. Offline PR checks print `NOT_DERIVABLE` and the exact `catalog-truth` command; they do not query preview or production.

There is no exception or test-driven hatch for changing a refusal in this plan. Any proposed behavior change becomes a separately reviewed issue.

**Gate:** `node scripts/check-throughput-truth-audit.mjs` proves inventory completeness. Snapshot tests prove every enriched guard's exit code is unchanged and only its explanatory text changes. `test_applied_dynamic_ddl_creation_contradicts_the_refusal` remains byte-for-byte unmodified and green. Static tests prove catalog output never enters `available`.

### Step 5 — Build the false-alarm corpus

Create fixtures under `scripts/fixtures/guard-false-alarms/` with an index containing `origin: incident|synthetic-shape`, guard, expected verdict and source evidence. Incident fixtures name the real issue/PR and later bind to one ledger ID. Synthetic shape fixtures explicitly say they are not incidents, carry no ledger ID, and cite the migration/test evidence that justifies the shape. Include:

- #1645 helper-argument DDL and all three creators;
- comment/string phantom DDL; bare, tagged and digit-bearing quotes;
- called versus uncalled routine bodies;
- quoted identifiers and spaced policy names;
- same-migration temporary-object cleanup;
- single-quoted RLS, `execute format`, `$applyddl$` functions and dynamic triggers;
- previously fixed cancelled-work and `ON UPDATE CASCADE` false alarms.

Each applicable guard test consumes shared fixtures through `scripts/throughput-guard/false-alarm-corpus.test.mjs`. The Node glob and named-file presence assertion from Step 2, plus the existing Python glob, must prove the corpus runner is wired.

**Gate:** revert one historical narrowing locally, prove the corpus fails, restore it, and record the exact command/output summary in the verification document. The corpus does not contain inferred target gold-lists.

### Phase B — triage, measurement and operating rules

### Step 6 — Record blockers and causal time

Create an append-only `config/blocker-ledger/` directory containing one immutable `<id>.json` incident file per blocker, plus `scripts/check-blocker-ledger.mjs` and `scripts/guard-throughput-report.mjs`. Do not use a shared JSON array or generated index: separate files avoid cross-worktree append conflicts and Git merges entries by filename. Required fields in each file:

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

Make collection enforceable without requiring a row for every ordinary red CI run:

- Every `origin: incident` fixture cites exactly one ledger `id`, and that incident file cites the fixture; validation enforces the two-way binding. `origin: synthetic-shape` fixtures must not cite a ledger ID and require source evidence. Backfilled incident files may retain unknown timestamps as `null`; validators accept those nulls while headline reports exclude them.
- `triage-gate` prints `ledger_id=<id>` for a match or `LEDGER_MISSING` for an incident-like unmatched diagnosis.
- Add `scripts/record-blocker-stub.mjs` to create the minimum valid immutable incident file: generated `id` (`blk_` plus 16 lowercase hexadecimal bytes), matching filename, current ISO-8601 `opened_at`, `class`, `issue_or_pr`, `guard`, `symptom`, `proof_command`, and `estimate=true`. Set `resolved_at`, `first_red_check_at`, `diagnosis_proved_at`, `resolution`, `fixed_by`, `corpus_fixture`, `active_minutes_lost`, and `wall_minutes_blocked` to JSON `null`; never infer them from wording.
- Create the final `<id>.json` directly with exclusive `wx`; on the negligible collision, generate a new ID and retry. There is no shared lock or mutable index. Later resolution edits only that incident's file on its owning branch. Validator rejects duplicate internal IDs across filenames.
- The operating rule in Step 8 forbids announcing a proved guard root cause or closing a guard-incident issue while `triage-gate` prints `LEDGER_MISSING`; record the stub first.

**Gate:** validation rejects filename/ID mismatch, duplicate IDs, missing fields, dangling or non-bijective fixture links, invalid SHAs and impossible timestamp order. Report tests prove null/estimated/incomparable files are excluded and every result prints sample size. Stub tests cover happy path, missing/unknown flags and class, refusal to invent resolution fields, forced ID collision retry, and two concurrent child processes creating distinct valid files. A Git fixture proves two branches adding different incident files merge without conflict. A test proves an omitted incident fixture/ledger link cannot yield “zero recurrence.”

### Step 7 — Add one-command triage

Add `scripts/triage-gate.mjs <guard-or-check> [object] [--target preview|production|both]`. It prints the guard purpose/owner, matching corpus and ledger entries, proof command, typed catalog truth when requested, one safe next action, and `NO KNOWN MATCH` without guessing.

It is read-only and does not mutate GitHub, databases or the ledger. Mutation is isolated in the explicit `record-blocker-stub.mjs` command.

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
- never replace a `REVISE` and never proceed below required coverage;
- retain the existing tool-enforced route: exhaust active rotation providers that have not failed on the exact head, use Codex overflow once, then fail closed and return the exact blocker to the owner.
- never announce a proved guard root cause or close a guard-incident issue while `triage-gate` prints `LEDGER_MISSING`; first record the minimal blocker stub.

Do not introduce a fixed 20-minute hard kill. Verify the active-plan router in `AGENTS.md` says “hash-bound verification sidecars” and contains no active manifest wording. Update issue #1680 to match the final design.

**Gate:** explicit searches prove both documents carry equivalent safety rules; `node scripts/check-skill-drift.mjs --require-skills` and its test pass.

### Phase C — final verification and landing

### Step 9 — Verify and ship

Run focused tests after each step. Once the tree is frozen, run the exact #1680 suites:

```bash
node --test scripts/throughput-guard/*.test.mjs
```

```bash
python -m unittest scripts/test_*.py
```

Run every repository-required check named by `AGENTS.md`, confirm no migration changed, obtain required independent review, commit owned files, open the PR and merge only after checks pass. Verify the merge SHA and post-merge `main` checks. Update this STATUS table with artifact-backed evidence and close #1680 only when all deliverables exist.

After Step 8 changes authority documentation, also run the existing skill-drift commands in their configured environment: `node --test scripts/check-skill-drift.test.mjs` and `node scripts/check-skill-drift.mjs --require-skills`. Do not claim `node --test scripts/*.test.mjs` is a repository-wide suite: existing `scripts/lib/*.test.mjs` and `scripts/tests/*.test.mjs` belong to separate workflows with their own prerequisites. Required GitHub checks, not one invented mega-glob, are the final integration proof.

**Gate:** merged commit on `main`, required checks green, no database mutation, and every STATUS row cites a file, test, run or SHA.

## 10. Required tests

- `scripts/test_production_catalog_verification.py` and `scripts/test_production_catalog_verification_noop_narrowing.py`: allowlist-scoped and SHA-bound sidecar loading; complete marker-review ranges for empty/non-empty checks; enforcing-mode “proved nothing” preservation; pure-data no-op narrowing; contract retirement/recovery behavior; no global probes.
- `scripts/test_check_production_verification_sidecars.py`: credential-free offline entrypoint, mandatory versions, orphan detection, global check-ID/contract-reference rules, marker-range/version coverage, existing-sidecar preflight and migration rename/re-key behavior.
- Static migration-guard test: `production_migration_guard.py` does not import/open/parse the sidecar store; sidecar data never reaches `created_objects()` or `available`.
- `scripts/throughput-guard/check-production-verification-sidecars.test.mjs`: exact PR/local/workflow-dispatch/guarded-merge base resolution, pure-function injection seam, mandatory versions, string/static-token exclusions, full marker-range coverage, no inferred target gold-list, Python diagnostic pass-through, global check-ID uniqueness and sidecar deletion bite.
- `scripts/throughput-guard/catalog-truth.test.mjs`: every typed per-source state, hard-blocked plus applied reissue, empty ledger, selected-target failure and exit 2 behavior.
- Guard snapshots: Step 4 changes wording only; existing exits and #1645 rescue are unchanged.
- `scripts/throughput-guard/check-throughput-truth-audit.test.mjs`: fixed repository discovery, scope-narrowing refusal, missing/stale audit entries, explicit exclusions and new nested guard-file detection.
- False-alarm corpus runner: fixtures reach real guards and fail when a historical narrowing is reverted.
- `scripts/throughput-guard/check-blocker-ledger.test.mjs`: fields, timestamps, sources, SHAs, nulls, estimate handling and bidirectional fixture binding.
- `scripts/throughput-guard/guard-throughput-report.test.mjs`: filters, sample size, median/p90 and no headline estimates.
- `scripts/throughput-guard/triage-gate.test.mjs`: false alarm, true block, unknown guard and selected-target outage.
- `scripts/throughput-guard/record-blocker-stub.test.mjs`: malformed input, no guessed fields, forced ID collision retry, concurrent distinct-file creation and cross-branch merge fixture.
- `scripts/throughput-guard/false-alarm-corpus.test.mjs`: shared fixtures reach the real guards and bite when a historical narrowing is reverted.
- A named-file presence assertion covers every planned `scripts/throughput-guard/*.test.mjs` file; the glob is the execution mechanism.
- Full Node and unittest suites remain green.

## 11. Constraints and gotchas

- Work in an isolated worktree from current `origin/main`; preserve unrelated work.
- Repository maintenance only; no migration, DB write, apply or new credential.
- Sidecars are one-way post-apply verification input, scoped to allowlisted versions and hash-bound to canonical migration contents.
- Migration acceptance and live catalog truth never consume sidecar declarations as evidence of presence.
- A migration-lane author may propose its sidecar and verifier-owned contract only in the same reviewed pull request; reviewers must inspect every marker disposition. Empty evidence is never an automatic or low-review path.
- Requested unavailable authority is `UNVERIFIABLE`, exit 2, never `ABSENT`.
- Once enabled, sidecar-integrity failure blocks every preview and production apply lane through `validate`; there is intentionally no emergency bypass. Recovery is a reviewed correction or complete feature revert merged through GitHub.
- Do not quote scan counts without rerunning the scan.
- Discover new Node tests with `scripts/throughput-guard/*.test.mjs` plus named-file presence assertions; do not maintain an explicit growing run list or sweep existing incompatible top-level tests into the offline job.
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

- [ ] Existing sidecars contain manually verified catalog contracts and reviewed-empty declarations where appropriate.
- [ ] Baseline JSON and audit Markdown record exact marker counts, ranges and mandatory-version sizing at the implemented source SHA.
- [ ] Every open migration PR was re-audited at its live head before guard rollout and was either clear, updated or merged first.
- [ ] Sidecars remain allowlist-scoped, migration-hash-bound post-apply inputs only.
- [ ] Mechanical changed-set-plus-mandatory-seeds guard requires sidecars but never infers execution, targets or durability; full-tree validation checks every sidecar's integrity.
- [ ] `catalog-truth` reports typed, independent file/ledger/catalog states and selected-target outages correctly.
- [ ] Credentialed guards add context without changing exits, availability or the #1645 rescue.
- [ ] Historical false alarms are executable and the corpus is proven to bite.
- [ ] Ledger and triage commands are read-only, tested and evidence-based.
- [ ] Headline measurement excludes estimates and prints comparable sample size.
- [ ] Reviewer replacement preserves coverage, never replaces a substantive `REVISE`, and retains overflow-then-refuse behavior.
- [ ] Full suites and required checks pass; no migration/database mutation occurred.
- [ ] PR merged, post-merge checks green, issue #1680 and STATUS current.

### Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Sidecar misses a target | Presence requirement, human review, corpus and explicit audit | Remove affected verification claim until the sidecar is corrected; never widen acceptance |
| Sidecar data manufactures acceptance | Static no-import test and one-way integration | Revert diagnostic consumer immediately |
| Presence guard becomes a parser | No classification/extraction; reviewed-empty sidecars allowed | Revert the presence guard and retain the existing sidecar loader |
| New guard falsely blocks the `validate` job and therefore preview/production apply jobs | Seed and validate all mandatory/existing sidecars before workflow wiring; exact marker/base/rename fixtures; fail closed | Correct the sidecar or guard in a reviewed PR; if the new feature itself is wrong, revert its complete workflow+guard commit rather than bypassing the dependency |
| Python 3.12 changes an existing green suite | Run default-versus-3.12 compatibility proof before workflow edits | Correct incompatibility before pinning; never re-host the enforcing lane on unproven behavior |
| Guarded merge/recovery lanes gain a Python runtime dependency | Pin 3.12 explicitly in both and test missing/interpreter-failure as exit 2 before merge/apply | Repair the runtime or revert the complete feature; never skip the guard |
| Catalog outage reads as absence | Typed `UNVERIFIABLE`, exit 2 | Revert message integration; keep standalone typed command |
| Quoted/spaced identity breaks SQL | Typed validation/binding, reject unsafe input | Remove unsupported type until safely bound |
| Metrics present guesses as fact | Evidence timestamps, estimate exclusion, `n=` | Withdraw claim; retain raw ledger |
| Reviewer replacement hides `REVISE` | Existing verdict-aware rotation, Codex overflow and fail-closed refusal | Revert documentation drift; keep tool behavior |

### Open questions

No owner decision is required before implementation. Language/module boundaries and optional PR comments remain implementer choices under §8. Unsupported identifier forms fail validation rather than being silently skipped. Any proposed change to a guard refusal or acceptance path is a new issue, not an interpretation of this plan.

## Self-audit

1. **Can a fresh session execute this without chat context? Yes.** §§1–8 give the goal, repository, exact #1645 helper shape, three creators, called-procedure and RLS/function/trigger traps, current code, rejected designs and locked decisions. §9 gives ordered file-level steps and gates; §§10–13 cover tests, access, landing and rollback.
2. **Does it preserve every relevant nuance? Yes.** §§3, 5–8 retain the facts removed by the prior rewrite, distinguish declaration presence from target inference, protect the existing rescue, type every truth state, and define reviewer replacement without a fixed kill timer.
3. **Is the goal sufficient for judgment calls? Yes.** §1 makes truthful evidence without weakened refusal controlling; §§4, 8 and 13 require fail-loud behavior and route any acceptance change to a new issue.

All 13 required sections are present. Every implementation step names files or functions, behavior, dependencies and a verification gate. Tests are behavior-specific; secrets are locations only; definition of done includes commit, merge and post-merge proof.
