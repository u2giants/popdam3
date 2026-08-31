---
issue: 1703
status: OPEN
owner: successor-orchestrator-after-1983
---

# Orchestrator #1983 closeout: finish #1703, then #1609

## 0. Decisions only the owner can make

### Blocking

- **#1671 non-production DesignFlow deployment:** DEV and STAGING database credentials both resolve to the protected production Supabase project. Do not apply. Albert or the infrastructure owner must provide genuine non-production bindings or explicitly identify the corrected secret versions. Recommendation: correct the bindings before resuming #1671. This blocks only #1671.

### Already settled — do not re-ask

- 2026-08-31: prioritize work by how many other open issues it unblocks, not by which chat asked most recently. PR #1990 implements that repository-maintenance rule but is not orchestrator structural work.
- 2026-08-31: preserve the #1703 production freeze until direct live acceptance passes; successful merge, preview, apply, or catalog verification alone is not acceptance.
- 2026-08-31: finish #1703 through live acceptance before resuming #1609. Never reuse stale review or promotion evidence after any head or `main` change.
- DesignFlow production stays on Cloud SQL schema `designflow`; do not cut production to Supabase, change unsuffixed production secrets, or add production multi-schema behavior.

The successor must present the whole blocking list to Albert in one message only if it needs owner action. Do not interrupt #1703/#1609 for #1671.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of POP Creations' shared Supabase database. One live orchestrator owns triage, dispatch, review, merge, preview, and production promotion; actual schema authoring happens in isolated worktrees. GitHub issues labelled `db-work` are the queue. Preview and production are shared protected environments.

The immediate business goal is a PopDAM search contract that is authorized, pagination- and facet-correct, and completes cold within eight seconds. After that, #1609 supplies a durable home for human source-to-POP resolution decisions so new captures cannot erase those decisions.

## 2. What this session set out to do, and why

This successor took marker #1983 to transfer the live orchestrator safely, re-derived `main`, queue, claims, and the production freeze, and was asked to finish #1703 through direct production acceptance and then complete #1609. The owner later clarified that queue priority is dependency impact, not arrival by chat.

The session shipped #1703 forwards #3 and #4 through production, but direct privacy-safe live acceptance still failed. It stopped before authoring forward #5, leaving a clean evidence boundary for a fresh orchestrator.

## 3. Current state — verified live

Moving facts were checked 2026-08-31 at 17:14Z unless a more exact event time is stated.

- Live marker: #1983, route `01a0580f-2fcd-78a2-8c67-629c5eddf929`. Close this marker only after this handoff PR is merged and all HANDOVER issues are created.
- `origin/main`: `eece8554261a92dde1428dca3965d4d47ab683b2`. The maximum migration on `main` is `20260831145707_popdam_ranked_search_query_expansion_estimate.sql`.
- A documentation merge, PR #1991 / commit `eece8554`, moved `main` after #1703's exact apply commit despite the declared freeze. Therefore every future review/promotion proof must bind to a freshly re-derived `main`; no artifact in this handoff authorizes reuse.
- Queue audit is not fully clean because #1984's documentation scope lists a plan filename as an unknown database object kind. There are no unclassified or unlabelled issues.
- Protected structural claims: #1912 for #1703, #1938 for #1609, and #1988 for #1987. Do not release a claim until its issue is genuinely complete or a guarded abandonment path explicitly permits it.

### #1703 — highest-priority structural work

- Open issue #1703 and claim #1912 remain authoritative. The production freeze remains active.
- Forward #3: PR #1981, migration `20260831104325`, merged and applied to preview and production (production run 33404966928). Direct acceptance failed; planner `ROWS 32` still produced broad-path timeouts.
- Forward #4: PR #1986 exact reviewed head `f638e4c4e7458760e5019e9c5ca8cba9e81a8b77`; merged as `227234b5cb481e4b6ee4461048d494ce186e3cfc`. Migration `20260831145707` changed the synonym expansion estimate to `ROWS 4` without limiting returned variants.
- Fresh forward #4 preview apply: run 33410916039, artifact digest `sha256:66f67f1a3b97e161bead62b5d8ac859f214d4d0e531ad7829b3505314fc91e8d`.
- Fresh production dry-run: 33411273748. Fresh immutable production review: 33411441935, digest `sha256:89683f59dba74d8a0e76c070b21a31e395dae1c92dd003a52611d962c1e50977`. Production apply: 33411491716. These prove only forward #4 and are stale for any new head or migration.
- Direct production acceptance after apply failed: filter 84 ms; effective counts 4,987 ms; legacy counts timed out at 8,063 ms; ranked pages timed out at 8,065/8,079 ms; asset wrapper 8,072 ms; style wrapper 8,151 ms. All six non-DAM paths correctly refused in 60–76 ms. Corpus proof was privacy-safe: 2 direct groups, 533 member groups, 1,474 asset documents. Full evidence is issue comment `https://github.com/u2giants/shared-db/issues/1703#issuecomment-5481013467`.
- No forward #5 branch, migration, PR, review, preview, or promotion exists yet.

