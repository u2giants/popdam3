---
issue: 1703
status: OPEN
owner: successor-orchestrator-after-2000
---

# Orchestrator #2000 handoff: finish #1703 from Grok-designed forward #6

## 0. Decisions only the owner can make

### Blocking

None for the immediate #1703 path. The successor must not ask Albert to approve ordinary review, merge, preview, or production steps already authorized by the open issue and orchestrator contract.

### Outside this immediate workstream

- Open security-setting issues #1693, #1353, #870, #718, and #696 remain owner-only. They were already present in the queue and are not newly discovered by this session. Recommendation: leave them on their existing owner-only route; do not interrupt #1703.

### Already settled — do not re-ask

- 2026-08-31: prioritize structural issues first by how many other open issues they unblock, then by age. #1703 stays in lane 1 until direct production acceptance passes.
- 2026-08-31: preserve the production merge/apply freeze until #1703 passes direct cold live acceptance. Merge, preview, production apply, and catalog checks alone are not completion.
- 2026-08-31: ask Grok 4.6 to design the #1703 solution before further implementation, not merely review completed code. That design consultation is complete and its Track B shape is now implemented in PR #2010.
- Repository-maintenance work is not structural-orchestrator work. Issue #2014 must be handled by a separately started repo-maintenance session, not dispatched from this orchestrator.

If an owner decision becomes necessary, the successor must present the complete blocking list in one message. There is presently no owner action required for #1703.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of POP Creations' shared Supabase database. One orchestrator owns triage, protected claims, review, merge, preview, and production promotion. Isolated author agents write migrations; preview and production are shared protected environments.

The immediate business problem is PopDAM search issue #1703: authorized users need correct ranked pages, facets, counts, and compatibility wrappers, while unauthorized users must be refused and every cold path must finish within eight seconds. #1703 blocks #1609 and freezes other merges/promotions.

## 2. What this session set out to do, and why

Marker #2000 continued predecessor #1983 with the owner's dependency-first priority and five-lane instruction. It completed #1703 forward #5 through production, ran direct privacy-safe acceptance, diagnosed the remaining performance failure, obtained a pre-code Grok 4.6 solution design, and implemented that design as forward #6 in PR #2010.

The session did not finish #1703 because forward #6 has not been split from unrelated pass-2 repository-maintenance changes, freshly reviewed at its latest exact head, merged, previewed, or production-tested.

## 3. Current state — verified live

Moving facts were rechecked at 2026-08-31 20:42-20:48Z.

- Live marker: #2000, route `01a058e1-1004-79b1-a31d-9705c5c38fab`. The successor must use a new route and new marker; never reuse this address.
- `origin/main`: `68080423297efdbf6770ac8bc55a1ebdb4264b25`.
- Maximum migration on `origin/main`: `20260831173841_popdam_ranked_search_narrow_visibility.sql`.
- Queue audit is **not fully audited** and cannot truthfully claim an empty lane. It reports three empty lanes, no dispatchable structural issue, open held work, outside-orchestrator work, and dependency #2008 not proven because #1999 remains open.
- Protected claims still open: #1912 for #1703, #1938 for #1609, and #1988 for #1987. Do not release them until completion or a guarded abandonment.

### #1703 — lane 1 and production freeze owner

- Issue #1703 and claim #1912 are open. PR #2010 is open and mergeable at exact head `15206223df106bc4cb4d3351fee391ce8470513b`, base `68080423297efdbf6770ac8bc55a1ebdb4264b25`.
- Every PR #2010 CI check is green at that head, including the ephemeral database suite. Preview and all production jobs are correctly skipped because it is not merged.
- Forward #6 migration: `20260831184547_popdam_ranked_search_private_keyed_visibility.sql`. It is not on `main`, preview, or production.
- The migration's canonical SHA recorded before the final test-only commit was `a33c22920120dee3ed2fc7f8f54a37377eb5c801141522d5b8b965bb59b14eac`; recompute before any evidence or apply rather than trusting that historical value.
- Latest head change only repaired a rollback-only authorization test: the prior test probed an empty eligible set, so PostgreSQL never had to execute the lazy materialized authorization CTE. The test now inserts one eligible asset before role probes. The migration/query design did not change.
- Muse approved previous exact head `4a1df6b44970c0228dd88a40153be78c631b0d77`; that verdict became stale at the test-only head change. A new exact-head governed review is required.

