---
issue: 3532
status: OPEN
owner: mimo/non-orchestrator-sweep-20260925
---

# Non-orchestrator open-issue sweep — successor handoff (2026-09-25)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

**Put this WHOLE list to Albert in ONE message before starting work.**

### Blocking (work cannot proceed without Albert)

1. **#2290 — authorize ColdLion health-lane deployment.** Owner-only. Recommendation: authorize if the health lane is still the right deploy path; otherwise say so and close. Blocks ColdLion sync closeout.
2. **#2541 — confirm the authorized ColdLion property-code set is the 33 unique codes in `docs/coldlion-unmatched-properties-by-licensor-20260731.md` (not the stale "66"), and whether Laura/Ilona #1941 is a hard gate.** Evidence comment: `#issuecomment-5829097054`. Recommendation: confirm 33; treat #1941 as NOT a hard gate for these codes (Laura already answered the specific codes; five contested attributions are ruled live). Blocks curated Master Data admission of the remaining 28.

### Wrong guess is recoverable, but wasteful

3. **#2701 — production deploy of popdam3 `444f960` + live Property Matches proof for Ilona Kereki and Laura Arevalo.** Recommendation: schedule the `workflow_dispatch` deploy (`launch-data-designflow-app`) and have those two Licensing users click Property Matches. Blocks closing #2701.

### Not part of this workstream — nobody is on them

4. **#3218 — DesignFlow production missing `hts_rag` schema** (Cloud Run `HTS_RAG_DB_*` config). Recommendation: hand to the DesignFlow production session. Blocks live duty research.
5. **#3351 — ColdLion technical team must answer `/proddetails` row identity** (shapes D/E + five numbered questions). Partial business answer exists (JamieLynn 2026-09-24: never sum/merge/dedupe on `(prodOrderNo, prodLineSeq)`). Recommendation: Albert chases ColdLion technical. Blocks #3234 and 8 held production orders.
6. **#2600 — Licensing Master Data 3.5 consolidated preview/performance proof.** Curated Master Data route; blocked on #2336. Recommendation: schedule a curated Master Data sub-agent when #2336 clears.
7. **Live `main` required-status contexts (4) have drifted from `docs/verification/main-required-status-checks.json` (12, captured 2026-09-08).** Recommendation: open a small repo-maintenance ticket to re-promote or refresh the mirror. Not urgent; note the drift.

### Already settled — do NOT re-ask

