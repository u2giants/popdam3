---
issue: 2058
status: OPEN
owner: codex/orchestrator-2051-handover
---

# Path B handover — marker #2051, blocker-first structural queue

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this whole list to Albert in one message before attempting the named blocked work.

### Blocking decisions

1. **Issue #1848 — Friends/Frida production hold.** The issue carries an explicit production hold. Recommendation: leave it blocked unless Albert explicitly reverses the hold and names the allowed production outcome. This blocks any implementation or promotion for #1848.
2. **Issue #2045 — HTS contract meaning.** The proposed `operative_eligible` / `proposed_hts` behavior needs a product/business ruling, separate from the technically checkable foreign-key index evidence. Recommendation: split the index-only work from the contract decision, then answer the contract in plain business terms. This blocks the semantic half of #2045.
3. **Issue #1671 — real non-production credentials.** Dev/staging credentials currently point at protected production rather than genuine non-production targets. Recommendation: provision/correct genuine non-production credentials; never weaken the target guards. This blocks safe rehearsal.
4. **Issue #1431 — cutover authorization after rehearsal.** The Cloud SQL-to-Supabase cutover still needs the corrected timed rehearsal owned by #771 and a fresh cutover decision. Recommendation: finish the rehearsal first; authorize cutover only from its current evidence. This blocks #1431.
5. **Issue #1275 — source-family model choices.** The umbrella issue remains blocked on unresolved source-family modeling choices despite its listed dependencies being closed. Recommendation: make the model choices explicitly in #1275 before another migration author starts. This blocks the umbrella design.
6. **Issue #552 — mixed structural and deployment scope.** The old issue combines an exact structural guard with deployment operations. Recommendation: approve splitting a narrow structural successor from deployment work, then supersede/close the mixed issue. This blocks clean admission.

All six issues now carry `needs-albert` as of 2026-09-01.

### Already settled — do not re-ask

- Albert authorized completing all eligible open orchestrator issues through production in this session on 2026-09-01. That authorization completed #2031; it does not reverse explicit holds or supply missing business definitions/credentials.
- Structural work remains the orchestrator's scope; repository maintenance remains a separate repo session (owner ruling 2026-08-21).
- Reviewer gates may not be bypassed because providers time out or the registry is wrong.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared Supabase database structure used by POP Creations applications. Structural changes are authored as migrations in isolated worktrees, independently reviewed, merged, rehearsed on shared preview, then promoted through guarded production workflows. GitHub `db-work` issues are the queue; a single `orchestrator-marker` issue routes work to one live coordinator.

This handover closes marker #2051 (`route_id` `01a05d0a-ba74-7000-bce1-15a87e9cc3e5`) on machine EDGE-DEV. The successor must open a new marker with its own route ID; never reuse this one.

## 2. What we set out to do this session, and why

Albert asked for blocker-count-first, age-second prioritization and then authorized completion through production of every open orchestrator issue. The technical objective was to re-derive the live queue, complete eligible structural work without collisions, and distinguish real owner/infrastructure blocks from executable work.

## 3. Current state — what is true right now

### Completed and verified

- **Issue #2031 is closed and production-complete.** PR #2053 merged as `bcd2ec1a439668b09d7c29a0846584fb0be8aba4`; migration `20260901130428` passed merged-main preview rehearsal, immutable production review, production apply, and post-apply catalog verification in workflow run `33519224144`. Completion evidence was published and claim #2052 released.
- At **2026-09-01 16:30 UTC**, `origin/main` was exactly `bcd2ec1a439668b09d7c29a0846584fb0be8aba4`; maximum migration on main was `20260901130428`.
- Queue classification was complete earlier in the session: no unclassified, malformed, or unlabelled issues; blocker-count then age ordering made #2054 dispatchable after #2031 completed.

### Ready code, not merged or promoted