Grok 4.6 design consultation:

- Session `shared-db-1703-solution-design`, provider session `01a05970-f1e0-72a2-a4da-4c030ab4931f`, model `grok-4.6-build`.
- Report: `.ai/reviews/grok-shared-db-1703-solution-design-20260831T200910Z-1438135.md` in the forward-6 worktree.
- Grok required: keep the public filter stable `SECURITY INVOKER` with null `proconfig` and one materialized authorization row; ranked visibility must start at candidate IDs joined to `public.assets` by primary key with seven columns and inline predicates; counts must use one narrow five-column asset scan; no library-wide SRF, helper, or LATERAL in ranked visibility; cold ranked pages under seven seconds and every required path under eight seconds with headroom.
- PR #2010's Track B migration follows that design. Counts share a private direct-assets five-column scan and materialize the thumbnail date once. Public count entry points retain one DAM gate, eight-second timeout, grants, facet/total behavior, and legacy empty-total behavior.
- The Grok wrapper itself behaved abnormally: 19/20 turns, 1,031,222 tokens, and about nine minutes with no provider output before a useful verdict. Incident `20260831T204134Z-edge-dev-grok-1599823` is saved under `C:\repos\ai-devops\.ai\reviewer-issues\20260831T204134Z-edge-dev-grok-1599823`. This does not invalidate the design.

Important PR #2010 scope debt:

- PR #2010 still contains pass-2 routine-restorer workflow/script/test changes from earlier CI debugging. Grok agreed with their direction but required live PostgreSQL proof and separate repository-maintenance ownership.
- Issue #2014, `Prove pass-2 routine restoration in live PostgreSQL`, is open with `work_type: repo-maintenance`, route `repo-maintenance`. The structural orchestrator must not implement or dispatch it.
- Before merging #2010, remove the pass-2 restorer files from the structural PR without altering the Track B migration or its #1703 contracts. The restorer work remains preserved by #2014 and branch history.

### Applied #1703 state and failed direct acceptance

- Forward #5 PR #2003 exact head `9f893ecd42687e2b4425a28e5c7843f89ece2076` merged as `68080423297efdbf6770ac8bc55a1ebdb4264b25`.
- Migration `20260831173841` was applied successfully to preview and production through the governed chain. Do not replay it.
- Direct production acceptance passed security and correctness but failed performance: six non-DAM paths refused in 52-104 ms; filter 67.6 ms; legacy counts 9.93 s; effective counts 3.81 s; ranked pages 18.79 s and 13.72 s; asset wrapper 11.07 s; style wrapper 9.85 s. Totals/facets matched, page overlap was zero, and direct/member behavior was preserved.
- Privacy-safe evidence: `https://github.com/u2giants/shared-db/issues/1703#issuecomment-5482877530`.
- Therefore preview and production contain #1703 through `20260831173841`; production acceptance is failed; the freeze remains active. Forward #6 invalidates all earlier performance rehearsals once applied.

### Held structural work after #1703

- #1609 / claim #1938 / PR #1939: branch head `e408bc1dbe558fe084c5d0c46fe0463f9f868776`; PR is conflicting and all old evidence is stale. It follows #1703 acceptance.
- #1987 / claim #1988 / PR #1989: head `c3ffdd59cc2872bfd86e56d6eae2064e06eb2da6`; mergeable but held. No preview or production action in this session.
- #1999 / PR #2002: head `5a621ce8c8f33a95510fbc166ad017b5d75e94e6`; PR is conflicting and its ephemeral database test failed on that stale base. #2008 depends on #1999 and cannot be treated as ready merely because #1999 later closes.
- #2004 / PR #2009: exact head `000e2aed39dde891b022c18e0dfe7b3f83fac3db`; mergeable with all CI green on base `68080423297efdbf6770ac8bc55a1ebdb4264b25`; held, unmerged, and not applied.
- PR #1888 is docs-only, mergeable, and deliberately held under the #1703 freeze.
- Recompute blocker impact and age after #1703; do not inherit this list as a permanent order.

