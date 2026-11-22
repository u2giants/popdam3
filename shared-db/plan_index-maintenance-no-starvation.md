# Implementation Plan: Prevent Index Maintenance from Starving Schema Promotions

Companion handoff: [`HANDOFF.d/2026-11-22T1820Z-edge-dev-antigravity-index-maintenance-no-starvation.md`](HANDOFF.d/2026-11-22T1820Z-edge-dev-antigravity-index-maintenance-no-starvation.md)

## STATUS

**Where a fresh session starts:** Step 1 (after reading this plan and confirming `origin/main` has not already landed these edits).

| Step | Description | Status | Date | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Add `dispatched=true`/`false` output on all exit paths in `scripts/automatic_promotion_candidates.py` | ⬜ open | 2026-11-22 | — |
| 2 | Scope index-maintenance retry cap to `(operation_id, target, policy_digest)` across all `main` SHAs, count `startup_failure` and re-runs, and skip exhausted operations in `scripts/automatic_index_maintenance.py` | ⬜ open | 2026-11-22 | — |
| 3 | Reorder `.github/workflows/automatic-production-trigger.yml` so schema promotion runs before optional index maintenance, gating maintenance on `steps.checkout.outcome == 'success'` and `steps.selector.outputs.dispatched != 'true'` | ⬜ open | 2026-11-22 | — |
| 4 | Add offline unit/adversarial tests in `scripts/test_automatic_index_maintenance.py` and `scripts/test_automatic_promotion_candidates.py` | ⬜ open | 2026-11-22 | — |
| 5 | Open PR, verify CI green, merge to `main`, and verify live trigger run order + zero regressions | ⬜ open | 2026-11-22 | — |

---

## 1. The Ultimate Goal — What We Are Actually Trying to Achieve

Optional database index maintenance (like online `pg_repack` compaction) must **never** starve or delay waiting production schema migrations, and a failing index-maintenance operation must **never** reset its retry budget just because unrelated pull requests merge to `main`. When this work is done:
- Waiting production schema migrations always get the serial promotion lane ahead of optional index maintenance.
- **Accepted priority trade-off:** Under sustained migration merge traffic, optional index maintenance waits for idle windows between schema promotions (a two-pass preview + production operation needs two idle windows; each completed run still re-nudges the trigger). This is deliberate: shipping application schema changes always outranks optional compaction.
- When no schema migration is ready (including when a migration PR is held), index maintenance runs immediately as before.
- If an index-maintenance operation fails 3 times under its current policy definition, it stops retrying automatically across *all* future `main` commits, raises a visible `ENGINEER ACTION REQUIRED` alert, and lets other healthy maintenance operations and all schema migrations proceed without delay.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What This Application Is

`popcre/shared-db` is the canonical PostgreSQL / Supabase schema, migration, contract-test, and automatic production promotion repository for POP Creations (serving DesignFlow PLM, PopPIM, PopCRM, PopDAM3, Monitor, and TheOracle).
- **Repository:** `popcre/shared-db` (`main` branch, protected; local canonical checkout `d:\repos\shared-db`).
- **Stack:** GitHub Actions (`.github/workflows/`), Python 3.11+ orchestration scripts (`scripts/`), Node.js 22 helpers, Supabase CLI.
- **Target workflow:** `.github/workflows/automatic-production-trigger.yml` ("Automatic production promotion trigger"), which serializes dispatches to `.github/workflows/shared-supabase-migrations.yml` ("Shared Supabase Migrations").

## 3. What Triggered This Work

On **November 21, 2026 (9:30 PM – 10:01 PM EST)**, merged migration PR `popcre/shared-db#6939` (`20261225090102_hts_rag_precedents_luna_ruling_basis.sql`, zero open review findings) sat unpromoted for over 30 minutes because an unrelated index-maintenance operation (`repack-20261109-6c9d5541`) kept jumping ahead of `Start the next automatic promotion` and failing on a stale November 9 review-finding check (`popcre/shared-db#5985`).
- On `main` SHA `36c7c7eb`, `repack-20261109-6c9d5541` burned 3 failed runs (`44974932445`, `44975321316`, `44975697227`).
- On `main` SHA `a26f8fe0`, it burned 3 MORE failed runs (`44977492775`, `44977855317`, `44978199091`).
- On `main` SHA `96784c24`, it immediately dispatched attempt #1 again (`44978554928`), which only succeeded because PR `#6948` (`96784c24`) happened to fix the review-finding check mismatch.
- On **November 22, 2026**, owner Albert Hazan asked how to prevent this starvation from ever happening again and requested an implementation plan debated with GLM-5.3.

