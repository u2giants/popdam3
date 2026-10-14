---
issue: 179
status: OPEN
owner: mimo/section3-issue-clearing
---

# PopDAM section-3 issue-clearing — MiMo wrap-up (2026-10-14)

Written 2026-10-14 ~4:23 PM EDT (20:23Z) on machine `edge-dev` by MiMo chat (session `ses_ffe5ec5b0ce0effeH2kZra1rqQ`). This session executed section 3 of the prior clearing handoff with MiMo v2.6 flash subagents. Owner instructions in force: **"Muse is the reviewer; Qwen is dropped."**

Source handoff (read first):
https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-14T1200Z-hetz-claude-issue-clearing-coordinator.md

## 0. Business decisions only the owner can make

1. **Second independent reviewer on shared-db migrations** (blocks #4206 merge and therefore #4284 promotion). Shared-db requires two independent review slots. Muse cannot hold both slots on one head. Albert said "Muse is the reviewer; Qwen is dropped" but did not name the second slot. **Recommendation:** GLM (already used successfully as slot 2 on #4284). Alternative: StepFun. **Already settled — do NOT re-ask:** Muse is the primary reviewer; Qwen is dropped (2026-10-14).
2. **DeepSeek top-up** (from the prior handoff; still unanswered). DeepSeek is out of credit and was skipped as a slot-2 candidate. **Recommendation:** leave out of rotation until topped up, or top up if a third independent reviewer is wanted.
3. **ColdLion property codes load** (shared-db #2541, Sept 25 hold — Ilona mapping + Laura sign-off). **Recommendation:** wait for Ilona/Laura; do not load now.
4. **Damaged-asset preview policy** (#382): 15 damaged PSDs, Winnie the Pooh .ai, 60 compat-alert .ai — re-save or stay no-preview? **Recommendation:** leave marked no-preview until a human can re-save; do not block the render cutover on this.
5. **15 zero-byte `_Conflict.psd` copies** — delete or keep? One differs from its sibling and needs a human look. **Recommendation:** keep all 15 until that one file is inspected.

Next session: put the WHOLE list above to Albert in ONE message before starting work. Do not drip one at a time.

## 1. What this application is

PopDAM is an internal Digital Asset Manager for licensed consumer-product art (Disney, Marvel, etc.). Same codebase serves PopSG (style-guide mode) via hostname. Shared Supabase backend project `qsllyeztdwjgirsysgai` is owned by `popcre/shared-db`. Production domains: `dam.designflow.app`, `sg.designflow.app`. This session worked across `u2giants/popdam3`, `popcre/shared-db`, and `popcre/ai-devops`.

## 2. What we set out to do this session

Execute section 3 of the 2026-10-14 clearing handoff, in order, with Muse as reviewer and Qwen dropped:

1. Get shared-db #4284 live (via #4206 merge + preview + promote).
2. Muse final-check then run popdam3 #179 3a Z: render-account cutover.
3. Run licensor fill-in #357 after the DAM scan.
4. Land Qwen-removal PRs and prove a reviewer draw never selects Qwen.
5. Enforce top ai-devops gate inventory items (start `never-open-raw-transcript-archives`).

## 3. Current state — what is true right now

Checked 2026-10-14 ~4:20 PM EDT unless noted.

| Item | State | Evidence |
|---|---|---|
| shared-db #4272 (Qwen/Gemini quarantine) | **MERGED** | `9595a63fcc0c616687d858b0eef1b3864a9d265e` at 2026-10-14T16:15:26Z |
| ai-devops #1747 (`never-open-raw-transcript-archives`) | **MERGED** | `a6cd1dd9bbbee9811408a54ef436400f299579fe` at 2026-10-14T17:59:42Z |
| popdam3 #179 3a cutover plan | **Revised, needs Muse re-check** | commit `28bbb4a7` on `popdam/179-z-nas-vault-agent`; comment https://github.com/u2giants/popdam3/issues/179#issuecomment-6170399081 |
| shared-db #4284 (Z: Vault RPCs) | MERGED, **NOT promoted** | `13bcff66` at 2026-10-14T07:19:34Z; promotion blocked on #4206 |
| shared-db #4206 (licensing engine) | **OPEN** | was head `61b97f6`; later read shows head `aa9c8a3d8d9066e93ed9c1b6185f56c18bbd9fea` — RE-VERIFY |
| ai-devops #1728 (Qwen drop, ai-devops side) | **OPEN, CI red** | head `d9027576` on `mimo/1714-review-scope-reduction`; linux shard 3 fails `test-windows-bash-selection.sh` 9 tests (likely from `5bd08e08`, not our fix) |
| ai-devops #1754 (`local-tests` gate) | **OPEN, CONFLICTING** | head `d1e12965`; Muse REJECT #2 outstanding (see §4) |
| DAM scan → licensor fill-in #357 | **Not started** | waiting on scan; not checked this session |
| ai-devops gate inventory remainder | **Not started** | next after local-tests: private-data gates |

Reviewer pool after #4272: **muse, deepseek, glm, stepfun** (qwen/gemini/grok absent from active registry).

## 4. Everything we tried that did NOT work

1. **`--assign-reviewer --review-slot 2` on shared-db PR #4206 at head 61b97f6** — refused: `reviewer allowlist does not match the durable assignment (muse-spark-1.3-contributor)`. Slot 1 was drawn Muse-only, so slot 2 inherits a Muse-only allowlist and cannot be a different reviewer. Fix path is a NEW head + redraw slot 1 with allowlist muse+glm.
2. **`--handoff-claim-author --remote-custody` for claim #4152** — process hung until tool timeout. Likely the reviewer/author mutex. `--recover-author-mutex` refuses without `--expected-sha` and `--confirm-stale`.
3. **`ai-muse` in the foreground** — the shell tool kills long Muse turns (`ChildProcess.kill`). Workaround: `Start-Process` detached + redirected logs **outside** the worktree (logs inside the worktree dirty the source digest and cause stale-response rejection).
4. **`xiaomi/mimo-v2.6-flash` as actor model** — `ProviderModelGroupNotFoundError` / instant APIError. Working id is **`mimo-desktop/mimo-v2.6-flash`**.
5. **Muse session stuck at `turn_in_progress` with dead worker PID** — `ai-muse reconcile` says "busy". Verdict is still recoverable from `retained_turn.stream` last `run.terminal.completed` payload.text.
6. **`ai-muse show` from the wrong cwd** — reports "no session for caller in this repository". Always run from the session's worktree.
7. **`gh pr merge --merge` on popcre/ai-devops** — merge-queue-only; errors but still enqueues. Use `--auto --merge` then `ai-pr-wait`.
8. **`bin/ai-pr-wait.cmd` directly** — fails; invoke via `"C:\Program Files\Git\bin\bash.exe" bin/ai-pr-wait ...`. Also needs `ai-task-gates start --class reviewer-safety` first or it STOPs on class mismatch.
9. **First flash subagent batch with `xiaomi/mimo-v2.6-flash`** — both died instantly with APIError. Retried on `mimo-desktop/mimo-v2.6-flash` successfully.
10. **Muse on #4272 could not record at the latest head** — its slot-1 draw was terminally failed/replaced; durable artifact came from a GLM replacement (6516) instead. Merge requires an APPROVE tied to the *latest* slot assignment, not a prose comment.

## 5. Root causes and key findings

- **Two-slot reviewer rule vs Muse-only allowlist** is the hard blocker for #4206. The allowlist is inherited from slot 1; a new head is required to redraw.
- **CHAT_OWNER_PATTERN** in shared-db session authority only accepts `Codex chat <uuid> on <host>` or `Claude chat <uuid> on <host>`. MiMo is not a recognized claim-owner form. Fallback `?? owner` can match a bare session id but is untested for claims.
- **Guarded merge inputs** are `pull_request` + `head_sha`, not `pr`.
- **ai-task-gates `ship`** needs an `ai-review` lifecycle final-check APPROVE (`--implementer` ≠ provider).
- **Vault RPC names** for the Z: cutover: `get/set_render_z_nas_password` (migration `20261014043757`), `get/set_sg_nas_password` (migration `20261011211208`). All service_role-only.
- **1Password restore sources** (vibe_coding): `Synology 192.168.3.101 - mac SMB share` (ahazan) and `Synology edgesynology2 - styleguides SMB share` (popdam).
- **Truth-audit disposition catalogues** are per-source-file under `docs/verification/throughput-dispositions/`; a comment shift that moves a matched line must rebind the site or CI goes red.

## 6. Exact next steps (in order)

1. **Ask Albert the §0 list in one message** (especially the second-reviewer question). You'll know it worked when he answers which of GLM/StepFun may be slot 2.
2. **shared-db #4206:** re-verify current head (was `aa9c8a3d` late in the session). Accept claim #4152 via `--handoff-claim-author --handoff-ready-ref refs/db-author-handoff-ready/4152-20261013130102-a0c0bad9e5c88cbe77fd012a --remote-custody` from a clean worktree at the PR head on branch `codex/2336-complete-support`. If the mutex hangs, run the serialized recovery with `--expected-sha` + `--confirm-stale`. You'll know it worked when the claim body shows a new owner and an active lease.
3. **Push an evidence-only commit** to create a new head, then `--assign-reviewer --review-slot 1` with `--reviewer-allowlist "muse-spark-1.3-contributor,glm-5.3"` (or stepfun), then slot 2. You'll know it worked when both slot refs exist at the new head.
4. **Guarded merge #4206**, preview historical rebind of `20261013130102`, then promote #4284 (`--prepare-preview-dispatch 4281 --admit-issue 4281 --pr 4284` with `SHARED_DB_MERGED_PR_ISSUE_BINDING=4284:4281`). Live-verify `get_popdam_z_nas_password` / `set_popdam_z_nas_password` (or the `get/set_render_z_nas_password` names from the migration) exist and are service_role-only.
5. **Muse re-check of the revised cutover plan** at https://github.com/u2giants/popdam3/blob/popdam/179-z-nas-vault-agent/docs/ops/179-3a-z-vault-cutover-plan.md (commit `28bbb4a7`). Only after APPROVE, run the cutover per that plan. SECRET SAFETY: values 1Password → umask-077 file → psql; never args/stdout/xtrace.
6. **ai-devops #1728:** diagnose the 9 `test-windows-bash-selection.sh` failures on linux shard 3 (likely broken by `5bd08e08`), push fix, CI green, review, merge. Then prove the registry pool has no Qwen.
7. **ai-devops #1754 (`local-tests`):** resolve CONFLICTING against main, then fix Muse REJECT #2: `cmd_authorize_install` (~2018), `cmd_install_verify` (~1971), `application_workflow_finish` (~700/710) still skip the evidence check; wrong refusal wording at 662/1400/1456; add ordering tests. Findings: https://github.com/popcre/ai-devops/pull/1754#issuecomment-6176569630
8. **#357 licensor fill-in** once the DAM scan finishes (500-row pilot, then full). Plan on branch `ops/licensor-fill-plan`.
9. **Remaining gate inventory** (ai-devops #1743 / #335): after local-tests, the ranked private-data gates (`no-raw-content-read`, `licensed-row-containment`, `privacy-classification`).

## 7. Constraints and gotchas in force

- **Muse is the reviewer; Qwen is dropped** (owner, 2026-10-14). DeepSeek out of credit. Do not re-enable Qwen/Gemini/Grok in the active pool.
- **Never push application changes directly to protected `main`.** Feature branch + PR. DesignFlow uses sandbox-albert → develop.
- **Shared-db structural work is claim-first** in `popcre/shared-db`. Never DDL from an app repo.
- **Secrets:** 1Password vault `vibe_coding` only. Never put values in args, stdout, logs, commits, or chat. Values move 1Password → umask-077 file → psql/stdin.
- **Do not `git pull` the installed ai-devops checkout** (detection + instruction only).
- **Muse logs must not be written inside a repo worktree** (dirties source digest).
- **popcre/ai-devops main is merge-queue-only.**
- **Max 2 simultaneous subagents** (owner instruction this session).
- **flash model id:** `mimo-desktop/mimo-v2.6-flash` (not `xiaomi/...`).

## 8. Access and environment

- Host: `edge-dev` (Windows, pwsh). Session id env `MIMO_SESSION_ID` is empty; `SHARED_DB_SESSION_ID` / `SHARED_DB_AUTHOR_ENGINE` must be set for lane tools (e.g. `claude` + a session id).
- `gh` authenticated to `u2giants` and `popcre`.
- `ai-muse` works with `AI_MUSE_CALLER=mimo` (or `claude`); run from the target worktree.
- 1Password vault: `vibe_coding` (Synology SMB share items, Supabase CLI token, OpenRouter key — never copy values).
- Shared-db tool worktree at `C:\repos\shared-db\.ai\worktrees\4152-accept` (detached at `82adbf804`). Successor worktree `4152-successor` at PR head on `codex/2336-complete-support`. PR-4272 worktree `4272-qwen`.
- popdam3 working copy is on branch `feature/windows-agent-service-install` with pre-existing untracked verification PNGs — do not delete those (another session owns them).

## 9. Open questions and risks

- **#4206 head moved** from `61b97f6` to `aa9c8a3d` during the session without our action — another session is working it. Re-verify before any claim/mutation. (2026-10-14)
- **Author mutex** may still be held; the serialized recovery path is untested from this machine.
- **MiMo is not a first-class claim-owner** in shared-db session authority; cross-machine handoff may refuse a MiMo identity.
- **#1754 is CONFLICTING** — another session may be editing the same gate files.
- **Fragile CI on ai-devops:** `explain cache directory is private` always fails on Windows (MSYS chmod); grok out-of-credit fails `test-ai-review-lifecycle.sh` on some runs. Do not treat those as regressions.

---

## Part (b) — sub-agent blocks

### Agent: general-4 / revise 179 3a cutover plan
- **Asked to do:** fix every Muse REJECT finding in the Z: cutover plan.
- **Actually did:** commit `28bbb4a7` pushed to `popdam/179-z-nas-vault-agent`; comment on popdam3 #179.
- **Found:** restorable rollback (not digests-only) and non-empty guards were the Critical gaps; Vault RPC names and 1Password restore items identified.
- **PR / branch:** `popdam/179-z-nas-vault-agent`
- **Worktree:** finished (safe to clean after Muse re-check)
- **Deliberately did NOT do:** run the cutover itself; no code changes.

### Agent: general-5 / land Qwen-removal PR 4272
- **Asked to do:** Muse review + merge shared-db #4272.
- **Actually did:** obtained Muse APPROVE (twice, on older heads); could not produce a durable verdict artifact at the latest head; merge workflow refused.
- **Found:** merge needs an APPROVE artifact tied to the latest slot assignment, not a PR comment.
- **PR / branch:** https://github.com/popcre/shared-db/pull/4272
- **Worktree:** finished
- **Deliberately did NOT do:** force-merge; new paid Muse draws (refused).

### Agent: general-8 / clear 4272 merge blocker
- **Asked to do:** write the durable APPROVE artifact and dispatch the guarded merge.
- **Actually did:** GLM-5.3 replacement review APPROVE → `refs/db-review-verdict-replacements/4280-4272-b16641cfad5f0c37de19af054ca312a48bda0758-6516`; guarded merge run 38596167705 succeeded; **#4272 MERGED `9595a63f`**.
- **Found:** Muse slot-1 was terminally failed/replaced; ship gate needed a stepfun final-check APPROVE.
- **PR / branch:** merged
- **Worktree:** finished
- **Deliberately did NOT do:** no source edits.

### Agent: general-6 / general-7 / general-9 / general-12 / general-13 / never-open-raw-transcript-archives
- **Asked to do:** open, fix, review, and land the first ranked ai-devops gate.
- **Actually did:** PR #1747 opened; Muse REJECT #1 (case-sensitive paths, application-workflow early return) fixed in `c793b5ed`; Muse REJECT #2 → fix `c793b5ed`/follow-ups; Muse APPROVE recovered from turn stream; **MERGED `a6cd1dd9`**.
- **Found:** Muse turns need Start-Process; verdict recoverable from stream JSONL when reconcile is busy; ai-devops is merge-queue-only.
- **PR / branch:** https://github.com/popcre/ai-devops/pull/1747 (merged)
- **Worktree:** `C:\repos\ai-devops-wt-raw-transcript` (finished; safe to clean)
- **Deliberately did NOT do:** force-merge.

### Agent: general-14 / local-tests gate
- **Asked to do:** fix Muse REJECT on local-tests and land it.
- **Actually did:** commit `d1e12965`, PR **#1754** opened; Muse REJECT #2 with remaining skip sites (authorize-install, install-verify, application-workflow-finish) and missing ordering tests.
- **Found:** flag must be set before approval call sites; refusal wording must name local-tests.
- **PR / branch:** https://github.com/popcre/ai-devops/pull/1754 (OPEN, later CONFLICTING)
- **Worktree:** `C:\repos\ai-devops-wt-local-tests` (live/resumable)
- **Deliberately did NOT do:** merge on REJECT.

### Agent: general-15 / 1728 CI
- **Asked to do:** land ai-devops #1728 (Qwen drop).
- **Actually did:** pushed `d9027576` (qwen lifecycle-test fix) after rebase onto `5bd08e08` (another session's suspension fix). CI still red on linux shard 3.
- **Found:** `test-windows-bash-selection.sh` 9 failures likely from `5bd08e08`, not our change. Pool confirmed muse/deepseek/glm/stepfun without Qwen.
- **PR / branch:** https://github.com/popcre/ai-devops/pull/1728 (OPEN)
- **Worktree:** `C:\repos\ai-devops-wt-1728` (live/resumable)
- **Deliberately did NOT do:** merge while CI red; wrap-up freeze hit mid-work.

### Agent: general-16 / local-tests REJECT 2
- **Asked to do:** fix the remaining skip sites on #1754 and get Muse APPROVE.
- **Actually did:** implemented authorize-install / install-verify / application-workflow / same-source deploy coverage, refusal wording at 662/1400/1456, static ordering + behavioral tests. Committed and pushed as `09e82988` to `feat/gate-local-tests-evidence` during wrap-up (finish-in-progress). Tests not run to completion; Muse re-review NOT started (scope freeze).
- **PR / branch:** https://github.com/popcre/ai-devops/pull/1754
- **Worktree:** `C:\repos\ai-devops-wt-local-tests` (live/resumable)
- **Deliberately did NOT do:** Muse re-review and merge — wrap-up freeze; next session must run tests, Muse, then merge.

---

Self-audit: sections 0–9 present; §0 holds every owner decision; dead ends in §4; next steps have verification gates; file/commit refs use GitHub URLs; secrets by vault name only; sub-agent blocks separated in part (b). Street-newcomer can continue from §6 alone once Albert answers §0 item 1.
