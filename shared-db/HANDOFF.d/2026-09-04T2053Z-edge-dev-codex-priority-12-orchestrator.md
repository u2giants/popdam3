---
issue: 2323
status: OPEN
owner: codex/2323-priority-12-handoff
---

# Path B handover — marker #2320 priority-12 orchestrator

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking, outside the priority-12 request

- **Issue #2290:** after structural issue #552 is merged, previewed, promoted, and verified, decide whether to authorize the exact operational taxonomy-health sequence described in #2290, including its breaker reset and production-baseline activation. Recommendation: authorize only after #552 has exact production proof; this blocks the operational half of the taxonomy-health recovery. The issue already has `needs-albert`.

### Already settled — do not re-ask

- On 2026-09-04 Albert directed the orchestrator to prioritize issues #2127, #2136, #2126, #2054, #1966, #2212, #2209, #2213, #2214, #2215, #2203, and #2204 through production. That authorizes ordinary governed technical execution, but it does not cancel #1966's dated evidence gate or authorize unrelated #2290.
- #1966's observation window opened 2026-09-03 and closes 2026-09-17. No index on its four tables may be dropped earlier; the next session must not ask to bypass the measurement.

The next coordinator must put the complete owner-decision list above to Albert in one message before acting on #2290. No other owner decision was discovered in this session.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared Supabase database structure used by POP Creations applications, including DesignFlow and PopDAM. One routable orchestrator coordinates structural work; migration authors work in isolated Git worktrees. Preview, merge, and production are serialized and evidence-gated.

The canonical repository is `C:\repos\shared-db`. This session used a clean current-main coordination worktree at `C:\repos\shared-db-orch-01a06e1e`, a structural author worktree at `C:\repos\shared-db-wt-2212`, and this documentation worktree at `C:\repos\shared-db-wt-2323`.

## 2. What we set out to do this session, and why

Albert asked this session to become the shared-db coordinator, identify the five issues blocking the most downstream issues, and start the following 12 as high priority through production: #2127, #2136, #2126, #2054, #1966, #2212, #2209, #2213, #2214, #2215, #2203, and #2204.

The session opened routable orchestrator marker #2320 with route ID `01a06e1e-0e18-7081-b81d-ba8d8c73ee96`, audited current `origin/main`, classified the 12, and dispatched the only immediately ready structural member, #2212. Albert then explicitly ordered a Path B closeout before implementation began.

## 3. Current state — what is true right now

### Coordination state

- At 2026-09-04T20:53:15Z, `origin/main` was `f9bfb92a6fe74b3c7265bd9134704d7520b79c05` and the highest migration filename on that commit was `20260904172420_allow_repeat_hts_determinations_across_sessions.sql`.
- Marker #2320 remained open while this handoff was written. It must be closed only after this docs-only PR is merged and all closeout gates pass.
- Queue audit on current main first reported 7/8 active author leases, then claim #2321 made it 8/8. Six older leases were expired-but-protective; expiry is not release.
- The audit was **not fully audited**: unclassified issues were #2300, #2296, #2284, #2267, #2247, #2244, #2243, #2242, #2218, #2207, #2191, #2188, and #2178; malformed scopes were #2318, #2317, #2311, #2310, #2309, #2308, #2307, #2306, and #2305; #2296 lacked the `db-work` label. Issue #2325 now owns restoration and the blocker ranking.
- Because the audit was incomplete, no global “top five” answer is defensible. The partial classified graph showed #2173 blocking one issue; #552, #718, #2138, and #2151 each blocked zero and were only the remaining order ties. Do not report that partial list as the global result.

### Priority-12 status

- **Closed before this session:** #2127, #2136, #2126, #2054, and #2209. #2209 delivered a plan only; its Steps 1–8 remain open and are now tracked by #2326.
- **#2212:** open, structural, and claimed as #2321. Reserved migration version `20260904203449`; owner `/root/issue_2212`; branch `codex/2212-popsg-contract`; worktree `C:\repos\shared-db-wt-2212`. No migration file, commit, PR, preview write, or production write exists. The worktree was clean at closeout inspection.
- **#2203 and #2204:** open and blocked on #2202. #2202's migration `20260904143518_canonical_designflow_workflow_contract.sql` was merged in PR #2259 and applied to preview by run `33890886759`, but its closeout explicitly said production had not run. A later production run `33910573989` still showed `20260904143518` absent from the remote column. Issue #2324 now owns production promotion and verification. Only after a `db-work-completion` record exists should #2203/#2204 be reclassified ready.
- **#2213, #2214, #2215:** open and blocked on the evidence and applicable application reductions required by the #2209 plan. Issue #2326 owns Steps 1–8; Steps 1 and 3 are the immediate shared blockers.
- **#1966:** open and deliberately blocked until its 14-day index observation closes on 2026-09-17. The fillfactor premise was withdrawn for three tables; no index drop is allowed before the dated delta.
- **#1090:** remains an open documentation/repo-maintenance tracker. During closeout, task `01a06e23-2786-7522-83d9-dbe714dfe94f` asked this coordinator to re-evaluate its remaining architecture phases and return exact structural successors in impact-first order. The request was refused for this closing marker and returned to that task with a pointer to #2323; the successor must inspect #1090 rather than dispatch the umbrella literally.