### Checkout and worktree state

- Shared checkout `C:\repos\shared-db` is stale at `20ec217fa0f4d3777cf245b9fd2414d53bb1a456`, behind `origin/main`, and contains many untracked files owned by other sessions. Do not clean, stage, or author there.
- #1703 forward-6 worktree: `C:\repos\shared-db-worktrees\issue-1703-ranked-search-forward-6`, branch `codex/issue-1703-ranked-search-forward-6`, clean committed head `15206223df106bc4cb4d3351fee391ce8470513b`.
- This handoff worktree: `C:\repos\shared-db-worktrees\handover-2000-20260831`, branch `codex/handover-2000-20260831`.
- Numerous older worktrees exist and are unexplained by this session. Issue #1868 owns the repo-maintenance reap. The open orchestrator marker prevents safe cleanup; do not improvise deletion.

## 4. Everything tried that did not work

- Forwards #1-#4 improved authorization and some narrow paths but broad ranked pages and wrappers still hit the eight-second ceiling.
- Forward #5 narrowed ranked rows and unified count behavior, yet production remained too slow: ranked pages 13.72-18.79 seconds and wrappers 9.85-11.07 seconds. Wide-row deduplication was not the only bottleneck.
- A forward-6 version using a private full-library SRF was rejected because it depended on planner inlining; without it, PostgreSQL could scan the entire effective library before joining candidate keys.
- A public `SECURITY DEFINER` wrapper with `SET search_path` was rejected because it prevents the PostgREST outer `LIMIT` from pushing down and changes the access contract.
- A public invoker wrapper that called a private helper was rejected because authenticated users lack execute permission on the helper.
- Earlier pass-2 restorer attempts emitted literal `\n`, reconstructed multi-schema `search_path` as one quoted value, and unconditionally reset routines that an older migration had dropped. Each caused real ephemeral replay failures. The current generic algorithm is promising but belongs in #2014 with live PostgreSQL tests.
- The first CI run at head `4a1df6b...` reported `non-DAM user reached effective assets`. Diagnosis showed the probe had no eligible row, so PostgreSQL legitimately skipped a lazy materialized CTE. Adding a rollback-only eligible fixture corrected the test; changing the production function would have been the wrong repair.
- Reviewer evidence repeatedly became stale after head changes. DeepSeek and GLM rejections informed the design; Muse's approval at `4a1df6b...` is now stale. Never reuse a verdict merely because the subsequent diff is test-only.
- Do not repeat the Grok consultation; its design is recorded. The unusual wrapper behavior is already logged separately.

## 5. Root causes and key findings

- Ranked visibility must be driven from already-bounded candidate IDs into `public.assets` primary-key lookups. Starting from an effective-library function makes performance depend on SQL-function inlining and can recreate a full-library scan.
- Counts need their own narrow scan. Reusing a `setof public.assets` list function projects dozens of unnecessary columns and pays library-wide materialization cost before facet work.
- The public PostgREST filter and internal ranked/count paths have different planner needs. One function shape should not be forced to serve all three.
- Authorization CTEs are evaluated only if the query needs rows from them. A security refusal test must provide an otherwise-eligible row or it proves only emptiness.
- Pass-2 routine definition replay is repository-maintenance infrastructure, even when its failure is exposed by a structural PR. Mixing it into #1703 obscures ownership and prevents the live PostgreSQL proof Grok required.
- Successful production apply is not acceptance. #1703 has repeatedly passed catalog/security checks while failing live latency.

## 6. Exact next steps