Fresh read-only diagnosis for forward #5:

1. In `search_dam_documents`, `visible_assets` materializes `f.*` at about 1,714 bytes and `matched_assets` redundantly executes `select distinct a.*`, causing a wide HashAggregate across roughly 68 asset columns. Candidate asset IDs are already distinct and the primary-key lookup preserves uniqueness.
2. Reissue the ranked function with unchanged behavior except `visible_assets` projects only `id, style_group_id, file_type, status, workflow_status, stage, is_licensed`, and `matched_assets` uses `select a.*` rather than `select distinct a.*`.
3. Keep the entitlement gate but route `get_filter_counts(jsonb)` through `get_effective_filter_counts_unchecked_1703(coalesce(p_filters,'{}'))`; do not remove the private legacy helper merely to hide the symptom.
4. Preserve grants, `SECURITY DEFINER`, the eight-second ceiling, ranking, all synonym/substring variants, filter behavior, exact totals/facets, pagination, and both compatibility wrappers.

### #1609 — next only after #1703 acceptance

- Open issue #1609, claim #1938, and PR #1939 remain live. Branch `codex/issue-1609-source-resolution`, head `e408bc1dbe558fe084c5d0c46fe0463f9f868776`, migration `20260831145729_source_resolution_supported_home.sql`.
- PR #1939's last known full checks passed, but it is now `DIRTY` against current `main`; its base was `bff443d253d1d8ae1859ec67a4d52523a9961be6`. All prior reviewer and promotion evidence is stale.
- No preview or production apply of `20260831145729` occurred in this session.

### Other outstanding session-specific items

- New HANDOVER coordination issues created at owner direction: #1992 for #1703, #1993 for #1609, #1994 for blocked #1671, #1995 for #1987, #1996 for malformed #1984, and #1997 for PR #1990. They contain no schema claims; the original issues remain authoritative.
- #1671: blocked and labelled `needs-albert`; both supposed DEV/STAGING database bindings point to production. No apply occurred.
- #1987 / claim #1988 / PR #1989: incoming DesignFlow notification structure request. Migration `20260831151112`, branch head `c3ffdd59cc2872bfd86e56d6eae2064e06eb2da6`; checks passed on its old base, but it is held, not reviewed, merged, previewed, or promoted. It must be ranked by dependency impact after #1703/#1609, not by chat arrival.
- #1984: documentation/repo-maintenance intake is malformed because `writes` contains a plan filename. It is outside orchestrator structural work and must be corrected by a repo-maintenance session.
- PR #1990: repository-maintenance implementation of blocker-impact priority, head `4e141a792b8eb2f5875bccf7930ce17f71072bf7`; open and blocked by Cross-PR Object Collision. It is not structural orchestrator work.

### Preview and production state

- Shared preview contains #1703 migrations through `20260831145707`; forward #4 rehearsal succeeded. That rehearsal becomes stale when forward #5 replaces either function.
- Production contains #1703 migrations through `20260831145707`; catalog verification passed but direct behavioral acceptance failed. Do not replay any applied version.
- #1609 migration `20260831145729` and #1987 migration `20260831151112` have not been applied by this session.

## 4. Everything tried that did not work

- Treating successful merge/preview/apply/catalog checks as completion did not work; each #1703 forward still failed direct production behavior.
- `20260831074401` added authorization/performance work but broad ranked pages, wrappers, and legacy counts timed out.
- `20260831093107` introduced keyed visibility and made narrow paths fast, but populated broad pages/member rollup still exceeded ten seconds.
- `20260831104325` set the synonym expansion estimate to 32; production still timed out near eight seconds.
- `20260831145707` corrected that estimate to the observed maximum of four; production still timed out near eight seconds. Planner cardinality was not the remaining root bottleneck.
- Reusing exact-head reviewer output after a rebase or `main` movement was refused. DeepSeek sequences 761/762, canceled Grok 763, and aborted GLM 764 are stale. Only sequence 765 approved PR #1986's final head, and even that approval authorizes no forward #5.
- An attempt to post an issue comment through an empty stdin body failed harmlessly; the comment was then posted directly. No database or repository state was affected.
- The main checkout is hundreds of commits behind and heavily untracked; using it for authoring would risk other sessions' files. This handoff uses isolated worktree `C:\repos\shared-db-worktrees\handover-1983-20260831`.

