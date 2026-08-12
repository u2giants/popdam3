# GLM review — automatic-production-gates-plan

| field | value |
|---|---|
| model | zai-coding-plan/glm-5.2 |
| opencode | 1.18.12 (pinned) |
| session | automatic-production-gates-plan |
| session id | `ses_00a3ab318ffeCiYjweFPZsA2Sh` |
| repository | C:/repos/shared-db/.claude/worktrees/automatic-production-gates |
| branch | feature/automatic-production-gates |
| caller | codex |
| requested | 2026-08-12T11:52:28Z |
| tokens | `{"input":76045,"output":4485,"reasoning":14591,"cache":{"read":43264,"write":0}}` |

---

# Corrected implementation plan — automatic production gates (provider-neutral)

## VERDICT: APPROVE — the corrected design is sound, implementable, provider-neutral, and provable offline + via read-only production dry-run without touching Supabase production

The earlier plan is withdrawn. Three corrections are applied wholesale: (1) no durable GLM/Z.ai/model pin anywhere — the evidence contract is provider-neutral with generic reviewer identity/type; (2) no canary or B3 apply — `20260810140000` and B3 are already on production, and this task writes nothing to Supabase; (3) preview evidence is a committed immutable contract bound to SHA+allowlist, verified by a script — no dependence on unqueryable dispatch inputs.

---

## 1. What changes and what does not

**Removed from the plan entirely:** the model-identity requirement (GLM 5.2), the canary apply, the B3 apply, the `preview_run_id` workflow input, the `/commits/{sha}/pulls` call and its untestable fallback.

**The human click is replaced by four enforceable gates plus one GitHub-native gate. None is sufficient alone.**

| Gate | Status | What it proves | How enforced |
|---|---|---|---|
| Exact origin/main SHA | **Existing, unchanged** | The dispatch SHA is the live tip of `main` | `test "$(git rev-parse origin/main)" = "$REQUESTED_SHA"` (wf, both review and apply jobs) |
| Allowlist policy (HARD_BLOCKED, §6.8 bundle, §6.5 hold, §660 co-presence, atomic batches) | **Existing, unchanged** | The named versions satisfy every owner ruling | `production_migration_guard.py` `parse_allowlist`/`validate_candidates` |
| **G1 — Required CI green on the exact SHA** | **NEW** | All six required status contexts were `success` on the dispatch SHA itself, not a stale verdict | `scripts/verify_production_apply_prerequisites.py` over `gh api …/commits/{sha}/check-runs` JSON |
| **G2 — Branch protection intact** | **NEW** | `enforce_admins: true` and the six contexts are required on `main` — the mechanical guarantee that the SHA reached `main` through reviewed CI, regardless of merge strategy | same script over `gh api …/branches/main/protection` JSON |
| **G3 — Evidence contract: APPROVE verdict + preview rehearsal** | **NEW (extends existing script)** | A committed, immutable file under `.ai/reviews/` carries an explicit `APPROVE`, a reviewer identity/type, is bound to the exact SHA + allowlist, and records a preview rehearsal that applied on `rjyboqwcdzcocqgmsyel` | `scripts/production_apply_review_reference.py` (extended) |
| Fresh production ledger preflight | **Existing, unchanged** | The bounded set is sized against the ledger as it exists at apply time | `production_migration_guard.py preflight` + re-read inside `production-apply` |
| Bounded checkout + bounded dry-run | **Existing, unchanged** | `--include-all` cannot reach any migration outside the allowlist | `prepare` + `assert-bounded` + `verify-dry-run` |
| Post-apply catalog verification | **Existing, unchanged** | The objects the migrations claim to create actually exist | `production_catalog_verification.py` |
| **G4 — Deployment branch policy** | **NEW (Environment API)** | Only protected branches (`main`) can use the `production` environment | GitHub-native; survives workflow bugs |

The seven "existing" gates stay byte-for-byte. The net new work is G1, G2, G3, G4 plus doc updates and the Environment API change.

---

## 2. The clean/current-PR-state gate, resolved robustly

The earlier `/commits/{sha}/pulls` approach is dropped — it is unreliable across squash/merge/rebase strategies and its fallback was an untestable claim.