- Albert 2026-08-18 (#539): five contested property attributions (AM1/AM2, MGM, WND, EP) are ruled and live in production (#1177).
- Albert 2026-08-13: no `HANDOFF.d/` file-count cap; retire stale files only.
- Albert 2026-09-16: technical production approvals go to an independent reviewer, not chat.
- 2026-09-25: #3505 is owned by session `shared-db.orch` — do not touch that worktree, branch, or issue.

---

## 1. What this application is

`popcre/shared-db` is the shared Supabase database repository for POP Creations. Every app (CRM, DAM, PM/PIM, DesignFlow PLM, PopDAM) reads and writes the same tables. This repo holds migrations, guarded merge/review tooling (`scripts/manage-migration-author-lanes.mjs` and friends), CI workflows, and the cross-app rulebook (`AGENTS.md` → `docs/agents/`).

Stack: Supabase (Postgres) + Node scripts + GitHub Actions. Production project `qsllyeztdwjgirsysgai`, shared preview `rjyboqwcdzcocqgmsyel`. Machine: `edge-dev`, Windows, worktrees under `C:\repos\shared-db\.claude\worktrees\` and `.ai\worktrees\`.

This session was a **repository session**, not the orchestrator. Orchestrator marker is #3496 (`shared-db.orch edge-dev mimo-successor-3480`) — do not close it.

## 2. What we set out to do this session, and why

Albert asked to **resolve all open non-orchestrator issues** in this repo, parallelized across as many concurrent sub-agents as possible, preferring `mimo-v2.6-flash` where instructions were tight enough, and spinning up blocker agents as needed.

Non-orchestrator = repo-maintenance, reviewer-tooling, docs, CI, source-data loaders — **not** database structure (that is orchestrator work).

## 3. Current state — what is true right now

**Checked 2026-09-25T08:55Z.** `origin/main` tip `a48ce7b1699e5ab4aa3ae7aff69a0261c3bdb7f3` (merge of PR #3274). Shared checkout `C:\repos\shared-db` is a landing-only main checkout with many untracked scratch files from other sessions — **do not edit it**.

### Closed with proof this session (45)

2448, 2549, 2678, 2824, 2836, 2844, 2923, 2998, 3050, 3114, 3125, 3273, 3280, 3290, 3313, 3319, 3327, 3342, 3353, 3359, 3360, 3362, 3364, 3365, 3370, 3384, 3387, 3393, 3399, 3412, 3413, 3421, 3427, 3437, 3440, 3442, 3450, 3479, 3484, 3488, 3492, 3493, 3507. Also nearby: 3300, 3377, 3411.

Many were **already implemented on main** (often via combined PR #3354, merge `905ec8e29`) and only needed verification + close. Others landed new PRs (#3503, #3499, #3506, #3509, #3514, #3517, #3274, #3379, #3390, #3395, #3366, #3350, #3448).

### Still open non-orchestrator (as of 08:55Z)

**Actionable tooling/docs (implement or land):**
| Issue | Title | Next |
|---|---|---|
| 2457 / 2491 | stale-readback / preview evidence | Core fixes on main via #3354; hardening PRs #3522 / #3512 blocked on Cross-PR collision |
| 2492 | grok-4.6 no verdict on large migrations | PR #3341 (also #2986) |
| 2508 | ledger drift reporter | PR #3518 |
| 2678 | AI_*_CALLER | Fixed on main; PR #3516 is test-only follow-up |
| 2701 | Property Matches Licensing | App fix on popdam3 `444f960`; needs prod deploy + live proof |
| 3002 | CI/review parallelism | PR #3352 |
| 3024 | product-type reader | Phase A merged (#3446); Phase B owner-gated |
| 3262 | ColdLion order intake docs | PR #3248 |
| 3302 | ColdLion replay proof | PR #3515 |
| 3349 | lease probe real cause | PRs #3525/#3529/#3531 (duplicate attempts) |
| 3361 | required-check authority | PR #3369 green |
| 3367 | runtime probe qualification | PR #3371 green |
| 3372 | Disney DCP routing | PR #3373 green |
| 3380 | immutable evidence generations | PR #3445 green |
| 3383 | pure-prose fast CI | PR #3523 |
| 3388 | dependency hygiene | PR #3396 CONFLICTING |
| 3392 | isolated routing | PR #3394 green |
| 3397 | apply evidence recovery | PR #3447 has 5 red checks |
| 3398 | global role claims | PR #3524 |
| 3428 | sandbox migration route | Needs sandbox creds + orchestrator coordination |
| 3493 | truth-audit gen2 | Issue closed but PR #3519 still open (site repoint gen2) |
| 3527 | silence-released reviewer capacity wall | PR #3526 |

**Claims (leave alone — live author leases, structural parents):**
3502 (→#3510), 3486 (→#3490), 3483 (→#3487), 3482 (→#3489), 3378 (→#3391), 3307 (→#3309), 3294 (→#3304), 2834 (→#2835), 2745 (→#3385).

**Programs / markers / parked:** 1403 (Switch 2 gated on `objects:` census), 2326 (handover), 2530 (merge queue phases 8–11), 3084 (alarm), 3306 (workflow-refactor parent), 3401 (handover), 3496 (orchestrator marker — **not yours**), 3505 (**other session**), 3508 (parked on #2995).

**External:** 2290 (Albert), 2600 (curated MD), 2986 (sandbox), 3218 (DesignFlow prod), 3351 (ColdLion tech).

### Open PRs (38) — many BLOCKED on Cross-PR object collision or missing review

All listed in the 08:55Z `gh pr list` snapshot. Highest-value greens awaiting one review + `guarded-migration-merge` dispatch: **#3445, #3394, #3373, #3369, #3371**. Need CI/rebase first: **#3447** (5 red), **#3396** (CONFLICTING). Duplicates to consolidate: 3349 family (#3525/#3529/#3531), 2998 family (#3528/#3530).

## 4. Everything we tried that did NOT work

1. **`xiaomi/mimo-v2.6-flash` as a subagent model → every spawn failed with `APIError`.** Use `mimo-desktop/mimo-v2.6-flash` (verified working) or the default model. Do not retry the `xiaomi/` id.
2. **`ai-task-gates start --class non-orchestrator` / `--class repo-maintenance` / `--class maintenance` / `--class docs` → rejected.** Valid classes come from `ai-devops/config/task-gates.json`: `prose, code, installation, reviewer-safety, ui-live-workflow, shared-db, deployment, infrastructure, production, private-evidence, private-tooling`. Use `code` for scripts, `prose` for docs.
3. **Many "implement this issue" briefs found the fix already on main** (especially anything absorbed by PR #3354). Always verify on `origin/main` before implementing. Close-with-proof is often the whole job.
4. **Cross-PR object collision** refuses any two open PRs that touch `scripts/manage-migration-author-lanes.mjs`. Serialize those PRs; do not try to bypass the guard.
5. **GitHub Compare API caps `files` at 300.** A branch >300 changed-files behind main fails the collision guard. Remedy: merge current main into the branch (do not re-run CI as a fix).
6. **`gh issue close --comment` fails with long bodies** on this platform. Use `gh issue comment` then `gh issue close`.
7. **`ai-task-gates end` clears the intent of whichever worktree it runs in** — including the shared checkout if cwd is there. Restore or re-declare after.
8. **Governed review after a replacement draw** needs `--replacement-sequence <failed-seq>` (the failed sequence suffix, not the new one). Without it, verdict recording resolves the superseded assignment and refuses.
9. **Unstarted reviewer assignments auto-release in ~10–12 minutes** (`silent_worker_observed`). Run the review immediately after drawing.
10. **MiMo must set `AI_MUSE_CALLER` / `AI_QWEN_CALLER` explicitly** (e.g. `mimo`); `detectReviewCaller` only knows claude/codex.
11. **`ai-*.cmd` launchers fail** with "system cannot find the path specified" unless `%ProgramFiles%` is set. Invoke the underlying scripts via `C:\Program Files\Git\bin\bash.exe` directly.

## 5. Root causes and key findings

- **PR #3354** (merge `905ec8e29`, 2026-09-20) is the combined landing of ten serialised `manage-migration-author-lanes.mjs` PRs. A large fraction of "open" issues were already fixed inside it and only lacked closure.
- **`gh issue close` does not fire `Closes #N` in PR bodies** when the PR is merged as "Merge pull request #N" or when the keyword is added post-merge. Watch for silently-open finished issues.
- **All 9 open `db-claim` issues hold live author leases and open PRs.** Closing any would steal a claim. Claims 3378/3307/3294 were re-verified as resumed (renewed leases 2026-09-25 ~06:25–06:30Z).
- **Merge path for code PRs:** draw reviewer (`--assign-reviewer`) → `run-governed-review.mjs` → durable verdict artifact → `gh workflow run guarded-migration-merge.yml -f pull_request=<n> -f head_sha=<exact head>`. GitHub PR reviews alone are insufficient; `check-exact-head-approval.mjs` wants the durable verdict.
- **Docs-only PRs** merge via `Documents-only merge authorization` (~30s posts the required status). Never `--admin` (admins are enforced), never `guarded-migration-merge` for prose.
- **Ephemeral DB check** was restored by PR #3452 (`SUPABASE_INTERNAL_IMAGE_REGISTRY: public.ecr.aws`); stale reds on old PR heads clear on re-run.
- **`#2541` "66 codes" is a stale figure**; the authorized source document lists 33 unique codes (37 rows, 4 dual-licensor). Five are already live; 28 held for source-authority recovery.

## 6. Exact next steps

1. **Send Albert the §0 list in one message.** You'll know it worked when he answers the three blocking items (#2290, #2541, #2701 deploy).
2. **Land the five green PRs** (#3445→3380, #3394→3392, #3373→3372, #3369→3361, #3371→3367): one independent review each + `guarded-migration-merge` dispatch. You'll know it worked when each PR shows MERGED and its issue is closed with proof.
3. **Unblock #3447** (fix 5 red checks) and **rebase #3396** (CONFLICTING), then same land path.
4. **Consolidate duplicate PR families** (3349: #3525/#3529/#3531; 2998: #3528/#3530) — keep one, close the rest as superseded.
5. **Do not touch** #3505 (other session), #3496 (orchestrator marker), any `db-claim` issue's claim state, or structural PRs (#3510, #3490, #3489, #3487, #3391, #3385, #3309, #3304, #2835) unless you are their author.
6. **For each remaining open issue in §3**, either finish it or post a dated status comment naming the holder/blocker. You'll know it worked when `gh issue list --label non-orchestrator --state open` only shows claims, programs, external blockers, and items with named owners.

## 7. Constraints and gotchas in force

- **Worktree-only.** Never edit `C:\repos\shared-db` shared checkout. `git -C C:\repos\shared-db fetch origin --prune` then `worktree add` from `origin/main`.
- **Non-orchestrator only in this workstream.** No migrations, no schema, no RLS, no production applies. Structural work goes to the orchestrator (#3496).
- **Scripts/docs/CI = one independent reviewer.** Migrations/data/production/security = two.
- **Sign every GitHub body/comment:** `Posted by MiMo chat unknown on edge-dev`.
- **Never weaken a guard or delete a check to go green.**
- **Serialize PRs touching `scripts/manage-migration-author-lanes.mjs`.**
- **Never invent reviewer verdicts. Silence is never approval.**
- **Do not close #3496. Do not touch #3505.**

## 8. Access and environment

- `gh` authenticated as `u2giants`. Git remote `https://github.com/popcre/shared-db.git`.
- Machine `edge-dev`, Windows. Git bash at `C:\Program Files\Git\bin\bash.exe`.
- Task gates: `ai-task-gates start --class code|prose ...` from `C:\repos\ai-devops\bin\ai-task-gates`.
- Reviewer wrappers: `scripts/run-governed-review.mjs`, `scripts/manage-migration-author-lanes.mjs`. Set `AI_MUSE_CALLER`/`AI_QWEN_CALLER` explicitly under MiMo.
- Secrets: 1Password vault `vibe_coding` (none appeared in this session; no new entries created).
- Models: `mimo-desktop/mimo-v2.6-flash` works for subagents; `xiaomi/mimo-v2.6-flash` does not.

## 9. Open questions and risks

- **2026-09-25:** Several parallel sessions closed the same issue mid-verification. Always re-check issue state before close-out work.
- **2026-09-25:** PR #3506 merged with zero formal GitHub review records (parallel sessions raced). The one-reviewer rule has a race under high parallelism.
- **2026-09-25:** `docs/verification/main-required-status-checks.json` is stale vs live branch protection (12 vs 4 contexts). Treat the live API as truth.
- **2026-09-25:** Background sub-agents from this session may still be running (`general-193`–`general-197` and earlier). Check `actor status` / recent PR activity before assuming a lane is free.
- **Risk:** duplicate PRs for the same issue (3349 family) can collide and confuse review draws. Consolidate first.

---

## Part (b) — sub-agent work (grouped by assignment; ~190 dispatches)

Session used high parallelism. Individual `general-N` actors map to one issue or one PR family each. Pattern: worktree from `origin/main` → verify/fix → PR or close-with-proof → signed comment.

### Agent group: PR finishers (already-open non-orchestrator PRs)
- **Asked:** land PR, one review if code, merge, close issue.
- **Actually did:** several landed (#3503, #3499, #3506, #3509, #3514, #3517, #3379, #3390, #3395, #3366, #3350, #3448, #3274). Many found CI blocked or PR already merged.
- **Found:** Cross-PR collision on `manage-migration-author-lanes.mjs`; ephemeral-DB reds were stale GHCR limits.
- **Worktree:** most finished and removed; some left under `.claude/worktrees/<issue>-pr<n>`.

### Agent group: verify-and-close (issues suspected already fixed)
- **Asked:** check `origin/main`, close with proof if done.
- **Actually did:** closed ~25 issues that were already fixed (especially #3354 absorptions). No code changes.
- **Found:** `Closes #N` often does not auto-close; #3354 is the hidden fix for many tickets.
- **Deliberately did NOT do:** implement duplicates of already-landed fixes.

### Agent group: implementers (new work)
- **Asked:** implement missing fixes in worktrees.
- **Actually did:** produced PRs #3511–#3531 family (3349, 2508, 2678 tests, 3302, 3383, 3398, 3437, 2457, 2491 hardening, 2998, 3526). Several duplicates across parallel waves.
- **Worktree:** live under `.ai/worktrees/` and `.claude/worktrees/` for those PRs.
- **Deliberately did NOT do:** structural/migration work; production deploys; claim releases.

### Agent group: triage / claims / handovers
- **Asked:** disposition comments on claims, programs, external blockers.
- **Actually did:** status comments on 9 claims + programs (#2326, #2530, #3306, #3401, #1403, #3084). Closed nothing that was not finished. Left #3496 and #3505 untouched.
- **Found:** all 9 claims live with renewed leases; #1403 Switch 2 gated on `objects:` census (3 claims still use the alias).

### Agent group: owner-decision investigations
- **Asked:** #2541 codes question; #2701 Property Matches root cause; #3351 ColdLion identity.
- **Actually did:** dated evidence comments. #2541: 33 not 66; #1941 not a hard gate for these codes. #2701: app read-path fix landed on popdam3 `444f960`; needs prod deploy. #3351: no full answer; precise ask posted.
- **Deliberately did NOT do:** invent identity schemes; run production deploys.

---

## Self-audit (handoff-writer gate)

1. **Comprehensive for a brand-new developer?** Yes — §1–§9 + part (b) cover app, goal, state, dead ends, findings, next steps, constraints, access, risks.
2. **As effective as this session?** Yes — every non-obvious finding (model ids, gate classes, #3354, collision/compare caps, review replacement flags) is in §4–§5.
3. **Every relevant detail?** Yes — SHAs stamped, PR/issue numbers listed, secrets by location only, deploy status explicit (none from this session).
4. **If Albert read only §0, would he see every decision?** Yes — sweep run over §1–§9 and part (b): #2290, #2541, #2701 deploy, #3218, #3351, #2600, required-check drift all promoted to §0.

Posted by MiMo chat unknown on edge-dev