### Preview and production

- This marker performed **no preview or production mutation**.
- The newest preview fact directly checked was successful run `33890886759`, which applied #2202 migration `20260904143518` at PR head `80fe7e54933d033ca5ceea58dad4ee0e6ef2142e`; artifact digest `0a96d7c717953a9d06b6f7f76b9c70e748ab5552da2955ce01b4fd5b87d31cf7`.
- Preview is not called clean: it contains at least that migration and may contain later concurrent rehearsals. Re-read the live preview ledger before any new apply.
- Production run `33910573989` successfully applied allowlisted migration `20260904172420` from main `a010061f9b3e2485076eca429797f47935864cbe`; its pre-apply ledger showed `20260904143518` absent remotely. This session did not dispatch a production workflow.

### Branches, PRs, files, and worktrees owned by this session

- `codex/2212-popsg-contract` / `C:\repos\shared-db-wt-2212`: clean, live, resumable, protected by claim #2321; no PR.
- `codex/2323-priority-12-handoff` / `C:\repos\shared-db-wt-2323`: owns only this handoff file and its docs-only PR.
- `C:\repos\shared-db-orch-01a06e1e`: detached coordination worktree, clean except temporary issue-body files that must be deleted before marker closure. It is safe to retire only after the handoff PR merges and marker closes.
- All other worktrees shown by `git worktree list --porcelain` pre-existed this session and were deliberately not altered. Issue #1868 remains the correct owner of the broad reap; do not treat those worktrees as abandoned merely because marker #2320 did not inspect their processes.
- The canonical checkout already contained unrelated untracked `.codex/`, `.mcp.json`, and two older `HANDOFF.d/` files. They were preserved unchanged.

## 4. Everything we tried that did NOT work

1. The first #2212 claim command exceeded the 30-second foreground window and printed no result. A read-only audit initially still showed seven claims, so the command was retried once with an explicit exit-code print. The retry correctly refused “all 8 active-author leases are occupied” because the first request had actually completed asynchronously as claim #2321. Lesson: after an ambiguous claim result, inspect open `db-claim` issues as well as the summary before retrying; the manager stayed safe and created no duplicate.
2. An attempt to update #2212's scope with `gh issue edit --body $updated` failed because PowerShell expanded the multiline body into separate arguments (`invalid issue format: status: ready`). A subsequent `gh api` attempt failed because the CLI output had become an array rather than one string. No remote change occurred. The six proposed index objects therefore remain unadded to #2212 and claim #2321; use an exact body file or join the body to one string, then run the guarded issue-scope claim expansion.
3. The queue audit could not produce a trustworthy top-five global blocker list because malformed, unclassified, and unlabelled issues made `fullyAudited: false`. The partial `blockerCounts` output is evidence only for the classified subset.
4. Production promotion for #2202 was investigated but deliberately not dispatched after Albert ordered closeout. The existing successful production run applied only `20260904172420`; it did not prove `20260904143518` applied.

## 5. Root causes and key findings

