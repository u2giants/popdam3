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
| requested | 2026-08-12T11:47:16Z |
| tokens | `{"input":2152,"output":5789,"reasoning":0,"cache":{"read":129216,"write":0}}` |

---

---

# AUDIT: Remove manual required-reviewer click from the shared-db production lane

## VERDICT: REQUEST CHANGES — the design is sound, but the code changes MUST land and prove out before the Environment API update removes the only thing currently holding

The ruling is correct and implementable. The human click is already a rubber stamp (AGENTS.md §1: "the owner does not review code"), so removing it loses no real safety *if and only if* the replacement gate constellation is wired, tested, and green on `main` first. The Environment API update is the **last** step, not the first — doing it before the code lands bricks the lane open with no gate at all.

---

## 1. Current state audit — every gate in the production apply path

The production apply runs through two jobs. `production-apply-review` runs first (deterministic gates); `production-apply` runs second (the write, behind `environment: production`).

### 1.1 Gates that are ENFORCEABLE today (machine-checked, not bypassable by the dispatcher)

| Gate | Location | What it proves |
|---|---|---|
| Typed confirmation string `APPLY <sha>` | `production-apply-review` step "Check exact confirmation" (wf line ~556) | The dispatcher typed the exact SHA |
| Exact origin/main SHA | `production-apply-review` step "Verify exact main commit" (wf line ~563): `test "$(git rev-parse origin/main)" = "$REQUESTED_SHA"` | The SHA is the live tip of `main`, not a stale or arbitrary commit |
| Allowlist policy (HARD_BLOCKED, §6.8 bundle, §6.5 FR hold, §660 co-presence, atomic batches) | `production_migration_guard.py` `parse_allowlist` → `validate_candidates` | The named versions satisfy every owner ruling encoded in the guard |
| Fresh production ledger read | `production-apply` re-reads `supabase migration list --linked` inside the job (wf line ~680), not the review job's stale copy | The bounded set is sized against the ledger as it exists at apply time |
| Bounded checkout (filesystem-pruned to `remote-ledger ∪ allowlist`) | `production_migration_guard.py prepare` + `assert-bounded` at point of use | `--include-all` cannot reach any migration outside the allowlist |
| Bounded dry-run verified against allowlist | `verify-dry-run` parses CLI output, asserts `actual == allowlist` exactly and in order | The set about to be pushed is exactly the named set |
| Post-apply catalog verification | `production_catalog_verification.py` — `to_regclass`, `pg_proc`, ACL assertions via read-only Management API | The objects the migrations claim to create actually exist after the write |

These seven are solid. They stay.

### 1.2 Gates that are STRING-PLAUSIBILITY checks (the weak class to identify and strengthen)

**The `review_reference` gate is the one.** `scripts/production_apply_review_reference.py` `validate()`:

- **URL branch** (line ~133): accepts any `https://` URL with a non-empty host and path, ≥12 characters. The file's own docstring admits this (lines ~97–100): *"An invented https URL such as `https://example.com/nope` passes. It cannot be otherwise: proving a URL holds a real review means fetching it."*
- **File branch** (line ~144): accepts a file under `.ai/reviews/` that exists and mentions the short SHA or an allowlisted version. This is stronger (it reads the file) but still proves only that a file exists and contains a token — not that its verdict was APPROVE, not that the review was independent, and not that GLM performed it.

**No verdict enforcement exists today.** The gate never checks for `APPROVE`, `CONCERNS`, or `REQUEST CHANGES`. A review file that says *"CONCERNS: this batch grants TRUNCATE on append-only tables"* would pass, because the file exists and mentions the version. This is the gap the task names.

### 1.3 Gate being removed

`environment: production` with `required_reviewers: [u2giants]`. This is the only human-in-the-loop gate. After removal, the entire safety boundary is the `production-apply-review` job's script gates. That job **must** absorb everything the click was nominally doing.

---

## 2. Design — the replacement gate constellation

The human click is replaced by **five new or strengthened gates in `production-apply-review`**, plus one GitHub-native gate on the environment. None is sufficient alone; together they are strictly stronger than a rubber-stamp click.

### G1 (NEW): Required CI green on the exact dispatch SHA

**What it proves:** the six required status contexts on `main` (AGENTS.md §6.7) all passed on the exact SHA being applied. Today the SHA is verified as `origin/main` tip, but nothing verifies CI was green *on that SHA*. A merge that somehow landed through a broken state would pass today.

**Enforcement mechanism:** a new step in `production-apply-review` that calls the GitHub API via `gh`:

```bash
# Requires permissions: actions: read (currently only contents: read)
for ctx in \
  "Promotion contract tests (offline)" \
  "Cross-PR object collision" \
  "Tools offline tests" \
  "SQL migration guards" \
  "Domain ownership" \
  "Intake pointer guard"; do
  state=$(gh api "repos/$GITHUB_REPOSITORY/commits/$REQUESTED_SHA/check-runs" \
    --paginate --jq ".check_runs[] | select(.name == \"$ctx\") | .conclusion" \
    | sort -u)
  if [ "$state" != "success" ]; then
    echo "::error::Required check '$ctx' is not success on $REQUESTED_SHA (got: $state)"
    exit 1
  fi
done
```

**Prerequisite:** add `actions: read` to the job's permissions (the top-level `permissions: contents: read` at wf line 62 defaults all other scopes to `none`).

**Why this is not a string check:** it queries GitHub's own check-run records, which can only be produced by the CI runners. The dispatcher cannot fabricate a check-run conclusion.

### G2 (NEW): Clean PR state — the SHA is a merged pull request

**What it proves:** the dispatch SHA reached `main` through the PR review process, not a direct push or a force-push. Branch protection already enforces this mechanically (`enforce_admins: true`, no force pushes per §6.7), but this step makes it an explicit, observable gate in the apply evidence.

**Enforcement mechanism:**
```bash
# /commits/{sha}/pulls returns PRs associated with the commit
count=$(gh api "repos/$GITHUB_REPOSITORY/commits/$REQUESTED_SHA/pulls" \
  --jq 'length')
if [ "$count" -eq 0 ]; then
  echo "::error::$REQUESTED_SHA is not associated with any merged PR."
  exit 1
fi
```

**Limitation, stated honestly:** on GitHub Free/Pro, the `/commits/{sha}/pulls` endpoint requires the commit to be the *merge commit*, not the squashed commit. If the repo uses squash-merge (the default), the PR's `merge_commit_sha` differs from the squashed SHA on `main`. If this endpoint returns 0 for a valid squash-merged commit, fall back to verifying `git log --merges --oneline $SHA^..$SHA` or accept the branch-protection argument (the SHA is `origin/main`, which branch protection guarantees came through a PR). This fallback must be tested before relying on it.

### G3 (STRENGTHENED): Independent GLM 5.2 review with explicit APPROVE verdict

**This is the gate that most directly replaces the human judgement the click nominally provided.**

**Current weakness:** the review-reference script accepts any file that exists and mentions a token. No verdict check, no independence check, no model attribution.

**Strengthened design — three new assertions in `production_apply_review_reference.py`:**

1. **Explicit APPROVE verdict.** The review file (for `.ai/reviews/` path references) must contain a structured verdict line. Accept any of:
   - `VERDICT: APPROVE` (case-insensitive)
   - `**APPROVE**`
   - A front-matter or JSON block with `"verdict": "APPROVE"`
   
   Reject if the file contains `VERDICT: CONCERNS`, `VERDICT: REQUEST CHANGES`, `VERDICT: REJECT`, or no verdict at all. This follows the existing repo precedent at `scripts/popsg-property-psg4-decision-package.test.cjs:53`: `assert.equal(approval.technical_review.verdict, "APPROVE")`.

2. **Model attribution.** The review file must attribute the review to GLM 5.2 (or a named independent reviewer). Accept `REVIEWER: GLM 5.2`, `MODEL: glm-5.2`, or equivalent. This makes "I reviewed it myself" fail the gate.

3. **URL references are demoted.** A URL reference (PR review comment, issue comment) can no longer satisfy the gate alone, because the script cannot read the URL's content. Require a **file-based** reference under `.ai/reviews/` for the verdict check. The URL can be *additional* evidence but cannot be the sole reference.

**Why this is stronger but still honest about its limit:** the file must now contain an explicit APPROVE from a named model, bound to the exact SHA and allowlist. The remaining weakness (the dispatcher could fabricate the file) is mitigated by: (a) the file goes through a PR and the six required CI contexts before it reaches `main`; (b) the dispatcher (`GITHUB_ACTOR`) is recorded in the evidence; (c) the post-apply catalog verification (gate 7 in §1.1) catches what a bad review would have missed. This is the same trust model the repo already uses for the `APPROVED_HASH`/`APPROVED_COUNT` pins in `tools/run-coldlion-licensor-property-phase4.mjs` — a committed constant that went through CI.