## 4. Scope — In and Out

**In scope:**
- `scripts/automatic_promotion_candidates.py` — emit `dispatched=true` / `dispatched=false` to `GITHUB_OUTPUT` on every exit path.
- `scripts/automatic_index_maintenance.py` — count failed attempts per `(operation_id, target, policy_digest)` across all `main` SHAs (including `startup_failure` and re-runs); skip exhausted operations inside `select()` with an `ENGINEER ACTION REQUIRED` annotation instead of aborting the whole step.
- `.github/workflows/automatic-production-trigger.yml` — run schema promotion selection (`selector`) before optional index maintenance (`index_maintenance`), gating `index_maintenance` on `steps.checkout.outcome == 'success'` and `steps.selector.outputs.dispatched != 'true'`.
- `scripts/test_automatic_index_maintenance.py` and `scripts/test_automatic_promotion_candidates.py` — unit and adversarial tests covering every new behavior and edge case.

**NOT in this plan (explicit out-of-scope):**
- Do **not** modify `scripts/nontransactional_index_maintenance.py`'s `dispatch_ref` regex (`refs/db-index-maintenance-operations/<op>/<target>/<40-hex-sha>`), `display_title` format, `workflow_gate` exact-dict check (`:298-300`), or SQL execution logic.
- Do **not** change `config/nontransactional-index-maintenance.json` or close/alter `#5983` / `#5985`.
- Do **not** alter `shared-supabase-migrations.yml` concurrency groups, refund markers, or apply logic.
- Do **not** add any hold, cooldown, retry delay, or wait longer than 30 minutes (owner ruling 2026-11-20).
- Do **not** build stuck-change issue deduplication for maintenance exhaustion in this PR (accepted trade-off noted in §8; follow-up optional if alert noise becomes material).

## 5. Current State of the Code

Baseline commit on `popcre/shared-db` `main`: `759bea851` (2026-11-22).
- **Already fixed and deployed (do not redo):** PR `#6948` (`96784c24`) aligned `automatic_index_maintenance.py` and `nontransactional_index_maintenance.py` so both use the same PR-head-bound review-finding check (`test_selector_and_executor_share_source_head_review_binding` in `scripts/test_automatic_index_maintenance.py:35-102`).
- **Still vulnerable:**
  - `scripts/automatic_index_maintenance.py:86-89` builds `title = f"INDEX {candidate['target']} {dispatch_ref} {candidate['source_sha']}"` and counts failed runs matching exact `title` and `{'failure', 'cancelled', 'timed_out'}` (missing `startup_failure` and re-run blinding). Any unrelated merge to `main` changes `source_sha`, resetting `len(attempts)` to `0`.
  - `scripts/automatic_index_maintenance.py:80-89` runs `select()` first and only checks `len(attempts) >= 3` *after* `select()` returns one candidate, raising `maintenance.Refusal` (exit 2) instead of skipping that operation and checking subsequent operations.
  - `.github/workflows/automatic-production-trigger.yml:166-198` runs `index_maintenance` before `selector`, and `scripts/test_automatic_index_maintenance.py:171,180` assert that exact old order and `index_maintenance.outputs.dispatched != 'true'` gate.
  - `scripts/automatic_promotion_candidates.py:1358-1521` writes `recheck` to `GITHUB_OUTPUT` via `write_recheck_output(...)` on multiple exit paths (`:1362` early return, `:1521` end of `main()`), but does not write `dispatched`.

## 6. Key Findings and Root Cause

