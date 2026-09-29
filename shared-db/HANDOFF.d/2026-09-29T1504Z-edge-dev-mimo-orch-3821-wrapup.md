---
issue: 3821
status: OPEN
owner: mimo/orch-3821-wrapup
---

# Shared-db orchestrator #3821 wrap-up (MiMo chat ses_ffe5f13a70fb2ffeFjJ8klotYE, edge-dev)

All times America/New_York (EDT). Facts checked 11:05 AM EDT, 2026-09-29.

## 0. DECISIONS ONLY THE OWNER CAN MAKE

None blocking technical work. One standing hold:

- **#1941 Laura/Ilona licensed-property sign-off** — on hold until **2026-10-05** per Albert (~3:05 PM EDT 2026-09-28). Dependents #2601, #2541 stay parked. Do not re-ask before that date.

Already settled — do NOT re-ask:

- 2026-08-18 / 2026-09-16: never ask Albert to approve technical production risk; independent AI reviewer / governed machine gate decides.
- 2026-09-28 ~2:55 PM: force through stuck hourly limit (done via pop-ai-watchers app secrets + PR #3759).
- 2026-09-28 ~5:45 PM: restore the merge line (ruleset 24142420).
- 2026-09-28 ~10:50 PM: add StepFun to rotation (PR #3657, still in protected-file queue).
- 2026-09-29 handover: authorized successor orchestrator route from #3732; apply-only recovery of #3464.

Next session: put the whole §0 list to Albert in ONE message before starting work.

## 1. What this application is

`popcre/shared-db` is the shared Supabase schema repo for POP Creations apps (CRM, DAM, PM/PIM, DesignFlow PLM). Every app reads the same tables. Structure (DDL) is governed here via branch+PR+Guarded Merge; application row data is not. Production project ref `qsllyeztdwjgirsysgai`; preview `mvpkijzfmfcxhnzqogzs` (`PREVIEW_PROJECT_REF`).

## 2. What we set out to do this session

Successor shared-db orchestrator after marker #3732 closed (handover PR #3819). Ordered queue from Albert / handover:

1. Preview-ledger reconciliation leftover `20260928145444`
2. Finish owner-authorized production recovery #3464 (apply only `20260924183947`)
3. Merge ready PRs migration-first: #3730, #3711, #3818
4. Promotion + live proof + close #3725, #3400, #3683 NBCU, #3685 WildBrain, then #2179 and build #2176
5. Protected-file queue one-at-a-time: #3757 → #3620 → #3657 → #3808 → #3396 → #3787 → #3647 → DesignFlow chain

Parallelize with concurrent sub-agents. Run ONE merge conductor.

## 3. Current state — what is true right now

**Main tip `4c4b5bbb85fe3d5361fedd6ff9b7fcf7d1227c3f` at 11:05 AM EDT** (after #3620 merge). Max migration on main: **`20260929082814`** (Peanuts). Marker **#3821 OPEN** (`route_id: local_5c28eb43-957b-4fea-b259-b0c364b5a540`, MiMo session `ses_ffe5f13a70fb2ffeFjJ8klotYE`).

### Done this session

| Item | Result |
|---|---|
| Preview-ledger `20260928145444` | Reconciled → `20260929040458` (run 36546629950). Preview clear. |
| #3464 production recovery | **CLOSED** on live proof. Only `20260924183947` applied (run 36554726641, artifact 11026977118). `reset_bulk_operation_submission_lease` live-verified. Completes the five owner-authorized recoveries. |
| #3730 Peanuts | **MERGED** (c98ae885), version `20260929082814` |
| #3818 allocator fix | **MERGED** (9fa45c24) |
| #3788 gate cutback | **MERGED** (26fe2037) — cross-session request from ai-devops#1014 |
| #3736 rate-limit wait | **MERGED** (755bd33c) |
| #3757 protected-file head | **MERGED** (339359bd). Gemini quarantine cleared via `ai-review-preflight clear gemini`. |
| #3620 claim transfer tool | **MERGED** (4c4b5bbb) just before wrap-up |
| #3725 WB STABLE fn | **CLOSED** live_verified (v1 path) |
| #3400 HTS phrase cols | **CLOSED** live_verified (`20260928182014`) |
| #3685 WildBrain | **CLOSED** live_verified (`20260929071000`) |

### Half-done / not done

| Item | Exact state |
|---|---|
| **#3711** ColdLion `/itemImages` | OPEN. Head `79f8cd31713e3e04e3a98651e68e7f3d72be80dc`. Migration version **`20260929093750`** (re-reserved from `20260929070422`). Slot 1 Muse APPROVE at that head. **Slot 2 (Grok seq 4581) assigned but no durable APPROVE yet.** Live-proof version refs fixed; gen-6 evidence pair published (`refs/db-contracts/2179/6`). |
| **#3683** NBCU | OPEN. Merged PR #3695 head `258f0319` has assignment refs but **no durable APPROVE**. `run-governed-review.mjs` `resolveReviewSource` refuses merged PRs. Fix PR **#3830** open. |
| **#2179** | OPEN; waits on #3711 merge + preview/prod/live proof. |
| **#2176** | OPEN; build after #2179. Scope block malformed (`function ` empty). Handover note: `plm.import_coldlion_vendors(jsonb)` does **not** exist live. |
| **#3825** risk-gate allowlist | OPEN PR (ALTER FUNCTION volatility + DO assertion). Was RED on truth-audit inventory (17 vs 15). |
| **#3828** verdict-deadlock messages | OPEN PR (repo-maintenance). Was blocked behind #3620 — now unblocked. |
| **#3830** merged-head review binding | OPEN PR (fixes #3683 tooling gap). |
| **#3657** StepFun rotation | Draft, protected-file queue after #3620 (owner asked). |
| DesignFlow chain #2870/#3707/#3708/#3737/#2873 | After #3647. |

### Preview / production

- Preview ledger **clear** of `20260928145444`.
- Production: `20260924183947`, `20260928182014`, `20260929005943`, `20260929071000` applied this recovery wave with live proof.
- NBCU `20260929045102` **not** promoted (blocked on #3683 tooling gap).

### Merge conductor

One conductor at `C:\Users\ahazan\.cache\conductor-3821\` (SIG MiMo/orch-3821, ALLOW_UPDATE off, STOP file present). Drive: `& "C:\Program Files\Git\bin\bash.exe" "C:/Users/ahazan/.cache/conductor-3821/drive.sh" <PR>`. Scripts recovered from edge-dev3 `/home/ahazan/.cache/conductor-626c9036/`.

## 4. Everything we tried that did NOT work

1. **Auto-update PR branches from main** — still forbidden (voids approvals). Guarded Merge refuses "not based on current main tip"; fix is content-preserving merge + evidence rebind + fresh review if diff moves.
2. **Heredoc via bash tool on Windows** — PowerShell has no `<<'EOF'`. Write body files first.
3. **`bash /c/...` conductor path** — WindowsApps `bash` is WSL stub with no distro. Use `"C:\Program Files\Git\bin\bash.exe"`.
4. **Preview reconcile dispatch twice** — second run fails "ledger rows do not match the supported reconciliation phase" after success. Check run list first.
5. **Hand-rename migration versions** — always `--supersede-active-claim-version`. Must run **on edge-dev3** from `/home/ahazan/repos/shared-db` (worktree path in claim).
6. **Qwen reviewer on edge-dev3** — fails until ai-devops#1035. `--replace-failed-reviewer --failure-code local_dependency_unavailable --failing-check "..." --confirm-local-dependency-unfixable`.
7. **Check exact-head approval with `PR_NUMBER=x cmd`** — PowerShell needs `$env:PR_NUMBER=...`.
8. **`ai-grok-review` without `AI_GROK_CALLER`** — refused. Set `AI_*_CALLER=mimo`.
9. **Governed review without `--worktree` / `--prompt-file`** — refused. Brief must not name a head in a VERDICT line.
10. **Gemini quarantined + existing APPROVE** — deadlock: lease not recreated, replace/release refuse on verdict. Escape: `ai-review-preflight clear gemini` (or `qualify`). Quarantine does **not** invalidate durable verdicts (`reviewerReadsRepository` is the only disregard key).
11. **In-place edit of published `refs/db-contracts/<issue>/<gen>`** — `refuseCommittedMutation`. Publish successor generation with `evidence_parent` bound to the recorded hash.
12. **Automatic v2 production promotion on material-risk migrations** — fail-closes (`material_access_change` etc.). Supported path: manual v1 `Production Apply Review Evidence` + dispatch (works for #3464/#3725/#3685).
13. **Review a merged PR for preview prep** — `resolveReviewSource` hard-refuses. Fix in #3830.
14. **Migrations need TWO review slots** — one APPROVE is not enough (`AGENTS.md` 6.x).
15. **`--max-turns` after `--` is a wrapper arg** — position it for the wrapper (Grok needs ~40).

## 5. Root causes and key findings

- Every merged migration backdates other open migration PRs; they must re-reserve via the supersession tool and usually re-review.
- Approval carry (#2758) is plus/minus content of non-`.agent/` diff, not raw diff. Version-string rewrites outside `.agent/` break carry.
- Historical recovery is apply-only; use `historical_preview_source_pr` + `historical_preview_original_run_map` when main moves mid-recovery.
- Protected source `scripts/manage-migration-author-lanes.mjs` serializes open PRs (allocator refuses a second draw while another open PR edits it). Land them one at a time.
- `contractHash` is key-order-insensitive; reformatting shows in git diff without changing the hash.
- Files under `C:/repos/shared-db` untracked (`.ai/`, `.ai-devops/`, etc.) are **pre-existing** from other sessions — do not `git add` them casually.

## 6. Exact next steps

1. **Open successor orchestrator-marker** with own `route_id`, `authorization: owner-authorized-handover #3821`, `handover_issue: 3821`, briefing = this file. Verify `node scripts/check-orchestrator-marker.mjs --resolve`.
2. **#3711**: run Grok slot-2 review at head `79f8cd31` (`--review-slot 2`, `AI_GROK_CALLER=mimo`, worktree at that head, brief `.ai/review-brief-3711-79f8cd31.md` or equivalent). When `check-exact-head-approval` passes (2 slots), drive conductor `3711`. Then preview + production + live proof + close #2179. Then build #2176 (fix scope block; do not assume `plm.import_coldlion_vendors` exists).
3. **Protected-file queue after #3620 (merged)**: #3657 (StepFun, owner asked) → #3808 → #3396 → #3787 → #3647 → DesignFlow #2870/#3707/#3708/#3737/#2873. One ready PR at a time for `manage-migration-author-lanes.mjs`.
4. **#3683**: get #3830 merged (merged-head review binding), then governed review at `258f0319` on PR #3695, then `--prepare-preview-dispatch 3683` + promotion + close. NBCU migration `20260929045102` not yet on production.
5. **#3825**: fix truth-audit inventory (call sites 17 vs recorded 15), green + review, merge (unblocks automatic risk-gate for ALTER FUNCTION / DO blocks).
6. **#3828**: now unblocked after #3620 merge — review + merge (message-only).
7. After #3620: claim transfers #2110 (#3378), #3175 (#3307), #2662 (#3294) via the command #3620 adds.

**Verification gates:** each step ends with `gh pr view` MERGED or `gh issue view` CLOSED + live-proof comment; `check-exact-head-approval` green before every conductor drive.

## 7. Constraints and gotchas in force

- Branch + PR + Guarded Merge; AI merges; never push to protected `main`.
- Preview / production / merge are one-at-a-time lanes.
- Never auto-update PR branches from main.
- Never ask Albert to approve technical risk.
- Qwen fails on edge-dev3 until ai-devops#1035; do not draw it.
- Claude/MiMo must not review Claude/MiMo-orchestrated work.
- #1941 on hold until 2026-10-05.
- Times in EDT (America/New_York).
- Sign GitHub comments `Posted by MiMo chat <id> on <machine>`.
- Keep GitHub API calls bounded; one merge conductor only.

## 8. Access and environment

- Machine: **edge-dev** (Windows). edge-dev3 reachable as `ahazan@edge-dev3` with `~/.ssh/916-alien`.
- `gh` authenticated as u2giants. Repo `popcre/shared-db`.
- 1Password vault `vibe_coding` for secrets (no new credentials this session).
- Reviewer wrappers: `ai-grok-review`, `ai-muse`, `ai-deepseek-agent`, `ai-gemini`, … under `C:\repos\ai-devops-reviewer-install\bin\` / `C:\Users\ahazan\.local\bin\`.
- `node scripts/manage-migration-author-lanes.mjs` and `scripts/check-exact-head-approval.mjs` from repo root.
- Conductor: `C:\Users\ahazan\.cache\conductor-3821\`.
- Git Bash: `"C:\Program Files\Git\bin\bash.exe"`.

## 9. Open questions and risks

- **#3683 tooling gap** is real and unmerged (#3830). Until then NBCU cannot promote.
- **Risk-gate classifier** still misclassifies some catalog-only SQL (#3825). v1 manual review path works but is slower.
- **Protected-file serialization**: only one open PR may touch `manage-migration-author-lanes.mjs`.
- **Untracked junk** in the shared checkout from many sessions — do not delete without `cleanup-worktree` audit.
- Max migration / main SHA go stale within the hour — re-verify at start (§3).

---

# Part (b) — sub-agent work blocks

### Agent: general-1 preview-ledger reconciliation
- **Asked to do:** Confirm/run reconcile of leftover `20260928145444`.
- **Actually did:** Dispatched `preview-ledger-orphan-reconciliation.yml` (run 36546629950) with allowlisted tuple issue=3458 claim=3483 source_pr=3672. Success. Comments on #3672/#3464/#3725/#3400.
- **Found:** Last prior run was 2026-09-07; #3814 allowlist had merged but workflow never ran.
- **PR / branch:** none (workflow dispatch).
- **Worktree:** finished.
- **Deliberately did NOT do:** production writes.

### Agent: general-3 / general-9 production recovery #3464
- **Asked to do:** Apply only `20260924183947`, dry-run + business-risk gate, live proof, close.
- **Actually did:** Dry-run 36551910772; preview apply 36552277530; v1 Production Apply Review Evidence 36553899587 APPROVE; production apply **36554726641** success; artifact 11026977118; live `pg_get_functiondef` proof; **#3464 CLOSED**.
- **Found:** Automatic v2 fail-closes on material risk; main-tip races force historical preview rebind (`historical_preview_source_pr=3490`).
- **PR / branch:** none (historical apply of already-merged #3490).
- **Worktree:** finished.
- **Deliberately did NOT do:** any version other than `20260924183947`.

### Agent: general-2 / general-8 / general-13 / general-19 — #3711
- **Asked to do:** Survey, re-reserve backdated migration, get two exact-head APPROVEs, merge.
- **Actually did:** Superseded `20260929070422` → `20260929093750` (tool on edge-dev3). Qwen replaced (local_dependency_unavailable) by Muse. Two REVISE verdicts on dead live-proof version + stale evidence. Fixed live proof + published gen-6 contract. Muse **APPROVE** at `79f8cd31`. Slot 2 Grok assigned (seq 4581), **not approved**.
- **Found:** Re-reserve left `.github/live-proofs/2179.sql` pointing at dead version; migrations need 2 slots.
- **PR / branch:** PR #3711 `claude/coldlion-item-images-2179`, head `79f8cd31`.
- **Worktree:** `C:/repos/shared-db-review-3711`, `C:/repos/shared-db-review-3711-v2` (clean, resumable for slot-2 review).
- **Deliberately did NOT do:** merge (slot 2 missing); no production.

### Agent: general-4 / general-11 / general-15 / general-16 / general-17 — #3757
- **Asked to do:** Fix tombstone allowlist / evidence, review, merge protected-file head.
- **Actually did:** Gen-4 contract (`refs/db-contracts/3675/4`); main-tip refresh to `61a61fed`; Gemini APPROVE; cleared Gemini quarantine; **MERGED 339359bd**. Gap issue #3827 + message-only PR #3828.
- **Worktree:** finished (branch deleted on merge).
- **Deliberately did NOT do:** #3828 merge (was blocked behind #3620).

### Agent: general-18 / general-21 — #3620
- **Asked to do:** Refresh after #3757, fix Muse REVISE (post-write rollback), get APPROVE, merge.
- **Actually did:** Head `60bed9e9` with exact-head APPROVE, green checks; **MERGED 4c4b5bbb** during wrap-up.
- **Found:** Medium finding on post-write verification without rollback (fixed before merge).
- **Worktree:** finished.
- **Deliberately did NOT do:** claim transfers #2110/#3175/#2662 (depend on the tool just merged).

### Agent: general-10 / general-20 — promotions
- **Asked to do:** Preview + promote + live proof + close #3725/#3400/#3683/#3685.
- **Actually did:** **#3725 CLOSED**, **#3400 CLOSED**, **#3685 CLOSED** on live proof. #3683 blocked on merged-head APPROVE gap. Closed redundant #3769.
- **Found:** v1 path needed for classifier gaps; catalog lexer silent-fails on mixed-case quoted identifiers.
- **Worktree:** `promote-3821-mimo` (scratch).
- **Deliberately did NOT do:** force automatic v2; invent risk flags.

### Agent: general-14 / general-22 / general-6 — tooling
- **Asked to do:** Risk-gate allowlist (#3825), merged-head review fix (#3830), merge conductor.
- **Actually did:** Conductor staged at `C:\Users\ahazan\.cache\conductor-3821\`. PRs **#3825**, **#3830** open (not merged).
- **Deliberately did NOT do:** finish those PRs (wrap-up freeze).

---

## Secrets / docs

- Secrets sweep: **no credential printed or created** this session. Pre-existing GitHub App secrets used via workflows only.
- Docs pass: nothing outside this handover is stale that this session proved wrong; new durable lessons live here (§4–§5).

## Queue seed (REQUIRED)

Outstanding items already have open issues: #3711/#2179/#2176, #3683, #3684 (Peanuts successor — closed work landed), #3657/#3555, #3825, #3827/#3828, #3829/#3830, DesignFlow #2870/#2873/#2874/#2875/#3737, claim transfers after #3620 (#2110/#3175/#2662). No new `db-work` issues opened at wrap-up (scope freeze); these are the seeded queue.

Posted by MiMo chat unknown on edge-dev