**On "without pretending GitHub can call GLM directly":** GitHub Actions ubuntu-latest runners *can* reach external APIs, and GLM 5.2 is available via Z.ai/OpenRouter. A future upgrade *could* add a `GLM_API_KEY` secret and have the workflow call GLM live. But the owner explicitly removed the paid model review on 2026-08-11 (§5.1-A, handoff `2026-08-12T0100Z` item 4), and the workflow's own comments say *"Do not restore an automated verdict here."* The committed-file approach respects that ruling. The direct-call path is documented as an optional future upgrade, not the default.

### G4 (NEW): Preview evidence

**What it proves:** the exact allowlist was rehearsed on preview before being applied to production. This is §4 rule 2 of AGENTS.md ("Preview database first").

**Enforcement mechanism:** add a new workflow input `preview_run_id` (the run ID of a successful preview `shared-supabase-migrations.yml` run). The `production-apply-review` job verifies via the GitHub API:
1. The run exists and belongs to this workflow
2. Its `target` input was `preview`
3. Its conclusion is `success`
4. Its `preview_allowlist` input matches `production_allowlist`

```bash
run=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$PREVIEW_RUN_ID" --jq '{})
target=$(echo "$run" | jq -r '.name')
conclusion=$(echo "$run" | jq -r '.conclusion')
# The dispatch inputs are in the run's display title or need a separate query
```

**Limitation:** querying a past run's dispatch *inputs* requires `gh run view $PREVIEW_RUN_ID --json` which may not expose `inputs`. If the inputs are not queryable, fall back to: the operator supplies the preview run ID, the gate verifies it was a successful preview run on the same SHA, and the allowlist match is a human responsibility recorded in the evidence. This is friction, not proof — and it must be labeled as such.

### G5 (NEW): Deployment branch policy on the `production` environment

**What it proves:** only `main` (a protected branch) can deploy to the `production` environment. This is GitHub-native enforcement that survives even if the workflow's own SHA check has a bug.

**Mechanism:** the Environment API update (see §6 below).

### G6 (EXISTING, UNCHANGED): The seven enforceable gates from §1.1

These stay exactly as they are.

---

## 3. Exact files to change (for the implementing agent — do NOT change in this task)

| File | Change |
|---|---|
| `.github/workflows/shared-supabase-migrations.yml` | (1) Add `actions: read` to `production-apply-review` job permissions. (2) Add G1 step (required CI on SHA). (3) Add G2 step (clean PR state). (4) Add G4 step (preview evidence). (5) Add `preview_run_id` workflow input. (6) Update job header comments (lines ~535–550, ~630–640): replace "gate 3: Albert as required reviewer" with the automatic gate description. (7) Rename `production-apply` job from "requires Albert's approval" to "requires automatic gate constellation." |
| `scripts/production_apply_review_reference.py` | Add G3: verdict-enforcement logic in `validate()` — require explicit APPROVE in `.ai/reviews/` files, require model attribution, demote URL-only references. |
| `scripts/test_production_apply_review_reference.py` | Add tests for G3: file with APPROVE passes, file with CONCERNS fails, file with no verdict fails, URL-only reference fails, file without model attribution fails. Update `TestWorkflowWiring` to reflect new permission and step names. |
| `AGENTS.md` §5.1-A gate 3 | Replace the description of gate 3 (Albert click) with the automatic gate constellation. Record the 2026-08-12 ruling. This is where the ruling becomes durable. |
| `docs/production-promotion-app-tolerance-contract.md` | Update any reference to the required-reviewer click as a gate. |
| GitHub Environment API (after merge) | Remove `required_reviewers`, add `deployment_branch_policy`. See §6. |

### What must NOT change
- `scripts/production_migration_guard.py` — the guard logic is correct and stays.
- `scripts/production_catalog_verification.py` — stays as-is.
- The `validate` job — stays as-is.
- The preview job — stays as-is (it already has its own bounded-apply lane).
- `coldlion-licensor-property-production.yml` — uses `environment: production` but is currently disabled. The Environment API change affects it too (see §6 note), which is correct: when re-enabled it should also run without the human click.

---

## 4. Exact acceptance tests

All tests run offline (no database, no network, no secrets) inside the existing `validate` job's `scripts/test_*.py` glob.

### 4.1 Tests for G3 (verdict enforcement) — in `test_production_apply_review_reference.py`

