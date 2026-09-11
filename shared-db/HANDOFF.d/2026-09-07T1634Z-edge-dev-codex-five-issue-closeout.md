---
issue: 1090
status: OPEN
owner: codex/session-closeout-20260907-1634
---

# Shared-db coordinator closeout: migration 20260906035323 and five-issue assignment

## 0. Decisions only the owner can make

None — nothing remaining in this workstream needs a new owner decision.

Already settled; do not re-ask:

- On 2026-09-07 Albert explicitly authorized applying migration `20260906035323` to the live shared database. It was applied and verified; issue #2494 is closed.
- For issue #1322, the 2026-09-07 direction is to preserve the newer #1686 ruling: do not restore the removed Licensors/Properties tree. Continue only with the narrow status control already described on #1322.
- Do not weaken reviewer, preview, guarded-merge, target-proof, or worktree-safety gates to finish faster.

The next session should not send Albert a decision request unless new evidence creates a genuinely new choice.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of POP Creations' shared Supabase database. Its orchestrator serializes schema authors, shared preview use, independent review, merges, and production promotion so several applications cannot make incompatible structural changes.

Repository: https://github.com/u2giants/shared-db. Production project proved during this session: `qsllyeztdwjgirsysgai`. Secrets remain in 1Password vault `vibe_coding`; no values belong in this file.

## 2. What we set out to do this session, and why

Albert asked this session to start the shared-db orchestrator, explain what migration `20260906035323` still needed, then resolve the five open issues with the greatest downstream blocking impact, oldest first. He later explicitly authorized the live production apply and invoked closeout.

The five selected oldest high-impact non-structural/repository issues were #1031, #1090, #1322, #1403, and #1868. Structural successors and PopSG refill work were delegated rather than implemented in the coordinator context.

## 3. Current state — what is true right now

Moving facts were rechecked at 2026-09-07 16:46 UTC:

- Current `origin/main` was `85015041f660bdebc5474751e63e12618d275b03`. Maximum migration on that commit was `20260907131610_popsg_search_style_guide_library_v2.sql`. Recheck both before acting.
- The live marker was #2517, route `01a07bca-4662-7323-9a55-1f6499864bd1`, host `vps2`, titled `shared-db.orch PopDAM issue closeout`. This session's marker #2497 is closed. Always rerun `node scripts/check-orchestrator-marker.mjs --resolve`; do not route from this file.
- Migration `20260906035323_style_group_rebuild_guard_and_ungroup.sql` is applied to production. Production run 34137289635 succeeded at exact main `7dade0beea9a484433297a7a4c1534ff77b65f4e`; ledger after-state contains the version and catalog checks passed for `public.rebuild_style_groups_batch` and its intended grants. Issue #2494 is closed.
- Of the five selected issues, only #1031 is closed. #1090, #1322, #1403, and #1868 remain open.
- #1090 is an umbrella repo-maintenance/documentation tracker. Its structural successors #2336, #2356, and #2357 are now dependency-eligible; #2358 still depends on #2336. This was sent to live orchestrator #2517.
- #1322 remains open, but its narrow linked-row status control merged through PR #2514 as `85015041f660bdebc5474751e63e12618d275b03`. Do not revive PR #2278's removed Properties tree. Live/operational acceptance and the separate 66-row admission are not proven by the merge.
- #1403 remains blocked. Its activation gates are authoritative in `config/agent-work-contract-activation.json`; do not flip either switch from the issue prose alone.
- #1868 remains blocked while any orchestrator marker is open. Marker #2517 is open, so no reap is safe now.
- PopSG issue #2506: PR #2512 merged at `b691e1f594d789ea1a3cd8c2f99236183cdd2ee1`; issue #2506 is still open and therefore production/closeout evidence is not complete.
- PopSG issue #2509: PR #2513 is open and mergeable at refreshed exact head `122ff6dd76686f1399588378f422e18105760d00`; claim #2511 is open and a prior-head `preview_ready` event exists. Exact-head checks/review must be re-derived. Its preview apply, governed merge, production promotion, and issue close are not proven.
- Preview is a shared mutable environment. This closeout did not run a fresh preview inventory. The immutable issue events prove readiness, not the current complete preview state; the live orchestrator must re-resolve the preview selector before dispatch.
- The canonical checkout `C:\repos\shared-db` was deliberately not modified. It already contains another session's `.mcp.json` modification, four untracked `.ai/queue-audit-*.txt` files, and two older untracked handoffs. Preserve them and determine ownership before any cleanup.

## 4. Everything we tried that did not work

- Production run 34136038005 stopped before SQL because the prior preview artifact was produced from a different exact main commit. This was a correct refusal, not a database failure.
- Historical recovery run 34136676462 was first invoked in its default dry-run mode. A dry-run creates no qualifying recovery evidence, so it could not authorize production.
- Production run 34136908771 then stopped before SQL because the recovery artifact did not name the exact migration file. No SQL ran in either failed production attempt.
- The correct recovery route was historical recovery in `apply` mode, run 34137120188, tied to immutable original preview run 34039900893. That allowed the successful production run 34137289635.
- A live ledger-drift check after production exited 1 because unrelated migration `20260907031246` was still pending (plus retired/held entries). It did not mean `20260906035323` failed; the exact target was present in the production ledger artifact.
- PR #2513's first review findings comment could not be recorded because no matching durable reviewer assignment existed. That findings comment was explicitly voided and is non-authorizing. Never treat it as an approval; use only a matching create-only verdict artifact.