- **#2054 / PR #2057 / claim #2056** — exact head `20b3fc06628a8444f3b5c9d7c8d52797eb839ca1`, migration `20260901142825`. All exact-head CI passes, including disposable replay and every SQL contract (run `33526842635`). It preserves legacy exclude-own facet behavior, effective include-own behavior, grants/timeouts, and uses seven mutually exclusive index-led identity branches. It has **no usable exact-head approval**: GLM sequence 813 timed out at 34m41s with no verdict/findings and was aborted. Nothing from #2054 was applied to shared preview or production.
- **#1609 / PR #1939 / claim #1938** — exact head `f8ee002d58d85d7378004b9ab7efe7803ddeb479`, migration `20260901134919`. Exact-head CI passes, including ephemeral run `33520272541`. DeepSeek sequence 808 refused approval because its evidence boundary would not accept evidence supplied in the same session; it confirmed no proven Critical/High defect. No current machine-recognized approval exists. Nothing from #1609 was applied to preview or production.
- **#1999 / PR #2002 / claim #2001** — exact head `0903384fb8db610c823c4c2bd9a3f9e0c45dfb53`, migration `20260901130624`. Exact-head CI passes, including ephemeral run `33520145615`. Grok sequence 809 exhausted its turn limit with no verdict; no replacement could be assigned. Nothing from #1999 was applied to preview or production.
- **#1987 / PR #1989 / protected claim #1988** — head `4c3de9c2b6d7b0e04d80ebb4f12917e2039476fa`, migration `20260901130334`. Its old exact-head Muse approval became stale after main moved. The author lease cannot safely resume because `--resume-author-lease` falsely collides with its own PR; repo-maintenance issue #2055 owns that defect. Nothing from #1987 was applied by this session.
- **#2008** waits on successful completion evidence for #1999; closure alone is deliberately insufficient.

### Reviewer-capacity incident

Issue #2058 is the separate repository-maintenance handover. At closeout all six `refs/db-review-active/*` records were occupied while zero reviewer workers were running: Codex 797/#2035, DeepSeek 808/#1609, GLM 813/#2054, Grok 809/#1999, Kimi 747/#1824, Muse 801/#1987. Local incident `20260901T155739Z-edge-dev-reviewer-coordination-2741130` is saved under `C:/repos/ai-devops/.ai/reviewer-issues/`.

### Other blocked structural queue items

- #2045: owner contract ruling plus current index evidence; `needs-albert`.
- #1966: fillfactor needs application update-column analysis; index statistics need an observation window. No owner label added.
- #1848: explicit production hold; `needs-albert`.
- #1671: genuine non-production credentials/targets required; `needs-albert`.
- #1431: corrected #771 rehearsal plus cutover authorization; `needs-albert`.
- #1275: unresolved source-family model choices; `needs-albert`.
- #552: mixed structural/deployment issue must be split; `needs-albert`.

### Preview state

Preview is **not declared clean**. The last preview write this session performed was the successful merged-main rehearsal of migration `20260901130428` for #2031. That same migration is now also in production. No #1609, #1999, #1987, or #2054 migration was applied to preview. Because preview is shared and other sessions may have written after the last check, the successor must re-read its live ledger/catalog before any rehearsal.

### Worktree state owned by this session

- `C:/repos/shared-db-worktrees/issue-1609-source-resolution` — tracked clean; untracked private review briefs/session material under `.ai/`; resumable.
- `C:/repos/shared-db-worktrees/issue-1999-marvel-disney-tiebreaker` — tracked clean; two untracked `.ai/` review briefs; resumable.
- `C:/repos/shared-db-worktrees/issue-1987-designflow-notifications` — tracked clean; one untracked `.ai/` Muse brief; resumable.
- `C:/repos/shared-db-worktrees/issue-2054-effective-count-performance` — tracked clean; four untracked `.ai/` review briefs; resumable.
- `C:/repos/shared-db-worktrees/orchestrator-2051-handover` — this docs-only closeout branch; delete only after its PR is verified merged.
- `C:/repos/shared-db-orch-2051` — detached orchestration checkout; no owned tracked changes. Safe cleanup must wait until marker closure and use the cleanup skill.

Many older unrelated worktrees exist. This session deliberately did not remove them: their ownership/dirty/process state was not established, and worktree issue #1868 already owns the broad cleanup.

## 4. Everything we tried that did NOT work