## 5. Root causes and key findings

- The remaining ranked-search bottleneck is wide-row materialization and redundant deduplication inside the shared ranked RPC, not lack of authorization and not synonym count. Production EXPLAIN showed a HashAggregate across roughly 68 asset columns after uniqueness had already been established by distinct candidate IDs.
- Legacy `get_filter_counts({})` still routes through the slower private path and times out, while the behaviorally equivalent effective-count path completed in 4.99 seconds.
- The production access boundary now works: every non-DAM path refuses promptly. Forward #5 must preserve that capability rather than bypass or remove it.
- A docs-only merge can move `main` during the declared freeze because enforcement is incomplete; issue #1688/PR #1948 are the separate maintenance track. Always re-derive exact `main` immediately before evidence or promotion.
- #1671 is not a schema-design blocker: it is a target-safety blocker. The current DEV/STAGING bindings are production and therefore cannot be used under the non-production authorization.

## 6. Exact next steps

1. Open a new orchestrator session and claim a fresh marker with its own route. Run `node scripts/check-orchestrator-marker.mjs --resolve` and do not dispatch until it resolves only to the new route. **Gate:** exactly one open marker names the successor.
2. Fetch current `origin/main`; rerun `node scripts/manage-migration-author-lanes.mjs --queue-audit`; re-derive #1703 claim #1912 and the freeze. **Gate:** no unacknowledged second marker or claim collision.
3. Dispatch #1703 forward #5 to an isolated author worktree. Implement only the narrowed seven-column `visible_assets`, removal of redundant wide `DISTINCT`, and legacy-count delegation described above. Use a new never-reused migration version. **Gate:** diff preserves access gates, grants, wrappers, filtering, ranking, totals, facets, and pagination.
4. Add tests that require the explicit seven-column projection, forbid `select f.*` and `select distinct a.*`, require exactly one effective-count delegate, compare ranked rows/totals/facets before and after projection, and keep two-user refusal, synonym, member-rollup, filtered deep-page, no-overlap, and parity suites. Add a hash-bound production sidecar checking function bodies and EXECUTE boundary. **Gate:** full relevant offline, SQL, ephemeral database, catalog-truth, and sidecar suites pass.
5. Obtain a fresh governed exact-head reviewer verdict. Any head change invalidates it. Guarded-merge only the exact approved head under a quiet release limited to #1703. **Gate:** PR is merged and `origin/main` is freshly re-derived.
6. Prepare the live preview dispatch from the merged ready record. Run fresh preview dry-run and apply, then cold authenticated tests for page 1, page 2, both wrappers, and both count entry points using populated preview data. **Gate:** all paths are correct and finish under eight seconds with meaningful headroom; no row values enter public evidence.
7. Run a fresh production dry-run, fresh immutable review-evidence workflow, and guarded production apply for only the new version. **Gate:** apply and post-apply catalog verification pass on exact current `main`.
8. Run direct privacy-safe production acceptance with real DAM and non-DAM identities: target/ledger/catalog, all six refusals, filter and both count APIs, broad pages 1/2, asset/style wrappers, exact total/facet parity, no overlap/duplicates, and direct/member Style Group behavior. **Gate:** every required path passes cold within eight seconds with headroom. Only then close #1703, release claim #1912, and lift the freeze.
9. Rebase/supersede PR #1939 onto then-current `main`; regenerate all tests, reviewer proof, preview rehearsal, production dry-run/review/apply, and direct catalog/behavior proof. **Gate:** #1609 is live in production and the durable-resolution write/read contract is verified before closing #1609 and releasing #1938.
10. Re-rank the remaining queue by transitive blocker impact. Do not automatically promote #1987 because another chat asked for it. Correct #1984 in a repo-maintenance session; resolve #1990 outside orchestrator structural work; keep #1671 blocked until genuine non-production targets exist. **Gate:** queue audit is truthful and every outstanding coordination issue has an owner/route.
11. At the end of each phase, re-read every downstream step through step 10 and report any changed assumption, identifier, route, or verification requirement before continuing. **Gate:** downstream drift is explicitly recorded rather than silently inherited.

## 7. Constraints and gotchas in force

- One orchestrator marker only. A successor uses a new route ID; never edit or reuse #1983's marker address.
- #1703 production freeze remains active until direct live acceptance, not merely apply. Preview, merge, and production actions remain serialized.
- Never replay applied migrations or split an ordered batch. Every correction receives a fresh 14-digit version.
- Exact-head reviews and promotion artifacts become stale after every head or `main` change. Handoff evidence is context, never authorization.
- Do not expose licensed query terms, row values, user identifiers, credentials, or connection strings. Public evidence may contain only target identity, field presence, counts, timings, and pass/refusal status.
- Do not raise or disable the eight-second statement timeout. Preserve the intended search capability.
- #1609 follows #1703. #1987 is held. Repo-maintenance and documentation are not orchestrator assignments.
- The dirty shared checkout belongs to multiple sessions. Work only in isolated worktrees and stage only owned files.