- Five of the named 12 were already closed; seven remained open. The major scheduling issue is prerequisite evidence, not authoring capacity alone.
- #2202 is closed without production proof. Closure alone is not success, and the queue tool explicitly refuses dependencies lacking a `db-work-completion` record. #2324 makes that gap visible again.
- #2209 is a completed planning issue, not completed execution. Its plan STATUS table shows Steps 1–8 open; #2213–#2215 correctly remain blocked until Steps 1 and 3 prove causes and contracts.
- #2212's current live database definitions were inspected read-only by its author. `public.deactivate_stale_sg_files` performs one unbounded update and is executable by `authenticated`; `public.refresh_style_guide_matviews` refreshes one aggregate concurrently and the folder aggregate in blocking mode. The repository has ledger-marker history but not reconstructable CREATE definitions for both materialized views, so guessed replacement SQL is unsafe.
- The #2212 author safely recovered the live materialized-view definitions. To meet the required bounded and nonblocking plans, it proposed six exact indexes: `public.sgfolders_licensor_property_uidx`, `public.idx_sgf_reconcile_root_active_run_id`, `public.idx_sg_pdf_text_claimable`, `public.idx_sg_search_documents_search_vector`, `public.idx_sg_search_documents_filters`, and `public.idx_sg_search_documents_stable_page`. They are not yet in issue #2212 or claim #2321.
- The current migration-author cap is eight. At closeout all eight active slots were occupied; six older claims were expired but still protective and may not be hand-deleted.

## 6. Exact next steps

1. Open a new orchestrator task named `shared-db.orch…`, claim its own routable marker, and run `node scripts/check-orchestrator-marker.mjs --resolve`. **Gate:** it prints exactly the successor's route ID and only one marker is open.
2. Read #2323 and this file, fetch current `origin/main`, then rerun `--audit` and `--queue-audit`. **Gate:** moving SHAs, claims, PRs, and issue states are refreshed; no stale value above is treated as current.
3. Resume #2212 without releasing claim #2321. Update issue #2212 atomically to include the six proposed indexes, then run `node scripts/manage-migration-author-lanes.mjs --expand-active-claim-from-issue --issue 2212 --claim-number 2321 --owner /root/issue_2212 --branch codex/2212-popsg-contract --worktree C:\repos\shared-db-wt-2212`. **Gate:** the command readback lists all original and six new objects before any migration file exists.
4. Re-dispatch #2212 to a structural author in its existing worktree with reserved version `20260904203449`. Allow only `supabase/migrations/20260904203449_popsg_bounded_crawl_pdf_search.sql` and `supabase/tests/popsg_bounded_crawl_pdf_search_contracts.sql` unless the author stops and justifies another file. **Gate:** local contract tests pass, identity is correct, commit is pushed, and a PR exists; no preview action has occurred.
5. Process #2324 first through the governed production lane from the then-current main, using source PR #2259 and preview run `33890886759`; verify the automatic risk gate, exact production ledger/catalog, and live DesignFlow workflow behavior. **Gate:** migration `20260904143518` is present in production with object and business-flow proof, and #2324 has a completion record.
6. Reclassify #2203 and #2204 only after Step 5's completion proof. Claim and author them serially where their objects overlap, then run preview, independent exact-head review, guarded merge, production, catalog verification, and authenticated DesignFlow acceptance. **Gate:** both issues close with `db-work-completion` records and live workflow/notification proof.
7. Have a separate repo-maintenance session execute #2326 beginning at the plan STATUS table Step 1. Route application changes to their owning repositories and structural results to new exact-object issues. **Gate:** Steps 1 and 3 have committed evidence artifacts that justify either unblocking or closing #2213–#2215.
8. When their entry gates are proven, process #2213, #2214, and #2215 independently through preview, review, guarded merge, production, and application smoke. **Gate:** each closes with measured before/after evidence and live acceptance, without weakening freshness or removing the capability.
9. Leave #1966 blocked until 2026-09-17, then collect the same 73-index delta, classify every index, and open separate structural drop issues only for proven candidates. **Gate:** no pre-date index drop occurred and every recommendation has workload and plan evidence.
10. Have a separate repo-maintenance session finish #2325. Classify all listed issues, add the missing label where appropriate, rerun the audit to `fullyAudited: true`, and report the top five using transitive blocked count, oldest creation time, then issue number. **Gate:** the JSON says `fullyAudited: true`; only then publish the five counts.
11. Re-evaluate open tracker #1090 against current live evidence in a separate repo-maintenance session. Do not dispatch #1090 itself; create or refresh exact structural successor issues only where a current, unfulfilled shape change is proven, order them by impact, and send the issue numbers/blockers/production proof to task `01a06e23-2786-7522-83d9-dbe714dfe94f`. **Gate:** every claimed remaining phase maps to a current evidence artifact and an exact-owner issue, or is explicitly closed as already delivered/no longer needed.
12. After every merge/claim release, rerun the live queue audit and refill any eligible lane. **Gate:** every empty lane is explained by a complete audit, not an expired claim or stale document.

## 7. Constraints and gotchas in force