1. **DeepSeek #1609 evidence delivery:** sequence 808 was given the exact diff, test runs, contract summary, migration/sidecar facts, and a same-session rebuttal. It still treated reply evidence as unattached and returned BLOCKED while explicitly finding no confirmed Critical/High defect. Do not call this a code rejection; fix the evidence delivery or use a governed replacement after capacity repair.
2. **Grok #1999 reviews:** the original old-head run and refreshed-head sequence 809 both hit the provider's turn limit with no final verdict. Sequence 809 used 20 turns and returned no reusable artifact. Do not resume the cancelled session.
3. **GLM #2054 reviews:** sequence 810 correctly found two High issues in the first implementation (legacy facet semantics changed; cross-table OR did not prove an indexed path). The author fixed both. Sequences 811 and 812 became stale because exact-head fixture corrections were pushed. Sequence 813 ran 34m41s, stopped progressing, produced no verdict/findings, and was aborted after exceeding the skill's 30-minute bound.
4. **Reviewer replacement:** governed `--replace-failed-reviewer` for #1609 sequence 808 and #1999 sequence 809 repeatedly refused because every provider appeared occupied. Posting a parser-recognized `REVISE` comment for an earlier #2054 head did not free capacity for the other PRs. No refs were manually removed.
5. **#1987 author resume:** `--resume-author-lease` treated PR #1989 as a collision against its own protected claim. No bypass was used; issue #2055 records the repository-maintenance defect.
6. **#2054 fixture gates:** early corrected heads failed only because new test fixtures violated existing licensing authorization, Property status, and controlled content-type contracts. Those fixture-only defects were corrected. The final head's full replay is green.

## 5. Root causes and key findings

- Reviewer availability is decided by a bounded durable active-ref index, not by whether a provider process is actually running. Terminal/finished records can therefore deadlock the whole pool if reconciliation/release fails.
- Replacement currently cannot recover a saturated pool: it needs another eligible reviewer before the failed active record is released/recorded, creating a circular wait when all slots say busy. Issue #2058 must repair this atomically and add a saturated-pool regression test.
- A reviewer result is useful to merge gating only when its verdict is machine-recognizable and tied unambiguously to the exact 40-character head. Wrapper-local prose or session output does not release work.
- #2054's first design was not merely under-tested: it changed legacy facet meaning and used a planner-unfriendly cross-table predicate. The final migration corrected both with separate public-wrapper semantics and index-leading candidate branches.
- Main movement invalidates exact-head approval. #1609, #1999, and #1987 must be refreshed/re-reviewed again after any subsequent merge that advances main.

## 6. Exact next steps

1. **Start a separate repository-maintenance session for #2058.** Reconcile the six live reviewer records using guarded compare-and-swap ownership proof; implement atomic release-on-terminal-result before selecting a replacement; add all-six-saturated recovery tests. It worked when live active refs match actual running/awaiting reviews and replacement assignment for #1609 or #1999 succeeds without manual deletion.
2. **Repair #2055 in that same class of separate repo-maintenance work (not this structural orchestrator).** It worked when #1987's exact claim can resume without colliding with its own PR and the regression test covers self-PR exclusion.
3. **Open a fresh orchestrator marker with a new route ID, resolve it, and queue-audit.** It worked when `check-orchestrator-marker --resolve` prints only the successor route and queue audit has no malformed/unlabelled/unclassified work.
4. **Commission fresh exact-head reviews after capacity repair.** Re-check every PR head and main first. Do not reuse sequences 808, 809, or 813. It worked when each current head has a durable APPROVE with no unresolved Critical/High findings.
5. **Promote one PR at a time in blocker-count/age order.** Refresh to current main before review; guarded merge; immediate merged-main preview rehearsal; immutable production review; production apply; post-apply catalog and functional acceptance. It worked only when the production workflow and live contract checks pass.
6. **For #2054 specifically, run repeated authenticated preview timing after merge.** Verify exact count and licensor/property facet calls repeatedly inside the 8-second ceiling while preserving returned values. If timing fails, do not promote; return to author. It worked when the repeated pass rate and timings meet issue #2054's acceptance criteria.
7. **After #1999 succeeds, re-run queue audit for #2008.** It worked when #2008 is released by typed completion evidence, not merely a closed dependency.
8. **Put all six Section 0 decisions to Albert together.** It worked when the affected issues contain durable owner answers and no successor guesses.

## 7. Constraints and gotchas in force

