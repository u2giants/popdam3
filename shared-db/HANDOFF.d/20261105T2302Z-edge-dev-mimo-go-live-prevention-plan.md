---
issue: 5782
status: OPEN
owner: mimo/plan-go-live-lane-prevention
---

# Handoff: go-live lane prevention plan (freeze window, attempt classification, stall alarms)

This handoff registers an **implementation plan**, not an implementation. The plan is the work product: [`plan_go-live-lane-prevention.md`](../plan_go-live-lane-prevention.md) — https://github.com/popcre/shared-db/blob/mimo/plan-go-live-lane-prevention/plan_go-live-lane-prevention.md (intended URL once this PR lands on `main`: https://github.com/popcre/shared-db/blob/main/plan_go-live-lane-prevention.md). **Read the plan's STATUS table first — do not re-derive or re-plan.**

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream needs the owner. The freeze-pause tradeoff is already settled by the owner's own standing rules (verbatim quotes preserved in the plan §8: 2026-10-02 "assign someone to pause merges during production runs"; 2026-10-21 "no session is allowed to freeze merges for more than 1hr. that's the new rule"). All remaining choices (refund cap, alarm channel, marker mechanism) are technical, carry defaults and criteria in plan §8, and are decided by the implementing AI itself. Already settled — do NOT re-ask: pause merges during production runs (2026-10-02); freeze ≤ 1 hour (2026-10-21); never weaken the production gate (#5324 engineer action); reviews advisory, lean required checks (2026-10-29/30).

## 1. What this application is

`popcre/shared-db` is the shape-of-database repository for POP Creations' shared Supabase project (production project `qsllyeztdwjgirsysgai`). It has no app runtime; its "product" is the GitHub Actions + Node/Python machinery that rehearses, qualifies and applies database changes to production for all four consumer apps (CRM, DAM, PM/PIM, DesignFlow). Repo: https://github.com/popcre/shared-db. Owner: Albert Hazan (non-technical; the AI owns all git mechanics).

## 2. What we set out to do this session, and why

On 2026-11-05 the go-live lane stalled twice in one day and the owner asked how to prevent it forever, then asked for a written implementation plan (`/implementation-plan-writer`). This session: investigated the incident to root cause, wrote `plan_go-live-lane-prevention.md` (13-section build spec for three prevention changes), and registered it here. Trigger evidence (all times EST): PR #5623's batch refused 7× 9:07–11:35 AM by `production lane requires the exact current main SHA or a verified prefix of it`; PR #5686 failed preview 7× 3:46–4:40 PM on `CI INFRASTRUCTURE: PostgreSQL client unavailable … apt mirror stall` + a curation witness refusal; two PRs held ~17 h as unread log annotations; the daily Queue Hygiene Report failing (exit 2) since 2026-11-01. Tracking issue: https://github.com/popcre/shared-db/issues/5782 (carries `- [ ] live proof`).

## 3. Current state — what is true right now

- **Plan file: written, not yet committed at the time this file's first draft — landed together with it on branch `mimo/plan-go-live-lane-prevention`** (this PR). Contents: STATUS table (all rows ⬜ open), §1–§13, self-audit. Nothing in the plan is implemented.
- **Implementation: not started.** A fresh session starts at plan §9 step 1.1 (freeze acquisition wiring).
- **Root cause established** (plan §6): the promotion merge freeze machinery is complete (`scripts/lib/lanes/exclusive-locks.mjs:372-446`, CLI `scripts/manage-migration-coordination.mjs:2180-2181,2267-2268`) and the production apply run already **releases** it (`.github/workflows/shared-supabase-migrations.yml:2291`), but `--acquire-promotion-freeze` has **zero callers in `.github/`** — verified 2026-11-05 by ripgrep. The acquire is a manual session command nobody runs in the automatic lane.
- **In-flight work the implementer must serialize behind** (plan §5): open PR #5733 touches `scripts/lib/lanes/exclusive-locks.mjs`; local worktree branch `ci-process-repair/step-2-3-stuck-change-owner` (in `D:/repos/shared-db-worktrees/ci-2.3-stuck-change-owner`, unpushed at plan time) already adds `report_stuck_change()` to `scripts/automatic_promotion_candidates.py` (one tracking issue for exhausted PRs — the base change 3 extends). Siblings `ci-process-repair/step-1.6-advisory-gates`, `step-2.1-paperwork`, `step-2.2-trigger-reporting`, `step-2.4-catalog-check` are live in the same CI surface. Rebuild PRs #5719/#5720/#5721 (issues #5622/#5683) carry the replacements for the two retired batches.
- Commits/push status: see this PR; `main` moved fast all day (e.g. `fbe4ac8aa..55f6e6a59` in one fetch) — that movement is the incident itself.

