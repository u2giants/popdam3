---
issue: 2368
status: OPEN
owner: claude/handoff-2829-sweep-successor
---

# Non-orchestrator sweep — successor to 2026-09-22T2032Z-916-codex-non-orchestrator-sweep

## 1. Goal
Continue section 6 of `HANDOFF.d/2026-09-22T2032Z-916-codex-non-orchestrator-sweep.md` in order. All items are non-orchestrator work. Preserve every ownership and Claude-session exclusion listed there. Do not suppress the evidence-head check, do not bind evidence to an unreviewed head, and do not retire Grok.

## 2. Done this session
- Step 1, #2829: complete. ai-devops PR #680 merged as `e8ad5c6a`.
- Step 2, PR #3186 (for #2368/#2369/#2370): the reviewer slot that Muse had failed (sequence 3446, wrapper_terminal_failure) was replaced with **gemini-3.8-flash-high**, sequence **3530**, slot 1. The replacement ref is `refs/db-review-replacements/2368-3186-ddbb2964db825c87dbeaf5cab80e7eb39dbe6c5d-3446`. The review is at head `ddbb2964`.
- Gemini was re-qualified live on edge-dev with `ai-review-preflight qualify gemini` (exit 0).
- A signed correction comment was posted on PR #3186 (issuecomment-5788354664). It says sequence "3529"; the real sequence is 3530.

## 3. In flight at close
- A background Claude agent was running the Gemini review of PR #3186 at `ddbb2964`. First check whether a verdict for sequence 3530 exists on the PR.
  - If APPROVE, dispatch the guarded merge.
  - If REVISE, fix the pull request and request a new exact-head review.
  - If there is no verdict, run the Gemini review again with the manage-migration-author-lanes reviewer flow.

## 4. Remaining steps (unchanged from predecessor §6)
3. PR #3375 for #2839: repair its keyed contract and completion evidence.
4. Branch `codex/2374-2376-keyed-evidence`: open its PR.
5. PR #3188, then PR #3214.
6. PR #2607, only after Claude PR #3320 resolves.
7. Bundle #2831, #2787, #3324, #3348 in one worktree.
8. Re-check the owners of #2326, #3342, #3353 and #3343 before acting.
9. Ask Albert once about the #2701 and #2290 decisions.
10. Write the successor handoff.

## 5. Facts learned (do not re-derive)
- The refusal line in `--replace-failed-reviewer` that lists "busy" reviewers is informational only. Concurrent leases are on, so busy never blocks a draw. The owner confirmed there is no concurrency limit.
- The real causes of the empty draw:
  - Qwen and Gemini were locally quarantined by `ai-review-preflight` (live-qualification-required).
  - Kimi is out of credit (since 2026-09-10).
  - Grok has a terminal exclusion on this PR: `refs/db-review-exclusions/2368-3186-grok-4.6`.
- Fix a local quarantine with `ai-review-preflight qualify <provider>`.

## 6. Blocked / deferred
- **Qwen does not qualify on edge-dev.** Its error is "ai-qwen: error: 1Password CLI is required to resolve the managed Qwen Coding Plan credential." Fix the `op` CLI availability for the ai-qwen wrapper on this machine (ai-devops toolkit), then run `ai-review-preflight qualify qwen`.
- Misleading "busy" wording in the refusal message (`scripts/manage-migration-author-lanes.mjs`, around line 6681). This is a repo-maintenance fix, not orchestrator work. It was not filed.

## 7. Failed paths
- Treating "busy" as the blocker was wrong.
- Drawing a replacement before qualifying Gemini failed with an empty candidate set.

## 8. Verify
Run `gh pr view 3186 --repo popcre/shared-db --json state,mergedAt`. It must show MERGED before step 3 starts.

## 9. Workspace
Worktree `C:\repos\shared-db\.claude\worktrees\issue-2829-non-orchestrator-5598e9` holds no unique work. The ai-devops worktree `fix-2829-grok-evidence` is merged (PR #680).

Posted by Claude chat 5f009b78-f897-4081-a133-9ae775fd8118 on edge-dev