1. **SHA-scoped retry reset (`scripts/automatic_index_maintenance.py:86-89`):** Because `dispatch_ref` and `display_title` embed `source_sha` (HEAD of `main`), counting failures by exact `display_title == title` resets the 3-attempt cap on every unrelated PR merged to `main`.
2. **Existing receipts already carry `policy_digest` (`scripts/automatic_index_maintenance.py:92-93`, `scripts/nontransactional_index_maintenance.py:298-300`):** Every dispatched index-maintenance run writes a Git ref receipt at `refs/db-index-maintenance-operations/<op>/<target>/<sha>` containing `{"operation_id", "target", "source_sha", "policy_digest"}` (exact-dict-checked by `workflow_gate`, so no fields may be added). We can bind attempt counting to `policy_digest` using that existing key with zero format changes.
3. **Why `index_maintenance` was originally placed before `selector` (`.github/workflows/automatic-production-trigger.yml:166-167`):** The comment noted: *"a promotion dispatched first would make every selection see an active run, and a held PR fails the promotion step."* Both concerns are cleanly solved by (a) having `selector` write `dispatched=true`/`false` to `GITHUB_OUTPUT` and (b) gating `index_maintenance` with `if: always() && steps.lane_guard.outputs.skipped != 'true' && steps.checkout.outcome == 'success' && steps.selector.outputs.dispatched != 'true'`, which runs `index_maintenance` whenever `selector` did not dispatch (including when `selector` exits non-zero on a held PR) without ever running against a failed checkout.
4. **Why `selector` previously carried `always()` (`automatic-production-trigger.yml:176,184,192`):** Only because `index_maintenance` ran before it and exited 2 on refusal. Once `selector` runs first (right after `checkout`, `setup-node`, and `Restore the workflow-run cache`), `selector` and its ledger/PR-cache steps should **drop** `always()` so a failed checkout/setup never runs `selector` on missing files.
5. **Re-arm runbook after executor-code fixes (GLM-5.3 Finding 2):** Because `policy_digest` hashes only the policy entry (`nontransactional_index_maintenance.py:31-32`) and not `executor_digest`, an executor-code fix (like PR `#6948`) does not automatically change `policy_digest`. To re-arm an exhausted operation after fixing a bug, an engineer either updates the policy entry in `config/nontransactional-index-maintenance.json` (e.g., adjusting a timeout or renaming the operation id, changing `policy_digest`) or removes the failed run records. Deleting or corrupting dispatch receipts does **not** re-arm (fail-closed).
6. **No long holds:** Neither `selector` nor `index_maintenance` introduces any timer/cooldown; `ACTIVE_WAIT_S` stays `120` seconds (2 minutes), well under the 30-minute rule.

## 7. Approaches Considered and REJECTED, and Why

1. **Rejected — Embed `policy_digest` or `executor_digest` into `dispatch_ref` / `display_title` / dispatch receipt:** Would require changing `operation_from_dispatch_ref` regex (`nontransactional_index_maintenance.py:62`), `workflow_gate` exact-dict check (`:298-300`), `verify_run` (`:259-264`), and `shared-supabase-migrations.yml`, risking breakage of in-flight or historical receipt verification. Reading `policy_digest` from the existing dispatch receipt achieves policy binding with zero format changes.
2. **Rejected — Count attempts globally per `(operation_id, target)` ignoring `policy_digest`:** If an engineer fixes a broken policy entry, the operation would stay permanently locked out until manually renamed. Scoping to `(operation_id, target, policy_digest)` automatically grants a fresh 3-attempt budget on a genuine policy edit while blocking unrelated `main` commits from resetting retries.
3. **Rejected — Keep `index_maintenance` first and only fix the retry cap:** Even with a fixed 3-attempt cap, a failing optional `pg_repack` would still burn ~13 minutes (3 × ~4.5 min) ahead of an urgent production schema migration. Putting schema migrations first guarantees zero delay for application releases.
4. **Rejected — Fail-open on unreadable dispatch receipts when counting attempts:** If GitHub API returns an error or a receipt ref was deleted/corrupted, ignoring that failure would allow infinite retries. Counting unreadable/missing/mismatched receipts *toward* the 3-attempt cap (fail-closed) guarantees bounded retries.

## 8. Design Decisions Already Made, and Their Reasoning

- **Locked (2026-11-22):** Schema migrations (`selector`) run before optional index maintenance (`index_maintenance`) in `.github/workflows/automatic-production-trigger.yml`.
- **Locked (2026-11-22):** Retry cap remains `MAX_ATTEMPTS = 3`, scoped to `(operation_id, target, policy_digest)` across all `main` SHAs; conclusion set is `{'failure', 'cancelled', 'timed_out', 'startup_failure'}`; any matching run with `int(r.get('run_attempt') or 1) > 1` also counts at least one failed attempt (anti-re-run blinding); fail-closed if a matching failed run's dispatch receipt is missing, unreadable, or names a different `operation_id`/`target`.
- **Locked (2026-11-22):** Accepted trade-offs (documented explicitly per GLM-5.3 review):
  - *No infra-refund marker for maintenance:* `shared-supabase-migrations.yml:396` excludes index-maintenance refs from the `preview` job that emits `refund-eligible-fault`; optional maintenance does not get extra infra refunds without touching the out-of-scope migrations workflow.
  - *Cancelled-by-concurrency double-burn:* If an old run is cancelled and a new run fails, both count toward the 3-attempt cap (intended conservative bound).
  - *Keep `index_maintenance`'s `dispatched=true` output:* Even though nothing downstream reads it post-reorder, keep it for observability and `test_automatic_index_maintenance.py:156` compatibility.
  - *Exhaustion alert repeats on trigger wake-ups:* Exhausted operations emit `::error title=ENGINEER ACTION REQUIRED: index maintenance attempts exhausted::` until re-armed or removed from policy; tracking-issue deduplication (`report_stuck_change` parity) is deferred to a separate follow-up if needed.
