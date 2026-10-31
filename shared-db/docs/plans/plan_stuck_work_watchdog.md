# Plan: stuck-work watchdog, and whether GitHub fits a many-agent workflow

Handoff backlink: [HANDOFF.d/2026-09-28T2000Z-edge-dev3-claude-gate-cutback-watchdog-plans.md](../../HANDOFF.d/2026-09-28T2000Z-edge-dev3-claude-gate-cutback-watchdog-plans.md)
Companion plan: [plan_gate_cutback.md](plan_gate_cutback.md) (do its Step 1–2 first; a watchdog that re-runs quota-starved checks would only burn more quota).

## Relationship to existing issues (read before starting)

Supersedes nothing; extends:
- popcre/ai-devops #1002 "Self-clearing stuck locks and merge-queue settings drift check" (plan_self-healing-locks-and-settings-drift.md in ai-devops) — that plan clears stuck *locks*; this one clears stuck *PRs*. Build the watchdog in the same ai-devops area and reuse its alerting; track Steps 1–4 as a child of #1002.
- popcre/ai-devops #198 "proactive reviewer-assisted problem solving for stuck sessions" — the fixer routine (§8) should call that reviewer-assist path when its own fix attempt fails.
- shared-db `orchestrator-no-progress-alarm.yml` (issue #3027) — unchanged; it covers orchestrator outcomes, this covers PRs.
- Quota fixes it depends on: shared-db #3743 / PR #3742, #3735, ai-devops #658.

## STATUS — read first

Written 2026-09-28 (EDT); revised the same day after Grok (REVISE) and Qwen (REJECT) reviews — see Review record. Start at Step 1 (needs the watchdog GitHub App, §8).

| Step | Outcome | Status | Updated | Evidence |
|---|---|---|---|---|
| 1 | Stuck-PR detector runs every 15 min and writes a report | ⬜ open | 2026-09-28 | — |
| 2 | Automatic re-run of infrastructure-failed checks | ⬜ open | 2026-09-28 | — |
| 3 | Fixer dispatch for real failures with no owner activity | ⬜ open | 2026-09-28 | — |
| 4 | Albert notified once per stuck item, in plain English | ⬜ open | 2026-09-28 | — |
| 5 | Local session side: waiters exit and register instead of polling | ⬜ open | 2026-09-28 | — |
| 6 | 7-day proof: no PR blocked > 2 h without an owner action | ⬜ open | 2026-09-28 | — |

## 1. Ultimate goal

Nothing Albert asked for sits silently stuck. **Within 45 minutes of a PR going stuck, something either re-runs it, hands it to a named fixer, or (by 90 minutes) tells Albert in one plain sentence what is blocked and on whom.** If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. System

Same as the companion plan §2: `popcre/shared-db` (shared database contracts, 49 workflows, merge queue), `popcre/ai-devops` (session tooling: `ai-pr-wait`, `ai-blocker-watch`, `ai-task-gates`, `ai-review-pool`, reviewer wrappers). AI sessions (Claude, Codex, MiMo, others) on edge-dev/edge-dev2/edge-dev3 and Windows open PRs and are expected to merge them themselves.

## 3. Trigger

2026-09-28: 5+ sessions idle "waiting"; PRs #3567, #3673, #3620 (shared-db) and #1006 (ai-devops) red for hours; 31 background waiters. Each session ended its turn "waiting" and nothing woke anyone to fix the red check.

## 4. Scope

In: detection of stuck PRs in popcre/shared-db and popcre/ai-devops; automatic retry of infrastructure failures; fixer dispatch; owner notification.
NOT in: changing which checks are required (companion plan); reviewer rotation; production or database actions — the watchdog never merges structural PRs, applies migrations, or bypasses a gate.

## 4a. Albert's three development machines

Albert works from three machines (concrete names/addresses live in the private atlas: `ai-private-config path machine_atlas`): a **Windows 11 PC** (PowerShell 7; bare `bash` is WSL and drops injected environment), an **Ubuntu desktop** (edge-dev3-class, Claude + Codex sessions), and an **Ubuntu server**. Self-hosted Windows CI runners share physical machines with interactive lanes (ai-devops #185).

- **Where the watchdog runs:** on a GitHub-hosted `ubuntu-latest` runner (scheduled workflow in popcre/ai-devops). None of the three machines has to be awake, logged in, or have `gh` authenticated. This is deliberate: the census (atlas §"Agent harness census") shows expired Claude OAuth and unauthenticated `gh` on some machines, which is exactly how local wake-ups silently fail today.
- **How each machine's sessions are seen:** the watchdog does not inspect machines. It sees sessions only through what they leave on GitHub — pushes, reviews, comments signed `Posted by Claude chat <id> on <machine>`, and `ai-blocker-watch` registrations (issue comments / `ai-blocker-watch:parked` markers). The daily stuck report groups items by the `<machine>` in the last signature so Albert can tell which box went quiet.
- **Fixer routine:** a Claude scheduled cloud routine (no machine dependency). Optional fallback if cloud routines are unavailable: the Ubuntu server runs it from cron (always on); never the Windows PC (WSL env trap, CI contention) or the desktop (sleeps). If no fixer picks up a `stuck-fixer` issue within 30 min, the watchdog treats that as unresolved and it reaches Albert at 90 min, so an absent fallback is visible, not silent.
- **Windows differences the fixer must respect:** failures that only occur on Windows shards (path separators, `isMainModule` checks — see shared-db PR #3668, WSL `bash`) are real failures, not infrastructure; the watchdog never re-runs them. Windows runner capacity is tracked in ai-devops #185, #961 (WarpBuild Azure Windows CI) and #963 (admit EDGE-DEV); Windows runner-queue monitoring is NOT in this plan (it belongs to #961/#185); the watchdog only avoids dispatching a code fixer for failures whose job ran on a Windows runner and timed out.

## 5. Does anything notice stuck work today? — Answer: partially, and nothing clears or reassigns

Existing scheduled workflows in shared-db (read their headers in `.github/workflows/`):

| Workflow | Cadence | What it does | Clears / reassigns? |
|---|---|---|---|
| `orchestrator-no-progress-alarm.yml` | every 30 min | Comments on the orchestrator marker when an orchestrator-owned outcome has no stage change for 120 min | No — comment only, orchestrator outcomes only, not ordinary PRs |
| `reviewer-start-watch.yml` | every 5 min | Checks reviewer relay liveness | No — reviewer starts only |
| `author-lane-abandonment-audit.yml` | hourly | Flags expired author lanes with work queued behind | Report only |
| `queue-hygiene-report.yml` | daily | Unlabelled issues, expired leases, aging work | Report only |
| `handoff-stale-report.yml` | weekly | HANDOFF.d files whose issue closed | Report only |

Local tools: `ai-blocker-watch wait` wakes the *same* session when a condition clears; if that session is dead or the condition is a red check that never clears by itself, nothing happens. `ai-pr-wait` polls one PR inside a turn. **No component looks across all open PRs for "red + nobody acting" and does anything about it.** That is the gap.

## 6. Root cause

Ownership of a red check is implicit (the session that pushed it). Sessions end turns, crash, or wait on each other; red checks caused by infrastructure (quota, runner loss) never clear by themselves; alarms that exist only comment in places no session is watching, and nobody tells Albert.

## 7. Rejected approaches

- **More local pollers per session.** Rejected: they are what exhausts the API quota (companion plan §6.1).
- **Auto-merge by the watchdog.** Rejected: merge authority stays with the governed review + merge queue; the watchdog only re-runs, dispatches, and notifies.
- **Paging Albert for every red check.** Rejected: he is not a programmer; notify only when automation could not resolve within 90 min (the single authoritative threshold).
- **Extending the orchestrator no-progress alarm to all PRs.** Rejected: owner ruling §0.0-C keeps monitoring out of orchestrator scope.

## 8. Design decisions

Locked:
- Definition of **stuck**: open, non-draft PR where (a) a required check is failing or the PR is BLOCKED/ejected from queue, and (b) no *owner activity* for ≥ 30 min. Owner activity = a new head commit, a review, or a comment by any login other than the watchdog's GitHub App bot (`stuck-work-watchdog[bot]`); never `updatedAt` (bot comments, including the watchdog's own, bump it — the refactor plan already warns about this). Timeline: detected by 30–45 min (cron */15), re-run or fixer at detection, Albert told at 90 min if unresolved, proof threshold 120 min. Draft PRs older than 3 days with no activity are "abandoned" (report only).
- Home: a new scheduled workflow in `popcre/ai-devops` (`.github/workflows/stuck-work-watchdog.yml`, cron `*/15`), because it covers both repos and is tooling, not database shape. Uses `repository(owner,name){pullRequests(states:OPEN)}` GraphQL (not `search`, which is eventually consistent — the reason `orchestrator-marker-guard.yml` avoids it). Budget: GraphQL is charged in points, so page `pullRequests(first:25)` with `statusCheckRollup(contexts:first 50)` and stop at 400 points per run (well under the App's 5,000 points/hour); plus at most 20 REST log fetches per run.
- Actions, in order: (1) first open or refresh the PR's single `stuck-fixer` dedupe issue (below), which is the only store for every watchdog marker; then, for an infrastructure failure (log matches rate limit / runner lost / 5xx) → re-run failed jobs once per head SHA; (2) otherwise → open a `stuck-fixer` issue in the PR's repo (dedupe: exactly one open issue per PR, found by a hidden `<!-- stuck-fixer:PR -->` marker authored by the App bot, refreshed in place; the rerun-once and `Owner:` markers are stored in that issue's body, not in PR comments, so no comment window can hide them; if that issue cannot be read, do nothing this run) and comment once per head SHA `Owner: stuck-fixer #<n> since <EDT>` on the PR; the fixer is a scheduled Claude cloud routine (created with the `schedule` skill, every 30 min) whose brief is: take the oldest open `stuck-fixer` issue that carries the `ready-for-fixer` label and not `fixer-attempted` (issues without `ready-for-fixer` are marker stores only and must be ignored), label it `fixer-attempted` before starting, and after one failed attempt leave it for Albert's notice (never retried automatically), check out the PR branch in its own worktree, make required checks green without weakening any gate, push, and close the issue or comment its blocker; (3) at 90 min unresolved → notify Albert.
- Credential and identity: a dedicated **GitHub App** `stuck-work-watchdog` installed on popcre/shared-db and popcre/ai-devops, so it has its own bot login distinct from every session (sessions all act as u2giants). Permissions: `actions:write`, `checks:read`, `pull_requests:read`, `issues:write`, `contents:read`, `administration:read` (needed to read branch rules; a fine-grained PAT is not proven for GraphQL `branchProtectionRule` here — see `scripts/lib/required-check-authority.mjs`). App id and private key in 1Password vault `vibe_coding`, item "stuck-work-watchdog GitHub App"; Actions secrets `WATCHDOG_APP_ID` / `WATCHDOG_APP_KEY` in ai-devops, token minted per run. The rerun marker and `Owner:` comments are trusted only when authored by the App bot login; any other author's copy is untrusted text. The fixer routine uses its own environment's GitHub connection (a normal session identity pushing to the PR branch, never to `main`); it holds no watchdog credential.
- Notification channel: one GitHub issue `Stuck work — <date>` per day in ai-devops, assigned to u2giants, updated in place (no email spam). Plain English, one line per item: "PR #3567 blocked 3 h on the merge-queue check; fixer Codex dispatched 2:10 PM EDT; no progress."
Open: whether Albert also wants a phone push (ntfy/Pushover) — default off; decide by asking him once in the Step 4 PR.

## 9. Steps

### Step 1 — Detector
`scripts/stuck-work/detect.mjs` (ai-devops): GraphQL `repository(owner,name){pullRequests(states:OPEN,first:25, after:$cursor){... isDraft, mergeStateStatus, headRefOid, commits(last:1){committedDate}, statusCheckRollup, reviews(last:1){submittedAt}, comments(last:20){author{login} createdAt}}}` — never `search`, never `updatedAt`. Request `rateLimit{cost remaining}` in each page; page through all open PRs; if the 400-point per-run cap would be hit before the set is complete, record `incomplete=true` in the report and continue from the saved cursor next run (never treat unseen PRs as not stuck). Owner activity = latest of head commit date, last review, last non-bot comment (§8). Output `stuck-report.json` artifact and a job summary table.
Gate: fixture test with PR #3567-shaped data classifies it stuck; a PR whose only recent comment is the watchdog's own stays stuck; a green PR and a 10-min-old red PR are not.

### Step 2 — Auto re-run of infrastructure failures
For each failed check, fetch the failed step log tail (1 call), match patterns (`API rate limit exceeded`, `quota`, `The runner has received a shutdown`, `HTTP 5\d\d`). Patterns are exact strings only: `API rate limit exceeded`, `installation quota low`, `The runner has received a shutdown signal` (no bare `quota` or `5xx`, which match real test output). If matched, the reset time printed in the failed log itself has passed (`scripts/check-actions-quota.mjs` prints "the quota resets at <time>"; the transport latch prints its reset too) — never the watchdog's own `rate_limit`, which is a different token's budget. A reset time printed within 120 seconds of the failure is the transport's fail-closed latch (`UNKNOWN_RESET_LATCH_MS`, 60 s), not a real reset, and is ignored; if no real reset time is printed, wait until 65 minutes after the failure (the installation window is hourly) — and no re-run yet for this head SHA (tracked by a `rerun:<SHA>` line in the PR's `stuck-fixer` dedupe issue body, written before the re-run; if that issue cannot be read or written, no re-run), `gh run rerun <run-id> --failed` (never `workflow_dispatch`). For a `merge_group` run, do not re-run; the queue re-forms the group itself.
Gate: fixture of today's four quota-failure logs → re-run; a real test failure log → no re-run.

### Step 3 — Fixer dispatch
If the failure is an expired migration author lease or lane recovery (`claim #N is expired`, `author capacity is expired-unconfirmed` from `scripts/check-migration-pr-lease.mjs`), do NOT dispatch a fixer: relinquishment is a guarded manual action (`author-lane-abandonment-audit.yml` header), so it goes straight to Albert's daily notice as an owner decision. Otherwise, if still red after re-run, or the failure is real, and no re-run is waiting for a quota reset, add the `ready-for-fixer` label (the only fixer dispatch signal; never added for quota-wait or lease-expiry items) and: open/refresh issue labelled `stuck-fixer` with PR link, failing check, log excerpt (≤ 20 lines, secrets-scrubbed), and a self-contained brief ("make this PR's required checks green without weakening any gate; never push to main"). Comment on the PR `Owner: stuck-fixer #<issue> since <EDT>`. The fixer is the scheduled routine defined in §8. If the PR author session resumes and pushes, the watchdog stands down (activity resets the clock).
Gate: dry-run mode on live repos lists exactly the currently-stuck PRs; one real dispatch fixes a seeded red PR in a sandbox repo.

### Step 4 — Notify Albert
Daily issue updated in place; only items stuck > 90 min with no successful fixer progress. Each line: what, since when (EDT), who holds it, what happens next.
Gate: screenshot of the issue with a seeded item.

### Step 5 — Local side
`ai-pr-wait`: after 10 min, stop polling, register with `ai-blocker-watch` (existing rule #723) and exit; the watchdog is the backstop if the session never returns. Remove per-session background reviewer loops that outlive their session (kill on session end via pidfile).
Gate: `ps` count of waiter processes on a host with 5 sessions ≤ 5.

### Step 6 — Proof
Seven days of `stuck-report.json` artifacts show the outcome, not the watchdog's own activity: median time from first red required check to green or to a recorded owner decision is under 60 min, and the count of PRs red for more than 2 h with neither is zero. An `Owner:` comment is an intermediate state, never a success. Record in `tests/verification/stuck-watchdog-7day-<date>.md` (ai-devops).

## 10. Tests
- `tests/stuck-work/detect.test.mjs`: stuck / not-stuck / draft-abandoned / queue-ejected cases.
- `tests/stuck-work/classify-failure.test.mjs`: infrastructure vs real, using real log fixtures from runs of 2026-09-28.
- `tests/stuck-work/rerun-once.test.mjs`: second run on same SHA does not re-run again.

Adversarial cases (untrusted input = PR bodies, comments, logs):

| Input | Hostile case | Test |
|---|---|---|
| PR comment | forged `rerun:<SHA>` line in a `stuck-fixer` issue edited by a non-bot author | rerun-once.test "marker only trusted from the workflow bot" |
| Log excerpt | contains a token | detect.test "excerpt passes secret scrubber" |
| PR body | prompt-injection text in the fixer brief | fixer brief quotes PR body as data inside a fenced block; test "brief never inlines body as instruction" |
| Check name | a check named like a required one from a fork | classify-failure.test "only required contexts from branch rules count" |

## 11. Constraints
Watchdog never merges, never force-pushes, never edits gates, never touches production/database. Uses the watchdog GitHub App (§8), never the Actions token for cross-repo work. Sign posts `Posted by stuck-work-watchdog (ai-devops)`. Times in EDT. Code changes go through normal checks and governed review.

## 12. Access
`gh` as u2giants (popcre admin). One new credential: the watchdog GitHub App (1Password vault `vibe_coding`, item "stuck-work-watchdog GitHub App"; creating the App needs Albert's approval). The fixer routine uses the credentials its cloud environment already has.

## 13. Done / risks
Done: six STATUS rows cite artifacts; Albert sees the daily stuck issue.
Risks: re-run loops burning quota (mitigated: once per SHA, quota floor); fixer fights the original session (mitigated: activity resets, `Owner:` comment). Rollback: disable the workflow.

## 14. Is GitHub the right fit for this many-agent workflow? — Recommendation

The failure today is not GitHub's merge model; it is (a) coordination re-implemented as ~16 required custom checks that each scan the API and starve the Actions token, (b) no owner for a red check, and (c) slow, contended Windows runners. Any option must fix those three.

Prices are approximate public list prices as of 2026 and must be re-checked before buying.

| Option | Fixes (a) quota/gates | Fixes (b) no owner | Fixes (c) Windows | Cost | Migration effort |
|---|---|---|---|---|---|
| **GitHub + native merge queue, rulesets consolidated, this watchdog, WarpBuild/self-hosted Windows runners** | yes (companion plan) | yes (watchdog) | yes (#961/#963) | ~$0 new platform cost; runner minutes (WarpBuild Windows, roughly cents per minute) | none — work already in flight (refactor Steps 6/8, #961) |
| GitHub + Mergify | partly (its queue/batching; still runs same checks) | no (it merges, doesn't fix) | no | ~$20–30 per active user/month | low (config file), but duplicates native queue work already built |
| GitHub + Graphite | no (stacking, not coordination) | no | no | ~$20–40 per user/month | low–medium; agents must learn its CLI |
| GitHub + Trunk merge queue | partly (parallel/batched queue, flaky-test quarantine) | no | no | free tier; paid ~$ per seat | low; replaces native queue |
| GitLab (SaaS Premium or self-managed) | only by rewriting the same gates as GitLab CI | no | needs its own Windows runners | ~$29 per user/month Premium | very high: 49 workflows, rulesets, sync to four app repos, every tool in ai-devops speaks `gh` |
| Gitea/Forgejo self-hosted | Actions-compatible, own API with no quota | no | own runners | server + admin time | very high, plus Albert becomes operator of a critical service |
| Linear (or similar) as the agent task queue | no (code still lands via GitHub) | partly (assignment and SLAs) | no | ~$8–14 per user/month | medium; duplicates GitHub Issues that already hold the queue, markers and owner rulings |
| Trunk-based with a single integrator agent | yes (one lander) | yes | no | agent cost | medium; single point of failure for four apps |

**Recommendation: stay on GitHub with no new vendor.** Finish the native merge queue (refactor Step 8, PR #3567 / #2530) and required-check authority (Step 6), cut API spend with the companion plan, add this watchdog as the owner of stuck work, and move Windows CI off interactive machines via ai-devops #961 (WarpBuild) / #963. Cost: runner minutes only; migration effort: none beyond work already planned. Every alternative either adds a vendor that does not fix "no owner" (Mergify, Graphite, Trunk, Linear) or requires rewriting the entire toolkit (GitLab, Forgejo). Revisit a single integrator agent only if, after the 7-day proof in Step 6, PRs still wait more than two hours on each other.

## Self-audit
1. Fresh session can execute? Yes — definitions (§8), files and gates per step (§9), tests named (§10).
2. Background and rejections carried? Yes — §5 inventory of existing partial alarms, §7 rejections, §14 alternatives.
3. Goal clear? Yes — §1: within 45 min something re-runs or reassigns; by 90 min Albert is told.

## Review record (2026-09-28)
Grok REVISE / Qwen REJECT findings on this plan: SLA/idle/notify timings contradicted each other and `updatedAt` is bumped by the watchdog's own comments; `search` is eventually consistent; repo-scoped `GITHUB_TOKEN` cannot act across repos; fixer route unnamed; loose log patterns would re-run real failures; merge_group re-runs; §14 should frame the recommendation as finishing refactor Steps 6/8. All incorporated in §1, §8, §9, §11, §12, §14. The §5 inventory and adversarial table were confirmed accurate by Qwen.

Second round (2026-09-28): Grok confirmed first-round watchdog defects resolved except Step 1 still naming `search`/`updatedAt`; fixed in Step 1.

Third round (2026-09-28): Qwen REJECT — watchdog could not be told apart from sessions (same login), token scopes lacked administration:read, Windows queue report had no step, 60 vs 90 min contradiction. Fixed: GitHub App bot identity with named permissions, Windows queue monitoring moved out of scope, single 90-min threshold, fallback absence made visible.

Fourth round (2026-09-28): Qwen REJECT — re-run precondition read the wrong token's quota; fixer livelocked on expired leases; no dedupe for */15 writes. Fixed: reset time read from the failed log, lease expiry routed to Albert, one attempt per issue with `fixer-attempted`, one issue per PR and one `Owner:` comment per head SHA.

Fifth round (2026-09-28): Qwen REJECT (Grok APPROVE) — reset time not always printed; 7-day proof was self-satisfying; markers could fall out of the comment window; budget in queries not points. Fixed in Steps 2, 3, 6 and §8.

Sixth round (2026-09-28, Grok REVISE on head 514f0e0c): rerun marker had no home before the dedupe issue existed; Step 1 query contradicted the point budget; the 60 s latch reset was trusted as a real reset. Fixed in §8, Steps 1–2 and §10.

Seventh round (2026-09-28, Grok REVISE on head 932a7331): fixer could claim marker-only issues (quota waits, lease expiry). Fixed: fixer picks up only issues labelled `ready-for-fixer`, added solely at Step 3 dispatch.
