# Plan: three prevention changes for the go-live lane

Freeze the merge window across the whole go-live · classify infrastructure failures so they stop burning a change's attempts · make every stall loud within the hour.

Session handoff (read together with this plan): [`HANDOFF.d/20261105T2302Z-edge-dev-mimo-go-live-prevention-plan.md`](HANDOFF.d/20261105T2302Z-edge-dev-mimo-go-live-prevention-plan.md). Tracking issue (carries `- [ ] live proof`): [#5782](https://github.com/popcre/shared-db/issues/5782).

## STATUS

| # | Step | State | Evidence (artifact, never a bare number) |
|---|------|-------|------------------------------------------|
| 1.1 | Wire `--acquire-promotion-freeze` into the qualification job before the risk assessment | ✅ done 2026-11-06 | PR #5838 (head `a786cec1b`, merge `083a5866c`): acquire step before `qualify-route` in `shared-supabase-migrations.yml`, same guarded source PR as the `always()` release, `--issue` from `--resolve-admitted-issue-for-pr`; CI green — https://github.com/popcre/shared-db/actions/runs/42169923794 |
| 1.2 | Keep the per-PR release + TTL guarantees; document the crash-recovery command | ✅ done 2026-11-06 | Release block verified unchanged (`if: always() && inputs.source_pr != ''`, `continue-on-error: true`); recovery command in the acquire-step comment; TTL/expiry + unreadable-record recovery unit-proven in `manage-migration-coordination.test.mjs` (341 tests green). Staged run-cancellation proof rides the 4.2 live-proof window |
| 1.3 | Workflow-content + lane tests for the freeze window | ✅ done 2026-11-06 | PR #5838: acquire-before-`qualify-route` + release-under-`always()` assertions in `check-merge-queue-workflows.test.mjs`; record pr/issue/owner + different-PR-release-refuses cases and the 4-command acquisitions invariant in `manage-migration-coordination.test.mjs`; guarded-read count 6 in `check-workflow-automatic-promotion-source.test.mjs` |
| 2.1 | Emit a machine-readable fault-classification marker step on infrastructure / coordination failures | ✅ done 2026-11-06 | PR #5911 (head `b9d07c38d`, merge `74e4c8d59`): `refund-eligible-fault` STEP in `preview` and `Production apply (automatic evidence gates)` (never a job — the run-shape invariants hold), `if: failure()`, classifying its own job's failed-step logs through `scripts/refund_fault_classification.py` (pinned in the preview executed surface, `production_business_risk_gate.py`). A SUCCESSFUL conclusion of the step is the marker. CI: SQL migration guards https://github.com/popcre/shared-db/actions/runs/42268083357 |
| 2.2 | Make the selector refund classified failures out of the attempt count (per-attempt evidence stays intact) | ✅ done 2026-11-06 | PR #5911 (`74e4c8d59`): `refund_eligible_in_any_attempt` (judged per attempt; any attempt suffices — a re-run never hides an earlier classification) plus the #5856 staleness classifier draw from ONE refund budget; refunded runs keep all evidentiary weight (`applied` / `preview` reads untouched). Tests: `python -m unittest scripts.test_automatic_promotion_candidates` 123 green — Tools offline tests https://github.com/popcre/shared-db/actions/runs/42268083538 |
| 2.3 | Cap refunds (default 3 per change), then park with the existing ENGINEER ACTION REQUIRED channel | ✅ done 2026-11-06 | PR #5911 (`74e4c8d59`): `MAX_REFUNDS = 3` per change since merge; the classified failure that finds the budget empty parks through the existing channel with `3 refunds used, now parked (refund cap 3 per change)`, and the stuck-change tracking issue carries it. Decision recorded in §8 below |
| 2.4 | Adversarial-case tests for the classifier and the refund | ✅ done 2026-11-06 | PR #5911 (`74e4c8d59`): every §9 2.4 row has a test — mixed-marker log (`CI INFRASTRUCTURE:` + SQL `ERROR:` without `NO MIGRATION WAS APPLIED`) never refunds; a missing marker stays status quo; runs of other workflows never count; a re-run never hides an earlier attempt's classification; both fault classes refundable up to the cap; alien run titles and pre-merge runs never count |
| 3.1 | Diagnose and repair the daily queue-hygiene report (exit 2, failing since 2026-11-01) | ✅ done 2026-11-06 | Root cause: issues #5608/#5609 carry `db-work-scope` fences used as live-proof routing metadata (no ready/blocked/owner-decision status) — a readable-but-invalid state the reader misfiled as "could not read". PR #5921 (merge `f1736f474`): a malformed scope is a loud `MALFORMED db-work-scope` finding and the run stays exit 0; genuine unreadable queue state still exits 2 (both shapes regression-tested). Verified live: workflow_dispatch https://github.com/popcre/shared-db/actions/runs/42283628072 **green** — the instrument reads again after five days of silence |
| 3.2 | Extend the no-progress alarm to promotion-lane stalls (held > 60 min, exhausted, no apply progress > 60 min) | ✅ done 2026-11-06 | PR #5921 (`f1736f474`): the 30-minute tick also evaluates, read-only (selector `--dry-run` + three single API reads — the selector never writes): a PR held by a review finding > 60 min (finding named), a change out of automatic attempts (the ENGINEER ACTION REQUIRED text verbatim), and a starved lane (candidates exist, no successful apply in 60 min). Transition-only preserved — claim-first alarm keys derive exactly as before; promotion rows are their own key component. One staged canary per class in `scripts/db-flow/no-progress-alarm.test.mjs` (21 green) |
| 3.3 | Alarm channel for "report could not run" and for frozen-merge complaints | ✅ done 2026-11-06 | PR #5921 (`f1736f474`): a Queue Hygiene Report run concluding failure is named as "the instrument could not run" ("silence is never a clean queue"); the `merges are paused for a production run; …` complaint (verbatim `assertNoPromotionFreeze` wording) is named whenever a promotion freeze has been live over 15 min. Staged canary run https://github.com/popcre/shared-db/actions/runs/42283735099 posted `STAGED CANARY` on #5782 whose promotion-lane section named real state (PR #5885 "3 refunds used, now parked (refund cap 3 per change)") |
| 4.1 | Land each change as its own PR, CI green, on top of the in-flight work named in §5 | ✅ done 2026-11-06 | Three sequential PRs through the merge queue: #5838 (Phase 1, merge `083a5866c`), #5911 (Phase 2, merge `74e4c8d59` — built on the merged #5856 staleness fix #5877, which it extends with the plan's cap), #5921 (Phase 3, merge `f1736f474`). No step was duplicated from the in-flight work; the one collision (the truth-audit catalogue re-review) is carried in #5877's own head |
| 4.2 | Live proof on the tracking issue (`- [ ] live proof` until then) | ✅ done 2026-11-06 | Captured on #5782 and the box checked: freeze created before qualification and released after apply (2026-11-06 go-live of PR #5619 — runs 42240703300 / 42241380486, record `pr=5619 issue=5608`), and one real refunded failure in the live selector trace (PR #5885: three refunds then "3 refunds used, now parked (refund cap 3 per change)"; PR #5857: two refunds — surfaced by canary run 42283735099) |
| 4.3 | Update this STATUS table and the handoff after each landing | ✅ done 2026-11-06 | Rows 1.1–2.4 landed with PR #5911; rows 3.1–4.3 and the final live-proof note land with this closeout, which also retires `HANDOFF.d/20261105T2302Z-edge-dev-mimo-go-live-prevention-plan.md` per its successor rule (issue closed in the same PR, outcome verified, nothing left open) |

**Where a fresh session starts:** read §1–§8 first (they are the thinking; do not re-derive it), then step 1.1. Before touching any file named in §5, re-run the in-flight collision check in §11 — two other workstreams are live in this exact machinery right now.

---

## 1. The ultimate goal

When this is done, a database change that has been reviewed, rehearsed and merged reaches production the same day — even on a day when other work is merging every few minutes. A change is never punished for the test machines having a bad day. And whenever anything in this pipeline gets stuck, a loud, human-visible alarm appears within an hour — never silence.

If a step conflicts with this goal, the goal wins — stop and flag it.

## 2. What this application is

`popcre/shared-db` is the shape-of-database repository for POP Creations' shared Supabase project. It has no application runtime: the "product" here is the go-live machinery — GitHub Actions workflows plus Node/Python scripts that rehearse each schema change on a preview database, qualify it for risk, and apply it to production (project `qsllyeztdwjgirsysgai`; preview project read from the `PREVIEW_PROJECT_REF` repository variable). All four consumer apps (CRM, DAM, PM/PIM, DesignFlow) read the same tables, so the machinery's job is to get changes live safely and predictably.

Work rules for this repo (from `AGENTS.md`): every write happens in a **git worktree cut from `origin/main`** (never in the shared landing checkout), lands as a branch + pull request, and the AI merges the PR itself once checks pass. Reviews are advisory. Do not push to `main` directly.

## 3. What triggered this work

On 2026-11-05 (all times EST) the go-live lane stalled twice in one day, and the owner asked for a plan to make it never happen again ("how do we fix now and how do we prevent this from ever happening in the future?").

- **Morning, 9:07–11:35 AM EST.** One merged batch (PR #5623, versions `20261105073854`, `20261105073903`, `20261105073911`, `20261105073920`) was dispatched for production apply **seven times** and refused every time with `production lane requires the exact current main SHA or a verified prefix of it` (thrown at `scripts/lib/lanes/exclusive-locks.mjs:236`). Each retry re-dispatched at a then-current commit and lost the race again, because other work merged to `main` every few minutes. The batch was then retired from the automatic lane (`HARD_BLOCKED`, `scripts/production_migration_guard.py:72-73`) and its replacement is being built under issue #5622 (open PRs #5719, #5721, #5733).
- **Afternoon, 3:46–4:40 PM EST.** A second change (PR #5686, version `20261105142616`) failed its post-merge preview rehearsal **seven times**. Two failure classes: `CI INFRASTRUCTURE: PostgreSQL client unavailable after N attempts (apt mirror stall on the hosted runner -- NOT a fault in the change under review); NO MIGRATION WAS APPLIED`, and a curation witness refusal (`Unchanged approved parent/source witness unavailable; packet abstained`). It was retired the same way (`HARD_BLOCKED`, `scripts/production_migration_guard.py:71`) and its replacement is issue #5683 (open PR #5720).
- **All day.** Two older PRs sat held by review findings for ~17 hours (`##[error]PR #5630 (versions 20261105042549) held 1036 min by #5631`, `PR #5619 held 1008 min by #5620`) as log annotations nobody reads.
- **Since 2026-11-01.** The daily Queue Hygiene Report — the one instrument designed to catch "work lost to administrative silence" — has itself failed every run (exit 2, `The queue hygiene report COULD NOT RUN`), five days in a row (run ids 41301477968, 41446018631, 41632293264, 41827856243, 42027627758). Nobody noticed, which is the third prevention change in one sentence.

Observed environment: GitHub Actions on `popcre/shared-db`, production apply runs titled `DB production apply <sha> PR<n> <versions>`, preview runs `DB preview apply …`.

## 4. Scope

**In scope (three changes, three sequential PRs):**

1. **Freeze window (change 1).** Acquire the existing promotion merge freeze automatically before the production-risk assessment and release it when the production run ends, so `main` cannot move under a go-live between qualification and apply.
2. **Attempt-fault classification (change 2).** Failures classified as infrastructure or coordination faults (the marker strings in §6) must not consume a merged change's automatic-attempt budget, with a hard cap on refunds.
3. **Loud stall alarms (change 3).** Repair the queue-hygiene report; extend the existing no-progress alarm to promotion-lane stalls; route "the instrument could not run" to the same loud channel.

**NOT in this plan (do not let it grow):**

- The `narrow-promotion-freezes` work (issue #4039, `plan_narrow-promotion_freezes.md`) — that plan narrows freeze scope; this plan only **extends the existing freeze earlier in the same run**. Do not open admission exceptions, do not relitigate its locked scope.
- Any change to `HARD_BLOCKED` policy, to the retirement of the four `2026110507…` versions or `20261105142616`, or to the rebuild work in issues #5622 / #5683 (PRs #5719, #5720, #5721, #5733 already carry those).
- Weakening or bypassing the production gate (`scripts/production_business_risk_gate.py`, `scripts/production_migration_guard.py`) — a standing constraint from the #5324 engineer action ("Do NOT weaken the production gate").
- Supabase schema/migration changes of any kind. This plan changes workflow YAML, Node/Python scripts, tests and docs only.
- The review system, the review-fixer, merge-queue configuration, or `configure-merge-queue.mjs`.
- A new scheduler, broker, or monitoring service. Reuse what exists.

## 5. Current state of the code

Everything below is committed and live on `origin/main` as of commit `55f6e6a59` (2026-11-05 evening). Nothing from this plan is implemented yet; this document is the first artifact.

**The freeze machinery exists and is complete — it is simply never turned on.**

- `scripts/lib/lanes/exclusive-locks.mjs:372-373` — `PROMOTION_FREEZE_REF = 'refs/db-coordination/promotion-freeze'`, `PROMOTION_FREEZE_MAX_TTL_MINUTES = 60`.
- `scripts/lib/lanes/exclusive-locks.mjs:375-392` — `readPromotionFreeze`: an unreadable record **fails closed** (treated as live) and is cleared only by `--release-promotion-freeze`.
- `scripts/lib/lanes/exclusive-locks.mjs:406-415` — `freezeTolerantMerge`: path-scoped tolerance (production-inert paths, or **added** `supabase/migrations/<14digits>_*.sql` / `supabase/tests/*.sql` merge through the freeze).
- `scripts/lib/lanes/exclusive-locks.mjs:417-419` — `assertNoPromotionFreeze`, called from merge acquisition at `exclusive-locks.mjs:354`; merge acquisition also refuses outright while the production lane ref is held (`exclusive-locks.mjs:353`, `production promotion is active; merges are frozen`).
- `scripts/lib/lanes/exclusive-locks.mjs:422-441` / `:443-444` — `acquirePromotionFreeze` (create-only ref, TTL 1–60 minutes) and `releasePromotionFreeze` (per-PR or per-owner; an unreadable record is released by any positive `--pr`).
- `scripts/manage-migration-coordination.mjs:2180-2181, 2267-2268` — CLI surface: `--acquire-promotion-freeze --issue N --pr N --owner TEXT --ttl-minutes N`, `--release-promotion-freeze --pr N`.
- `scripts/lib/lanes/exclusive-locks.mjs:366-371` — the design comment, including two owner quotes (see §8).

**The production apply workflow already releases the freeze — and nothing acquires it.**

- `.github/workflows/shared-supabase-migrations.yml:1109` — job `Automatic production qualification and dispatch`; `:1310` runs `python scripts/production_business_risk_gate.py qualify-route` (the production-risk assessment).
- `.github/workflows/shared-supabase-migrations.yml:2274-2283` — release steps at the end of the production apply job (`--release-production`, then `--release-promotion-freeze --pr "$SOURCE_PR"` under `if: always()`), with the comment: *"A session may set the freeze for this source PR before drawing the risk assessment; the run ending ends it."*
- **Verified 2026-11-05 by ripgrep: `--acquire-promotion-freeze` has zero callers under `.github/` and `scripts/` outside its own CLI wiring and tests.** The only workflow reference to the freeze is the release at `shared-supabase-migrations.yml:2291`. The acquire is a manual, optional, session-run command — never part of the automatic lane. This is the gap.

**The pin checks that refused the morning batch:**

- `scripts/dispatch-production-apply.mjs:122-123` — at dispatch: `--commit-sha` must be the current `origin/main` or a verified prefix ("#4845: a verified prefix of main is dispatchable; the workflow re-proves it").
- `scripts/lib/lanes/exclusive-locks.mjs:233-236` — at production-lane acquisition inside the run: exact current main SHA or verified prefix, else `production lane requires the exact current main SHA or a verified prefix of it`. `productionPrefixOk` (`exclusive-locks.mjs:400-404`) accepts only production-inert movement or migrations appended strictly after the dispatched ledger; anything else (including the workflow/script commits that landed every few minutes on 2026-11-05) refuses.
- `scripts/check-main-tip-freshness.mjs` (`classifyMainTip`, production mode) is the authority behind `productionPrefixOk`; see `scripts/check-main-tip-freshness.test.mjs:483-501` for the verified-prefix semantics.

**Attempt counting (why seven infra failures buried a good change):**

- `scripts/automatic_promotion_candidates.py:55-56` — `MAX_ATTEMPTS = 3`, `ALERT_AFTER = timedelta(minutes=30)`.
- `scripts/automatic_promotion_candidates.py:293-304` — attempts counted **per change since its merge, across the whole automatic cycle** (preview and production runs both count; any conclusion other than `success` counts). The comment records the 2026-11-05 decision that attempt counters must not reset on unrelated `main` advances ("A cure for a stuck change is a new governed version, which is a new candidate") and why the whole cycle counts (#5532: a failed production apply re-enters through a recovery preview that succeeds by design).
- `scripts/automatic_promotion_candidates.py:304-310` — at `attempts >= MAX_ATTEMPTS` the PR is passed over and collected as `out_of_attempts`; `:438` prints `::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::…` — a **workflow-run annotation**, visible only to someone who opens the run.
- `scripts/test_automatic_promotion_candidates.py` is the unit suite (unittest style).

**Alarms that exist today:**

- `.github/workflows/no-progress-alarm.yml` — every 30 minutes (`7,37 * * * *`), posts **transition-only** comments on the claim-first session identity for owned outcomes with no stage transition for 120 minutes / nothing closed in 4 hours. It has staged-canary inputs (`post_issue`, `now`, `staged_label`) usable for proof. It does **not** look at the promotion lane (held PRs, exhausted attempts, stalled applies).
- `.github/workflows/queue-hygiene-report.yml` + `scripts/queue-hygiene-report.mjs` (+ `scripts/queue-hygiene-report.test.mjs`) — daily 04:23 UTC, strictly read-only by construction (`hygieneReportIo` strips every mutation hook). Exit semantics: 0 = report produced (a backed-up queue is not a failure); **2 = the instrument could not read the queue and must never be mistaken for a clean queue**. It has exited 2 every day since 2026-11-01.
- The selector's `held` alerts (`##[error]PR #5630 … held 1036 min`) are also annotations only.

**In-flight work a fresh session MUST read before editing (collision surface):**

- Open PR #5733 (`codex/index-maintenance-early-pin-5622`, "Preserve safe index maintenance across irrelevant main advances") touches `scripts/lib/lanes/exclusive-locks.mjs` — the same file change 1 depends on.
- Local worktree branch `ci-process-repair/step-2-3-stuck-change-owner` (in `D:/repos/shared-db-worktrees/ci-2.3-stuck-change-owner`, +153 lines, unpushed at plan time) already adds `report_stuck_change()` to `scripts/automatic_promotion_candidates.py`: the selector opens/updates **one** tracking issue titled `Automatic promotion: stuck migrations need repair` for exhausted PRs. That is a large part of change 3. Do not duplicate it — land behind it and extend it.
- Sibling branches `ci-process-repair/step-1.6-advisory-gates`, `step-2.1-paperwork`, `step-2.2-trigger-reporting`, `step-2.4-catalog-check` sit in `D:/repos/shared-db-worktrees/` and touch the same CI surface.
- Rebuild PRs #5719 / #5721 (issue #5622) and #5720 (issue #5683) are the live replacements for the two retired batches; they are context, not collision, unless they touch `exclusive-locks.mjs` or the selector.

## 6. Key findings and root cause

1. **The morning starvation was a missing wire, not a missing safety rule.** The freeze exists precisely so "main does not move in a way the running production gate would refuse" (`exclusive-locks.mjs:397-399`) and merge acquisition already honors it (`:354`). But `--acquire-promotion-freeze` is never invoked by any workflow (ripgrep proof in §5), so during qualification→dispatch→apply `main` moved freely, every dispatched SHA went stale before production-lane acquisition (`:233-236`), and each retry lost the race again. The release is wired (`shared-supabase-migrations.yml:2291`); the acquire is not. That single asymmetry is the incident.
2. **The verified-prefix escape hatch cannot absorb a busy day.** `productionPrefixOk` tolerates only production-inert movement and migrations appended strictly after the dispatched ledger (`exclusive-locks.mjs:400-404`). On 2026-11-05 `main` advanced with workflow/script changes (see the day's commit log: dozens of `.github/workflows/*` and `scripts/*` changes), so every prefix check refused. Do not "fix" this by widening the prefix rule — see §7.
3. **Attempt counting has no fault model.** `automatic_promotion_candidates.py:296-304` counts every non-`success` run against the change. The preview workflow already emits the truth in machine-readable form (`::error::CI INFRASTRUCTURE: … NOT a fault in the change under review); NO MIGRATION WAS APPLIED`), and the production-lane refusals of §3 are likewise coordination faults — but nothing reads those markers. Seven infra failures on PR #5686 exceeded `MAX_ATTEMPTS = 3` and parked it.
4. **Every alarm today is a workflow-run annotation or a nightly report nobody sees.** The selector alerts (`:438`, held alerts), the ENGINEER ACTION REQUIRED idle message (`:316-319`) and the queue-hygiene report all fail *quietly* when they matter. The report's own header names this risk ("Revisit only if the daily report proves too easy to ignore (plan §8 open question)") — and it then spent five days exiting 2 unwatched. The no-progress alarm proves the repo already knows how to post a loud, transition-only comment; it just doesn't watch this lane.

## 7. Approaches considered and REJECTED

- **Widen the pin check (accept any ancestor commit at the production gate).** REJECTED. Evidence is bound to the exact dispatched SHA; `#4845`'s verified-prefix rule is deliberately narrow. `plan_narrow-promotion-freezes.md` (locked scope, line 57) records the same constraint: "preview and qualification/lock still require literal equality". Installing a commit nobody evaluated as current is exactly the disaster the gate exists to prevent. **Never weaken the production gate.**
- **Just retry harder on pin refusal.** ALREADY EXISTS, ALREADY FAILED on 2026-11-05: seven dispatches, each at a then-current SHA, each refused minutes later. Retries without a freeze cannot outrun per-minute merges. (The 2026-11-05 change to per-change attempt counting deliberately removed retry-after-unrelated-merge; that decision stands.)
- **Freeze merges across the whole post-merge preview rehearsal too.** REJECTED for this plan. The owner's design comment scopes the pause to "between the assessment and the production run"; extending it through the (longer) rehearsal costs real merge throughput for everyone and starts a fight with `plan_narrow-promotion-freezes.md`. Rehearsal pin races stay covered by re-dispatch plus the change-2 refund.
- **Unlimited retries for infrastructure failures.** REJECTED. #5532 exists so one dead change cannot park the lane forever; unbounded retry reopens that. Refunds are capped (step 2.3).
- **A new standalone "stall monitor" workflow / new alert service.** REJECTED. `no-progress-alarm.yml` already posts transition-only stall comments every 30 minutes with canary inputs for proof; extend it. The repo rule is to reuse shared workflows before adding another copy.
- **Make the queue-hygiene report exit non-zero on a dirty queue, or make it write issues.** REJECTED. Its read-only, write-free-by-construction invariant is load-bearing (`queue-hygiene-report.mjs` header) and "Exit-non-zero-on-dirty-queue is deliberately NOT implemented". Change 3 fixes the instrument and routes its failure loudly; it does not change the invariant.
- **Re-deriving the retirement of the 2026-11-05 batches inside this plan.** REJECTED as out of scope; their governed replacements already exist (PRs #5719/#5720/#5721/#5733). This plan prevents the *class* of failure; it does not re-deliver those batches.

## 8. Design decisions already made

**LOCKED (do not relitigate):**

- **Freeze window = risk assessment → end of the production apply run.** Acquire immediately before `production_business_risk_gate.py qualify-route` (`.github/workflows/shared-supabase-migrations.yml:1310`); the production apply job's existing `if: always()` release (`:2274-2291`) ends it. Owner quotes already in the code comment (`exclusive-locks.mjs:366-371`), Albert Hazan in his chat 2026-10-02 (verbatim): *"assign someone to pause merges during production runs"*; and 2026-10-21 (verbatim): *"no session is allowed to freeze merges for more than 1hr. that's the new rule"*.
- **TTL ≤ 60 minutes** (`PROMOTION_FREEZE_MAX_TTL_MINUTES`, `exclusive-locks.mjs:373`) and never above. Proposed default **45 minutes** (qualification ≈ 2–5 min + production apply ≈ 5–15 min + slack); a shorter TTL that expires mid-run is safe (an expired freeze stops blocking merges; the production lane ref itself keeps merges frozen during the apply, `exclusive-locks.mjs:353`).
- **Path-scoped tolerance stays** (`freezeTolerantMerge`, `exclusive-locks.mjs:406-415`): production-inert PRs and pure added migrations/tests keep merging through the freeze. Only non-inert merges wait.
- **The production gate's pin semantics do not change** (`exclusive-locks.mjs:233-236`, `dispatch-production-apply.mjs:122-123`, `#4845`).
- **Attempts stay bounded per change since merge** (the 2026-11-05 "not per main commit" decision in `automatic_promotion_candidates.py:293-296`); refunds only *classify*, they never unbound.
- **The queue-hygiene report stays read-only and write-free by construction.**
- **One dispatch at a time** remains the selector's rule (`automatic_promotion_candidates.py` module docstring), so the create-only freeze ref cannot see two competing acquires in normal operation.
- **`HARD_BLOCKED` and the two 2026-11-05 retirements are untouched** (`production_migration_guard.py:69-73`).

**DECIDED by the implementer on landing (was OPEN; recorded per §13):**

- **Refund cap for classified failures** (step 2.3) — **DECIDED 2026-11-06: 3 per change since merge** (the default proposal). Parking semantics: the classified failure that finds the cap exhausted parks **immediately** through the existing ENGINEER ACTION REQUIRED channel ("3 refunds used, now parked (refund cap 3 per change)") — this is what the §9 2.3 verification gate names ("4th classified failure parks the change"). The alternative reading (beyond the cap, classify as ordinary attempts and park only at the 6th failure) was rejected because it would not surface persistently broken infrastructure the same day, and §8's own criterion says "after that, park and alert exactly as today". Both fault classes (infrastructure and coordination) share the one budget. If a busy day shows 3 is too tight, the cap is one constant (one-line PR).
- **Where stall alarms post** (step 3.2/3.3) — **DECIDED 2026-11-06: the `no-progress-alarm` channel** (the claim-first session identity, with the stable fallback issue), as proposed. The stuck-change tracking issue (`Automatic promotion: stuck migrations need repair`) remains owned by the selector's `report_stuck_change()` and is named in the alarm's unblock text; the alarm itself posts only on its own transition-only channel so two instruments never duplicate the same comment. Idempotence: claim-first alarm keys derive exactly as before; promotion rows join as their own key component.
- **How the selector learns a run's fault class** (step 2.1) — **DECIDED 2026-11-06: the marker step** (as proposed), named `refund-eligible-fault`, inside the `preview` and `Production apply (automatic evidence gates)` jobs. It is a STEP, never a job (the run-shape invariants at `manage-migration-coordination.mjs` must hold). Classification is per-attempt and survives re-runs (`refund_eligible_in_any_attempt` reads every attempt, the same rule as `applied_in_any_attempt`); the marker is forgeable only by compromising the workflow itself. The classifier lives in `scripts/refund_fault_classification.py`, pinned in the preview executed surface so a doctored copy cannot silently bless a change fault.

## 9. The plan — numbered, executable steps

Phase boundaries are context cut points: **after Phase 1 and again after Phase 2, stop, update the STATUS table, and re-read Phases 2–4 before starting the next phase** (drift check; the repo moves hourly).

### Phase 1 — change 1: freeze the merge window across the go-live (one PR)

**1.1 Acquire the promotion freeze in the qualification job, before the risk assessment.**
Target: `.github/workflows/shared-supabase-migrations.yml`, job `Automatic production qualification and dispatch` (starts `:1109`), inserting a step immediately **before** the `python scripts/production_business_risk_gate.py qualify-route` call at `:1310`.
The step runs `node scripts/manage-migration-coordination.mjs --acquire-promotion-freeze --pr "$SOURCE_PR" --issue "$WORK_ISSUE" --owner "automatic-production-qualification" --ttl-minutes 45` (exact value from the OPEN decision in §8), with `GH_TOKEN: ${{ github.token }}`.
- `SOURCE_PR` is the same `inputs.source_pr` the release step at `:2291` already uses — the acquire and the release **must** name the same PR or the release silently no-ops against another PR's record.
- `WORK_ISSUE` is the PR's bound work issue (the same merged-PR/issue binding the selector resolves). If the job context does not carry it, extend the dispatch inputs to carry the bound issue number. **Never invent or default an issue number** — the freeze record's header (`promotion-freeze-record pr=N issue=N`, `exclusive-locks.mjs:374`) is parsed by the alarm and by operators.
- Behavior when a live freeze already exists: the create-only ref makes the acquire **fail**. That is the correct outcome (go-lives serialize; the selector already dispatches one at a time). The step must fail loudly and name the recovery command from 1.2 — do **not** swallow the error and continue without a freeze.
- Depends on: nothing. Verification gate: `node --test scripts/check-merge-queue-workflows.test.mjs` (extend it) asserts the workflow contains the acquire step positioned before `qualify-route`; and `node --test scripts/manage-migration-coordination.test.mjs` passes with the new cases from 1.3.

**1.2 Keep the release guarantees and document crash recovery.**
Target: the release block at `shared-supabase-migrations.yml:2274-2291` — verify (do not rewrite) that `--release-promotion-freeze --pr "$SOURCE_PR"` stays under `if: always()` and `continue-on-error: true`, releasing only *this* PR's record. If the qualification job acquires the freeze but the production apply run never starts, **TTL expiry is the cleanup** (≤ 45 min of paused non-inert merges). Add one comment line at the acquire step naming the operator recovery: `node scripts/manage-migration-coordination.mjs --release-promotion-freeze --pr <n>` (and, for an unreadable record, any positive `--pr` — `exclusive-locks.mjs:386-392`).
Verification gate: a staged proof (see 4.2) in which a run is cancelled after acquisition and merges resume on their own after TTL or after the documented release command.

**1.3 Tests for the freeze window.**
Add cases to `scripts/manage-migration-coordination.test.mjs` (it already owns freeze/lease cases): acquire creates the record with the given pr/issue/owner/TTL; a second acquire while live **refuses** (create-only); release by the same PR clears it; release by a different PR leaves it; an unreadable record fails closed and is cleared by any positive `--pr`; TTL expiry stops blocking `assertNoPromotionFreeze`. Add a workflow-content assertion (in `scripts/check-merge-queue-workflows.test.mjs` or a new `scripts/check-freeze-window.test.mjs` next to it) that the acquire step exists before `qualify-route` and the release remains under `always()`.
Verification gate: `node --test scripts/manage-migration-coordination.test.mjs scripts/check-merge-queue-workflows.test.mjs` green locally and in CI.

### Phase 2 — change 2: classify faults so they stop burning attempts (one PR)

**2.1 Emit a fault-classification marker step.**
Target: `.github/workflows/shared-supabase-migrations.yml` — inside the **existing** `preview` and `Production apply (automatic evidence gates)` jobs, add one step named exactly `refund-eligible-fault`, `if: failure() && <classification condition>`, that writes a fixed success marker (e.g. `echo "REFUND_ELIGIBLE=1" >> "$GITHUB_OUTPUT"` and a `::notice::` line). **Never add a new job** — `scripts/manage-migration-coordination.mjs:2661` asserts this workflow's `total_count === 6`.
Classification condition (both classes from §6):
- the failed step's log/annotations contain `CI INFRASTRUCTURE:` (the workflow's own marker, `NO MIGRATION WAS APPLIED`), or
- the failure is a coordination refusal: `production lane requires the exact current main SHA` / `post-merge preview rehearsal requires the exact current main SHA` / `a guarded merge is active; production promotion must wait`.
Everything else (SQL errors, guard refusals, witness rejections) stays a change fault.
Depends on: Phase 1 merged (so pin refusals become rare — the classifier is the safety net, not the fix).
Verification gate: a workflow_dispatch rehearsal (preview apply of any harmless version on the preview project) in which an induced infrastructure failure shows the marker step green; the adversarial table below is fully tested.

**2.2 Refund classified failures in the selector.**
Target: `scripts/automatic_promotion_candidates.py:293-304` (`attempts = sum(...)`). Extend the per-run test to skip runs whose **any attempt** contains a succeeded `refund-eligible-fault` step (reuse the existing `attempt_jobs` / `run_jobs` per-attempt readers at `:150-158` — a re-run must not hide an earlier attempt's classification, exactly like `applied_in_any_attempt` at `:161-162`). Refunded runs must still count for *evidence* purposes (`applied_despite_catalog_check`, `preview_job_succeeded_in_any_attempt`) — only the **attempt budget** is affected.
Verification gate: `python -m unittest scripts.test_automatic_promotion_candidates` (or `pytest scripts/test_automatic_promotion_candidates.py`) green with the new cases from 2.4; a `--dry-run` of the selector against a synthetic run list prints the refund in its trace.

**2.3 Cap refunds, then park with the loud channel.**
Same file: count refunded runs per change since merge; once the refund count exceeds the OPEN cap (default 3), further classified failures count as ordinary attempts again, and the existing `out_of_attempts` path (`:304-310`) parks the change with `ENGINEER ACTION REQUIRED` (`:438`). The cap must appear in the alert text (so a reader sees "3 refunds used, now parked").
Verification gate: unit test covering "4th classified failure parks the change"; the alert text names the cap.

**2.4 Adversarial-case tests (trust boundary: GitHub run metadata is external input).**

| External input | Hostile case | Test that proves it |
|---|---|---|
| Run title | A run titled `DB preview apply …` dispatched by someone else's experiment | Only runs listed by the workflow `WORKFLOW = "shared-supabase-migrations.yml"` and created after the PR's `merged_at` count — unit test with an alien-workflow run in the fixture list |
| Run conclusion | Re-run hides an earlier attempt that applied the versions | Per-attempt reading (`attempt_jobs`) — unit test with `run_attempt = 2` where attempt 1 succeeded the apply and attempt 2 failed |
| Marker step | Marker present but the migration actually failed (log contains `ERROR:` SQL failure alongside `CI INFRASTRUCTURE:`) | Classifier requires `NO MIGRATION WAS APPLIED` too — unit test with mixed-marker log; must NOT refund |
| Marker step | Marker missing because the run predates this change | Treated as a change fault (status quo) — unit test with a run lacking the step |
| Marker step | Marker forged in a job name of another workflow | Classifier reads steps of runs of our workflow only — unit test with foreign-workflow jobs |
| Fault class | Pin refusal caused by a broken freeze (real coordination fault) vs. caused by a genuinely stale dispatch of a superseded version | Both refundable up to the cap; after the cap, park — unit test for both paths |
| Freeze record (`refs/db-coordination/promotion-freeze`) | Unreadable / malformed commit message | `readPromotionFreeze` fails closed (`exclusive-locks.mjs:383-388`) — existing tests extended in 1.3 |
| Freeze record | Another PR's live freeze | Acquire refuses (create-only); release by different PR no-ops — tests in 1.3 |
| Workflow input `source_pr` | Empty on the release path | Release is skipped by the existing `inputs.source_pr != ''` guard (`:2290`); acquire must likewise refuse to run with an empty PR — test in 1.3 |

### Phase 3 — change 3: loud stalls, and a working daily report (one PR)

**3.1 Diagnose and repair the queue-hygiene report.**
Target: `scripts/queue-hygiene-report.mjs` (+ `scripts/queue-hygiene-report.test.mjs`). The workflow step (`.github/workflows/queue-hygiene-report.yml`) prints `The queue hygiene report COULD NOT RUN (exit ${CODE})` — exit 2 means the reader **threw** (`queue-hygiene-report.mjs` header: "A throw (unreadable GitHub state) falls through to exit 2"). Reproduce with the exact command the workflow runs (see the report job's `run:` step), identify the throw (likely a new issue/lease body shape introduced since 2026-11-01 — the repo saw dozens of new issues that day), and fix the reader defensively **without** weakening the write-free invariant (`hygieneReportIo` refusal list) and **without** turning a genuine unreadable queue into a green run. Add a regression test per throw found.
Verification gate: `node --test scripts/queue-hygiene-report.test.mjs` green; then a `workflow_dispatch` of Queue Hygiene Report runs green (record the run URL in STATUS). A healthy queue with findings must still exit 0; an unreadable queue must still exit 2.

**3.2 Extend the no-progress alarm to promotion-lane stalls.**
Target: `.github/workflows/no-progress-alarm.yml` and the scripts it runs (`scripts/db-flow/no-progress-alarm.test.mjs` is its proof harness — keep it green and extend it). Add three promotion-lane stall classes, evaluated from read-only state (run `python scripts/automatic_promotion_candidates.py --dry-run` and read its trace; do **not** make the selector write anything — the in-flight `report_stuck_change()` already owns the exhausted-PR tracking issue):
1. a PR held by a review finding longer than 60 minutes (the selector already computes `held` entries);
2. an `out_of_attempts` PR (surface the existing `ENGINEER ACTION REQUIRED` text through the alarm channel too);
3. candidates exist but no successful apply in 60 minutes (the "starved lane" signature of 2026-11-05).
Keep the alarm's existing discipline: **transition-only** comments (never repost), same channel as today unless the OPEN decision in §8 says otherwise, and the staged-canary inputs (`post_issue`, `now`, `staged_label`) must work for the new classes too.
Verification gate: `node --test scripts/db-flow/no-progress-alarm.test.mjs` green including one staged canary per new class (the workflow's own `staged_label` path is the proof vehicle — record run URLs in STATUS).

**3.3 Route "the instrument could not run" and freeze complaints loudly.**
Same alarm entry point: if the latest Queue Hygiene Report run concluded `failure` (exit 2), the next alarm tick must say so in its comment (this is what five silent days cost). Also surface `assertNoPromotionFreeze`'s user-facing complaint (`merges are paused for a production run; …`, `exclusive-locks.mjs:418-419`) in that comment when a merge waits on a freeze longer than 15 minutes, so a wedged freeze is seen, not discovered.
Verification gate: staged canary with a forced failing report run id and a staged freeze timestamp; the alarm comment names both.

### Phase 4 — landing

**4.1 Three sequential PRs, one per phase** (Phase 1 first — it unblocks the lane). Each PR: own worktree from the then-current `origin/main`, re-run the §11 in-flight check first, branch + PR, CI green, merge it yourself (reviews are advisory). Serialize behind open PR #5733 and the `ci-process-repair/*` worktrees (§5) — read their diffs first and rebase onto them; if one of them already implements a step, mark that step done in STATUS with **their** artifact instead of duplicating it.
**4.2 Live proof on the tracking issue** ([#5782](https://github.com/popcre/shared-db/issues/5782), created 2026-11-05 for this plan; never open a second ticket for a leftover proof). Until live proof exists, the issue keeps `- [ ] live proof`, named in the closing note. Live proof for this work means: a real go-live in which the freeze ref was created before qualification and released after apply (run URLs), and one real classified failure that was refunded (selector trace).
**4.3 Keep the docs true.** After each landing: update this STATUS table (done rows cite artifacts — commit SHA + CI run URL, never bare counts), update the handoff file, and leave the plan in place until every row is done.

## 10. Tests required

Existing suites that must stay green on every PR (run exactly as CI does — see `.github/workflows/tools-offline-tests.yml` and `database-contract-tests.yml` for the invocations):

- `node --test scripts/manage-migration-coordination.test.mjs`
- `node --test scripts/check-merge-queue-workflows.test.mjs`
- `node --test scripts/queue-hygiene-report.test.mjs`
- `node --test scripts/db-flow/no-progress-alarm.test.mjs`
- `python -m unittest scripts.test_automatic_promotion_candidates` (or the repo's pytest equivalent under `scripts/`)
- `node --test scripts/check-sql.test.mjs`, `node --test scripts/check-handoff-contract.test.mjs` (PR hygiene)

New tests, named by behavior (never "add tests"):

1. Freeze record lifecycle: create-only acquire; second acquire refuses; same-PR release clears; different-PR release no-ops; unreadable record fails closed and any positive `--pr` clears it; TTL expiry unblocks `assertNoPromotionFreeze`.
2. Workflow-content: the acquire step sits before `qualify-route`; the release stays under `always()`; the `refund-eligible-fault` step exists in the preview and production-apply jobs and **no new job** was added (`total_count === 6` invariant at `scripts/manage-migration-coordination.mjs:2661` must keep passing).
3. Selector refunds: classified failure does not consume an attempt; classified failure still contributes apply/preview evidence; unclassified failure consumes as today; mixed-marker logs do not refund; the refund cap parks the change and the alert names the cap; per-attempt classification survives re-runs.
4. Queue-hygiene reader: one regression test per root cause found in 3.1; healthy-dirty-queue still exits 0; unreadable-queue still exits 2.
5. Alarm canaries: one staged canary per new stall class (held > 60 min, exhausted, starved lane), plus report-failure and long-freeze complaints; transition-only posting proven by firing the same canary twice.

## 11. Constraints, standing rules, and gotchas in force

- **Branch policy:** every write in your own worktree cut from `origin/main` (`D:/repos/shared-db-worktrees/<slug>` is the convention here); branch + PR; the AI merges; never push to `main`. `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>` before the first commit.
- **In-flight check before every edit** (`AGENTS.md` §6): at plan time, PR #5733 touches `scripts/lib/lanes/exclusive-locks.mjs`, and the local branches `ci-process-repair/step-2-2-trigger-reporting`, `step-2-3-stuck-change-owner`, `step-2-4-catalog-check` (in `D:/repos/shared-db-worktrees/`) touch `scripts/automatic_promotion_candidates.py` and the CI surface. Re-check (`gh pr list`, `git worktree list`, `git diff main...<branch> --stat`) before starting each phase; serialize, never parallelize. Do not edit another session's worktree or branch.
- **Task gates:** run `ai-task-gates start --class <class>` at the start of each implementation session (this planning session declared `prose`), and `ai-task-gates check --before shipment` before PR waits/merges. Reclassify to `code` for the implementation PRs.
- **Never weaken the production gate** (`scripts/production_business_risk_gate.py`, `scripts/production_migration_guard.py`) — standing constraint from the #5324 engineer action. The pin semantics in §5 stay exactly as they are.
- **Owner rules already quoted in the code and binding:** max 60-minute merge freeze (2026-10-21); pause merges during production runs (2026-10-02). Keep both in the code comment wherever you touch it.
- **Reviews are advisory** (owner ruling 2026-10-29); do not wait on them. Required checks are only those that protect production data or secrets ("lean required checks", 2026-10-30); drop a hanging flaky required check first and repair after.
- **CI waits:** use the bounded waiter (`bin/ai-pr-wait <pr>` from the ai-devops toolkit) in the background; never hand-roll sleep loops. One probe per state change.
- **No background task chips in this repo** (standing fact from the 2026-07-31 four-way collision incident): do not spawn parallel chip sessions for this work; serialize.
- **GitHub comment signature:** anything posted to GitHub carries `Posted by MiMo chat <id> on edge-dev` (`<id>` = `$MIMO_SESSION_ID`, or `unknown` when empty).
- **Secrets:** never in logs, args, or commits; values live only in 1Password vault `vibe_coding`. This plan needs none.
- **Do not change the read-only invariant** of `queue-hygiene-report.mjs` (mutation hooks stay refused; the workflow keeps `contents: read / issues: read / pull-requests: read`).
- **Do not add a workflow job** to `shared-supabase-migrations.yml` (six-job invariant). Steps are fine.
- **Sign/keep comments in code honest:** where you touch the freeze comment block (`exclusive-locks.mjs:366-371`), preserve both owner quotes verbatim.

## 12. Access and environment

- **GitHub:** `gh` authenticated on this machine (used throughout the investigation); repo `popcre/shared-db`; Actions enabled. Test any workflow change with `workflow_dispatch` runs and the staged-canary inputs before relying on schedules.
- **Node:** `node --test` (LTS, per `docs/development.md:11`). **Python:** `python -m unittest` / pytest for `scripts/test_*.py` (`docs/development.md:12`). Bundled runtimes (`MIMO_NODE`, `MIMO_PYTHON`) exist on the authoring machine if a host lacks them.
- **Branches/env:** base = `origin/main`; no local runtime to serve — verification is CI runs, `--dry-run` selector traces, and GitHub ref state (`refs/db-coordination/promotion-freeze`).
- **Production/preview databases:** NOT touched by this plan. If a rehearsal step needs the preview project, read `PREVIEW_PROJECT_REF` from repository variables (never hard-code project refs).
- **Secrets by location:** 1Password vault `vibe_coding` (items: Supabase access token, production DB password) — only needed if a verification step must run `supabase` CLI; the default verification path needs none.
- **Worktrees already on this machine** (do not disturb): `D:/repos/shared-db-worktrees/ci-1.6-advisory-gates`, `ci-2.1-paperwork`, `ci-2.2-trigger-reporting`, `ci-2.3-stuck-change-owner`, `ci-2.4-catalog-check`, plus `.claude/worktrees/*`. Your worktree for this plan: `D:/repos/shared-db-worktrees/plan-go-live-prevention` (branch `mimo/plan-go-live-lane-prevention`) — the plan file landed from it; implementation sessions should create their own.

## 13. Definition of done, risks, open questions

**Done when, for each of the three changes:**

1. Its PR merged to `main` with CI green (named suites in §10), on top of the in-flight work in §5.
2. Its tests from §10 exist and fail without the change.
3. Live proof recorded on the tracking issue (§9 step 4.2): real run URLs, not counts. The issue's `- [ ] live proof` box is checked only then.
4. STATUS rows above cite the artifacts (commit SHA + run URL) and the handoff file is updated.
5. Nothing in §4's "NOT in this plan" list was touched.

**Risks and mitigations:**

- *Freeze wedges merges after a crash.* Mitigated by design: TTL ≤ 45 min expires it; merges are only partially blocked (path-scoped tolerance); the documented release command clears it immediately. An unreadable record fails closed but is releasable by any positive `--pr`.
- *Freeze TTL expires mid-apply.* Safe: an expired freeze stops blocking merges, but the production lane ref itself keeps merges frozen during the apply (`exclusive-locks.mjs:353`). Choose TTL to cover the observed apply duration (45 min default) and log both timestamps.
- *Refund cap mis-tuned (too low → parks good changes; too high → a broken week retries forever).* Criteria in §8; the alert names refunds used; changing one constant is a one-line PR.
- *Change 2 interacts with the in-flight `report_stuck_change()`.* Mitigated by landing behind it and extending, not replacing; its tracking issue becomes (part of) the alarm channel per §8.
- *Queue-hygiene root cause is unknown until diagnosed (3.1).* If the throw is a third-party outage (GitHub API), the fix is resilience + loud failure, not a green lie. The invariant "exit 2 means the instrument could not read" must survive.

**Open questions (with decision criteria):** exactly the three OPEN items in §8 — refund cap, alarm channel, marker mechanism. Each has a default proposal and criteria; the implementer decides and records the choice in this file's STATUS/§8 on landing.

---

## Self-audit (mandatory, answered before first presentation)

**1. Could a brand-new AI session with no project knowledge and no context from this conversation execute this plan to perfection, without asking me anything?**
Yes. §1–§3 give the goal and the incident with times and run ids; §5–§6 carry every discovery from the investigation (including the exact ripgrep finding that `--acquire-promotion-freeze` has no workflow caller, and the in-flight branch that already adds `report_stuck_change()`); §7 records the dead ends (widened pin, retry-harder, rehearsal-wide freeze, unbounded refunds, new monitor service) with reasons; §8 marks each decision locked vs open with criteria and defaults; §9 names files, line anchors, behaviors and verification gates per step; §11 lists the repo rules and traps (six-job invariant, no task chips, worktree-only, in-flight check). No step requires a fact that lives only in this conversation. Gap found and fixed during drafting: the first draft said the exhausted-attempt alert fires "only when idle"; §5 now correctly cites `automatic_promotion_candidates.py:438` as the always-firing annotation and scopes change 3 to *channel* visibility, with the in-flight tracking-issue work named as the base to extend.

**2. Does the plan carry every piece of background, nuance, and reasoning I currently hold — including what we ruled out and why?**
Yes. The rejected approaches in §7 include every path considered during the investigation (pin-widening, retry-only, rehearsal-wide freeze, unbounded refunds, a new monitor, hygiene-report write/exit changes, re-delivering the retired batches), each with its rejection reason and the file evidence. The owner's two freeze quotes are preserved verbatim in §8 and §11. The `plan_narrow-promotion-freezes.md` relationship (we extend the pause earlier; we do not narrow admission) is explicit in §4 and §8 so the implementer cannot accidentally relitigate that locked scope.

**3. Is the ultimate goal stated clearly enough that the implementer could make a correct judgment call if a step turns out to be wrong?**
Yes. §1 states the goal in plain business English (same-day go-live even on busy days; infrastructure breakage never punishes a change; every stall loud within an hour) and instructs: *"If a step conflicts with this goal, the goal wins — stop and flag it."* The three OPEN decisions in §8 each carry the criteria derived from that goal, so a step that turns out wrong can be re-judged against the goal rather than against the letter of the plan.

