# Plan: cut back shared-db merge gates and fix the stuck checks permanently

Handoff backlink: [HANDOFF.d/2026-09-28T2000Z-edge-dev3-claude-gate-cutback-watchdog-plans.md](../../HANDOFF.d/2026-09-28T2000Z-edge-dev3-claude-gate-cutback-watchdog-plans.md)
Companion plan: [plan_stuck_work_watchdog.md](plan_stuck_work_watchdog.md)
Relationship to the operating route: this plan is a concrete input to Step 6 ("trustworthy required-check set") and Step 8 (native merge queue) of [plan_shared_db_workflow_refactor.md](../../plan_shared_db_workflow_refactor.md). It does not replace that plan; whoever executes a step here updates that plan's STATUS row too.

## Relationship to existing issues (read before starting — this plan extends, it does not compete)

Supersedes nothing. Each step is executed under an existing issue where one exists:
- Step 1 (measure spend) → extends shared-db #3617 "Measure preview-ready GitHub request cost"; add the per-gate split there.
- Steps 2–3 (quota) → extend shared-db #3743 (preflight trusts `/rate_limit`; fix in PR #3742), #3735 (no retry after rate limit) and #3718 (merge drain after Actions rate limit). Land #3742 first.
- Step 5 (required set) → refactor plan Step 6 (issue #3361, now closed) and the #3306 tracker; post the proposal on #3306.
- Step 7 (local pollers, user token) → belongs wholly to popcre/ai-devops #658 "Reduce GitHub requests at source"; do it there, not here.
- Protected-source overlap failing PRs against each other → shared-db #3721 (not duplicated here).

## STATUS — read first

Written 2026-09-28 (EDT); revised the same day after Grok (REVISE) and Qwen (REJECT) plan reviews — see "Review record" at the end. Start at Step 1.

| Step | Outcome | Status | Updated | Evidence |
|---|---|---|---|---|
| 1 | Actions-token API spend per workflow measured and attributed | ⬜ open | 2026-09-28 | — |
| 2 | API-scanning gates share one conditional (ETag) snapshot; spend halved | ⬜ open | 2026-09-28 | — |
| 3 | Quota-failed gates re-run automatically after reset (fail-closed kept) | ⬜ open | 2026-09-28 | — |
| 4 | Agent work contract failures classified; missing-file failures made impossible by tooling | ⬜ open | 2026-09-28 | — |
| 5 | Required-set reduction proposal decided by Albert via refactor Step 6 owner | ⬜ open | 2026-09-28 | — |
| 6 | ai-devops `verify`: #1006 shard failures fixed; Windows-shard move proposed to Albert (owner ruling) | ⬜ open | 2026-09-28 | — |
| 7 | Local poller hygiene (secondary) | ⬜ open | 2026-09-28 | — |
| 8 | Re-measure: gate-caused (quota/paperwork) failures < 5% for 7 days | ⬜ open | 2026-09-28 | — |

## 1. Ultimate goal

Albert has five or more AI sessions that sit idle "waiting" on pull requests that cannot merge. The goal is simple: **an AI session that finishes correct work gets it merged the same hour, without a person or another session having to unstick it.** Safety checks that protect the shared database stay; checks that mostly fail for reasons unrelated to the change go away or stop blocking. If a step here conflicts with this goal, the goal wins — stop and flag it on the tracker.

## 2. What this system is

- `popcre/shared-db`: the single source of truth for the shared Supabase database used by CRM, DAM, PM/PIM and DesignFlow. Every schema change lands here via branch + PR + merge queue. Workflows live in `.github/workflows/` (49 files). Required checks on `main` come from branch protection (`gh api repos/popcre/shared-db/branches/main/protection`).
- `popcre/ai-devops`: the shared AI toolkit (`bin/ai-pr-wait`, `bin/ai-blocker-watch`, `bin/ai-task-gates`, `bin/ai-review-pool`, reviewer wrappers). Its `main` uses rulesets ("main: pull request + merge queue"), not classic protection. Its single big CI workflow is `verify` (Linux + long Windows shards).
- Albert's sessions run on three development machines — a Windows 11 PC, an Ubuntu desktop and an Ubuntu server (details in the private atlas, `ai-private-config path machine_atlas`) — each with its own `gh` user login (user-token quota, 5,000/hour, shared by every session using that login). CI gates use the separate per-repo Actions token. Windows-specific: bare `bash` is WSL; Windows CI shards run on self-hosted runners on machines also used interactively (ai-devops #185). Steps 1–5 are machine-independent (they run in Actions); Step 6 touches Windows runners; Step 7 must work on Windows PowerShell and Linux alike.

## 3. What triggered this work

Snapshot 2026-09-28 afternoon EDT: 31 background reviewer/waiter processes on one host (64 matching `ai-pr-wait|ai-blocker|*review` processes counted by `ps` on edge-dev3 at 4 PM EDT); shared-db PRs #3567, #3673, #3620 BLOCKED on "Documents-only merge authorization", "Cross-PR object collision", "Migration author lease", "Orchestrator marker guard"; ai-devops #1006 failing classifier/offline shards. No one owned clearing them.

## 4. Scope

In: required-check list of shared-db; the five failing gate workflows; quota consumption by local waiters; ai-devops `verify` PR path.
NOT in this plan: reviewer rotation membership; exact-head approval semantics (AGENTS.md §5.0-C refuses widening them — unchanged); production promotion workflows; any database schema; the watchdog (companion plan).

## 5. Current state (measured 2026-09-28)

Command used (reproduce it): `gh run list -R popcre/shared-db --created ">=2026-09-14" -L 3000 --json workflowName,conclusion,event` filtered to PR / merge_group events, grouped by workflow.

| Workflow (shared-db) | Failed / runs, 14 days | Required? |
|---|---|---|
| Agent work contract | 24 / 43 | yes |
| Documents-only merge authorization | 23 / 51 | no (but blocks docs PRs by design) |
| Cross-PR Object Collision | 17 / 43 | yes |
| Orchestrator Marker Guard | 14 / 42 | yes |
| Migration Author Lease | 13 / 44 | yes |
| Queue-Sensitive Checks Aggregate | 3 / 44 | yes |
| Tools Offline Tests | 3 / 43 | yes |
| 17 other PR workflows (Cancelled Work Guard, Domain Ownership, Handoff Contract, Intake Pointer, Destructive Analysis, Public Data Venue, PII guard, etc.) | 0 failures each | many yes |

ai-devops: `verify` 25 / 204 failed; "Reviewer membership drift" 4 / 10.

Required contexts on shared-db `main` (16): SQL migration guards; supabase/tests against an ephemeral database; Cross-PR object collision; Destructive SQL outside migrations; Migration guarded merge authorization; Merge queue gate; Agent work contract; Cancelled work guard; Domain ownership; Handoff contract; Intake pointer guard; Migration author lease; Orchestrator marker guard; Promotion contract tests (offline); Tools offline tests; Queue-sensitive checks (aggregate).

## 6. Key findings and root cause

1. **Four of the five blocking gates are not failing on the change — they fail because the GitHub API quota is empty.** Sampled failed logs (`gh run view <id> --log-failed`, runs of 2026-09-28 18:43–18:49 UTC):
   - Documents-only merge authorization: `REFUSED: GitHub command failed: GitHub API rate limit exceeded (host-wide latch...)`.
   - Cross-PR object collision: `installation quota low: the GitHub API refused the quota probe itself`.
   - Orchestrator marker guard: `UNKNOWN: gh api --paginate .../issues?state=open failed: API rate limit exceeded`.
   - Migration author lease: `REFUSED: GitHub read failed: gh: API rate limit exceeded for installation`.
   The investigating session itself hit the limit twice during this survey. **Correction after review:** these gates run on the repository's **Actions installation token** (`GH_TOKEN: ${{ github.token }}`), whose budget is separate from any person's login; `scripts/lib/github-transport.mjs` keys its latch by token identity and lives in the runner's tmpdir. So the consumer is CI itself — ~49 workflows, several paginating every open PR/issue per run (`scripts/lib/open-pr-files.mjs`) — not the local pollers. Local pollers exhaust the *user* token (this session hit that limit too), which starves sessions and `ai-pr-wait`, a separate but real problem. The 14-day totals are not yet split quota-vs-genuine; Step 1 does that split. Gates correctly fail closed on quota (`docs/agents/merge-protocol.md` §5.2-B rule 4); the defect is that nobody re-runs them afterwards.
2. **A quota-failed gate stays red forever.** Failing closed is correct doctrine; what is missing is an automatic re-run after the quota resets. Nobody re-runs (see companion plan).
3. **Agent work contract often fails on missing evidence files (sampled, not yet classified across all 24):** `Enforced mode requires this pull request to change both .agent/work/<issue>/<gen>/contract.json and .../completion.json` — PRs missing one of two evidence files. It is 56% red. It is an owner-activated control (#1403, #2591 exemption for prose only; rulebook files keep full treatment) — so the fix is tooling that always writes both files, not weakening it.
4. **Documents-only merge authorization is NOT redundant** (corrected after review): it is the only producer of the required status `Migration guarded merge authorization` on prose-only PRs (`scripts/manage-migration-author-lanes.mjs --authorize-repository-maintenance-status`, context in `scripts/lib/merge-self-context.mjs`), under the coordination mutex. It fails only because of quota. Keep it; fix quota.
5. Seventeen guards never failed in 14 days. That means they do not false-fail — they are not the blocker and are kept. (Intake pointer and Domain ownership are designed to be required; see their headers.)
6. **The required-context mirror may only grow:** `scripts/update-required-checks.mjs` refuses removals; `docs/verification/main-required-status-checks.json` is tool-written; `scripts/check-merge-queue-workflows.test.mjs` fails if coverage shrinks. Required-check authority is owned in-flight by refactor Step 6 (#3361, closed; follow-up on the #3306 tracker) and native queue by Step 8 (PR #3567, independent REVISE on #2530). Shrinking the set is an owner decision.

## 7. Rejected approaches

- **Delete all custom gates and rely on review only.** Rejected: collision, lease and destructive-SQL guards protect a database shared by four apps (AGENTS.md §3).
- **Raise quota by adding more tokens/Apps per gate.** Rejected: hides the poller problem, multiplies secrets.
- **Accept reviews bound to earlier heads when only tests changed.** Already refused by owner rule in AGENTS.md §5.0-C; do not reopen.
- **`paths:` filters on required workflows.** Rejected by standing memory "merge gate: never propose paths: filters" (skipped required checks stay pending forever). Use in-job early exit instead.
- **Just re-run failed checks by hand.** That is the status quo that produced idle sessions.

## 8. Design decisions

Locked (2026-09-28, after review):
- **No gate is deleted and none becomes advisory in this plan.** Every blocking gate measured fails for quota or missing-file reasons; fix those causes. Documents-only merge authorization stays (it produces a required status). Agent work contract stays enforced (owner-activated). Domain ownership, Handoff contract, Intake pointer stay required.
- Gates keep failing closed on API unavailability (merge-protocol §5.2-B). Recovery is an automatic re-run with the correct token after reset (Step 3, executed by the companion watchdog).
- Consolidation reduces API spend inside existing workflows, keeping every required context name, the marker guard's `schedule`/`push` legs, and the merge-time re-proofs in `merge-queue-gate.yml` and `guarded-migration-merge.yml`.
- Reducing the 16 required contexts is proposed only, through the refactor tracker #3306 and Albert; candidate: combine Cross-PR collision + Migration author lease + Orchestrator marker guard into one context once Step 2 has run green 7 days.
Open: whether a separate GitHub App token for gates is needed — decide from Step 1 numbers (if Actions-token spend stays above 70% of budget after Step 2, yes).

## 9. Steps

### Step 1 — Measure API spend per workflow (attributable)
The installation-wide `X-RateLimit-Used` counter cannot be attributed per workflow (every concurrent run shares it). Instead add a per-process counter inside `scripts/lib/github-transport.mjs` that counts HTTP requests including retries and probes (latch-blocked calls counted separately), not `gh` invocations: for `--paginate` calls count pages. Print one line at exit: `api_requests workflow=<GITHUB_WORKFLOW> job=<GITHUB_JOB> requests=<n> invocations=<m> blocked=<k>`. Coverage: only calls routed through the transport; inline `gh` calls in workflows (e.g. `shared-supabase-migrations.yml`, `reviewer-start-watch.yml`, `guarded-migration-merge.yml`) are not counted, so also do a one-off audit listing every inline `gh` call and its per-run count, and state the uncovered share in the report. Reuse the existing `GitHub API quota: <remaining> of <limit>` line from `scripts/check-actions-quota.mjs` for budget context. Over 48 h, tabulate per workflow, and split the 14-day failures into quota vs genuine via `gh run view --log-failed` patterns (`rate limit exceeded`, `installation quota low`). Record in `docs/verification/gate-api-spend-<date>.md` and on shared-db #3617.
Gate: the file lists requests per run for every PR workflow and the quota/genuine split for the five gates.

### Step 2 — Durable cross-run cache refreshed on `main` (the real lever)
The collision job already gathers the open-PR snapshot once per run (`scripts/lib/open-pr-files.mjs`, ~110–130 calls per push); the lease and marker gates read little, so do NOT merge workflows. Persist per-PR data across runs instead:
- `actions/cache` is branch-scoped (a run restores only its own branch's, its base's and the default branch's caches). So a new workflow `.github/workflows/open-pr-files-cache.yml` runs on `main` every 15 min as a **delta writer**: one `pulls?state=open` list (1–2 calls; returns head SHA, base SHA and draft) and file-list fetches only for PRs whose key changed since the previous run. PR runs of `pr-object-collision.yml` gain a cache-restore step and become read-only consumers. Eviction: 10 GB per repo, entries unused for 7 days removed — a miss just means a full gather.
- Key each entry `open-pr-files-<pr>-<headSha>-<baseSha>-<isDraft>` and store the whole `pullWithFiles` record including `changed_files`; a consumer re-validates `files.length == changed_files` and that head, base and draft still match a fresh single-PR detail read (1 call per PR, not the paginated file list). Any mismatch, missing or unreadable entry → gather that PR fresh exactly as today. A partial snapshot never passes (§11).
- `pr-object-collision.yml` gains only the restore step. Leave every job name, the `pull_request` / `merge_group: checks_requested` triggers, every self-test suite (collision's 6, marker's 2, lease's ~28 incl. `scripts/orchestrator-flow/*.test.mjs`), `merge_group` trigger and `scripts/check-merge-queue-workflows.test.mjs` assertions unchanged.
Gate: installation-wide spend of collision **plus** the new writer (Step 1 counter, summed per day) is at most half of the pre-change daily collision spend on a day with more than 10 open PRs; tests "base retarget invalidates entry" and "draft→ready invalidates entry" pass; all existing suites green.

### Step 3 — Automatic re-run after quota reset
Owned by the companion watchdog (its Step 2): `gh run rerun <run-id> --failed` with a token that has `actions:write` on shared-db, only when the failed log matches the quota patterns exactly, once per head SHA, and only after `rate_limit` shows reset. No `workflow_dispatch` retries (they carry no PR payload and evaluate nothing).
Gate: a quota-failed gate on a live PR goes green with no human re-run.

### Step 4 — Agent work contract: add quota handling, then fix missing files
First: `agent-work-contract.yml` is the only one of the five without `scripts/check-actions-quota.mjs` and `GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS`, and its documents-only classifier treats a quota refusal as "not documents-only", which then prints the missing-files message. Add the same quota preflight and bounded wait the other four use, and make a classifier read failure print a distinct quota error. Only then classify all 24 failures (Step 1 method). For missing-contract/report failures, make `ai-task-gates` (ai-devops) always write both `.agent/work/<issue>/<gen>/contract.json` and `completion.json` on `start`/`check --before pr`, and have the gate's error print the exact command that creates the missing file. Do not widen the #2591 exemption.
Gate: failures of type "contract without report / report without contract" = 0 over 7 days.

### Step 5 — Proposal for a smaller required set (owner ruling required; not executable by a session)
AGENTS.md §5.0-C says "No required check becomes optional, no gate is skipped" and `scripts/check-review-parallelism-brief.mjs` pins that. Retiring or merging any required context therefore needs an owner ruling recorded in `docs/agents/owner-rulings.md` plus an AGENTS.md amendment, and then a change to `scripts/update-required-checks.mjs` (today add-only). Couplings that any change must carry: `scripts/check-merge-queue-workflows.test.mjs` CONTEXT_MAP and dated readback, `scripts/orchestrator-flow/runner-lanes.json`, and `scripts/production_business_risk_gate.py` `REQUIRED_CHECKS` (requires `Cross-PR object collision` and `Migration author lease` at the merged head for production promotion; tests in `test_production_business_risk_gate.py`). Recommendation to carry to Albert: do not retire those two contexts at all; only consider the others after Steps 1–4 show they still cost meaningful spend. Post the evidence on #3306.
Gate: a recorded owner decision (yes or no) on #3306.

### Step 6 — ai-devops `verify` (Windows: see ai-devops #185, #961, #963, #1008)
Windows shards run on self-hosted runners that share Albert's Windows PC-class machines with interactive sessions (#185); PR #1008 covers the protected Windows install. Do not duplicate those; this step fixes only the fast-classifier and linux-offline shard failures (new child issue).
Fix the classifier/offline shard failures on #1006 from `gh run view --log-failed` (a real test fix). Moving Windows shards off the PR path changes what the required `verify` context proves, so it needs the same kind of owner ruling as Step 5 (ai-devops rulesets): propose it on #1014 with Step 1-style evidence; do it only after Albert's recorded yes. Until then, only the test fixes land.
Gate: #1006 green; median PR `verify` < 10 min.

### Step 7 — Local poller hygiene (user token) — executed under ai-devops #658
`bin/ai-pr-wait` and `bin/ai-blocker-watch` reuse the same conditional-request approach (port `github-conditional.mjs` semantics) and one poller per PR per host (lock file). Reviewer wrappers do not poll GitHub.
Gate: 10 waiters on 3 PRs spend < 100 user-token requests/hour (`tests/gh-poll-budget.test.mjs`).

### Step 8 — Re-measure
Repeat the section 5 command for 7 days after Step 4. Record in `docs/verification/gate-cutback-remeasure-<date>.md`.
Gate: quota/paperwork failures < 5% of PR runs.

## 10. Tests required
- `tests/gh-poll-budget.test.mjs` (ai-devops): shared cache, ETag 304 path, one-poller lock.
- `scripts/open-pr-files-cache.test.mjs`: delta writer fetches only changed keys; base retarget and draft→ready invalidate; unreadable cache → full gather; partial pagination never treated as complete.
- `tests/task-gates-evidence-pair.test.mjs` (ai-devops): `ai-task-gates` always writes both `contract.json` and `completion.json`.
- Existing: `Tools offline tests`, `scripts/check-review-parallelism-brief.mjs`, `scripts/check-exact-head-approval.mjs` stay green.

Adversarial cases (trust boundary = GitHub API responses):

| Input | Hostile case | Test |
|---|---|---|
| API response | 403 rate limit | github-conditional.test "quota → fail closed, marked quota for rerun" |
| API response | partial pagination (page 2 fails) | github-conditional.test "partial snapshot never passes" |
| API response | stale ETag cache after new push | gh-poll-budget.test "head SHA change busts cache" |
| PR body | forged lease claim text | existing lease suite "lease requires ref reservation, not text" stays green |

## 11. Constraints and gotchas
- Never push to `main`; branch + PR + merge queue. Workflow/script changes are code: normal checks, governed review (AGENTS.md §5.0-C), not the docs-only admin merge.
- Branch-protection change is shared infrastructure: independent read-only reviewer APPROVE before running it.
- Never a partial snapshot treated as "no collisions".
- Sign GitHub posts `Posted by Claude chat <id> on <machine>`.
- Times in EDT.

## 12. Access
`gh` authenticated as u2giants with popcre admin. Reading branch protection needs `secrets.SYNC_TOKEN` (the Actions token cannot; run 36186790619). Any new token is stored in 1Password vault `vibe_coding` by title, never pasted. Run `ai-task-gates start --class <class>` first.

## 13. Done, risks, open questions
Done: all 8 STATUS rows cite a PR/run artifact; refactor plan Step 6 row updated; re-measure file committed.
Risks: snapshot sharing bug → collisions slip. Mitigation: merge-time re-proofs untouched; snapshot partial = fail. Rollback: revert the workflow PR.
Open: whether GitHub App quota should be split per repo (decide after Step 1 measurement).

## Self-audit
1. Fresh session can execute? Yes — goal (§1), system (§2), exact files/commands per step (§9), gates per step.
2. Carries background and rejected paths? Yes — §5 measurements with reproduction command, §6 log quotes, §7 rejections including owner-refused ones.
3. Goal clear enough for judgment? Yes — §1 "merged the same hour without a person unsticking it; database safety checks stay".

## Review record (2026-09-28)
Grok (grok-4.6-build) VERDICT: REVISE; Qwen (qwen3.8-max) VERDICT: REJECT. Both found: deleting Documents-only authorization strands a required status; advisory Agent work contract widens an owner exemption; neutral+dispatch retry is not implementable and breaks fail-closed doctrine; merged gate dropped the marker schedule and merge-time re-proofs; required set cannot shrink via the existing tool and collides with #3361/#2530/PR #3567; quota root cause was the Actions token, not local pollers. All incorporated above: no deletions or advisory changes, re-run instead of neutral, consolidation inside existing contexts, shrink only as a proposal to Albert via #3361. Reports: `.ai/reviews/grok-gate-plans-e10415-*.md`, `.ai/reviews/qwen-gate-plans-e10415-*.md` (local, edge-dev3).

Second round (2026-09-28): Grok re-review confirmed all 8 first-round defects resolved and raised 3 more — `needs:` is same-workflow only, evidence file is `completion.json` not `report.json`, handoff next action stale. All fixed.

Third round (2026-09-28): Qwen REJECT on round 3 — handoff frontmatter missing; single-run snapshot sharing saves ~4% not 50%; merged workflow would be a shared failure point and orphan self-tests; Step 5 conflicted with §5.0-C and production_business_risk_gate.py; per-workflow attribution impossible from the shared counter. Fixed: frontmatter added; Step 2 is now a durable per-head cross-run cache with per-job fallback, no workflow merge; Step 5 is an owner-ruling proposal naming all couplings; Step 1 uses a per-process counter.

Fourth round (2026-09-28): Qwen REJECT — cache key missed base/draft changes (fail-open risk), actions/cache is branch-scoped, Agent work contract masks quota as missing files, counter counted invocations, Windows-shard move needs an owner ruling. All fixed in Steps 1, 2, 4, 6. Qwen confirmed all round-3 defects resolved.

Fifth round (2026-09-28): Qwen REJECT (Grok APPROVE on the same head) — refresh job could cost more than it saves; constraint sentence contradicted the mechanism; counter coverage overstated and the round-4 counter fix had not actually been applied; §10 test named the rejected design; STATUS row 6 overstated. Fixed: delta writer every 15 min with a combined-spend gate, explicit file edits, counter counts requests with stated coverage plus inline-`gh` audit, test renamed, row 6 reworded.
