---
issue: 1015
status: OPEN
owner: codex/issue-1015-dynamic-queues
---

# HANDOFF — shared-db orchestrator workflow transfer (2026-08-14 21:56 UTC, al8960ofc/Codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking

None. Albert has already made the business decision this handoff exists to preserve. The next session must implement it, not ask him to restate it.

### Already settled — do NOT re-ask

- **Production approvals, 2026-08-14:** asking Albert to approve a migration number, database identifier, SQL statement, or other technical detail is useless because he cannot meaningfully verify it. Replace that with a business-risk gate. After independent review, green checks, preview proof, and guarded merge, routine low-risk changes may go to production automatically. Ask Albert only when existing data may be lost or permanently changed, users may be interrupted, access materially changes, recovery is uncertain, or the reviewing models cannot resolve a material disagreement. This ruling is recorded on [issue #1015](https://github.com/u2giants/shared-db/issues/1015#issuecomment-5298558089).
- **Transition safety, 2026-08-14:** the old exact-production-approval rule remains binding until the replacement is implemented, independently reviewed, merged in both repositories, installed, and forward-tested. The new policy cannot authorize its own rollout.
- **Continuous queues, 2026-08-14:** keep three collision-separated migration-author queues busy whenever eligible work exists. Refill a freed queue in the same coordination turn without waiting for Albert.
- **External review rotation, 2026-08-14:** finished issues rotate through Grok 4.6, GLM 5.2, Kimi K3, and Qwen 3.8 Max, then repeat. Use the approved persistent wrapper, debate verified objections in the same session, and stop after the initial review plus at most three rebuttals. Unresolved material disagreement goes to Albert in business language.
- **Model scorecard, 2026-08-14:** append objective results after each external review to `C:\repos\ai-devops\models_comparison_grok_kim_glm.md`. Record defects caught, false positives, policy adherence, continuity, time, turns, and only usage/cost figures the wrapper actually exposes. Kimi exposes no trustworthy token, cache, cost, or returned-model figures, so those remain `unavailable`.
- **No updates on #958 or #964, 2026-08-14:** both are complete and Albert no longer wants them included in status reports.

The new session should not send Albert another decision list. Everything currently needed from him is settled above.

## 1. What this application is

`u2giants/shared-db` is the source of truth for the structure of POP Creations' shared Supabase database. It contains ordered migrations, tests, database contracts, and DB Data Admin. Multiple applications depend on it, so one orchestrator coordinates structural changes and prevents two agents from changing the same database area at once.

The canonical repository is `C:\repos\shared-db`, GitHub is [u2giants/shared-db](https://github.com/u2giants/shared-db), preview is Supabase project `rjyboqwcdzcocqgmsyel`, and production is `qsllyeztdwjgirsysgai`. The companion operating-skill repository is `C:\repos\ai-devops`, GitHub [u2giants/ai-devops](https://github.com/u2giants/ai-devops).

GitHub issue [#960](https://github.com/u2giants/shared-db/issues/960) is the still-open single-orchestrator marker. Leave it open during the fresh-session transfer. The incoming orchestrator should adopt it rather than open a competing marker.

## 2. What we set out to do this session, and why

This long-running orchestrator session began by recovering work performed outside proper coordination, then ran multiple schema workstreams. The immediate transfer objective is narrower: finish and institutionalize the new orchestrator workflow without consuming this already-large chat context.

The intended workflow has three parts:

1. Three database-author queues stay full with non-colliding work and refill automatically.
2. Completed work receives a durable round-robin external review using Grok, GLM, Kimi, then Qwen. Verified objections are debated to agreement or escalated after a fixed bound.
3. Production approval becomes a meaningful business-risk decision. Routine reviewed, reversible, preview-proven work proceeds automatically; Albert is asked only about material business risk, never technical identifiers he cannot assess.

Issue [#1015](https://github.com/u2giants/shared-db/issues/1015) and its two repository PRs own this workflow change.

## 3. Current state — what is true right now

### Moving baseline, refreshed 2026-08-14 22:00 UTC

- `origin/main`: `3301a25870dd235ceb4fad54cc6917c88e013e00`.
- Latest migration on `origin/main`: `20260814213043_pmt_metadata_element_normalization.sql`.
- Open work PRs now include replacement #963 PR [#1025](https://github.com/u2giants/shared-db/pull/1025), [#1019](https://github.com/u2giants/shared-db/pull/1019), and workflow PR [#1021](https://github.com/u2giants/shared-db/pull/1021). Old #963 PR #1018 is closed after governed version recovery. PR [#1006](https://github.com/u2giants/shared-db/pull/1006) merged at `3301a25870dd235ceb4fad54cc6917c88e013e00` at 22:00 UTC.
- Preview contains #965 migration `20260814213043`, now explained by `main`. #961 may proceed after it updates and repeats exact-head review/checks. Do not repair or delete the preview ledger.
- Production contains migration `20260814210518` from completed #953. No active production lock was reported after that successful promotion.
- The primary checkout has pre-existing unrelated changes and untracked files, including `.gitignore`, `.ai/*`, `HANDOFF.d/start-phase-7a-prompt.md`, `claim-931.md`, and `docs/verification/item-mg-reclassification-20260814/`. They belong to other sessions. Do not stage, delete, move, or “clean” them.

### #1015 workflow implementation

- Shared-db worktree: `C:\repos\shared-db-codex-worktrees\issue-1015-dynamic-queues`.
- Branch: `codex/issue-1015-dynamic-queues`.
- Shared-db PR: [#1021](https://github.com/u2giants/shared-db/pull/1021), latest reported pushed head `0f0e489bda7cbdb7afff54ea768d75878e5ee097`; worktree clean; checks green except long-running temporary-database/app verification at snapshot time.
- AI-devops worktree: `C:\repos\ai-devops-codex-worktrees\issue-1015-dynamic-queues`.
- AI-devops PR: [#24](https://github.com/u2giants/ai-devops/pull/24), latest reported pushed head `1ca50358e35f461279bdae48d412dd99f209e0dd`; worktree clean.
- Implemented before final review: scope parser, three collision components, priority/dependency/skip handling, empty-lane proof, persistent reviewer cursor Grok → GLM → Kimi → Qwen, retry protection, shared-lock protection, AGENTS rules, canonical skill/manual/metadata, and forward-test evidence.
- Prior tests: 100/100 queue/collision tests, skill validation, and skill drift passed on the earlier head.
- The first independent review returned REVISE and found:
  - Critical: with two active claims and one unrelated eligible issue, the algorithm can queue the candidate behind an occupied lane and leave the third lane empty.
  - High: a dependency on an open issue without the `db-work` label is incorrectly treated as closed.
  - High: retrying a reviewer assignment after another assignment can change the reviewer.
  - Medium: duplicate scope fences are accepted.
- The queue/reviewer defects and the first production-policy contradiction were patched, with 105/105 tests plus skill validation. **Current independent verdict is REVISE. Do not merge #1021 or #24.** Exact-head review found three High enforcement gaps: the risk gate trusts caller-written booleans/prose instead of proving the exact review/check/preview/merge evidence; no governed production workflow consumes and enforces the result; and activation is prose-only, so it could be used before both repositories are merged, installed, and forward-tested. The policy has not authorized its own production action.

### Three active migration-author workstreams

1. **#965 Paramount metadata normalization** is complete: PR #1006 merged at `3301a25870dd235ceb4fad54cc6917c88e013e00`; preview migration `20260814213043` is now on `main`. Verify issue #965 and claim #998 are closed/released before refilling that lane.
2. **#963 durable curated decisions** owns replacement claim #1024 and migration `20260814220500`. Replacement PR #1025 is active at head `1f40808`; fresh CI is starting and the preserved GLM session has not returned its initial verdict. Old PR #1018 and claim #1016 were safely closed/released because #965 made their version backdated. #963 has not touched preview and is paused for transfer.
3. **#961 licensing 3D statuses** owns replacement claim #1026 and version `20260814220838`. PR #1019 is temporarily closed. Its worktree intentionally contains an uncommitted pure migration-file rename from backdated `20260814213027` to `20260814220838`; no SQL content changed. It has not touched preview and is paused for transfer.

The version numbers do not represent merge order once another migration lands first. Every branch must update from the latest `main`; if its reserved version becomes older than the latest merged migration, use the governed claim/version recovery rather than renaming an applied preview migration or bypassing guards.

### Reviewer rotation already begun

- #961 used Grok 4.6 and received APPROVE on head `62b57394ace35700616a4df241317d22ac98d4e2`. Total reported cost was `$0.39959826`; the first broad run hit its turn limit without a verdict, and a constrained two-turn retry approved.
- #963 is assigned GLM 5.2 in persistent session `issue-963-final-review`.
- #965 used Kimi K3 and merged after approval.
- The next completed issue after those uses Qwen 3.8 Max. Never override wrapper model/reasoning pins by hand.

## 4. Everything we tried that did NOT work

### Workflow and coordination failures

- The original single migration-writer lane serialized unrelated work and left developers idle. Three author lanes were introduced, but several safety-tool defects then appeared: cross-host allocation races, expired leases losing protection, malformed claims blocking audits, open PRs omitted from collision checks, stale lock cleanup failures, missing workflow tools, and missing PR metadata hydration. These were repaired through #976 and follow-up PRs #983, #985, #986, and #987. Do not return to the one-writer rule.
- The first #1015 queue algorithm is still wrong. It groups one eligible issue behind an occupied component instead of placing it in the genuinely empty third lane. The independent review's exact reproduction is authoritative; fix it before merging.
- Treating only `db-work` issues as dependency truth made an open dependency without that label look complete. Dependency state must come from the referenced issue's actual state, not whether it participates in the migration queue.
- The reviewer cursor retry was not stable after another assignment advanced the cursor. A retry for the same issue must return the same reviewer, not consume or select a different reviewer.

### Model review failures and lessons

- Grok's first #961 review was too broad and hit the 20-turn cap without a verdict after 3,290,986 tokens. A constrained exact-head review finished in two turns. Keep review prompts bounded to the issue's final diff and explicit contract.
- Grok's #965 final review also hit its turn limit without a verdict after 3,950,550 tokens and `$0.44553464`. A cancellation is not approval.
- Kimi does not expose trustworthy token, cache, cost, or returned-model information in headless mode. Do not invent comparative metrics.
- #963's first GLM attempt from a linked worktree failed closed because Git metadata lived outside the permitted repository path. It was aborted/deleted and restarted from a normal isolated clone. Continue the restarted named session, not the failed one.
- The local `ai-codex-review` command was unavailable for #963. Direct Codex review found real defects, but the new standing rotation now requires the named external reviewer too.

### Preview and migration failures

- #961 preview run `31844251461` stopped safely before writing because preview contains unmerged #965 version `20260814213043`. This is expected safety behavior. Merge #965 first; never use migration-ledger repair to hide it.
- #965 guarded merge run `31844353758` stopped because `main` advanced during the run. It correctly made no merge. Update to current `main`, re-review the exact new head, rerun checks, then retry.
- Several earlier migrations had to rotate versions after `main` gained later migrations. An applied preview migration cannot be renamed. Preserve exact applied versions and use a reviewed fix-forward or exception path if needed.

## 5. Root causes and key findings

- **Albert's approval must be meaningful.** Technical production approvals provide no safety because Albert cannot validate migration identifiers or SQL. The replacement gate must describe business consequences: permanent data change, downtime, access change, uncertain recovery, or unresolved expert disagreement.
- **Automation cannot approve its own safety relaxation.** Until the new policy is reviewed, merged in both repositories, installed, and forward-tested, the old exact-production-approval rule remains in force.
- **Three lanes are capacity, not three fixed database partitions.** Queue assignment must be recomputed from live object overlap. An unrelated eligible issue must occupy an empty lane in the same coordination turn.
- **Author concurrency and integration concurrency are different.** Up to three unrelated migrations may be authored simultaneously, but preview and merge remain globally serialized.
- **Round-robin state must survive sessions and retries.** The reviewer choice cannot live in chat memory. The GitHub-backed cursor and per-issue assignment must be atomic and retry-stable.
- **Agreement is not evidence.** The orchestrator verifies every reviewer claim against the exact diff and tests. Debate ends at consensus or after three rebuttals; unresolved material risk goes to Albert.
- **Preview is shared mutable state.** Its ledger currently proves #965 applied. Every other preview run must wait for #965 to land on `main`.

## 6. Exact next steps

1. **Adopt the live orchestrator marker.** Read [#960](https://github.com/u2giants/shared-db/issues/960), comment that the fresh Codex session has taken over, and do not open a second marker. You will know it worked when #960 remains the only open `orchestrator-marker` issue and names the new session.
2. **Re-read moving state.** Fetch both repositories; inspect PRs #1006, #1018, #1019, #1021, ai-devops #24, active claims, current `origin/main`, latest migration, coordination refs, and preview ledger. You will know it worked when the new handoff comment records fresh SHAs and identifies any change since 21:56 UTC.
3. **Verify #965 closure and refill its lane.** Confirm issue #965 and claim #998 closed after merge `3301a258`; if not, close/release them with the merge evidence. Then allocate the freed lane in the same turn. You will know it worked when the live lane audit no longer counts #998 and either shows a new eligible claim or proves none exists.
4. **Resume #961's governed version recovery.** In its preserved worktree, inspect the pure rename, commit it, change the PR body from claim #1017 to #1026, push, and reopen PR #1019. Rerun exact-head Grok review/checks because the pushed head changes, then bounded preview, guarded merge, claim #1026 release, and issue closure. You will know it worked when PR #1019 is merged, its issue/claim are closed, and preview contains a migration present on `main`.
5. **Finish #963.** Wait for replacement PR #1025 head `1f40808` CI, continue the existing GLM session after its initial older-head turn returns, relay the complete exact-head delta, and resolve verified objections within the three-rebuttal bound. Then preview, guarded-merge, release claim #1024, and close #963. You will know it worked when PR #1025 is merged and all four #963 contract suites pass in preview. Do not promote #963 under the old rule without exact approval; under the new rule, classify its business risk after that rule is active.
6. **Keep three author lanes full.** Each time #998, #1017, or #1016 releases, run the corrected queue allocator and immediately claim the highest-priority eligible non-colliding issue. Current known successors include #999 behind #963; #970 then #969 behind the Paramount sequence; #853 PopDAM OrderList; #912 licensing normalization; #945 production-only Disney work; #974 only after consumer apps stop using compatibility views. You will know it worked when all three lanes are occupied or the complete audit proves no eligible candidate for an empty lane.
7. **Fix #1015 before merging it.** Preserve the already-fixed queue/dependency/retry/scope tests, then fix the three current High production-enforcement findings: derive evidence from exact governed artifacts rather than caller assertions; make the production workflow consume and enforce the gate; and implement a machine-enforced activation barrier requiring both repository merges, canonical installation, and forward-test proof. You will know it worked when forged booleans/prose cannot pass, the production workflow refuses without a valid gate result, and pre-activation use fails closed. Then obtain a fresh exact-head review.
8. **Finish the model scorecard and round-robin installation.** Commit current #961 Grok and #965 Kimi evidence, add subsequent GLM/Qwen results, run the full queue tests, skill validation, and drift checks, obtain an independent exact-head review, merge shared-db #1021 and ai-devops #24 in safe order, pull canonical ai-devops, install the skill, and run a fresh-agent forward test. You will know it worked when the installed skill hash matches canonical, the reviewer cursor persists across a fresh session, and `models_comparison_grok_kim_glm.md` contains evidence-backed entries without invented metrics.
9. **Activate the new production rule only after step 8.** Before activation, use the old exact-approval rule. After activation, automatically promote only changes satisfying every low-risk condition; ask Albert one plain business question for any material risk. You will know it worked when a synthetic low-risk case proceeds without owner input and each risky synthetic case stops with a plain-English explanation.
10. **Retire this handoff when #1015 is genuinely complete.** The successor session that merges and installs #1015 should delete this file in that finishing PR after verifying all obligations are preserved elsewhere. You will know it worked when issue #1015 is closed and this file is absent from `main` but preserved in Git history.

## 7. Constraints and gotchas in force

- This is an orchestrator-only repository. Coordinate agents; do not implement migration work in the root session.
- Maximum three concurrent migration authors. Object overlap, not issue count or arbitrary category names, determines whether work may run together.
- Preview and merge remain one-at-a-time even with three author lanes.
- Until #1015's replacement policy is fully active, exact production approval remains mandatory. Do not interpret Albert's business ruling as permission to bypass the transition gate.
- After activation, reviewer approval alone is still not sufficient. All green checks, bounded preview proof, guarded merge, recovery proof, and the low-business-risk classification are required.
- External reviewer order is Grok → GLM → Kimi → Qwen. Use `ai-grok-review`, `AI_GLM_CALLER=codex ai-glm`, `AI_KIMI_CALLER=codex ai-kimi`, and `AI_QWEN_CALLER=codex ai-qwen`. Reuse named sessions and current artifact reads. Never call provider CLIs directly.
- Do not override model or reasoning pins. Qwen “High” was Albert's requested quality level, but the approved wrapper owns supported configuration; record requested versus proven configuration honestly.
- No licensed licensor rows, secrets, `.env` contents, or private source values may be sent to external reviewers or GitHub.
- A canceled or timed-out model run is not approval.
- Never edit applied migrations. Never rename a migration already applied to preview. Never repair the ledger to conceal drift.
- The primary checkout is dirty with other sessions' files. Use isolated worktrees and stage only owned files.
- Do not delete old worktrees during this transfer. Issue #884 and existing housekeeping work own unexplained legacy cleanup. The active worktrees named in the agent blocks below must remain.
- Do not close marker #960 during the fresh-session transfer. Close it only when an orchestrator truly ends with no successor taking over.

## 8. Access and environment

- Machine: Windows 11 `al8960ofc`; PowerShell 7 is the main shell.
- Shared-db canonical checkout: `C:\repos\shared-db`.
- AI-devops canonical checkout: `C:\repos\ai-devops`.
- GitHub CLI `gh` is authenticated for `u2giants`; real issue/PR reads and comments succeeded during this handoff.
- Git identity was verified in the handoff worktree as `Albert Hazan <u2giants@users.noreply.github.com>`.
- Supabase preview project: `rjyboqwcdzcocqgmsyel`.
- Supabase production project: `qsllyeztdwjgirsysgai`.
- Secrets belong only in 1Password vault `vibe_coding`; no new secret appeared in this transfer and no value is recorded here.
- Approved model wrappers are installed under the ai-devops machine-tool setup. Run each wrapper's doctor before use if service/model health is uncertain.
- Handoff branch/worktree: `codex/orchestrator-handoff-20260814-215618` at `C:\repos\shared-db-worktrees\orchestrator-handoff-20260814-215618`.

## 9. Open questions and risks

- No owner question remains. The production business-risk policy is settled but not active until its implementation passes the transition gate.
- #1015 currently contains a Critical queue bug. Merging it as-is would violate the very promise that all three lanes stay busy.
- Preview contains #965 ahead of `main`. Any attempt to preview #961 or #963 first will safely fail and waste time.
- PR heads, CI states, and `main` can change within minutes. Every SHA in this handoff is a snapshot, not permission to skip fresh reads.
- #963's dblink test correction is unproven at the snapshot time; latest CI and GLM review must decide it.
- The broad open issue list contains historical/stale owner labels. Do not present all of them to Albert. The new queue SOP must classify actual eligibility, dependencies, data-only work, and genuine business decisions from live evidence.
- The model scorecard can become misleading if canceled sessions, unavailable metrics, cached-token totals, or unverified findings are compared as though equivalent. Record raw evidence and final adjudication, not a simplistic winner.

## Part (b) — sub-agent state

### Agent: Franklin — `C:\repos\shared-db-worktrees\issue-961-license-3d-statuses`

- **Asked to do:** take over old licensing-status PRs, reconcile them into governed issue #961, review, preview, and merge.
- **Actually did:** reconciled superseded PRs #950/#989 into PR #1019; passed full CI; obtained Grok approval twice. After #965 merged, CI correctly found old version `20260814213027` backdated. The agent released claim #1017, acquired identical-scope claim #1026/version `20260814220838`, and made an uncommitted worktree-only pure rename. Remote branch head is `5ba67c3291bcf158b06bc34e8feb93a6de6d8f79`. Latest Grok approval on that remote head took 4 turns, 382,287 tokens, and `$0.04142186`.
- **Found:** the first Grok run was too broad and canceled; constrained retries approved. The failed claim attempt's author mutex was owner-proved released and coordination refs were empty afterward.
- **PR / branch:** [#1019](https://github.com/u2giants/shared-db/pull/1019) temporarily CLOSED, `codex/issue-961-license-3d-statuses`.
- **Worktree:** live, resumable, and deliberately DIRTY with only the pure rename: deleted old migration file plus untracked identical new-version file. Do not clean or discard it.
- **Deliberately did NOT do, and why:** no preview, merge, or production action; the agent paused before committing/pushing/reopening so the fresh orchestrator can verify and resume safely.

### Agent: Hilbert — `C:\repos\shared-db-worktrees\issue-963-curated-decisions`

- **Asked to do:** implement #963 so curated licensor/status decisions survive source refreshes, then review, preview, and merge.
- **Actually did:** implemented durable resolution records, secured commands/read path, Paramount consumer views, deterministic backfill, six fail-closed guards, docs, and tests. When #965 made version `20260814213019` backdated, the agent closed PR #1018, owner-proved/released claim #1016, acquired identical-scope claim #1024 with version `20260814220500`, pure-renamed version references, and opened replacement PR #1025. Latest head is `1f40808`. No DB write occurred during recovery. Issue #999 tracks additional source families.
- **Found:** direct reviews caught missing consumer wiring, concurrency/tie behavior, scope overstatement, grant/revoke gaps, and a test that skipped. Those were corrected. Supabase then correctly denied unsafe `dblink_connect_u` to the CI role; the latest test transactionally grants it only to the throwaway test role and rolls it back. GLM session `issue-963-final-review` must reread the complete replacement head.
- **PR / branch:** [#1025](https://github.com/u2giants/shared-db/pull/1025), `codex/issue-963-curated-decisions`; old PR #1018 is closed.
- **Worktree:** live and resumable; untracked `.tmp-ci-997/` is preserved and must not be staged.
- **Deliberately did NOT do, and why:** no preview or production before exact-head CI and GLM approval; no unrelated scrape-skill edits; version rotations were limited to governed recoveries forced by later migrations landing first. Agent is paused for transfer with its worktree and persistent GLM session intact.

### Agent: Poincare — #965 worktree plus #1015 worktrees

- **Asked to do:** complete #965 after Grok authored it; then own the continuous-queues/reviewer SOP #1015 across shared-db and ai-devops.
- **Actually did for #965:** PR #1006, branch `grok/issue-965-metadata-normalization`, head `0be10c497d45deea806ad6c2dd8aec22ddb50452`, claim #998, migration `20260814213043`; preview dry-run `31843606537` and apply `31843717018` passed; Kimi approved; PR merged at `3301a25870dd235ceb4fad54cc6917c88e013e00`.
- **Actually did for #1015:** PR #1021 and ai-devops PR #24; implemented the queue/reviewer mechanism and 105 tests; committed #965 Kimi and #961 Grok evidence to the model comparison file; fixed the first review's queue/dependency/retry/duplicate-scope findings; replaced the obsolete technical production approval with the five-condition business-risk gate.
- **Found:** #965 merge correctly stopped once when main advanced, then succeeded after updating. #1015's first queue findings were fixed. The latest exact-head review remains REVISE with three High production-enforcement gaps: untrusted caller assertions, no workflow consumer/enforcement, and no machine-enforced transition activation.
- **PR / branch:** [shared-db #1006](https://github.com/u2giants/shared-db/pull/1006), [shared-db #1021](https://github.com/u2giants/shared-db/pull/1021), [ai-devops #24](https://github.com/u2giants/ai-devops/pull/24).
- **Worktree:** all three live and resumable: `C:\repos\shared-db-grok-worktrees\issue-965-metadata-normalization`, `C:\repos\shared-db-codex-worktrees\issue-1015-dynamic-queues`, and `C:\repos\ai-devops-codex-worktrees\issue-1015-dynamic-queues`.
- **Deliberately did NOT do, and why:** no #965 production; no workflow PR merge after REVISE; no production-approval relaxation yet; no wrapper overrides; no invented Kimi metrics.

### Agent: Gibbs — prior concurrency safeguards

- **Asked to do:** implement and then repair the three-author concurrency system under #976.
- **Actually did:** merged the initial concurrency SOP and successive fixes through shared-db PRs #977, #983, #985, #986, #987 and ai-devops PRs #19/#20. These established atomic versions/claims, guarded locks, CI gates, stale-lock recovery, workflow dependencies, and PR metadata hydration.
- **Found:** GitHub ref deletion has no compare-and-delete guarantee, stale reads can create false release failures, and list-pulls omits changed-file counts unless hydrated.
- **PR / branch:** completed historical work; details are in issues #976 and its linked PRs.
- **Worktree:** agent is finished; legacy worktrees remain and are not to be force-cleaned during transfer.
- **Deliberately did NOT do, and why:** it did not implement #1015's dynamic three-queue allocator or the new production business-risk policy; those are current work.

## Mandatory self-audit

1. **Yes, a brand-new developer can continue without asking a question.** Sections 1–3 define the repositories, environments, marker, active PRs, preview state, workflow objective, and exact moving baseline. Section 6 gives ordered actions with success checks. Part (b) gives a separate resumable record for every agent.
2. **Yes, the developer can continue as effectively as this session.** Sections 4–5 preserve the failed queue algorithm, reviewer failures, preview ordering trap, migration-version history, and the reasons behind each safety boundary. Section 8 supplies paths and access without exposing secrets.
3. **Yes, all execution details are present.** Background and outcome are in §§1–2; exact current state and evidence in §3; failures in §4; findings in §5; verified next actions in §6; constraints in §7; environment in §8; risks in §9; agent ownership in part (b).
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of §§1–9 and part (b) found only the production business-risk policy, transition gate, three always-busy queues, reviewer rotation/debate, scorecard requirement, and suppressed #958/#964 reporting. All appear in §0 with dates. No unanswered owner decision remains.