- Database shape work is orchestrator-only, branch/PR based, preview-first, exact-head reviewed, and production-serialized. Ordinary application data stays with the application; curated Master Data keeps its separate governance route.
- Claims protect exact objects and permanent migration versions even after lease expiry. Never delete coordination refs or claims by hand.
- A closed dependency without a `db-work-completion` record is not successful.
- Never edit an applied migration. Repairs use a new forward migration.
- Resolve the live marker before every dispatch. A handoff or closed marker is never a routing address.
- The live orchestrator engine cannot review its own work. Use only the review allocator's returned provider and wrapper.
- Preview contains production-sensitive cloned data. Prove the target immediately before every write and never use the production-bound Supabase MCP for mutation.
- #1966's September 17 date is an evidence gate, not a priority value. “High priority” does not make missing workload evidence true.
- Do not remove, bypass, or disable a feature to make a gate pass.

## 8. Access and environment

- GitHub CLI was authenticated and successfully read/wrote `u2giants/shared-db` issues and read workflow evidence.
- No database credential was printed or stored. Approved secrets remain in the 1Password vault `vibe_coding`; the #2212 author used approved read-only access and reported only schema definitions, not rows.
- Production Supabase project ref is `qsllyeztdwjgirsysgai`; preview is `rjyboqwcdzcocqgmsyel`. These identifiers are for target verification, never permission.
- This session used PowerShell on `EDGE-DEV` and Node scripts from current `origin/main` in `C:\repos\shared-db-orch-01a06e1e`.
- Secrets sweep: session outputs, owned diffs, and temporary files were checked; no credential, connection string, licensed row, or new secret requiring 1Password storage was found.
- Documentation pass: nothing outside this handoff was made stale by this session. The only durable new facts belong here and in issues #2323–#2326.

## 9. Open questions and risks

- #2290 is the only owner decision found; it is consolidated in §0 and already labelled `needs-albert`.
- #2212's six indexes are a proposed exact scope expansion based on live definitions, not yet a committed design. The guarded expansion must collision-check them before authoring.
- The live production definitions for #2212's materialized views were not captured into this public handoff verbatim. The successor should re-read them safely at implementation time; do not infer them from empty ledger-marker migrations.
- The full preview ledger and every other session's live process state were not re-derived. The successor must treat the preview and pre-existing worktrees as shared, mutable state.
- The top-five blocker ranking remains intentionally unanswered until #2325 makes the audit complete.

## Part B — per-sub-agent state

### Agent: `/root/issue_2212` / `C:\repos\shared-db-wt-2212`

- **Asked to do:** inspect and then implement #2212's bounded PopSG reconciliation, lifecycle, PDF extraction, and unified search contract after an exact claim.
- **Actually did:** read-only inspection of issue #2212, current repository definitions, live schema definitions, grants, and existing indexes. Claim #2321 reserved version `20260904203449` and the original 13 objects. No file was edited, no commit or PR was created, and no preview or production write occurred.
- **Found:** two materialized-view histories are not reconstructable from repository migration bodies; live definitions were therefore required. Six additional indexes are needed for the proposed bounded/nonblocking design and remain outside the claim.
- **PR / branch:** no PR; branch `codex/2212-popsg-contract` at `f9bfb92a6fe74b3c7265bd9134704d7520b79c05`.
- **Worktree:** live and resumable; clean when inspected at closeout.
- **Deliberately did NOT do, and why:** did not create the migration because the six indexes were not protected; did not guess materialized-view SQL; did not preview, merge, or touch production because those stages were never authorized by the coordinator before closeout.

## Mandatory self-audit

1. **Yes, a brand-new developer can continue without asking a question.** Sections 1–3 define the system, objective, exact live state, claims, environments, and every priority issue; §6 gives executable ordered gates.
2. **Yes, the successor has the same operational knowledge this coordinator had.** Sections 4–5 preserve every failed attempt and non-obvious discovery; Part B preserves the author's separate state and deliberate omissions.
3. **Yes, every execution dimension is covered.** Background and outcome are in §§1–2; branches, versions, deployment state, and evidence in §3; failures in §4; causes in §5; exact actions and success tests in §6; safety rules in §7; access/secrets/docs in §8; uncertainty and risks in §9.
4. **Yes, section 0 contains every owner judgement found in §§1–9 and Part B.** A line-by-line sweep found only #2290; it appears in §§0 and 9 with a recommendation and consequence. The priority-12 authorization and #1966 dated gate are recorded as settled decisions so they are not re-asked.

All ten required sections, the coordination half, the per-agent half, queue seeding, failure record, environment/secret status, and evidence-backed next-step gates are present.