1. Start a successor orchestrator with a new route, open its marker immediately after #2000 closes, and run marker resolve. **Gate:** exactly one marker resolves to the successor's route before any dispatch.
2. Fetch `origin/main`, rerun marker resolve and queue audit, inspect #1703 claim #1912, PR #2010, and current freeze state. **Gate:** the moving facts match or every difference is recorded before acting.
3. In the forward-6 worktree, remove only the pass-2 restorer workflow/script/test changes from PR #2010, preserving them in branch history and open issue #2014. Do not change the Track B migration/query behavior. **Gate:** PR diff contains only #1703 migration, #1703 contracts, and its hash-bound production verification; focused and full CI pass.
4. Commission a fresh governed exact-head reviewer after the split. The approval comment must contain exactly one 40-character SHA. **Gate:** a clean verdict approves the current head; any head change restarts this step.
5. Guarded-merge only the exact approved head while the #1703 freeze is otherwise quiet. Re-resolve marker and queue immediately before merge. **Gate:** PR #2010 is merged and current `origin/main` contains only the intended #1703 change.
6. Run fresh protected preview ledger reconciliation, prepare-preview-dispatch for #1703, rerun the read-only selector, and apply only the matching instruction. **Gate:** preview contains exact migration `20260831184547` at the merged digest and no unrelated ready work was applied.
7. Before production, run cold privacy-safe preview EXPLAIN and timings. Require no effective-filter Function Scan/LATERAL in ranked visibility, candidate IDs driving asset primary-key lookups, ranked pages under seven seconds, and every required path under eight seconds with headroom. **Gate:** all security, correctness, plan-shape, and cold-time conditions pass. If they fail, do not production-apply; use EXPLAIN to identify the next bottleneck.
8. If preview passes, run a fresh production dry run, immutable production review, and guarded apply for only `20260831184547`. Re-derive exact `main` before each artifact. **Gate:** production ledger/catalog match the merged digest and automatic checks pass.
9. Run direct privacy-safe production acceptance: target proof, ledger/catalog, six non-DAM refusals, public filter, both count entry points, ranked pages 1/2, asset/style wrappers, total/facet parity, zero overlap/duplicates, and direct/member behavior. **Gate:** every path is correct and cold under eight seconds with ranked pages under seven. Only then close #1703, release #1912, and lift the freeze.
10. Recompute transitive blocker impact then age. Refresh and finish #1609 first if it remains the highest-impact/oldest dependency, then re-rank #1987, #1999/#2008, and #2004 rather than following chat order. Every refreshed head needs new CI/review/preview/production evidence. **Gate:** queue audit and dependency proof agree with the chosen order.
11. At the end of every phase, re-read steps through step 10 and every downstream issue plan to plan-end. Report any changed assumption, identifier, route, dependency, or verification requirement before continuing. **Gate:** downstream drift is explicit, never silently inherited.

## 7. Constraints and gotchas in force

- One live orchestrator only; successor route IDs are never copied from predecessors.
- #1703 owns lane 1 and the freeze until direct live acceptance passes.
- Preview, merge, production review, and production apply remain serialized protected resources.
- Never replay an applied migration, split an ordered batch, weaken/refuse a safety guard, raise/disable the eight-second timeout, or remove the intended search capability.
- Every head or `main` change invalidates exact-head review and promotion evidence.
- No licensed query terms, rows, user IDs, credentials, or connection strings in public evidence. Counts, timings, target identity, field presence, and refusal status are safe.
- Work only in isolated worktrees. Stage exact owned files; the shared checkout belongs to other sessions.
- #2014 is outside orchestrator scope. Its existence preserves the restorer work; it does not authorize this orchestrator to implement it.
- A closed dependency is not proof of completion; use the guarded dependency-evidence path before admitting #2008.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/shared-db` on `EDGE-DEV`.
- Coordination scripts run from the repository. On Windows, use `C:\Program Files\Git\bin\bash.exe` for Git-Bash commands; bare `bash` may invoke unavailable WSL.
- Production project identity remains historically `qsllyeztdwjgirsysgai`; prove it live again immediately before any write.
- Database credentials live in 1Password vault `vibe_coding`, item `Supabase DB Password - shared POP database`. Use only through protected `op run` environment references; never print values or put them in arguments/files.
- Grok report and the latest migration/test work are in the forward-6 worktree named in section 3.

## 9. Open questions and risks

- Track B is CI-green but has not been preview-planned or timed. Planner behavior and cold production-like cardinality remain the decisive unknowns.
- Removing the restorer changes will create a new PR head and invalidate all current review evidence; this is expected.
- Style wrapper still has the greatest risk of missing eight seconds because it can request a large member rollup. If preview EXPLAIN proves candidate visibility is cheap but wrapper fan-out dominates, fix that measured path rather than changing access gates.
- `main` can move despite the declared freeze because enforcement remains imperfect. Re-derive it immediately before evidence and mutation.
- The queue audit is not fully audited; never translate three printed empty lanes into “no work exists.”
- Old worktrees are numerous. Their cleanup is deliberately left to #1868 after no marker is open; this session did not inspect enough evidence to delete any safely.

