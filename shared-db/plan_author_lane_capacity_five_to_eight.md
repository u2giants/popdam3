# Plan — raise the migration-author lane cap from five to eight

**Status:** proposed, not applied. **Owner instruction:** 2026-08-27.
**Enforced value today:** `MAX_AUTHOR_LANES = 5` in
[`scripts/manage-migration-author-lanes.mjs`](scripts/manage-migration-author-lanes.mjs)
(raised 3 → 5 on 2026-08-25 in commit `c9b9599`).

## 1. What the number is

The cap is a **throughput dial, not a safety dial**. Collision safety comes from four
mechanisms that never read the constant:

1. exact per-object claims (`assertLaneAvailable`),
2. the global acquisition mutex (`MUTEX_REF`),
3. permanent per-version refs (`refs/db-claims/<version>`),
4. the single-holder exclusive stage refs in `EXCLUSIVE_REFS`.

Preview, guarded merge and production stay **strictly serial at eight lanes exactly as
they are at five**. Eight authors never means eight sessions touching a live database; it
means eight drafts queueing for the same serial stages.

## 2. What the raise actually costs

Downstream capacity, not correctness. Three pressures, each with a required mitigation.

### 2.1 Reviewer capacity — the binding constraint

Today: **four active rotation providers** (`grok-4.6`, `glm-5.3`, `kimi-k3`, plus the
rotation entry retained in `ACTIVE_REVIEWERS`) and **one overflow slot**
(`codex-gpt-5.6-sol`, assigned only when every rotation provider is busy or has already
failed on the exact head).

Eight authors feeding four rotation reviewers doubles the wait rather than removing it —
the same failure the 3 → 5 raise avoided by growing the roster in the same change. Note
also that `ai-grok-review` holds a per-**repository** in-flight lock, so Grok contributes
one concurrent review, not more.

**Required before the cap moves:** either un-retire and prove a provider (`qwen-3.8-max`
is retired, not deleted) or add a new rotation name, so the active rotation is **at least
six**. Every added or un-retired name must be proven with a real `doctor` run on the
wrapper and the output pasted into the PR — never assumed. Never delete a name from
`REVIEWERS`; retired names must still resolve to a wrapper when read back out of
permanent coordination refs.

### 2.2 GitHub ref-write rate

Claim renewal is ~6 ref writes per hour per lane. Three lanes = 18/hr, five = 30/hr,
**eight = 48/hr**. That remains far inside GitHub's limits, so the rate-limit caveat
recorded in
[`plan_multi_agent_database_coordination_hardening.md`](plan_multi_agent_database_coordination_hardening.md)
§6 stays discharged. Update that paragraph's arithmetic in the same change so the
recorded reassessment matches the enforced cap.

### 2.3 Serial-stage queue depth

Eight simultaneous completions queue in front of one preview ref, one merge ref and one
production lane. This is a wait, not a hazard — but the orchestrator should expect longer
preview queues and should not read a long queue as a stuck lock. No code change; a
sentence in the §4 doc.

## 3. Exact changes

| # | File | Change |
|---|------|--------|
| 1 | `scripts/manage-migration-author-lanes.mjs` | `MAX_AUTHOR_LANES = 5` → `8`; rewrite the cap comment block so it reads "eight" and records this raise, its date and the owner instruction |
| 2 | `scripts/manage-migration-author-lanes.mjs` | Grow the rotation to ≥6 active reviewers (§2.1). Keep Codex as overflow, not a rotation slot |
| 3 | `scripts/manage-migration-author-lanes.test.mjs` | `assert.equal(MAX_AUTHOR_LANES, 5)` → `8`; the capacity-refusal test already derives its fixtures from the constant. Fix the "four active reviewers" fixture comment and loop to the new roster size |
| 4 | `docs/agents/section-4-anti-collision-rules.md` | Replace "Five authors…", "A sixth author is refused", and the **stale** "or three author lanes are occupied" line in the `--claim` failure list. That line is already wrong at five and must be corrected here regardless |
| 5 | `AGENTS.md` | Any surviving lane-count wording must agree with the constant. §4 text and the constant are required to agree |
| 6 | `plan_multi_agent_database_coordination_hardening.md` | §4 "(five since 2026-08-25)" and §6 ref-write arithmetic → eight |
| 7 | `scripts/check-skill-drift.mjs` | No change required — the `author-cap` rule is deliberately cap-agnostic. Do **not** hardcode a number into it |

## 4. Verification

1. `node --test scripts/manage-migration-author-lanes.test.mjs` — green.
2. `node scripts/check-skill-drift.mjs` — exit 0.
3. `node scripts/manage-migration-author-lanes.mjs --audit` — prints `N/8 lanes occupied`.
4. `node scripts/manage-migration-author-lanes.mjs --queue-audit` — still fully audits and
   still refuses an unproven empty-lane claim.
5. Paste each new/un-retired reviewer's real `doctor` output into the PR.
6. Grep the repository for the words "five lanes", "sixth author" and "three author lanes"
   and prove each hit is either updated or a historical record that must not change.

## 5. Rollback

Set the constant and the test assertion back to `5`. Nothing persists a lane count: claims
live in issues and refs and are unaffected by the constant, so a revert is safe with lanes
occupied. Do **not** revert the reviewer-roster growth or the §4 doc correction — both are
improvements independent of the cap.

## 6. What this plan does not authorize

It does not weaken any guard, does not make preview/merge/production concurrent, and does
not raise the cap without the reviewer growth in §2.1 landing in the same change.
