# Implementation Plan: Prevent stranded migrations

Issue: [popcre/shared-db#6574](https://github.com/popcre/shared-db/issues/6574) (claim-first there).
Handoff: [HANDOFF.d/20261117T1545Z-edge-dev3-claude-stranded-migration-prevention-plan.md](HANDOFF.d/20261117T1545Z-edge-dev3-claude-stranded-migration-prevention-plan.md)

## STATUS

| Step | State | Evidence |
|---|---|---|
| A. Refuse pre-merge preview apply of high-risk migrations | ✅ merged | PR #6585 → commit `4a022243`; live proof run `44149841592` (dispatch claim_pr=6598, preset `20261204000300`): step refused in validate, preview job skipped, nothing applied |
| B. Park immediately on a permanent producer-mismatch refusal | ✅ merged, live-proven | PR #6586 (merged). Live proof 2026-11-18 5:31 PM EST: merged detector run read-only against the real logs of PR #6433's failed runs `44093787649` and `44098049834` (both permanent); negative control `44149841592` not permanent. Proof: https://github.com/popcre/shared-db/issues/6574#issuecomment-6993579415 |
| C. Merge-time check for migrations the catalog verifier cannot read | ✅ merged | PR #6588 → commit `249527aa`; check ran on its PR in run `44144185872` (advisory workflow `migration-catalog-readable.yml`, not required) |
| D. Live proof + docs | ✅ merged, live-proven | Doc line PR #6598 (merged). Live proof A: run `44149841592`. Live proof C: run `44144185872`. Live proof B: https://github.com/popcre/shared-db/issues/6574#issuecomment-6993579415 |

**A fresh session starts at Step A.** Steps A, B, C touch different files and may be done in any order, but land each as its own PR. Nothing is blocked on Albert.

---

## Part 1 — Why

### 1. The ultimate goal

A merged database change should reach production on its own, or — if it truly cannot — be set aside **at once** with a clear message, instead of looping through failed attempts for half an hour and then needing an engineer to re-submit it by hand. Concretely, the mess of 2026-11-17 (PR #6433) must not be able to repeat:

1. A risky change was tried on the test database **before** it merged. That made its only test evidence permanently unacceptable to production once a safety script changed between test and merge.
2. The queue then spent 7 runs (~60 minutes, 13:07–14:07 UTC) retrying a change that could never pass.
3. When the re-submitted copy finally applied, the after-apply check reported **failure** because it could not read the change, although the change was correct.

**If a step below conflicts with this goal, the goal wins — stop and flag it** (ask the coordinating session, or comment on #6574). The production safety guarantees are not negotiable: never weaken `scripts/production_migration_guard.py`, the production gate's producer pin, the attempt caps, or review-finding holds to "make it pass".

### 2. What this application is

`popcre/shared-db` is the canonical repository for POP Creations' shared Supabase (Postgres) database used by the CRM, DAM, PIM and PLM apps. Migrations live in `supabase/migrations/<14-digit version>_<name>.sql`. Promotion to production is fully automatic through GitHub Actions:

- `.github/workflows/automatic-production-trigger.yml` — the **selector trigger**. Runs `scripts/automatic_promotion_candidates.py`, which picks the oldest merged migration PR not yet in production and dispatches a **preview apply** (a rehearsal on the preview/test database).
- `.github/workflows/shared-supabase-migrations.yml` — the **migrations workflow**. Its `preview` job applies to the preview database; its `automatic-production-promotion` job qualifies evidence through `scripts/production_business_risk_gate.py qualify-route` (line ~1413) and dispatches the **production apply**; `production-apply` applies and then runs **Post-apply catalog verification** (line ~2387, `scripts/production_catalog_verification.py`).
- Preview applies come in three lanes (workflow inputs, lines ~36–110):
  - **pre-merge (claim) lane** — inputs `claim_pr` + `claim_head_sha`: an authoring session rehearses its own unmerged PR on preview.
  - **post-merge lane** — `merged_preview_source_pr`: what the selector uses after merge, at the exact current main tip.
  - **historical recovery lane** — `historical_preview_source_pr` (+ `historical_preview_original_run_map`): a no-write lane for a version already applied on preview; it pins evidence to the **authoring PR's merge commit**.

No app is deployed from this repo; there is no server to SSH to.

### 3. What triggered this work

PR #6433 (migration `20261116013153`, "revoke anon/authenticated EXECUTE on 104 trigger-returning functions", merged 2026-11-16 04:57 UTC at merge commit `3b0c25e76`).

- 2026-11-16 02:01 UTC, **before merge**, run `43789639543` (dispatched by the `u2giants` login at main `a2311d0`) applied `20261116013153` to preview through the claim lane.
- Between `a2311d0` and the merge commit, `scripts/production_migration_guard.py` changed.
- After merge the version was already on preview, so only the historical recovery lane could prove it. That lane pins producer files to the merge commit; the preview evidence was produced with the older guard → `RiskGateError: ... produced evidence with a different scripts/production_migration_guard.py than the merge commit ...` (raised at `scripts/production_business_risk_gate.py:1562`). The migration is classed high-risk (`preview_required_reasons`, line 3343), so the ephemeral-CI evidence route cannot substitute (line ~3965). **Permanent refusal.**
- 2026-11-17 13:07–14:07 UTC: 7 preview runs for it — 3 free stale refusals (main moved), 2 historical-recovery SHA refusals, 2 `ENGINEER ACTION REQUIRED` qualification refusals (runs `44093787649`, `44098049834`) — then it parked.
- Another session reissued the SQL as `20261204000300` (PR #6566, commit `c08727cf3`) and retired the original in `scripts/production_migration_guard.py` (`HARD_BLOCKED` line ~101, `RETIRED_VERSION_REASONS` line ~453). It applied to production in run `44106460484`, but that run is red: Post-apply catalog verification failed with "the allowlisted migrations named NO catalog object this lexer can read" because the revokes are dynamic (`execute format(...)` in a DO block). Live check 2026-11-17 10:03 AM EST: 0 of 190 in-scope trigger functions executable by anon/authenticated — the change is correct.

This is the **fifth** strand of this shape: `20261113145056`, `20261113150753`, `20261113175425`, `20261113203604`, `20261116013153` (all listed in `RETIRED_VERSION_REASONS`).

### 4. Scope

**In scope:** the three fixes A, B, C below; their tests; one doc line in AGENTS-routed docs.

**NOT in this plan:**
- Notifying the owning session when a PR parks (per-PR comment, `promotion-parked` label) — that is [plan_promotion_stranding_watch.md](plan_promotion_stranding_watch.md), issue #6561. Fix B only changes **when** a park happens; it must call the existing park path so #6561's escalation picks it up.
- Loosening the producer pin or the guard (rejected, §7).
- Automatic re-issuing of stranded migrations (rejected, §7).
- Selector latency / SLOs (issue #6493).
- Re-running or repairing run `44106460484` (production is correct; a production run is never re-run).

---

## Part 2 — What we already know

### 5. Current state of the code (origin/main at 77e8facde, 2026-11-17)

- `scripts/automatic_promotion_candidates.py`
  - `MAX_ATTEMPTS = 3` (line 59); refund budget `MAX_REFUNDS` (line ~62).
  - `COORDINATION_STEPS` (line 403) and `STALE_MAIN_RE` (line ~426, already contains `requires the exact current main SHA`).
  - `stale_main_refusal_only(repo, run)` (line 436) reads a run's failed-job logs (`gh run view --job <id> --log-failed`) to decide a failure was a free staleness refusal. **This is the pattern Fix B copies.**
  - `decide(...)` (line 505); attempt counting loop ~line 620–655; park path appends to `out_of_attempts` (line ~650) and returns `idle` with `ENGINEER ACTION REQUIRED` (line ~664). `decide` is called with `stale=lambda run: stale_main_refusal_only(repo, run)` at lines ~855, ~881, ~918.
- `scripts/production_business_risk_gate.py`
  - `prove_preview_producer_matches_main` (line 1426) raises `PreviewProducerMismatch` (a `RiskGateError`) with text `produced evidence with a different <path> than <against>` (line 1562).
  - `qualify_automatic_route` (~line 3940–3977) wraps it: `the production gate would refuse this preview evidence (...), and the migration is high-risk to live data so the ephemeral CI route cannot substitute -- ...`.
  - `qualify_route_main` prints `::error::ENGINEER ACTION REQUIRED: automatic qualification found no evidence route the production gate accepts: ...` (line ~4000) and returns 2.
  - `preview_required_reasons(repo_root, allowlist)` (line 3343) — non-empty list means "high-risk, preview cannot be skipped".
- `.github/workflows/shared-supabase-migrations.yml` — `preview` job (line 383). The claim-lane inputs `claim_pr`/`claim_head_sha` are read at lines ~460, ~642, ~1300. Post-merge lane validation at ~455–480 refuses `claim_pr` together with `merged_preview_source_pr`.
- `scripts/production_catalog_verification.py` — the "named NO catalog object" hard failure is appended at line ~4508; it is deliberate (test `test_nothing_to_check_is_a_hard_failure`, `scripts/test_production_catalog_verification.py:844`). Escape hatches already exist: a `-- catalog-verification: no-op <reason>` line (regex line 381, pure-data only) and **behavior sidecars** in `scripts/production-verification-sidecars/<version>.json` (`BEHAVIOR_SIDECAR_DIR`, line 613; 143 exist) with check kinds `row_count`, `catalog_contract`, `catalog_absence`.
- `scripts/check-production-verification-sidecars.mjs` runs in CI (`merge-queue-gate.yml:132`, `shared-supabase-migrations.yml:227`) and validates sidecars that exist; it does **not** require one when the lexer would read nothing — that is the Fix C gap.

Nothing for this plan is implemented, committed, or on any branch.

### 6. Key findings and root cause

1. **Root cause (A):** a pre-merge claim-lane preview APPLY of a high-risk migration makes the version "already on preview"; post-merge, only the historical recovery lane remains, which pins to the merge commit; any change to an apply-shaping producer (e.g. `production_migration_guard.py`) between the claim run and the merge strands it forever. Low-risk migrations escape through the ephemeral-CI route; high-risk ones cannot (line ~3965).
2. **Root cause (B):** the selector cannot tell a permanent refusal from a transient one, so it spends up to `MAX_ATTEMPTS` (plus free stale retries) on a change whose refusal text already says no route exists.
3. **Root cause (C):** dynamic SQL (DO blocks with `execute format(...)`) gives the lexer nothing to verify; the verifier correctly refuses to call that green, but nothing at merge time forced the author to supply a sidecar, so the failure is only discovered after the production apply.

### 7. Approaches considered and REJECTED

| Approach | Why rejected |
|---|---|
| Exempt `production_migration_guard.py` from the producer pin (add to `PREVIEW_CUSTODY_ONLY_PATHS`) | It is an apply-shaping producer; evidence made by a different guard is not evidence for this guard. Weakens a safety guarantee. |
| Auto-reissue a stranded migration under a new version | Writes migrations without an author; byte-identical reissue still needs judgment (idempotency on preview, retirement entry). Keep manual. |
| Forbid ALL pre-merge preview applies | Low-risk changes recover fine via the ephemeral route; the claim lane is a useful pre-merge rehearsal. Narrow to high-risk only. |
| Make "named NO catalog object" a warning | Deliberate hard failure (a green that verified nothing is a lie). Fix it at merge time instead. |
| Count the historical-recovery SHA refusal as free | Already done on main (`STALE_MAIN_RE` contains it). Do not redo. |
| Raise `MAX_ATTEMPTS` or add retries | Opposite of the goal. |

### 8. Design decisions

**LOCKED (2026-11-17):**
- The producer pin, the guard, the attempt caps, review-finding holds stay exactly as strong.
- Fix A refuses only when `preview_required_reasons` is non-empty for the claim-lane allowlist, and only for `mode == apply` (dry-run stays allowed — it writes nothing).
- Fix B parks a PR on its **first** run whose failed-job log matches the permanent-refusal signature, and uses the existing `out_of_attempts` park path (so the #6561 escalation and the `ENGINEER ACTION REQUIRED` message keep working).
- Fix C is a CI check at PR / merge-queue time, not a change to the post-apply verifier.

**OPEN (implementer's judgment, criteria given):**
- Fix A placement: a new step in the `preview` job or inside an existing claim-lane validation step — pick the earliest step that already has the checkout and the allowlist, before any database credential step.
- Fix C implementation language: extend `scripts/check-production-verification-sidecars.mjs` **or** add a small Python entry point that imports `production_catalog_verification`'s lexer. Prefer Python if the lexer is only in Python (it is) — never re-implement the lexer.

---

## Part 3 — How to build it

Work in your own worktree from `origin/main`; declare `ai-task-gates start --class code` (Fix A touches a workflow, still `code`). One PR per fix.

### 9. Steps

#### Step A — refuse pre-merge preview apply of high-risk migrations

1. In `.github/workflows/shared-supabase-migrations.yml`, `preview` job, add a step named **`Refuse pre-merge apply of a high-risk migration`** that runs only when `inputs.claim_pr != '' && inputs.mode == 'apply'`. It runs:
   `python scripts/production_business_risk_gate.py premerge-preview-check --allowlist "$PREVIEW_ALLOWLIST"`
   Place it before any step that uses a preview database credential.
2. In `scripts/production_business_risk_gate.py`, add a `premerge-preview-check` sub-command (dispatch it next to `qualify-route` at the bottom `__main__` block): parse `--repo` (default cwd) and `--allowlist`; call `preview_required_reasons(repo, normalize_review_allowlist(allowlist))`; if non-empty print
   `::error::REFUSED: <versions> is high-risk to live data (<reasons>). A pre-merge preview APPLY would strand it (#6574: once applied on preview before merge, only the historical recovery lane can prove it, and any producer change before merge refuses it forever). Run mode=dry-run now, merge, and let the automatic queue rehearse it post-merge.` and exit 1; else exit 0.
3. Do **not** add the new step name to `COORDINATION_STEPS`: claim-lane runs are dispatched by authoring sessions, never by the selector, so they are never counted as attempts.

You'll know it worked when: unit tests below pass, and a `workflow_dispatch` of the migrations workflow with `target=preview mode=apply claim_pr=<n>` for a high-risk version fails at this step before any database step (prove with the dry-run of the step's command locally on `20261204000300`, which is high-risk).

#### Step B — park immediately on a permanent refusal

1. In `scripts/automatic_promotion_candidates.py`, next to `STALE_MAIN_RE`, add
   ```python
   # #6574: a refusal that no retry can cure. The preview evidence was made by a
   # different apply-shaping producer than the gate pins to, and the change is
   # high-risk, so no evidence route exists. Retrying burns the lane (PR #6433:
   # 7 runs, 2026-11-17 13:07-14:07 UTC).
   PERMANENT_REFUSAL_RE = re.compile(
       r"ENGINEER ACTION REQUIRED: automatic qualification found no evidence route"
       r".*produced evidence with (?:a different \S+ than|\S+ (?:present|absent) where)"
       r".*high-risk to live data")
   ```
2. Add `permanent_refusal(repo, run) -> bool`, modelled on `stale_main_refusal_only` (line 436): collect failed jobs from `attempt_jobs(repo, run)`, fetch their `--log-failed`, strip ANSI with `ANSI_RE`, return `bool(PERMANENT_REFUSAL_RE.search(...))`. On any read error return **False** (fail safe = ordinary attempt, current behaviour).
3. Add a `permanent: callable | None = None` keyword to `decide(...)`. In the attempt loop (~620–655), for each failed run of the PR, **before** the stale check, if `permanent and permanent(run)`: set `attempts = MAX_ATTEMPTS`, record `entry["permanent"] = True`, and break — so the existing `out_of_attempts` park path runs.
4. In the `idle` message (~line 664), render such entries as `PR #N (permanent refusal: producer mismatch on a high-risk change — reissue under a new version)` instead of `(N attempts)`.
5. Pass `permanent=lambda run: permanent_refusal(repo, run)` at all three `decide` call sites (~855, ~881, ~918).

Coordination: plan #6561 also edits this file (`report_stuck_change`). Rebase on main before opening the PR; do not touch `report_stuck_change`.

You'll know it worked when: unit tests pass, and replaying PR #6433's history (fixtures below) parks after the first `ENGINEER ACTION REQUIRED` run instead of the third counted one.

#### Step C — merge-time check for unreadable migrations

1. Add a Python entry point (in `scripts/production_catalog_verification.py`, sub-command `--check-readable` or a new small script `scripts/check_catalog_readable.py` that imports it) which, for every migration file **added** relative to `--base origin/main`, derives targets with `derive_targets(migrations, allowlist)` exactly as `verify()` does (~line 4851; the no-op declaration is `targets.noop_declaration`) and fails when **all** are true: targets are empty, there is no valid `-- catalog-verification: no-op` declaration, and there is no sidecar `scripts/production-verification-sidecars/<version>.json`. Message: `<version>: the post-apply catalog check cannot read this migration (dynamic SQL). Add a behavior sidecar scripts/production-verification-sidecars/<version>.json with a catalog_contract or catalog_absence check, or a valid no-op line. Without it the production apply will report failure after applying (#6574, run 44106460484).`
2. Run it in `.github/workflows/merge-queue-gate.yml` right after line 132 (sidecar check) and in the `SQL migration guards` path of `shared-supabase-migrations.yml` next to line 227.
3. Required vs advisory: owner ruling 2026-10-30 says only checks preventing production-data damage or secret leaks may block. This one prevents a false red, not damage → wire it into an **existing** job step (so it fails that job) only if that job is already advisory; otherwise add it as its own non-required job. Check with `gh api repos/popcre/shared-db/branches/main/protection` and the merge-queue ruleset before choosing; record the choice in the PR body.

You'll know it worked when: a test PR adding a copy of `20261204000300`'s SQL under a scratch version with no sidecar fails the new check (do this only as a unit test with a temp repo, not a real PR).

#### Step D — live proof and docs

1. Add one line to `docs/agents/anti-collision-summary.md` near line 180 ("Merge first, then rehearse"): high-risk migrations are refused pre-merge preview APPLY (#6574); use dry-run.
2. Live proof (leave the checklist on #6574 open until each is observed; do not open new issues):
   - A: dispatch the migrations workflow once with `target=preview mode=apply claim_pr=<any open migration PR> preview_allowlist=20261204000300` — must fail at the new step, nothing applied (it refuses before credentials). 
   - B: the next real park, or a replay test only if no park occurs within the plan's session — state which.
   - C: CI log of the PR that adds C showing the check ran.
3. Update this plan's STATUS table with artifacts (run ids, commit SHAs), and the handoff file.

### 10. Tests required

All in existing test files; run `python3 -m pytest -q scripts/test_production_business_risk_gate.py scripts/test_automatic_promotion_candidates.py scripts/test_production_catalog_verification.py scripts/test_automatic_index_maintenance.py` and `node --test scripts/throughput-guard/*.test.mjs` — all green.

- A (`test_production_business_risk_gate.py`): `test_premerge_check_refuses_high_risk_allowlist` (temp repo with a DO-block revoke migration → exit 1, message contains `#6574`); `test_premerge_check_allows_low_risk_allowlist` (plain `create table` in new schema → exit 0); `test_premerge_check_refuses_unknown_version` (missing file → non-zero, not silently 0). Workflow text test in `test_automatic_promotion_candidates.py`: the step exists in the `preview` job, gated on `claim_pr` and `mode == 'apply'`, and precedes the first step that references a `SUPABASE_DB_PASSWORD` secret.
- B (`test_automatic_promotion_candidates.py`): `test_permanent_refusal_parks_on_first_run` (one failed run whose stub log contains the #6433 RiskGateError text → `idle`, message contains `permanent refusal`); `test_permanent_refusal_unreadable_log_counts_as_ordinary_attempt` (log read raises → not parked after one run); `test_stale_refusal_is_not_permanent` (main-moved log → free, not parked); `test_ordinary_failure_still_needs_three`.
- C (`test_production_catalog_verification.py`): `test_readable_check_fails_dynamic_migration_without_sidecar`; `..._passes_with_sidecar`; `..._passes_with_valid_noop`; `..._ignores_unchanged_migrations`.

### 11. Constraints and gotchas

- Never edit an existing migration file; never hand-edit `types/database.types.ts`.
- Changing workflow line numbers can break `docs/verification/throughput-dispositions/*.json` (truth-audit "stale semantic site"). Run `node --test scripts/throughput-guard/check-throughput-truth-audit-context.test.mjs`; re-key with `discover()` from `scripts/check-throughput-truth-audit.mjs` as done in commit `c9efb769e` (closed PR #6558).
- A new job in the migrations workflow must be added to `notify-production-queue`'s `needs` list (comment at line ~2479).
- Merge goes through the merge queue (`gh pr merge --squash --auto`); the AI merges, Albert never does. Wait with `ai-pr-wait <pr> --repo popcre/shared-db` in the background, never a polling loop.
- Sign every GitHub post with `$AI_GH_SIGNATURE`. Quote times in EST.
- Commit as Albert's identity (`git var GIT_COMMITTER_IDENT`), staging only your files.
- Never run SQL that writes; production checks are read-only.

### 12. Access and environment

- `gh` authenticated as `u2giants` with repo + actions write; `ai-task-gates`, `ai-pr-wait` on PATH.
- Python 3.12 + pytest; Node 22.
- No credentials needed for A–C (tests are offline). Live proof A uses `gh workflow run`; the preview database password is a repo secret, never read it.
- Supabase MCP (`mcp__supabase__execute_sql`) is bound to **production** — read-only queries only.

---

## Part 4 — Landing it

### 13. Definition of done, risks, open questions

Done when, for each of A, B, C: code + tests merged to main via the merge queue, CI green on the merge commit, live proof recorded on #6574 with run ids, STATUS row updated with artifacts; then D's doc line merged and the handoff file marked closed.

Risks / rollback:
- A could refuse a migration an author legitimately wants to rehearse pre-merge → they use dry-run; revert the step if it misfires (one-commit revert).
- B regex too broad could park a curable change → fail-safe is the narrow three-part match; tests cover stale and ordinary failures.
- C could fail PRs with existing unreadable migrations → only **added** files are checked.

Open questions: whether the merge-queue job hosting C is required (decide by §9 C.3 criteria).

---

## Self-audit (2026-11-17)

1. *Could a brand-new session execute it without asking?* Yes. B and C (§5 line refs, §9 exact code shape, §10 named tests). A has one judgment call (step placement) with criteria in §8. 
2. *Does it carry the background and ruled-out options?* §3 evidence chain with run ids, §7 rejected table, §8 locked decisions.
3. *Could the implementer steer by the goal?* §1 states the business outcome and the "goal wins / never weaken safety" rule.