- **Locked (2026-11-22):** Do not change `dispatch_ref` or `display_title` format in `nontransactional_index_maintenance.py`.
- **Open for implementer judgment:** Whether `automatic_promotion_candidates.py` uses a shared `write_github_output(name, value)` helper alongside `write_recheck_output`.

## 9. The Plan — Numbered, Ordered, Executable Steps

### Step 1 — Emit `dispatched=true` / `dispatched=false` on all exit paths in `scripts/automatic_promotion_candidates.py`
- **Who:** `helper-ok` — mechanical output emission with exact file, line numbers, and unit test gate. **Stop-and-ask trigger:** if `main()` has any additional `return` path between `:1350` and `:1530` not listed below, stop and ask the lead.
- **Target:** `scripts/automatic_promotion_candidates.py` around `write_recheck_output` and `main()` (`:1358-1525`).
- **Change:** Add `write_dispatched_output(value: bool)` writing `dispatched=true` or `dispatched=false` to `GITHUB_OUTPUT`, called at all four exact points:
  1. `:1362` (ledger-unreadable early return, right next to `write_recheck_output(True)`): `write_dispatched_output(False)`.
  2. `:1439-1440` (`args.dry_run` break where `action == "dispatch"` but no dispatch ran): keep `dispatched = False` (written at end of `main()`).
  3. `:1454` (immediately after `dispatch(...)` returns successfully): `dispatched = True; write_dispatched_output(True)` (so even if a later step in `main()` throws, `dispatched=true` is already persisted!).
  4. `:1521` (end of `main()`, alongside `write_recheck_output(...)`): if not already written as `True`, call `write_dispatched_output(False)`.
- **Intent:** Downstream steps in `automatic-production-trigger.yml` deterministically know whether `selector` took the serial lane on every exit path.
- **Dependencies:** None.
- **Verification gate:** `python -m unittest scripts/test_automatic_promotion_candidates.py` passes, including new assertions for `dispatched=true` on real dispatch and `dispatched=false` on ledger-unreadable early return, `--dry-run` break, and no-candidate paths.