## Sub-agent handover

### Agent: Kuhn / `issue_1703_forward5`

- **Asked to do:** author successive #1703 corrections, then implement Grok's Track B design and repair the exact failing security contract.
- **Actually did:** produced PR #2010, latest exact head `15206223df106bc4cb4d3351fee391ce8470513b`; candidate-driven ranked visibility, narrow count scan, preserved gates/contracts, and corrected the rollback-only eligible-row fixture. All current CI is green.
- **Found:** the apparent non-DAM regression was a test that never forced authorization evaluation; the production function did not need a security weakening or redesign.
- **PR / branch:** PR #2010 / `codex/issue-1703-ranked-search-forward-6`.
- **Worktree:** live and resumable at `C:\repos\shared-db-worktrees\issue-1703-ranked-search-forward-6`.
- **Deliberately did NOT do, and why:** no merge, preview, production apply, or direct acceptance; exact-head review and protected gates remain coordinator work. It also did not expand restorer work after instructed to keep that outside Track B.

### Agent: Boole / `issue_1999_author`

- **Asked to do:** author #1999's Marvel/Disney authority tie-breaker while #1703 remained lane 1.
- **Actually did:** repaired PR #2002 at head `5a621ce8c8f33a95510fbc166ad017b5d75e94e6`, changing only the Disney authority arm and proving the Lucasfilm arm stayed unchanged; focused/static local tests passed.
- **Found:** fresh CI later failed the ephemeral database suite and the PR is now conflicting against current `main`; its evidence is stale.
- **PR / branch:** PR #2002; exact branch/worktree must be re-derived from GitHub/worktree list before resumption.
- **Worktree:** live/resumable; do not clean until #1999 is refreshed or abandoned through the guarded path.
- **Deliberately did NOT do, and why:** no preview, merge, or production action because #1703 freeze remained active and #1999 was not lane 1.

### Agent: Mendel / `issue_2004_recovery`

- **Asked to do:** recover and prepare #2004's DesignFlow HTS durable precedent/shadow-comparison contract without overtaking #1703.
- **Actually did:** left PR #2009 at exact head `000e2aed39dde891b022c18e0dfe7b3f83fac3db`; current CI is green and GitHub reports it mergeable.
- **Found:** no live blocker within the PR, but protected merge/preview/production work remains held by #1703.
- **PR / branch:** PR #2009; re-derive branch and worktree before resumption.
- **Worktree:** agent was interrupted at handoff; preserve the worktree as live until the successor inspects it.
- **Deliberately did NOT do, and why:** no review refresh, merge, preview, or production apply because the freeze and lane priority prohibited it.

## Closeout self-audit

1. **Fresh newcomer can continue without questions:** yes. Sections 1-3 define the system, goal, moving facts, exact SHAs, applied state, freeze, queue, PRs, claims, and worktrees; section 6 provides ordered gates.
2. **Newcomer has the session's non-obvious knowledge:** yes. Sections 4-5 preserve every material dead end, Grok's planner diagnosis, the lazy-authorization test finding, and the restorer ownership boundary; each sub-agent has a separate state block.
3. **Every execution dimension is present:** yes. Sections 0-9 cover owner decisions, purpose, state, failures, causes, next actions, constraints, access, risks, and reciprocal downstream review.
4. **Owner-only sweep is complete:** yes. A line-by-line scan of sections 1-9 and all three agent blocks found no immediate #1703 owner decision. Pre-existing owner-only security issues are consolidated in section 0 and do not block this path.

Secrets sweep: the handoff worktree and owned diff contain no credential values, connection strings, or new secret files. No new vault item is needed.

Docs pass: nothing outside this handoff became newly false. Earlier #1703 performance evidence is explicitly superseded by the failed forward-5 acceptance and becomes stale again when forward #6 is applied.