## 5. Root causes and key findings

- Production promotion is bound to exact migration bytes, exact main, immutable preview evidence, a matching review, and a filename-aware recovery artifact. A successful historical dry-run or a catalog observation is not a substitute.
- Issue priority is transitive and dependency-sensitive. #1090 itself is not a structural author assignment; its exact structural successors must be admitted separately.
- Repository-maintenance #1868 cannot safely reap worktrees while a live orchestrator marker exists because a clean worktree can still belong to an active worker.
- A merged pull request is not proof the related operational issue is finished. #2506 remains open after PR #2512 merged, and #2509 remains open with PR #2513.
- No durable standing documentation outside this handoff was found to be made false by this session. The documentation pass therefore changed only this handoff.

## 6. Exact next steps

1. Resolve the live marker again and confirm #2517 (or its successor) acknowledges ownership. Success is the resolver printing one current route and the destination replying, not mere message delivery.
2. Let the live orchestrator finish #2506 from merged PR #2512 through the required production and closeout evidence. Success is issue #2506 closed with immutable run links and ledger/catalog proof.
3. Continue #2509 / PR #2513 from exact current head only: re-resolve preview dispatch, apply preview, record matching independent verdict, guarded-merge, promote, and close. Success is issue #2509 closed, claim #2511 retired by the governed lifecycle, and production verification attached.
4. For #1090, dispatch dependency-eligible structural successors #2336, #2356, and #2357 through independent author lanes; dispatch #2358 only after #2336 is proven complete. Success is all four successors closed with governed evidence, then #1090 reconciled and closed by its repo-maintenance owner.
5. Resume the non-orchestrator five-issue thread for #1322 and #1403. For #1322, verify PR #2514's narrow status-only control in the live workflow, keep the 66-row admission separate until that control is live, supersede/close PR #2278 appropriately, and close #1322 only with acceptance evidence. For #1403, evaluate the current activation JSON gates and change switches only if every recorded gate is true. Success is each issue closed with its required PR/live proof.
6. Run #1868 only after `check-orchestrator-marker.mjs --resolve` proves zero open markers. Start with the reaper dry-run and preserve every dirty, locked, live, or unmerged worktree. Success is an evidence-backed apply report and #1868 closed without losing unique work.
7. Re-run the queue audit and verify every remaining obligation has an open `db-work` issue. Success is a fully audited queue with no obligation existing only in prose.
8. When all obligations above are proven complete, delete this handoff in the completing PR under the successor rule. Success is #1090 closed and every other obligation either closed or carried into a newer open handoff before deletion.

## 7. Constraints and gotchas in force

- Only the one current orchestrator may dispatch or mutate structural queue work. Re-resolve before every delegation and require acknowledgment.
- Keep the canonical checkout landing-only. Work in isolated current-main worktrees; never discard or stage another session's files.
- Preview readiness is not preview application; preview application is not production; merge is not operational acceptance.
- Never edit an applied or previewed migration version. Use a new forward migration for any repair.
- Protected reviewer verdicts are exact-head and create-only. A prose findings comment is not authorization.
- Do not manually delete author/reviewer coordination refs or bypass the guarded lifecycle.
- Worktree age and `git branch --merged` are insufficient cleanup evidence, especially after squash merges. Ask GitHub whether the PR merged and inspect dirty/unique state.
- Shared database writes require immediate target proof. Production authorization here covered only migration `20260906035323` and has been consumed.

## 8. Access and environment

- GitHub CLI was authenticated for `u2giants/shared-db` during this session.
- The successful production workflow used repository-managed credentials and target proof; no secret values were exposed to chat, files, commits, or logs by this session.
- Durable credentials belong only in 1Password vault `vibe_coding`.
- This handoff was authored in isolated worktree `C:\repos\shared-db-worktrees\session-closeout-20260907-1634` on branch `codex/session-closeout-20260907-1634`.
- Live orchestrator at verification time: issue #2517 / route `01a07bca-4662-7323-9a55-1f6499864bd1` on `vps2`; treat as stale until re-resolved.

## 9. Open questions and risks