### Step 2 — Scope retry cap to `(operation_id, target, policy_digest)` and skip exhausted operations in `scripts/automatic_index_maintenance.py`
- **Who:** `lead-only` — reshapes retry/custody logic that decides production maintenance dispatches and must preserve fail-closed receipt verification.
- **Target:** `scripts/automatic_index_maintenance.py` (`select` `:19-48`, `main` `:51-100`).
- **Change:**
  1. Add `MAX_ATTEMPTS = 3`, `FAILED_CONCLUSIONS = frozenset({'failure', 'cancelled', 'timed_out', 'startup_failure'})`, and pure helper `failed_attempts_for_operation(runs, operation_id, target, policy_digest, read_receipt)`:
     - Compile exact regex using `re.escape`: `rf"^INDEX {re.escape(target)} (refs/db-index-maintenance-operations/{re.escape(operation_id)}/{re.escape(target)}/[a-f0-9]{{40}}) [a-f0-9]{{40}}$"`.
     - For each run in `runs` whose `display_title` matches the regex:
       - Determine if the run represents a failure: `r.get('conclusion') in FAILED_CONCLUSIONS` **or** `int(r.get('run_attempt') or 1) > 1` (prevents re-run blinding).
       - If not a failure, skip.
       - Extract `dispatch_ref` (group 1) and read its receipt via `read_receipt(dispatch_ref)` wrapped in `try/except Exception` (catching `CalledProcessError` / corrupt JSON).
       - Count the run **unless** `isinstance(receipt, dict)` and `receipt.get('operation_id') == operation_id` and `receipt.get('target') == target` and `isinstance(receipt.get('policy_digest'), str)` and `receipt['policy_digest']` is non-empty and `receipt['policy_digest'] != policy_digest`. (Missing, unreadable, or mismatched `operation_id`/`target` receipts fail-closed and count.)
       - If `r.get('conclusion') in FAILED_CONCLUSIONS` and `int(r.get('run_attempt') or 1) > 1`, count `int(r.get('run_attempt'))` (or at least 1 per prior failed attempt + current failure); otherwise count 1.
     - Return the total failed attempt count.
  2. Update `select(policy, read_receipt, active_runs, held, source_sha, exhausted=None)` (default `exhausted=None` for backward compatibility):
     - Keep `completed('production')`, `completed('preview')`, `preview_only`, and `held(entry['source_pr'])` checks **before** calling `exhausted(...)` (preserves zero extra API calls when all ops are completed or held).
     - If `exhausted is not None and exhausted(operation_id, target, entry)`: print `::error title=ENGINEER ACTION REQUIRED: index maintenance attempts exhausted::operation={operation_id} target={target} work_issue=#{entry['work_issue']} source_pr=#{entry['source_pr']} — automatic retries stopped; edit policy entry (change policy_digest) to re-arm.` and `continue` to the next operation in `sorted(policy['operations'])`.
  3. In `main()`:
     - Lazily fetch fresh runs (`promotion.workflow_runs(maintenance.REPO, fresh_since=promotion.ACTIVATED_AT)`) once inside `exhausted(...)` on first call (zero extra API calls when no operation is ready/unheld).
     - Remove the post-`select()` SHA-only `if len(attempts)>=3: raise maintenance.Refusal(...)` block; keep `dispatched=true` write at `:97-99` when a candidate is dispatched.
- **Intent:** Unrelated merges to `main` never reset failed maintenance retries; `startup_failure` and re-runs cannot bypass the cap; one exhausted maintenance operation never blocks other healthy maintenance operations or schema promotions; a genuinely updated policy (`policy_digest` changed) gets a fresh 3-attempt budget.
- **Dependencies:** None (can be authored in parallel with Step 1).
- **Verification gate:** `python -m unittest scripts/test_automatic_index_maintenance.py` passes, proving every row in the adversarial-cases table below.

### Step 3 — Reorder `.github/workflows/automatic-production-trigger.yml` so schema promotions run first
- **Who:** `lead-only` — modifies production promotion trigger ordering and step gating conditions.
- **Target:** `.github/workflows/automatic-production-trigger.yml` (`:146-213`).
- **Change:**
  1. Add `id: checkout` to `actions/checkout@v4` (`:146`).
  2. Move `Read the production migration ledger (read-only)`, `Restore the selector PR cache`, `Start the next automatic promotion` (`id: selector`), and `Save the selector PR cache` **before** `Select an explicitly enabled exact-index maintenance operation` (`id: index_maintenance`).
  3. Set `if: steps.lane_guard.outputs.skipped != 'true'` (NO `always()`) on `Read the production migration ledger`, `Restore the selector PR cache`, and `Start the next automatic promotion` so a failed checkout/setup never runs `selector` on missing files.
  4. Set `if: always() && steps.lane_guard.outputs.skipped != 'true' && steps.checkout.outcome == 'success' && steps.selector.outputs.dispatched != 'true'` on `index_maintenance` (`always()` is load-bearing so a held-PR failure in `selector` still lets maintenance run; `steps.checkout.outcome == 'success'` prevents running on an absent checkout). Residual behavior (reviewed and accepted in GLM-5.3 debate): a failed `setup-node` still lets maintenance run (safe because `ubuntu-latest` preinstalls Node and any receipt-bridge failure exits 2 fail-closed), and a failed `actions/cache/restore` lets maintenance run cacheless (safe because the run cache is discovery-only).
  5. Update `Save the workflow-run cache` `if:` to `always() && (steps.selector.outcome != 'skipped' || steps.index_maintenance.outcome != 'skipped')`.
  6. Update the comment on `:166-167` to explain the new priority invariant (schema promotions first; maintenance runs only when `selector` did not dispatch).
- **Intent:** Waiting schema migrations always take the serial lane ahead of optional index maintenance, while still allowing index maintenance to run immediately whenever `selector` dispatches nothing (including when a migration PR is held) and preserving the shared run cache.
- **Dependencies:** Steps 1 and 2.
- **Verification gate:** YAML parses cleanly; `python -m unittest scripts/test_automatic_index_maintenance.py` passes with updated workflow-order and gate assertions.