## 4. Everything we tried that did NOT work

Not implementation attempts (none yet) — investigation dead ends the plan records so nobody repeats them (plan §7): widening the production pin to accept any ancestor (rejected — evidence binds to the dispatched SHA; never weaken the gate); "retry harder" on pin refusal (already existed, already failed 7× on 2026-11-05 — retries without a freeze cannot outrun per-minute merges); freezing merges across the whole preview rehearsal (rejected — owner design scopes the pause to assessment→apply; costs real throughput); unbounded infra retries (rejected — #5532 bounding exists so one dead change cannot park the lane); a new standalone monitor workflow (rejected — extend `no-progress-alarm.yml`); making the queue-hygiene report write issues or fail on dirty queue (rejected — its write-free/exit-0-on-backlog invariants are load-bearing). Also wrong for a while: the assumption that the exhausted-attempt alert only fires when the selector is idle — it always fires as a workflow annotation (`automatic_promotion_candidates.py:438`); the problem is channel invisibility, not absence.

## 5. Root causes and key findings

1. **Missing wire, not missing rule.** Freeze exists so "main does not move in a way the running production gate would refuse" (`exclusive-locks.mjs:397-399`) and merge acquisition honors it (`:354`, plus `:353` blocks merges while the production lane ref is held) — but nothing acquires the freeze automatically. Release is wired at `shared-supabase-migrations.yml:2291`; acquire is not. That asymmetry is the day's two stalls.
2. **Pin checks:** dispatch-time (`scripts/dispatch-production-apply.mjs:122-123`) and lane-acquisition-time (`exclusive-locks.mjs:233-236`) both demand the exact tip or a *verified prefix* — and `productionPrefixOk` (`exclusive-locks.mjs:400-404`) tolerates only production-inert movement / appended migrations, which a busy day of workflow+script commits violates every few minutes.
3. **Attempt counting has no fault model** (`automatic_promotion_candidates.py:293-304`): every non-success counts against the change (`MAX_ATTEMPTS = 3` at `:55`), including `CI INFRASTRUCTURE:` failures the workflow itself labels "NOT a fault in the change under review". Seven such failures parked PR #5686. (Per-change-since-merge counting is a deliberate 2026-11-05 decision — do not revert it.)
4. **All alarms are invisible channels:** selector annotations (`:438`, held alerts), the idle `ENGINEER ACTION REQUIRED` (`:316-319`), and a daily report that has exited 2 for five days (`The queue hygiene report COULD NOT RUN`). `no-progress-alarm.yml` (30-min cadence, transition-only comments, staged-canary inputs) is the proven loud channel to extend — it just doesn't watch this lane.

## 6. Exact next steps

1. Fresh implementation session: read `plan_go-live-lane-prevention.md` §1–§8 (context; do not re-derive), then re-run the in-flight check (plan §11: `gh pr list`, `git worktree list`, `git diff main...<branch> --stat`) and land **behind** PR #5733 and the `ci-process-repair/*` work. If one of them already implements a plan step, mark that STATUS row done citing **their** artifact. Verification gate: STATUS updated, no duplicated code.
2. Phase 1 (plan §9 steps 1.1–1.3, one PR): wire `--acquire-promotion-freeze` into the qualification job before `production_business_risk_gate.py qualify-route` (`shared-supabase-migrations.yml:1310`), same `--pr` as the release at `:2291`, TTL 45 min, failing loudly if a live freeze exists. Verification gate: `node --test scripts/manage-migration-coordination.test.mjs scripts/check-merge-queue-workflows.test.mjs` green, with the new freeze-lifecycle cases named in plan §10.
3. Phase 2 (steps 2.1–2.4, one PR): `refund-eligible-fault` marker **step** (never a new job — `scripts/manage-migration-coordination.mjs:2661` asserts `total_count === 6`), selector refunds with a cap (default 3) and the adversarial table from plan §9. Verification gate: `python -m unittest scripts.test_automatic_promotion_candidates` green including every adversarial row.
4. Phase 3 (steps 3.1–3.3, one PR): repair `scripts/queue-hygiene-report.mjs` exit-2 (keep the write-free invariant), extend `no-progress-alarm.yml` to held >60 min / exhausted / starved-lane, route report-failure and long-freeze complaints. Verification gate: `node --test scripts/queue-hygiene-report.test.mjs scripts/db-flow/no-progress-alarm.test.mjs` green; a `workflow_dispatch` Queue Hygiene Report run green (run URL in STATUS); one staged canary per new stall class.
5. Live proof on issue #5782 (a real go-live showing the freeze created before qualification and released after apply + one real refunded infrastructure failure), check `- [ ] live proof`, update STATUS rows with artifacts, then delete this handoff file in the finishing commit (successor rule).

## 7. Constraints and gotchas in force

Worktree-only (`D:/repos/shared-db-worktrees/<slug>` convention), branch + PR, AI merges, never push to `main`; `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>`; `ai-task-gates start --class code` for implementation PRs and `check --before shipment` before PR waits; reviews advisory, lean required checks; bounded CI waiter (`bin/ai-pr-wait`), no sleep loops; **no background task chips in this repo** (2026-07-31 four-way collision incident); never weaken the production gate; never add a job to `shared-supabase-migrations.yml` (six-job invariant at `manage-migration-coordination.mjs:2661`); keep `queue-hygiene-report.mjs` write-free; keep both owner freeze quotes verbatim in any touched comment (`exclusive-locks.mjs:366-371`); GitHub posts carry `Posted by MiMo chat <id> on edge-dev`; `HANDOFF.d/` files: edit only your own, never rewrite root `HANDOFF.md`; secrets only in 1Password vault `vibe_coding`, never in logs/args/commits.

## 8. Access and environment

`gh` authenticated on this machine; repo `popcre/shared-db`; Node `node --test` and Python `python -m unittest`/pytest per https://github.com/popcre/shared-db/blob/main/docs/development.md; bundled `MIMO_NODE`/`MIMO_PYTHON` available if a host lacks runtimes. No database access needed for this work; preview project read from repository variable `PREVIEW_PROJECT_REF` if a rehearsal needs it. Secrets by location: 1Password vault `vibe_coding` (Supabase access token, production DB password) — values never in chat. Machine nickname: `edge-dev`.

## 9. Open questions and risks

- Three OPEN implementation decisions (2026-11-05, defaults + criteria in plan §8): refund cap (default 3), alarm channel (default: no-progress-alarm channel + the stuck-change tracking issue), marker mechanism (default: marker step, not job). The implementer decides and records the choice in the plan on landing.
- Risk: freeze wedges merges after a crash — mitigated by TTL ≤ 45 min and the documented `--release-promotion-freeze --pr <n>` recovery; an unreadable record fails closed but any positive `--pr` clears it.
- Risk: TTL expiring mid-apply — safe (the production lane ref itself freezes merges during the apply, `exclusive-locks.mjs:353`).
- Risk: change 2 colliding with the in-flight `report_stuck_change()` — land behind it, extend it.
- Open unknown: the exact throw behind the queue-hygiene exit 2 (diagnose first in step 3.1; a third-party outage needs resilience + loud failure, never a green lie).

## Self-audit (answered before first presentation)

1. *Could a brand-new developer pick up with no project knowledge?* Yes — §1–§2 give the application and the incident, §5 the root causes with file:line anchors, §6 the exact ordered next steps with verification gates, §7 the traps (six-job invariant, no task chips, worktree-only, in-flight list), §8 access. Supporting sections: all of §1–§8; gap found and fixed during drafting: the intended plan URL was stated as unpushed-branch URL plus post-land `main` URL (per the GitHub-URL rule).
2. *Detailed enough to continue as well as I could right now?* Yes — every non-obvious discovery (the never-acquired freeze, the verified-prefix limit, the `total_count === 6` invariant, the in-flight `report_stuck_change()` overlap, the always-firing annotation) is in §5 or plan §5–§7; the investigation dead ends are §4 / plan §7.
3. *Every relevant detail for flawless execution?* Yes — background §2, goal plan §1, current state §3, failures §4, decisions (locked/open) plan §8, constraints §7, risks §9, next actions §6 with gates, evidence links throughout.
4. *If the owner read only §0, would he see every business decision and no technical approval?* Yes — the sweep found **no** business-meaning decisions in this workstream (the only owner-touching items are his own already-settled freeze rules, listed in §0 as "do NOT re-ask"); every remaining choice is technical and is routed to the implementing AI per plan §8. §0 states this explicitly.