- One live orchestrator only; successor route ID must be new.
- Structural work only. #2058 and #2055 are repository maintenance and may not be implemented or dispatched by the structural orchestrator.
- Blocker-count descending, then issue age ascending, is the requested priority.
- Never bypass exact-head review, merge freeze, preview rehearsal, production evidence, or target proof.
- Any commit, merge, rebase, or evidence edit invalidates exact-head approval.
- Do not manually delete reviewer refs or claim refs. Recovery must be guarded and evidence-preserving.
- Do not clean unrelated worktrees without the cleanup skill and live ownership/dirty/process proof.
- Never expose licensed rows, secrets, tokens, or private reviewer packets in issues or commits.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/shared-db` on EDGE-DEV.
- Repository root: `C:/repos/shared-db`; clean orchestrator checkout used: `C:/repos/shared-db-orch-2051`.
- Supabase access is through 1Password vault `vibe_coding`; this session referenced the existing Supabase CLI token item but did not expose values.
- Preview and production writes occur only through guarded GitHub workflows. Production run for #2031: `33519224144`.
- External reviewer tools used: DeepSeek, Grok, and GLM through their governed wrappers. Exact session identifiers are in the per-agent blocks below.

## 9. Open questions and risks

- The active reviewer-ref snapshot will go stale immediately when another repair/session reconciles it. Re-read it live; never delete based on this file alone.
- Shared preview may have changed after this closeout snapshot. Re-prove the target and ledger before every write.
- #2054 is logically and mechanically green but still lacks the required independent approval and real shared-preview timing. Production safety is unproven until both pass.
- #1609's Medium concern remains: authenticated clients may not reach `plm.set_source_resolution` if the `plm` schema is not exposed. This is fail-closed, not a security expansion, but it may require an API wrapper follow-up for usability.
- Large numbers of older worktrees and clean repo-maintenance PRs remain outside this orchestrator. Do not confuse their existence with structural queue ownership.

# Part B — sub-agent state, separated by agent

### Agent: Nietzsche / `repair_2031_ci`
- **Asked to do:** repair PR #2053's failing exact-head SQL/contract checks for issue #2031.
- **Actually did:** corrected ranked-search visibility expansion, pushed exact head `4ab4a76338eadcd4ea7f065ce93b5903193b59e9`, and passed local guards plus ephemeral run `33517234894`.
- **Found:** keyed visibility expansion needed explicit rank and identity columns to preserve behavior.
- **PR / branch:** #2053, `codex/issue-2031-ranked-filter-parity`; subsequently merged as `bcd2ec1a...`.
- **Worktree:** finished; safe cleanup only through the cleanup skill after marker closure.
- **Deliberately did NOT do, and why:** no preview, merge, or production; those belonged to the orchestrator gates.

### Agent: Maxwell / `resume_1609`, then `refresh_1609`
- **Asked to do:** restore #1609's claim/branch after scope correction, then refresh it onto the new main.
- **Actually did:** preserved migration `20260901134919`, refreshed cleanly to exact head `f8ee002d58d85d7378004b9ab7efe7803ddeb479`, pushed, and passed local plus GitHub checks.
- **Found:** the issue scope needed `column plm.source_resolution.updated_at`; refreshed code had no semantic conflict with #2031.
- **PR / branch:** #1939, `codex/issue-1609-source-resolution`.
- **Worktree:** live/resumable; tracked clean, private untracked `.ai/` material remains.
- **Deliberately did NOT do, and why:** did not merge or promote because exact-head independent approval was not available.

### Agent: Bacon / `refresh_1999`
- **Asked to do:** refresh #1999 after #2031 advanced main.
- **Actually did:** merged current main cleanly, pushed exact head `0903384fb8db610c823c4c2bd9a3f9e0c45dfb53`, and passed 286 focused tests plus all exact-head CI.
- **Found:** no semantic conflict with #2031; GitHub PR-head display lagged briefly after push but later converged.
- **PR / branch:** #2002, `codex/issue-1999-marvel-disney-tiebreaker`.
- **Worktree:** live/resumable; tracked clean, two untracked review briefs.
- **Deliberately did NOT do, and why:** no merge/preview/production without current review.

### Agent: `implement_2054`
- **Asked to do:** implement issue #2054 under claim #2056 and migration version `20260901142825`.
- **Actually did:** opened PR #2057, corrected the first review's two High findings, produced final head `20b3fc06628a8444f3b5c9d7c8d52797eb839ca1`, passed 837 offline tests (8 expected skips), verifier suite, SQL/sidecar checks, and full exact-head ephemeral run `33526842635`.
- **Found:** the public count functions depend on private helper `public.get_effective_filter_counts_unchecked_1703`; issue/claim scope was expanded before touching it. Correct semantics require legacy exclude-own facets and effective include-own facets.
- **PR / branch:** #2057, `codex/issue-2054-effective-count-performance`.
- **Worktree:** live/resumable; tracked clean, four untracked reviewer briefs.
- **Deliberately did NOT do, and why:** no shared preview timing, merge, or production because author assignment forbade promotion and independent approval never landed.

### Agent: `review_1609_exact`
- **Asked to do:** run DeepSeek assignment 808 at exact #1609 head.
- **Actually did:** session `20260901-103805-2382968`; supplied original packet and one same-session evidence rebuttal.
- **Found:** no confirmed Critical/High code defect; Medium concerns were authenticated RPC reachability and fixed table-list assumptions. The provider nevertheless blocked on its attachment boundary.
- **PR / branch:** read-only review of #1939 / `f8ee002d...`.
- **Worktree:** finished reviewer process; review evidence remains private/untracked.
- **Deliberately did NOT do, and why:** no durable approval was posted because the provider did not approve.

### Agent: `review_1999_exact`
- **Asked to do:** run Grok assignment 809 at exact #1999 head.
- **Actually did:** session `shared-db-1999-pr2002-head0903384-seq809`, provider ID `01a05d68-7ed2-71b1-9e98-fa8fdadcee8d`; 20 turns, no verdict.
- **Found:** provider cancelled at its turn limit; no ranked findings or reusable artifact.
- **PR / branch:** read-only review of #2002 / `0903384f...`.
- **Worktree:** reviewer process finished/cancelled.
- **Deliberately did NOT do, and why:** did not resume a cancelled provider session or invent approval.

### Agent: `review_2054_exact`
- **Asked to do:** review initial and corrected #2054 heads through governed GLM assignments.
- **Actually did:** sequence 810 produced a valid BLOCK with two High findings; later stale sequences were stopped; sequence 813 session `shared-db-2054-seq813` ran 34m41s without verdict and was aborted after the documented bound.
- **Found:** initial legacy facet semantics and planner shape were wrong; final code fixes exist, but no final reviewer verdict exists.
- **PR / branch:** read-only review of #2057; final reviewed snapshot target `20b3fc06628a8444f3b5c9d7c8d52797eb839ca1` received no verdict.
- **Worktree:** reviewer process finished/aborted.
- **Deliberately did NOT do, and why:** did not convert green CI or silence into approval.

# Closeout audits

- **Secrets sweep:** swept tracked diffs and owned untracked filenames; no new credential, token, connection string, or vault item was created. Nothing new to store. Private reviewer packets remain untracked in their owned worktrees and contain no credential values.
- **Docs pass:** no standing behavior document was changed by this session. The reviewer-capacity defect is not yet a durable rule; it is recorded in issue #2058 and this handoff. Nothing outside this handoff is being rewritten as if the repair already exists.
- **Queue seed:** every unfinished structural item named here already has an open `db-work` issue (#1609, #1999, #1987, #2008, #2054, #2045, #1966, #1848, #1671, #1431, #1275, #552). Repository-maintenance blockers have #2055 and new #2058. Owner-held structural issues named in Section 0 carry `needs-albert`.
- **Worktree sweep:** finished worktrees were not removed because the orchestrator marker is still open and the repo has many concurrent/unknown worktrees. Every worktree created or used by this session is explained in §3/Part B. Cleanup belongs after marker closure through the cleanup skill.

# Mandatory fresh-developer self-audit

1. **Yes, a brand-new developer can continue without questions.** Sections 1–3 define the system, live heads, PRs, environments, and ownership; Section 6 gives ordered executable gates.
2. **Yes, the file carries this session's operational knowledge.** Sections 4–5 preserve every significant dead end and root cause; Part B separates every dispatched agent.
3. **Yes, execution detail is complete.** Sections 0–9 cover goals, current state, failures, decisions, constraints, risks, access, exact versions/SHAs/runs, and verification criteria.
4. **Yes, Section 0 contains every owner decision.** A line-by-line sweep of Sections 1–9 and Part B found only the six explicit owner-held issues (#1848, #2045, #1671, #1431, #1275, #552); all six appear in Section 0 with recommendations and consequences. Reviewer repair, #2055, #1966, and current PR reviews are technical work, not owner decisions.