### Step 4 — Add unit and adversarial tests
- **Who:** `helper-ok` — concrete test cases and assertions listed in §10. **Stop-and-ask trigger:** if any existing test in `scripts/test_*.py` fails due to an unexpected coupling to the old step order, stop and report the exact failing test to the lead.
- **Target:** `scripts/test_automatic_index_maintenance.py` and `scripts/test_automatic_promotion_candidates.py`.
- **Dependencies:** Steps 1, 2, 3.
- **Verification gate:** Full offline Python test suite (`python -m unittest discover -s scripts -p "test_*.py"`) passes 100%.

### Step 5 — PR, CI, merge, and live trigger verification
- **Who:** `lead-only` — PR creation, merge, and live workflow verification.
- **Target:** `popcre/shared-db` PR → `main`.
- **Change:** Push branch, open PR referencing this plan, wait for all required checks (`SQL migration guards`, `Test every scripts/test_*.py (offline)`, etc.) to pass, merge via merge queue, and inspect the next `Automatic production promotion trigger` run on `main` to confirm `Start the next automatic promotion` executes before `Select an explicitly enabled exact-index maintenance operation`, skips `index_maintenance` when `selector` dispatches, and saves the workflow-run cache.
- **Verification gate:** Merged commit SHA on `main`, green `SQL migration guards` run, and live `Automatic production promotion trigger` run ID showing the new step order.

### Adversarial-Cases Table (Trust Boundary: GitHub API Run Titles, Receipts & Workflow Outputs)

| External Input | Hostile / Edge Case | Test That Proves It |
| --- | --- | --- |
| `runs[].display_title` | Failed runs across 3 *different* `main` SHAs (`aaa...`, `bbb...`, `ccc...`) for the same `(operation_id, target, policy_digest)` | `test_attempts_accumulate_across_different_main_shas` (`scripts/test_automatic_index_maintenance.py`) |
| `runs[].conclusion` | `conclusion == 'startup_failure'` on INDEX runs | `test_startup_failure_counts_toward_attempt_cap` (`scripts/test_automatic_index_maintenance.py`) |
| `runs[].run_attempt` | Re-run of a failed maintenance run (`run_attempt > 1`) overwriting prior failure conclusion | `test_rerun_attempt_counts_toward_attempt_cap` (`scripts/test_automatic_index_maintenance.py`) |
| `runs[].display_title` | Prefix collision: operation `repack-1` vs `repack-10` or `preview` vs `production` | `test_attempt_matching_rejects_operation_id_prefix_collision` (`scripts/test_automatic_index_maintenance.py`) |
| `runs[].display_title` | Spoofed/malformed title missing 40-hex SHA or extra trailing tokens | `test_attempt_matching_ignores_malformed_titles` (`scripts/test_automatic_index_maintenance.py`) |
| Dispatch receipt at `refs/db-index-maintenance-operations/...` | Missing receipt (`None`), corrupted non-dict, or `read_receipt` raises exception | `test_unreadable_or_missing_dispatch_receipt_counts_fail_closed` (`scripts/test_automatic_index_maintenance.py`) |
| Dispatch receipt payload | Well-formed dict naming a *different* `operation_id` or `target` | `test_mismatched_receipt_identity_counts_fail_closed` (`scripts/test_automatic_index_maintenance.py`) |
| Dispatch receipt `policy_digest` | Old failed runs have previous `policy_digest`; current policy has new `policy_digest` | `test_policy_digest_change_resets_attempt_budget` (`scripts/test_automatic_index_maintenance.py`) |
| Multiple enabled operations | Operation A exhausted (3 failures), Operation B healthy and ready | `test_exhausted_operation_is_skipped_and_alerts_so_next_runs` (`scripts/test_automatic_index_maintenance.py`) |
| Completed or held operations | All operations completed or held → lazy `workflow_runs(fresh_since=...)` fetch must NOT be invoked | `test_lazy_attempt_fetch_not_called_when_no_op_is_ready` (`scripts/test_automatic_index_maintenance.py`) |
| `selector` crash after dispatch | `selector` crashes before writing `dispatched=true` while newly dispatched run is active → `index_maintenance` sees active run, exits 0, dispatches nothing | `test_wait_is_bounded_and_active_queue_dispatches_nothing` (`scripts/test_automatic_index_maintenance.py`) |
| `selector` exit paths | Real dispatch writes `dispatched=true`; ledger-unreadable early return, `--dry-run` break, and no-candidate paths write `dispatched=false` | `test_main_writes_dispatched_output` (`scripts/test_automatic_promotion_candidates.py`) |