```
test_a_review_file_with_verdict_approve_is_accepted
  → file contains "VERDICT: APPROVE" + "REVIEWER: GLM 5.2" + SHA binding → True

test_a_review_file_with_verdict_concerns_is_refused
  → file contains "VERDICT: CONCERNS" → False, reason mentions "verdict"

test_a_review_file_with_verdict_request_changes_is_refused
  → file contains "VERDICT: REQUEST CHANGES" → False

test_a_review_file_with_no_verdict_is_refused
  → file mentions SHA but has no verdict line → False, reason mentions "no explicit verdict"

test_a_review_file_without_model_attribution_is_refused
  → file has "VERDICT: APPROVE" but no "REVIEWER:" or "MODEL:" → False

test_a_url_only_reference_is_refused_for_production_apply
  → GOOD_URL alone → False, reason says "file-based reference required for verdict"

test_a_url_plus_file_is_accepted
  → URL is supplementary evidence, file has APPROVE + binding → True
```

### 4.2 Tests for G1/G2/G4 (workflow-level gates) — new test file `test_production_lane_gates.py`

```
test_the_workflow_has_actions_read_permission    → greps workflow YAML for actions: read
test_ci_status_step_exists                      → greps for the check-run verification step
test_pr_state_step_exists                       → greps for the commits/pulls step
test_preview_evidence_input_exists              → greps for preview_run_id input
test_preview_evidence_step_exists               → greps for the preview-run verification step
test_no_continue_on_error_in_new_steps          → existing test, must still pass
test_environment_production_still_present        → environment: production must remain
test_job_name_no_longer_says_albert             → "Albert" removed from job name/comments
```

### 4.3 Existing tests that must still pass unchanged

All four Python suites in the glob (`test_production_migration_guard.py`, `test_production_catalog_verification.py`, `test_production_apply_review_reference.py`, `test_post_batch_app_verification.py`) plus `check-sql.sh` and all `scripts/test_*.py`. The existing `TestWorkflowWiring` class in the review-reference test will need its assertions updated for the renamed job and new steps.

---

## 5. Safe sequencing

**Phase 1 — Code changes (PR to `main`, normal branch-protection + six required contexts):**

1. Strengthen `production_apply_review_reference.py` with G3 verdict enforcement + tests.
2. Add G1 (CI on SHA), G2 (PR state), G4 (preview evidence) steps to `production-apply-review` in the workflow. Add `actions: read` permission. Add `preview_run_id` input.
3. Update workflow comments and job names.
4. Update AGENTS.md §5.1-A with the ruling and the new gate description.
5. Merge the PR. All six required contexts must be green.

**Phase 2 — Dry-run verification (no production write):**

6. Dispatch `shared-supabase-migrations.yml` with `target: production, mode: dry-run`. Verify the new gates fire (G1 checks CI, G2 checks PR state, G3 requires the verdict file, G4 requires preview run). If any gate is wrong, the dry-run fails loudly — no harm done.

**Phase 3 — Canary apply (the canary migration `20260810140000`):**

7. Dispatch `target: production, mode: apply` with the canary. This exercises the full gate constellation end-to-end, including the environment gate (which still has required_reviewers at this point — Albert clicks one last time). Verify all new gates pass and the evidence artifacts are complete.

**Phase 4 — Environment API update (the irreversible step):**

8. Only after Phase 3 is green: remove `required_reviewers` from the `production` environment and add `deployment_branch_policy`. See §6.

9. Dispatch one more dry-run to confirm the lane still works without the click.

**Phase 5 — First real apply without the click:**

10. Apply the next real batch (B3 per the handoff) entirely through the automatic gates.

---

## 6. Before/after API payload

### BEFORE (current state, verified per task evidence)

```bash
gh api repos/u2giants/shared-db/environments/production
```
```json
{
  "name": "production",
  "protection_rules": [
    {
      "type": "required_reviewers",
      "reviewers": [
        { "type": "User", "reviewer": { "login": "u2giants", "id": 55610577 } }
      ]
    }
  ],
  "deployment_branch_policy": null
}
```

### AFTER (the narrow update — Phase 4, step 8)

```bash
gh api -X PUT repos/u2giants/shared-db/environments/production \
  --input - <<'EOF'
{
  "wait_timer": 0,
  "reviewers": [],
  "deployment_branch_policy": {
    "protected_branches": true,
    "custom_branch_policies": false
  }
}
EOF
```
```json
{
  "name": "production",
  "protection_rules": [],
  "deployment_branch_policy": {
    "protected_branches": true,
    "custom_branch_policies": false
  }
}
```