**The robust resolution does not depend on merge strategy at all.** The existing check already proves the SHA *is* `origin/main` tip (current). G2 proves `main` is protected with `enforce_admins: true` and the six contexts required (clean). Branch protection with `enforce_admins: true` physically prevents any commit — squash-merged, merge-committed, or rebased — from reaching `main` without passing the required contexts, with no admin bypass. Therefore "the SHA is `origin/main` tip AND `main` is protected" **is** the mechanical proof of clean PR state. It is read-only, stable, and offline-testable against a fixture JSON. It is the actual guarantee, not a fallback.

This repo has no human PR-approval step to verify (the owner does not review code; review is done by an agent in Claude Code and recorded as the G3 evidence contract), so there is no "was the PR approved" fact to check beyond "did it pass CI on a protected branch."

---

## 3. The evidence contract (provider-neutral, G3)

One committed, immutable file per apply, under `.ai/reviews/`. It folds the review verdict and the preview rehearsal into a single artifact bound to SHA + allowlist. It is referenced by the existing `review_reference` input (no new input). Schema:

```yaml
---
schema: shared-db-production-apply-evidence/v1
commit: 9645709a4b52e4848434b3ab3afda90e69505117
allowlist: [20260810070000, 20260810080000]
verdict: APPROVE
reviewer: <identity string>          # any non-empty identity; NOT pinned to a provider
reviewer_type: model                 # one of: model | human | agent (categorical, never a vendor)
preview_rehearsed: true
preview_outcome: APPLIED             # must be APPLIED, not DRY-RUN, for a production apply
preview_project_ref: rjyboqwcdzcocqgmsyel
---

Review notes…
```

`production_apply_review_reference.py` `validate()` is extended to require, for a file reference:

1. **`verdict`** is present and equals `APPROVE` (case-insensitive). `CONCERNS`, `REQUEST CHANGES`, `REJECT`, or absence → refused.
2. **`reviewer`** is a non-empty string. **`reviewer_type`** is present and one of `{model, human, agent}`. The script never reads or requires a specific vendor, provider, or model name — that is the provider-neutrality guarantee, and a test asserts it.
3. **`commit` / `allowlist` binding** (existing logic, unchanged): the file must name the short SHA (≥7 chars) or an allowlisted version. The empty-token door (the GLM-found hole, PR #806) stays closed.
4. **`preview_outcome`** is `APPLIED` and **`preview_project_ref`** is `rjyboqwcdzcocqgmsyel`. A `DRY-RUN` outcome, or a project ref of `qsllyeztdwjgirsysgai`, is refused — a production apply must be backed by a rehearsal that actually applied on preview.
5. **URL-only references are demoted.** A URL cannot be read offline, so it cannot prove a verdict. A URL may be *supplementary*, but the gate now requires a file reference that the script can read and assert against. A bare URL → refused.

**Honest limit, stated in the script's own docstring (as the existing one does):** the gate proves a record exists, is bound, and carries an APPROVE — it does not prove the review behind it was good. The immutability comes from CI: the file went through the six required contexts on the PR. This is the same trust model the repo already uses for the `APPROVED_HASH`/`APPROVED_COUNT` pins in `tools/run-coldlion-licensor-property-phase4.mjs`. Do not overclaim.

---

## 4. Exact files and tests

### NEW

**`scripts/verify_production_apply_prerequisites.py`** — reads two JSON files (branch protection, check-runs) and asserts:
- `enforce_admins.enabled == true`
- the six required contexts (read from a module-level constant, so a 7th context is a one-line add) are each present with `conclusion == success` on the exact SHA
- refuses on: `enforce_admins` false, a missing context, a non-success conclusion, empty check-runs, or a context whose `head_sha` ≠ the dispatch SHA

**`scripts/test_verify_production_apply_prerequisites.py`** — offline tests against fixture JSON:
- `test_enforce_admins_true_passes` / `test_enforce_admins_false_refused`
- `test_all_contexts_success_passes` / `test_missing_context_refused` / `test_non_success_conclusion_refused`
- `test_check_runs_on_wrong_sha_refused`
- `test_context_list_is_module_constant` (anti-shrink)
- `test_no_write_or_network_in_module` (the script is pure-assertion over files; no `requests`/`urllib`/`subprocess`)

### EXTENDED

**`scripts/production_apply_review_reference.py`** — add the verdict/reviewer/preview assertions in §3 to `validate()`. Keep every existing refusal (placeholders, bare host, plain http, multiline, traversal, empty-token door). The `require_binding` / `binding_tokens` logic is unchanged.

**`scripts/test_production_apply_review_reference.py`** — new class `TestEvidenceContract`:
- `test_verdict_approve_passes` / `test_verdict_concerns_refused` / `test_verdict_request_changes_refused` / `test_verdict_missing_refused`
- `test_reviewer_empty_refused` / `test_reviewer_type_required`
- `test_reviewer_type_accepts_model_human_agent` (the neutrality test)
- `test_no_provider_name_pinned` — greps the script's `validate` path and asserts it references no vendor/model string
- `test_preview_outcome_applied_required` / `test_preview_outcome_dry_run_refused`
- `test_preview_project_ref_must_be_preview`
- `test_url_only_reference_refused` (was previously accepted — behavior change)
- `test_url_plus_file_accepted`
- Update `TestWorkflowWiring`: assert the new prerequisites step exists, the job name no longer names the owner, `actions: read` and `administration: read` are present on the review job, no `continue-on-error`.
- Update `test_a_real_committed_reviews_file_still_passes_when_bound` — existing `.ai/reviews/` files predate the verdict schema; the test must either skip or use a fixture file with the new schema. (The implementing agent checks whether any committed file already carries the new fields.)

### EDITED

**`.github/workflows/shared-supabase-migrations.yml`** — in `production-apply-review` only:
- Add job-level `permissions: { contents: read, actions: read, administration: read }` (the top-level stays `contents: read`; the job widens only what it needs).
- Add two steps that fetch JSON and call the new script:
  ```
  - name: Fetch branch protection and check-runs
    run: |
      gh api repos/$GITHUB_REPOSITORY/branches/main/protection > "$RUNNER_TEMP/protection.json"
      gh api "repos/$GITHUB_REPOSITORY/commits/$REQUESTED_SHA/check-runs" --paginate > "$RUNNER_TEMP/checks.json"
    env: { GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}" }
  - name: Verify production apply prerequisites (G1+G2)
    run: |
      python scripts/verify_production_apply_prerequisites.py \
        --protection "$RUNNER_TEMP/protection.json" \
        --check-runs "$RUNNER_TEMP/checks.json" \
        --commit-sha "$REQUESTED_SHA"
  ```
- The `production-apply` job: keep `environment: production`. Rename job from "requires Albert's approval" to "Production apply (automatic gates)". Update the three-gate header comment block: gate 3 becomes "the automatic gate constellation (G1–G4); the required-reviewer click is removed by owner ruling 2026-08-12."

**`.github/workflows/shared-supabase-migrations.yml`** `validate` job — add the two new test files to the "Prove the known Python suites were in that glob" explicit list (currently four files; becomes six).

**`AGENTS.md` §5.1-A** — replace gate 3's description. Record the 2026-08-12 ruling in the standing-owner-ruling format: *the manual required-reviewer click is removed because the owner does not review code and the click adds no technical safety; it is replaced by enforceable automatic gates (G1–G4), never a bypass; the evidence contract is provider- and model-neutral.* This is where the ruling becomes durable.

**`docs/production-promotion-app-tolerance-contract.md`** — update any reference to the required-reviewer click as a gate; point at the evidence-contract schema.

### NOT CHANGED
`production_migration_guard.py`, `production_catalog_verification.py`, the `validate` job logic, the preview job, `check-sql.sh`. The existing four Python test suites keep passing.

---

## 5. Sequencing — no Supabase production write in this task

**Phase 1 — Implement (one PR to `main`).** Create the two scripts + test; extend the review-reference script + test; edit the workflow, AGENTS.md, the contract; extend the explicit-suite list. Merge when all six required contexts are green. (Normal branch protection; the human click is still in place, so the lane is not open even if a gate has a bug.)

**Phase 2 — Proven offline/CI (automatic, the PR's own run).** The `validate` job runs every `scripts/test_*.py` — including the two new files — plus the SQL guards and wiring tests. Green CI is the offline proof. No dispatch needed.

**Phase 3 — Proven via production dry-run (read-only).** Dispatch `shared-supabase-migrations.yml` with `target: production, mode: dry-run`, the current `origin/main` SHA, and a real allowlist. This proves the Supabase-touching path (bounded checkout, fresh ledger read, bounded dry-run, `verify-dry-run`) is unbroken on the new code. It is read-only by design (issue #646: the dry-run job has no `environment:` and runs only `link`/`migration list`/`db push --dry-run`).

**Phase 4 — Narrow Environment API change.** Only after Phase 2 green and Phase 3 green. See §6.

**Phase 5 (out of scope for this task — a future session's first real apply).** Whatever the next real batch is. The gates run fully automatic; defense-in-depth in `production-apply` (re-verify SHA, re-read ledger, re-assert bounded, fresh dry-run, catalog verification) catches what a weak review would have missed.

**Residual gap, named honestly:** the new G1/G2 steps live in `production-apply-review`, which a dry-run does not exercise (the dry-run runs the separate `production-dry-run` job). Their proof is therefore the offline tests (Phase 2) plus the wiring tests, not a live run. This is acceptable because (a) both are read-only `gh api` + pure-assertion scripts, offline-tested against fixtures; (b) G2 is confirmatory — branch protection is the actual enforcement and is independently verified by the §6.7 live-read convention; (c) the first real apply (Phase 5) re-runs every Supabase-side check inside the write job with `if: always()`. Do not pretend the dry-run exercises G1/G2.

---

## 6. Before/after Environment API payload (Phase 4)

**Before** (current, per the task's read-only evidence):
```json
{ "protection_rules": [ { "type": "required_reviewers",
    "reviewers": [ { "type": "User", "reviewer": { "login": "u2giants", "id": 55610577 } } ] } ],
  "deployment_branch_policy": null }
```

**After** — the narrow update:
```bash
gh api --method PUT repos/u2giants/shared-db/environments/production --input - <<'EOF'
{
  "wait_timer": 0,
  "reviewers": [],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
EOF
```
```json
{ "protection_rules": [],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
```

- `reviewers: []` removes the `u2giants` rule; `prevent_self_review` becomes moot.
- `deployment_branch_policy.protected_branches: true` restricts the environment to protected branches (`main`) only — GitHub-native enforcement that survives workflow bugs.
- `wait_timer` stays `0` (no artificial delay unless the owner later asks for one).

**Verify immediately after:**
```bash
gh api repos/u2giants/shared-db/environments/production \
  --jq '{rules: .protection_rules, branch_policy: .deployment_branch_policy}'
```

**Cross-workflow impact:** `coldlion-licensor-property-production.yml` (line 208) also uses `environment: production`; it is currently disabled, and after this change it too will run without the click — which is the ruling's intent (it is about the production environment, not one workflow). If the coldlion lane should retain its own human gate, that is a separate owner ruling and a separate environment name.

---

## 7. Rollback

**If a gate misbehaves after Phase 4:** restore the reviewer rule, keeping the new branch policy:
```bash
gh api --method PUT repos/u2giants/shared-db/environments/production --input - <<'EOF'
{ "wait_timer": 0,
  "reviewers": [ { "type": "User", "id": 55610577 } ],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
EOF
```
The lane returns to "human click + automatic gates."

**If the code breaks in Phase 1–3:** revert the PR. The `production` environment still has the required reviewer, so the lane is not open.

**Rollback of a bad apply (Phase 5, future):** unchanged — forward-only, recovery allowlist is "the fix alone" (§5.1-A co-presence rules are deliberately one-directional to permit exactly that).

---

## 8. Stop conditions — halt and escalate

1. Any of the six required contexts is red on `main` after Phase 1. Fix CI first.
2. A new offline test passes in the working tree but the same assertion is absent from CI — the exact "green tick earned by nothing" class (§5.1-A). Halt.
3. The Phase 3 production dry-run fails for any reason unrelated to the (intentional) bounded-set behavior. Halt and diagnose.
4. The Environment API PUT returns an error, or the verification GET still shows `required_reviewers`. Do not assume it worked.
5. Branch protection on `main` has been weakened or removed (`enforce_admins` false, contexts dropped) at any point — the entire automatic-gate argument collapses. Check `gh api …/branches/main/protection` before Phase 4.
6. The repo is made private — per the §6.7 trap, going private silently removes branch protection on this account's plan. If `gh api …/branches/main/protection` returns 403, stop.
7. The evidence-contract script accepts a reference with no `verdict`, or accepts `CONCERNS`, or accepts a URL alone — any of these is a regression of G3. Halt before Phase 4.

---

## 9. The one thing genuinely lost, and the optional mitigation

The human click introduced reaction time (minutes to hours) during which a person might notice a mid-batch problem. The automatic gates execute in seconds. If the design needs a deliberate delay, set `wait_timer` on the environment to a non-zero value (e.g., 1 minute) — a GitHub-native delay that holds the run before `production-apply` starts, independent of any script. This is an owner decision, not a default; the plan ships with `wait_timer: 0`.