## 10. Tests Required

1. **`scripts/test_automatic_index_maintenance.py`:**
   - All 11 new/updated cases named in the adversarial-cases table above.
   - Update `test_automatic_selector_is_part_of_existing_trigger` (`:171, :180`) to assert `automatic_promotion_candidates.py` runs **before** `automatic_index_maintenance.py`, `index_maintenance` checks `always() && steps.lane_guard.outputs.skipped != 'true' && steps.checkout.outcome == 'success' && steps.selector.outputs.dispatched != 'true'`, `selector` does NOT carry `always()`, and `Save the workflow-run cache` checks `steps.selector.outcome != 'skipped' || steps.index_maintenance.outcome != 'skipped'`.
   - Re-derive `run_main` (`:141-166`) positional `workflow_runs` side-effect counts and `self.fetch.call_args.kwargs` (`:158`) to match the lazy fresh fetch inside `exhausted()`.
2. **`scripts/test_automatic_promotion_candidates.py`:**
   - `test_main_writes_dispatched_output`: verifies `dispatched=true` on real dispatch and `dispatched=false` on ledger-unreadable early return (`:1362`), `--dry-run` break (`:1439-1440`), and no-candidate paths.
3. **Existing suite that must stay green:**
   - `python -m unittest discover -s scripts -p "test_*.py"` (all offline tests in `popcre/shared-db`).

## 11. Constraints, Standing Rules, and Gotchas in Force

- **Worktree rule:** Never edit `d:\repos\shared-db` directly; create a fresh worktree from `origin/main` under `d:\repos\shared-db-worktrees\`.
- **Protected `main`:** Never push directly to `main`; open a PR and merge via GitHub merge queue (plain `gh pr merge`, never `--admin` or `--squash`).
- **Committer identity:** Verify `git var GIT_COMMITTER_IDENT` shows `Albert Hazan <u2giants@users.noreply.github.com>`.
- **GitHub signatures:** Sign every PR/issue comment with `Posted by <client> chat (<short-id>) on <machine>`.
- **No long holds:** Never introduce any cooldown, sleep, or retry delay > 30 minutes.
- **No SQL/migration changes:** This plan touches workflow and Python orchestration only; do not add files under `supabase/migrations/`.
- **Re-arm runbook (important):** After fixing an executor bug (like PR `#6948`), an already-exhausted operation stays stopped until an engineer edits its policy entry in `config/nontransactional-index-maintenance.json` (changing `policy_digest`) or deletes the failed workflow runs. Deleting or corrupting dispatch receipts does NOT re-arm (fail-closed).
- **Gotcha — `Save the workflow-run cache`:** Currently gated on `steps.index_maintenance.outcome != 'skipped'`. After reordering, `index_maintenance` WILL be skipped whenever `selector` dispatches, so update that cache-save condition to check `steps.selector.outcome != 'skipped' || steps.index_maintenance.outcome != 'skipped'`.
- **Gotcha — coupled assertions in `scripts/test_automatic_index_maintenance.py`:** Lines `:171` (step order), `:180` (exact `if:` string), and `:141-166` (`run_main` positional `workflow_runs` mock side-effects) must all be updated together.

## 12. Access and Environment

- **Authenticated CLIs:** `gh` (authenticated for `popcre`), `git`, `python` (3.11+).
- **Target repo & branch:** `popcre/shared-db`, `main`.
- **Secrets:** None required locally; CI uses existing repository `GITHUB_TOKEN` and `SUPABASE_ACCESS_TOKEN` secrets (never print or modify secrets).
- **Local test command:** `python -m unittest discover -s scripts -p "test_*.py"` inside the worktree.

## 13. Definition of Done + Risks and Open Questions

**Definition of done:**
- [ ] Steps 1–4 implemented in an isolated worktree of `popcre/shared-db`.
- [ ] All new unit/adversarial tests and the full `scripts/test_*.py` suite pass locally and in CI.
- [ ] PR merged to `popcre/shared-db` `main` via merge queue (exact commit SHA recorded in STATUS).
- [ ] Live `Automatic production promotion trigger` run on `main` verified showing `selector` running before `index_maintenance` and `Save the workflow-run cache` succeeding.
- [ ] Worktree removed; plan STATUS table and companion `HANDOFF.d/` updated (or plan retired once live proof passes).