**What this changes:**
- `reviewers: []` removes the `u2giants` required-reviewer rule. `prevent_self_review` becomes moot (no reviewers to self-review).
- `deployment_branch_policy.protected_branches: true` restricts the environment to protected branches only (i.e., `main`). This is GitHub-native enforcement that a dispatch from any other branch cannot reach `environment: production`.

**What this does NOT change:** `wait_timer` stays 0 (no artificial delay). No other environment settings are touched.

**Cross-workflow impact:** `coldlion-licensor-property-production.yml` (line 208) also uses `environment: production`. It is currently disabled. When re-enabled, it will also run without the required-reviewer click — which is the intended behavior of this ruling (the ruling is about the production lane, not one workflow). If the coldlion lane should retain its own human gate, that must be a separate owner decision and a separate environment (e.g., `production-coldlion`).

**Verification after the PUT:**
```bash
# Confirm reviewers are gone and branch policy is set
gh api repos/u2giants/shared-db/environments/production \
  --jq '{reviewers: .protection_rules, branch_policy: .deployment_branch_policy}'
```

---

## 7. Rollback

**If something breaks after the Environment API update (Phase 4):**

```bash
# Restore the required-reviewer rule
gh api -X PUT repos/u2giants/shared-db/environments/production \
  --input - <<'EOF'
{
  "wait_timer": 0,
  "reviewers": [
    { "type": "User", "id": 55610577 }
  ],
  "deployment_branch_policy": {
    "protected_branches": true,
    "custom_branch_policies": false
  }
}
EOF
```

This re-adds `u2giants` as required reviewer while keeping the new branch policy. The lane returns to its current state (human click + automatic gates).

**If the code changes break the lane (Phase 1–2):** revert the PR. The `production` environment still has required_reviewers, so the lane is not open even if the new gates are buggy.

**Rollback of a bad production apply:** unchanged from today — forward-only, no undo (AGENTS.md §5). The recovery allowlist is "the fix alone" per §5.1-A.

---

## 8. Stop conditions — halt and escalate if any of these is true

1. **Any of the six required CI contexts is red on `main`** after the code PR merges. Do not proceed to Phase 2. Fix the CI first.

2. **The dry-run in Phase 2 does not exercise all new gates.** If a gate silently passes without actually checking (e.g., the `gh api` call returns empty and the step treats empty as success), halt. This is the exact "green tick earned by nothing" failure class that §5.1-A documents.

3. **`gh api repos/.../commits/{sha}/pulls` returns 0 for a valid merged PR** (squash-merge issue). Do not skip G2 silently. Either fix the query or accept the branch-protection argument explicitly in the evidence, but do not let the gate pass by accident.

4. **The canary apply in Phase 3 fails any new gate.** Do not loosen the gate to make the canary pass. The canary is the test of the gate, not the other way round.

5. **The Environment API PUT in Phase 4 returns an error** or the verification GET still shows `required_reviewers`. Do not assume it worked. Re-run and verify.

6. **Branch protection on `main` has been weakened or removed** at any point. AGENTS.md §6.7 rules 1–3 are prerequisites: if `enforce_admins` is false or required contexts are removed, the automatic gates are bypassable by an admin and the ruling's safety argument collapses. Check `gh api repos/u2giants/shared-db/branches/main/protection` before Phase 4.

7. **The repo is made private.** Per §6.7's trap: going private silently removes branch protection on this account's plan. If the repo is private, `gh api .../branches/main/protection` returns 403, and none of the automatic gates hold. Stop.

---

## 9. One design risk to name explicitly

**The `production-apply-review` job becomes the sole barrier between a dispatch and a production write.** Today, even if every script gate has a bug, Albert's click stops the apply. After this change, a bug in `production-apply-review` that lets it pass when it should fail means the apply proceeds with no human barrier.

The mitigation is the **redundancy already in the design**: the SHA is re-verified in `production-apply` itself (wf line ~658); the ledger is re-read in `production-apply` (wf line ~680); the bounded checkout is re-asserted at the point of use (wf line ~705); the dry-run is re-run fresh inside the apply job (wf line ~710). These are defense-in-depth checks that run *after* the review job, inside the write job. They stay regardless of the gate change, and they are the reason a single bug in the review job does not reach production unchallenged.

The one thing that is genuinely lost is **time**. The human click introduced a delay — minutes to hours — during which someone might notice something wrong. The automatic gates execute in seconds. If the design needs a delay (e.g., to allow monitoring to catch a mid-batch failure), `wait_timer` on the environment can be set to a non-zero value. This is optional and should be an owner decision, not a default.
