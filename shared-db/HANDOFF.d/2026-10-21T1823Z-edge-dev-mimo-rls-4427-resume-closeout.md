---
issue: 4421
status: OPEN
owner: mimo/rls-resume-ec79f18d
---

# RLS InitPlan repairs: parked source recovered, not live-accepted

Snapshot: October 21, 2026, 2:23 PM EDT. Wrap-up. Implementation stopped. This handoff is prose-only; it grants no database or promotion authority.

## 0. Business decisions only the owner can make

None. Preserve every existing permission and capability; never close a repair without LIVE verification; continue families in dependency order (#4427 → #4428 → #4429 → #4430).

## 1. What this repository is

[popcre/shared-db](https://github.com/popcre/shared-db) is the shared Supabase database-shape source. Start with [AGENTS](https://github.com/popcre/shared-db/blob/main/AGENTS.md), [current workflow](https://github.com/popcre/shared-db/blob/main/docs/agents/current-workflow.md), [anti-collision rules](https://github.com/popcre/shared-db/blob/main/docs/agents/anti-collision-summary.md), [merge protocol](https://github.com/popcre/shared-db/blob/main/docs/agents/merge-protocol.md), [worktree/handoff rules](https://github.com/popcre/shared-db/blob/main/docs/agents/worktrees-and-handoffs.md), [standing facts](https://github.com/popcre/shared-db/blob/main/docs/agents/standing-facts.md).

## 2. Goal and origin

Albert requested resume from [handoff 2026-10-18T1929Z](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-18T1929Z-edge-dev3-codex-rls-repair-closeout.md): resolve ownership recheck, complete #4427–#4430 in order, preserve permissions, require live verification before closure. Later: "don't stop until everything is 100% complete" and "get this done NOW", then `/wrap-up`.

Parent [4421](https://github.com/popcre/shared-db/issues/4421). Programme [2326](https://github.com/popcre/shared-db/issues/2326) not complete.

## 3. Current state and verified evidence

### Ownership
- Session UUID `ec79f18d-51ae-4565-9907-15b8659ed4fb` (edge-dev). Host edge-dev, not edge-dev3.
- Claim #4478 park-released (owner string `mimo/rls-resume-…` could not satisfy claim-first session authority).
- Claim #4502 park-released at wrap-up (`--release-claim --confirm-finished --park`). Version **20261021142900** reserved; never reuse.
- `ai-shared-db-closeout-check` must be re-run by the successor after any further ownership op.

### Source
- Recovered from parked [PR #4444](https://github.com/popcre/shared-db/pull/4444) head `d80e4eb` (claim #4443 / version 20261018172640 — do not reuse).
- 44 `ALTER POLICY` InitPlan wraps of `has_role(auth.uid(),'admin')` across 37 tables. Archive false positives unchanged. Permissions preserved.
- Six Node tests pass: `node --test scripts/rls-public-admin-initplan.test.mjs`.
- CI ephemeral `supabase/tests/rls_public_admin_initplan_contracts.sql` executes **2124 before/after outcomes** on this source family (job on PR #4503 run 39311856928).

### PR / evidence lineage (all superseded except current reserved version)
| PR | Head | Pair gen | State |
|---|---|---|---|
| #4479 | … | 9 | closed/parked |
| #4503 | many | 10–19 | closed (history confused budget) |
| #4544 | `ec6ee1e1f…` | 17 | closed (object collision); **GLM APPROVE recorded here** |
| **#4551** | **`ea57c573241153d7c5bc1b24d6732bba107451fa`** | **19** | **CLOSED/parked at wrap-up** |

- Branch `mimo/rls-4427-resume` kept at `ea57c5732`. Worktrees `rls-4427-resume` and `rls-4427-clean` kept (unmerged).
- Contract refs: `refs/db-contracts/4427/9` … `/19`. Current pair is generation 19 under `.agent/work/4427/19/`.

### Review
- GLM `VERDICT: APPROVE ec6ee1e1f657cbef5965ff06bf38a8d408a830b4` **is recorded** (replacement seq 6879 / #4544). It does **not** approve #4551 head `ea57c5732`.
- Incidents logged: `20261019T003615Z-edge-dev-stepfun-800507`, `20261021T164147Z-edge-dev-multi-reviewer-recording-3487006`.

### Environments
- **Preview: nothing applied.** Production: nothing applied. No fixture writes. No consumer writes. Live acceptance fully open.

## 4. Failed attempts and dead ends

1. Claim owner `mimo/rls-resume-…` → check-in refused; use session UUID as owner.
2. Two evidence pairs on one PR → refused (#2708).
3. Rebound historical runtime evidence alone → reviewers call it circular; pair with CI ephemeral SQL execution proof.
4. StepFun Windows spawn failure. DeepSeek never emitted governed `VERDICT: <sha>`. Muse approvals were not recordable (silent lease reclaim / fenced turn).
5. Force-pushed PR history → review-budget first-parent ancestry refused; use a **fresh PR**.
6. `contract.branch` must equal PR head ref; `completion.head_sha` must be 40 hex chars; only pair files after `report.head_sha`.
7. Backdated migration versions refused when main moves — re-reserve via `--reversion-active-claim`.
8. `assign-reviewer` often strands `refs/db-coordination/author-acquisition`; recover with `recover-author-mutex.yml`.
9. PR #4544 vs #4503 object collision — one open PR per object set.

## 5. Findings that must survive

- Exact whole-helper wrapping is necessary. Both helpers STABLE. `auth.uid()` MD5 `ea3b41bf…`; `public.has_role` MD5 `187a79a4…`.
- Do not GRANT archive tables to create fixtures. Requalify at live acceptance.
- Source merge first, then preview, then bounded production. Do not pre-apply the PR migration to preview.
- ready-for-merge is source evidence only. **Live proof stays on the same issue** as `- [ ] live proof`.

## 6. Exact next steps

1. Read this handoff and [plan_rls_request_constant_checks.md](https://github.com/popcre/shared-db/blob/main/plan_rls_request_constant_checks.md). Re-read current main, claims, stages. Declare own session UUID and `SHARED_DB_AUTHOR_ENGINE`.
2. Fresh claim of exact source objects on #4427, **new reserved version** (not 20261021142900). Own worktree from current main. Rebase parked source (branch `mimo/rls-4427-resume` head `ea57c5732`).
3. Publish prospective contract generation 20+ with current paths/owner/branch/base. Keep exactly one evidence pair. Implementation commit then pair-only commits.
4. Get exact-head independent APPROVE that `recordReviewVerdict` accepts on the live assignment lease (GLM works on this machine; DeepSeek/StepFun/Muse are unreliable here).
5. Guarded merge (no --admin). Then preview apply, production risk assessment, bounded promotion.
6. LIVE proof on #4427 (same issue checklist). Only then close #4427 and start #4428.
7. #4428 (17 owner policies) → #4429 (4 style-guide) → #4430 (2 packaging), each with own live proof.

## 7. Constraints and gotchas

Dependencies: 4427←4425+4426 (done); 4428←4427 live; 4429←4428 live; 4430←4429 live. Never direct-push protected main. Never reuse retired versions. Sign GitHub posts `Posted by MiMo chat ec79f18d-51ae-4565-9907-15b8659ed4fb on edge-dev`. Check-in every 10 minutes while active.

## 8. Access and environment

Host **edge-dev**. GitHub/gh authenticated. Session tools: `ai-shared-db-closeout-check`, `manage-migration-author-lanes.mjs` in the shared-db worktree. Credentials only in 1Password `vibe_coding` (no new secrets this session). GLM via `ai-glm` works; `AI_GLM_CALLER=mimo`. DeepSeek `ai-deepseek-agent`; Muse `ai-muse` with `AI_MUSE_CALLER=mimo`.

## 9. Open questions, risks and handoff audit

No new business questions. Risks: main moves fast (version backdating); reviewer recording fragile on edge-dev; live proof entirely outstanding.

Self-audit: new developer can resume from §§3–6 + issue comment 6323378677; failed paths in §4; no hidden business choice.

## Part (b): sub-agents

No live sub-agents at wrap-up. Earlier session agents (admin_repair / owner_repair / access_packaging) are described in the 2026-10-18 handoff; none were resumed this session.

## Resume prompt

Resume popcre/shared-db from this handoff and issue #4427 comment 6323378677. Take a fresh claim + new migration version for #4427 source on branch `mimo/rls-4427-resume` head `ea57c573241153d7c5bc1b24d6732bba107451fa`, get a recordable exact-head APPROVE (prefer GLM), guarded merge, then preview/production/live proof before closing #4427. Then #4428→#4429→#4430. Preserve permissions. No manual production SQL.