**Risks & rollback:**
- *Risk:* If `selector` throws an unexpected exception *after* calling `gh workflow run` but *before* writing `dispatched=true`, `index_maintenance` could run and see the newly dispatched active run. *Mitigation:* Step 1 writes `dispatched=true` immediately after `dispatch()` returns (`:1454`), `index_maintenance` already calls `promotion.workflow_runs()` and refuses to dispatch if any run is active, and `shared-supabase-migrations.yml` enforces its own concurrency group.
- *Rollback:* Revert the single PR on `popcre/shared-db` `main`; zero database state or receipt formats are modified.

**Open questions:** None — GLM-5.3 debate completed and all agreed revisions incorporated.

---

## Mandatory Self-Audit Gate

1. **Could a brand-new AI session with no project knowledge and no context from this conversation execute this plan to perfection, without asking me anything?**
   Yes. Sections 1–4 explain the business goal (including the deliberate priority trade-off), repo, incident (with exact run IDs `44974932445`–`44978554928` and PRs `#6939`/`#6948`), and explicit out-of-scope boundaries. Sections 5–8 pin exact `file:line` references, root causes, re-arm runbook, rejected approaches, and locked decisions. Section 9 gives 5 ordered steps with exact file targets, helper signatures, `lead-only`/`helper-ok` markings, stop-and-ask triggers, a 12-row adversarial-cases table, and verification gates.
2. **Does the plan carry every piece of background, nuance, and reasoning I currently hold — including what we ruled out and why?**
   Yes. Section 5 documents PR `#6948`; Section 6 documents the existing `policy_digest` receipt structure, why `selector` drops `always()` while `index_maintenance` keeps `always() && steps.checkout.outcome == 'success'`, and the re-arm runbook; Section 7 documents all 4 rejected approaches; Section 8 documents all GLM-5.3 accepted trade-offs; Section 11 flags all coupled tests (`:141-166`, `:171`, `:180`) and the cache-save gotcha.
3. **Is the ultimate goal stated clearly enough that the implementer could make a correct judgment call if a step turns out to be wrong?**
   Yes. Section 1 states the plain-English business goal and accepted priority trade-off up top with the explicit instruction *"If a step conflicts with this goal, the goal wins — stop and flag it."*

---

## Lead Launch Prompt

```text
You are the lead session executing `plan_index-maintenance-no-starvation.md` in `popcre/shared-db`.

1. Read `plan_index-maintenance-no-starvation.md` (starting with its STATUS table) and its companion handoff `HANDOFF.d/2026-11-22T1820Z-edge-dev-antigravity-index-maintenance-no-starvation.md`. Verify `origin/main` has not already landed these changes.
2. Create an isolated worktree under `d:\repos\shared-db-worktrees\` from `origin/main` and verify `git var GIT_COMMITTER_IDENT` is `Albert Hazan <u2giants@users.noreply.github.com>`.
3. Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model. Follow https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md.
   - Helper rules: return finished work or an evidenced blocker; make no design decisions; never merge or post to GitHub; stop and ask you immediately when a step's stop-and-ask trigger fires; take back any helper stuck for 30 minutes.
4. Execution order:
   - Delegate Step 1 (`dispatched=true`/`false` output on all 4 exit paths in `scripts/automatic_promotion_candidates.py`) to your helper and verify its diff and unit tests yourself.
   - Execute Step 2 (`scripts/automatic_index_maintenance.py` policy-digest-scoped retry cap + `startup_failure` + re-run counting + skip exhausted) and Step 3 (`.github/workflows/automatic-production-trigger.yml` reorder + `steps.checkout.outcome == 'success'` + cache-save fix) yourself (`lead-only`).
   - Delegate Step 4 (unit and adversarial tests in `scripts/test_automatic_index_maintenance.py` and `scripts/test_automatic_promotion_candidates.py`) to your helper, then run the full offline suite (`python -m unittest discover -s scripts -p "test_*.py"`) yourself.
   - Execute Step 5 yourself (`lead-only`): open PR, confirm all CI checks green, merge via merge queue, verify live `Automatic production promotion trigger` run order on `main`, update STATUS with exact commit SHA and run ID, and remove the worktree.
```