- No owner question is open as of 2026-09-07 16:46 UTC.
- The marker, main SHA, maximum migration, PR heads, claims, and preview contents are moving facts; recheck immediately before action.
- #2506 being open after merge likely means promotion/closeout is still running or pending. Do not infer production state from the merge.
- #2513 has a non-authorizing failed-recording review comment followed by later findings. Only the durable exact-head verdict ref can authorize merge.
- The canonical checkout's untracked `.ai` and old handoff files were not created or claimed by this closeout. Cleaning them without ownership proof risks data loss.
- The 2026-09-07 16:38 UTC stale-handoff report found seven files whose issues are closed and which no open issue still cites. Scope freeze prevented starting their retirement; a maintenance PR should verify and delete only these exact files: `2026-08-14T2236Z-al8960ofc-claude-coldlion-history-endpoints.md` (owner `al8960ofc/claude-coldlion-history-endpoints-13b4f3 (session ended)`), `2026-08-31T2340Z-edge-dev-claude-coldlion-reply-ready-to-send.md` and `2026-09-04T0129Z-edge-dev-claude-coldlion-reply-20260903-ready-to-send.md` (owner `claude/coldlion-api-validation-proofread-1d2edd`), `2026-09-06T0030Z-edge-dev-claude-orchestrator-2330-closeout.md` (owner `claude/shared-db-orchestrator-8ca8f3`), `2026-09-06T1330Z-edge-dev-2-claude-orch-2404-closeout.md` (owner `claude/shared-db-orchestrator-ed94bd`), `2026-09-07T0620Z-edge-dev-claude-orchestrator-blocker-issues.md` (owner `claude/handover-orch-6172c135`), and `20260906T205200Z-edge-dev-shared-db-orch-5e0e7c81-orchestrator-closeout.md` (owner `claude/shared-db.orch-5e0e7c81`). Seven other closed-issue files remain cited by open issues and must not be retired.

## Delegated worker records

### Agent: non-orch shared-db / task `01a07bce-9266-7232-acf3-2d9f24fdaebf`

- **Asked to do:** Resolve the five highest-impact non-orchestrator issues, oldest first.
- **Actually did:** Closed #1031; completed and guarded-merged prerequisite repository repairs including #2504 / PR #2237 and #2157 / PR #2245; implemented the narrow #1322 control through merged PR #2514; reconciled the remaining five-issue states and sent the structural successor request to the orchestrator.
- **Found:** #1090 cannot be closed until its exact structural successors land; #1322 had conflicting old/new owner rulings but now has a 2026-09-07 narrow-control direction; #1403 is gate-bound; #1868 is marker-bound.
- **PR / branch:** PR #2514 merged as `85015041f660bdebc5474751e63e12618d275b03`; older PR #2278 must be superseded/closed without reviving its removed tree. Other completed prerequisite PRs are recorded on their issues; remaining deliverables are issue acceptance and closure, not one shared branch.
- **Worktree:** Worker task is no longer active in this coordinator. Its individual worktrees must be assessed by the reaper; do not assume safe from task state.
- **Deliberately did NOT do, and why:** Did not author structural #1090 successors in a repo-maintenance context and did not reap worktrees while an orchestrator marker was open.

### Agent: issue 2506 PopSG search

- **Asked to do:** Implement PopSG guide-mode search and launch-filter database structure.
- **Actually did:** Authored migration `20260907131610`, tests, and PR #2512; exact head `dff809bc476b64480e0761d21012dde2ba39ac8c` merged as `b691e1f594d789ea1a3cd8c2f99236183cdd2ee1` at 2026-09-07 16:04 UTC.
- **Found:** The structural contract passed its required checks; operational closure still remains because issue #2506 is open.
- **PR / branch:** PR #2512 merged; branch `codex/issue-2506-popsg-search-v2`.
- **Worktree:** Agent is finished, but cleanup belongs to the marker-safe governed reaper; no manual removal was attempted.
- **Deliberately did NOT do, and why:** Did not claim production completion from a merged PR.

### Agent: issue 2509 PopSG preview stats

- **Asked to do:** Repair PopSG preview-stat timeouts without increasing the timeout or removing existing behavior.
- **Actually did:** Authored migration `20260907131728`, a contract test, and PR #2513. The author handoff head `92c168167fd6c873954ab648a9a9ff38c867d79a` passed its checks; the live orchestrator refreshed the branch to `122ff6dd76686f1399588378f422e18105760d00`, so exact-head gates must be re-derived. Claim #2511 remains open and a prior-head preview-ready event exists.
- **Found:** The solution uses an additive classification contract and a compact partial expression index; the first attempted reviewer recording was invalid because its assignment was missing.
- **PR / branch:** PR #2513 open; branch `codex/issue-2509-popsg-preview-stats`.
- **Worktree:** Live/resumable through the current orchestrator; preserve until the issue is closed and GitHub proves merge state.
- **Deliberately did NOT do, and why:** Did not bypass the missing-verdict refusal, infer preview apply from readiness, or claim merge/production completion.

## Final evidence-backed self-audit

1. **Yes, a brand-new developer can continue without context.** Sections 1–3 define the repository, original goal, exact live state, identifiers, and ownership; section 6 gives ordered executable steps with success gates.
2. **Yes, the handoff preserves the session knowledge needed to work at the same level.** Sections 4–5 record every material failed attempt and non-obvious cause; the worker blocks separate each delegated result and omission.
3. **Yes, every execution dimension is covered.** Sections 2–9 cover purpose, state, failures, findings, actions, constraints, environment, risks, production evidence, preview uncertainty, and moving-fact timestamps. No gap was found on reread.
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of sections 1–9 and all worker blocks found no unresolved owner choice. The consumed production authorization and #1322 direction are both listed in section 0 as settled decisions that must not be re-asked.