## 8. Access and environment

- GitHub CLI is authenticated for `u2giants/shared-db` on EDGE-DEV.
- Node coordination scripts run from `C:\repos\shared-db`; use `C:\Program Files\Git\bin\bash.exe` for Bash-specific checks on Windows.
- Production project identity is `qsllyeztdwjgirsysgai`. Prove it again immediately before every write.
- The production database password lives in 1Password vault `vibe_coding`, item `Supabase DB Password - shared POP database`. Read it only through a protected environment variable and clear it immediately; never place it in arguments, logs, files, or chat.
- Privacy-safe acceptance scripts used by this session are in `C:\repos\shared-db-worktrees\issue-1703-prod-acceptance`; inspect and update their ledger/prorows assertions before reuse. They are diagnostic aids, not durable evidence.
- Handoff worktree: `C:\repos\shared-db-worktrees\handover-1983-20260831`, branch `codex/handover-1983-20260831`.

## 9. Open questions and risks

- Forward #5 is a fresh diagnosis, not yet preview-proven. Narrowing projection is intended to preserve semantics, but parity tests must prove no output/facet change.
- The current `main` may move again despite the freeze because enforcement PR #1948 is not merged. Recheck immediately before every guarded action.
- PR #1939 and PR #1989 are based on stale `main` and may require version supersession after rebase; never guess that old migration versions remain lawful.
- #1671 requires owner/infrastructure action described in section 0. Nothing else in the immediate #1703 → #1609 path needs Albert.
- Queue audit remains non-clean until #1984's malformed documentation scope is corrected.

## Sub-agent handover

### Agent: Pasteur / requested_status_audit

- **Asked to do:** first audit requested issue statuses; later perform fresh read-only #1703 forward #5 diagnosis after production acceptance failed.
- **Actually did:** reported live issue status and produced the forward #5 diagnosis captured in sections 3, 5, and 6. No commit or database write.
- **Found:** redundant wide-row deduplication in `search_dam_documents` and the slower legacy empty-filter count route are the smallest remaining bottlenecks.
- **PR / branch:** none.
- **Worktree:** finished; no owned worktree reported.
- **Deliberately did NOT do, and why:** did not author a migration, mutate shared state, or reuse old evidence because the assignment was read-only diagnosis.

### Agent: Linnaeus / issue_1609_readiness

- **Asked to do:** audit #1609 readiness and, at closeout, independently inventory session-specific outstanding queue items.
- **Actually did:** established that PR #1939 was ready only on its then-current base and must be refreshed after #1703; independently confirmed that every underlying work item was already seeded in the live issue queue.
- **Found:** #1609's old evidence cannot survive later `main` movement; it must follow #1703 with a new exact-head chain. It also found missing `needs-albert` labels on owner-only #1353 and #718; this session added both labels before closeout.
- **PR / branch:** existing #1609 PR #1939 / `codex/issue-1609-source-resolution`; the agent made no new commit in this closeout.
- **Worktree:** finished/idle; preserve the existing #1609 worktree until the successor verifies its exact path and dirty state.
- **Deliberately did NOT do, and why:** did not rebase, merge, preview, or promote #1609 because the owner ordered #1703 live acceptance first.

## Closeout self-audit

1. **Fresh newcomer can continue:** yes — sections 1–3 define the system, objective, exact live state, SHAs, claims, runs, and environments; section 6 gives gated actions.
2. **Newcomer has all session knowledge:** yes — sections 4–5 preserve failed forwards and the non-obvious forward #5 diagnosis; sub-agent blocks preserve delegated findings and omissions.
3. **Every execution detail is present:** yes — sections 0–9 cover decisions, purpose, state, dead ends, causes, ordered steps, constraints, access, risks, and downstream drift review.
4. **Owner-only sweep is complete:** yes — line-by-line review of sections 1–9 and both agent blocks found only #1671 requires Albert/infrastructure action; it is consolidated in section 0 with a recommendation. All other owner rulings are in the settled list and must not be re-asked.

Secrets sweep: no new credential or token was created or exposed; the only secret used was read transiently from the existing 1Password item and the environment variable was cleared.

Docs pass: no standing document outside this handoff became newly false. Forward #4 evidence is explicitly marked stale for forward #5 here and in #1703's live issue history.
