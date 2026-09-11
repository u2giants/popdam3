---
issue: 2704
status: OPEN
owner: shared-db.orch/01a08eaa-8c89-7061-8f29-7b39095383cd
---

# HANDOFF — production queue closeout (2026-09-11 11:52 UTC, EDGE-DEV/Codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream currently needs Albert. Continue the governed queue without asking him to review or merge. The next orchestrator must present the whole list here in one message only if a new owner decision appears.

Already settled — do not re-ask:

- Albert authorized completing the named queue through production and authorized self-merge outside DesignFlow on 2026-09-11.
- Issues #2705 and #2709 are owned elsewhere and must not be touched by this orchestrator.
- Do not touch #2290, the #2543 residual, or #2678.
- Never use `--admin`. Preserve actual independent reviews, preview proof, target proof, bounded production lanes, data history, and application capability.
- Automatic promotion should require no Albert approval after governed review and post-merge preview; issue #2716 and PR #2736 carry the implementation proposal. Version 20260910155753 was the first requested candidate and is already safely in production, so it must never be replayed.
- For #2481, do not guess a historical product-to-item crosswalk. The current nullable FK already settles cardinality: zero or one canonical item per product, with many products allowed per item. Unmatched historical products remain NULL until an authoritative mapping exists.

## 1. What this application is

`u2giants/shared-db` is the governed migration and coordination repository for the shared Supabase database used by PopDAM, PIM, CRM, and DesignFlow. The production project is `qsllyeztdwjgirsysgai`; the protected preview project is `mvpkijzfmfcxhnzqogzs`. One live orchestrator owns queue routing and dispatches structural changes to isolated worktrees. Application code remains in its application repository.

This session was the successor to marker #2689. Its marker is #2714 and route ID is `01a08eaa-8c89-7061-8f29-7b39095383cd`. The root worktree is `C:/repos/shared-db-worktrees/orch-01a08eaa` on branch `codex/orch-01a08eaa`.

## 2. What we set out to do this session, and why

Albert asked for the latest repository state, a verified successor marker, merger of docs-only PR #2713 through the guarded path without `--admin`, rapid parallel completion of long-waiting issues #2506, #2507, #2509, #2497, #2501, #2481, #2482, #2496, #2576, and #2579, an automatic-promotion design, and continuation through #2703, PR #2700, PR #2640, and PRs #2526/#2527. He later explicitly removed #2705 and #2709 from this orchestrator.

The intended outcome is direct production and live application proof, not merely merged SQL or green CI. Structural delivery and application acceptance are distinguished throughout.

## 3. Current state — what is true right now

### Orchestrator and repository

- Marker #2714 resolves cleanly to this route. Close it only as the final external action after this handoff PR merges.
- At 2026-09-11 11:52 UTC, `origin/main` was `d530f85bc54d2b3c1f3ac52fcb9ee8d57c17fe3e`; the highest migration filename was `20260911052640_popdam_tag_counts_narrow_eligibility.sql`. Both are moving facts and must be refreshed.
- Another authorized maintenance programme owns merge order PR #2738 then PR #2640 and will send the final main SHA. PR #2703 must refresh once after that final SHA, then receive a fresh exact-head review.
- Root has six untracked, owned diagnostic files: `.ai-2466-viewer-probe.mjs`, `.ai-2501-viewer-probe.mjs`, `.ai-2506-probe.mjs`, `.ai-2506-viewer-probe.mjs`, `.ai-2706-full-select.sql`, `.ai-queue-2714.txt`. They contain no secret values. Preserve or move them out before worktree cleanup; do not commit them.

### Delivered and verified

- PR #2713 merged through guarded run 34561627198; merge `71dca7b3...`; no `--admin`.
- #2579 version `20260910155753` is in production from run 34561883149; issue closed and live schema/security verified.
- #2496 version `20260907121732` is in production from run 34563022495; issue closed and live provenance/security verified.
- #2507 version `20260911042655` is in production from run 34564122644; issue closed and live limits/RPC security verified.
- #2509 was already closed and production-applied; the ledger was rechecked.
- #2497 was a predecessor-marker closeout and required no migration.
- PR #2526 merged as `439beffc5970b60bc7e1c8e0445f892fae46f8a7`; versions `20260907030418`, `20260907051735`, and `20260911045438` applied in production run 34568135063 with live table/RLS/RPC verification.
- #2466 canonical item-list version `20260909132734` applied in production run 34575705567. An authenticated viewer read returned 50 of 19,362 canonical items in 927 ms.
- #2644 durable PopDAM item state version `20260909220101` applied in production run 34582403563. A validated service-role transaction performed dismiss -> fresh canonical read true -> restore -> fresh read false -> explicit rollback. Persisted state remained zero, predictions remained 2,788, and history digest `f652ae86f9cf4489d9306f7bc4137c34` was unchanged.
- #2501 PR #2734 version `20260911052640` applied successfully to production in run 34595295842 on main `d530f85b...`. Production immediately showed the ledger row and all three indexes valid/ready. Apply artifact 10262431870 has digest `sha256:d89ea12c3db55e0aaf5261d7f40e0cdb0224dbf05216d5c437e73f06d245270a`. Structural delivery is complete; application acceptance remains open.
- #2439 structural scope was recorded complete and closed with its application-only failure-alert residual preserved in `u2giants/popdam3#123`.
- #2419/#2548 drift detector is in production. It found 6,392 missing/wrong-group application rows; no repair was guessed or performed.
- The automatic-promotion design is recorded on #2714 comment 5629666302 and implemented separately under #2716/PR #2736. No automation was enabled by this session.

### Outstanding queue, exact state

- #2501 application fix: worktree `C:/repos/popdam3-worktrees/2501-count-only`, branch `codex/2501-count-only`, currently dirty in `src/hooks/useAssets.ts`, `src/test/effective-asset-filtering.test.ts`, and `docs/verification/effective-asset-count-2501.md`. The final design serializes only effective-scope page/facet/count RPCs and stages exact count after page. Authenticated preview accepted seven filter shapes twice with exact totals and no duplicate IDs; worst cold tag page 3.054 s and count 1.664 s. No commit, PR, deployment, or production UI acceptance yet. Application issue is PopDAM #127.
- #2482 PopDAM cutover: existing draft PR `u2giants/popdam3#119`; remote head was still `9981d8bb...` at closeout, while local worktree `C:/repos/popdam3-worktrees/119-canonical-delivery`, branch `codex/119-canonical-delivery`, was clean at `13461e024d05a48505038c7f3ff18682dfa60506`. That local candidate repairs canonical prediction identities and missing-division ambiguity. It passed focused edge/app 10/10, worker 153/153, typecheck, build, and lint; the full app suite passed 345 tests with one unrelated known sell-through export timeout. The exact reviewer transport stalled for about six minutes and produced no verdict or diagnostic; the local commit was correctly not pushed. After a clean review, merge/deploy, perform the authorized one-item UI dismiss/restore acceptance, retain the legitimate final-false audit row, and prove prediction history unchanged. Do not drop legacy tables until this, soak, and PIM linkage are complete.
- #2481 PIM linkage: fresh catalog proof showed `api.plm_item_list.id` may intentionally be a legacy UUID and cannot safely populate `pim.product.plm_item_id`. New structural issue #2753 and draft PR #2755 provide `api.pim_item_picker` with true canonical UUID and company/division/source identity. PR #2755 was at pushed head `f78fd20625cc7db804fdd848a9446feddba4b3c2`; 14 required checks and full ephemeral run 34595552211 succeeded. The expected documents-only classifier refused because this is code. A durable reviewer assignment ref exists, but the wrapper was not launched; do not allocate a second reviewer before validating that assignment on the final head. The app candidate in `C:/repos/poppim-web-worktrees/issue-5-item-link-2714` passes the full 50/50 tests, lint, TypeScript, and Vite compile but must wait until the view is production-live. Do not backfill historical rows without an authoritative crosswalk.
- #2506 PR #2726 remains blocked on a real Grok timeout: local wait expired after 912 seconds but remote cancellation was never proved. Assignment 2323 and its locks must remain fenced. The ai-devops reviewer programme is repairing a supported terminal/replacement transition; do not fake a verdict, delete locks, or repeat the paid review unchanged. SQL head `84e9bd0c...` is now stale and must refresh after tooling and final main.
- #2576/#2706 structural RPC is in production, but the real Data Admin UI still timed out. #2703/PR #2740 contains route-specific OPA completion rights and must land before the performance follow-up #2744. PR #2740 head `301cd01a...` is stale; do one final refresh after PR #2738 and #2640, rerun CI, and obtain a fresh review.
- #2440 version `20260909005945` is preview-applied and production-absent. Historical preview rebind run 34584639275 succeeded on `d530f85b...`; review run 34584640834 succeeded. A prepared ready record was terminalized. Do not promote from these if main moves. Promotion changes the rebuild cron to a ten-minute poll and, because no enqueue marker exists, can enqueue one additional same-day rebuild after first reconciling the completed run. This is expected governed behavior; verify runtime and the seven-day floor.
- PR #2743/#2741 repairs historical Character alias preview with new version `20260911063554`; tested, not reviewed, stale against moving main.
- PR #2746/#2478 centralizes the shared SKU derivation; draft, tested, not reviewed, stale against moving main.
- PR #2748/#2664 adds authenticated OrderList Find position lookup; draft, tested, not reviewed, stale against moving main. #2665 was closed as duplicate.
- PR #2640 remains draft and is owned by the maintenance programme; do not duplicate it.
- #1275 has a read-only engineering proposal in comment 5631588458. No claim or code was started.
- `u2giants/popdam3#123` retains the application failure/alert acceptance residual. A safe drill proposal exists but no failure was injected and no notification was sent.

### Preview state

Preview is not clean. It contains every already-applied governed migration through version `20260911052640`, including #2501, plus historical rebind evidence for #2440 and #2501. The #2501 rebind was ledger-only and made no additional SQL change. Preview also contains other sessions' migrations and data clone state; always derive a fresh candidate before the next dispatch.

## 4. Everything we tried that did NOT work

- The first #2501 production-review evidence run 34583138767 was rejected because main moved from `84a1a1d...` to `d530f85b...`. Refreshing only the review was insufficient: production run 34584348903 then refused before write because PR #2737 changed the preview evidence producer. Supported historical rebind run 34585168762 solved the producer mismatch; production run 34595295842 succeeded.
- Terminalizing #2501's historical ready record refused because the outcome parser did not classify the unchanged ledger proof, even though the workflow and artifact succeeded. The production gate accepted the current-producer artifact directly. Do not treat the terminalization refusal as a database failure.
- #2501 sequential preview parity passed but actual simultaneous page/facets/count usage timed out. Moving category both inside and outside the RPC also timed out. The working correction delegates supported category semantics inside the RPC and serializes the three effective-scope requests; final concurrent-equivalent acceptance passed.
- The first PR #119 review rejected use of the compatibility view UUID and alphabetical division fallbacks. Local commits `7f6135d...` and `13461e0...` repair those findings. Do not reuse the rejected review as approval.
- A fresh broad PIM join-count query timed out with SQLSTATE 57014. Do not retry unchanged or infer zero coverage. Source code proved that `code`/`external_id` are source-task identifiers, not canonical item numbers.
- #2506's Grok review timed out locally without proving remote cancellation. Do not start a second equivalent review, invent a slot, or remove its locks.
- #2706 production RPC apply succeeded, but a real authenticated Data Admin read still timed out. Ledger and HTTP success are not application acceptance.
- For #2355/#2426, the original historical preview artifact bytes did not match the final merged migration. Never rebind or apply that old version; PR #2743 uses a new forward version.
- A local full PopDAM suite exposed a pre-existing Windows CRLF assertion and a parallel export timeout. PR #119 normalized newline reading without weakening assertions and passed the bounded full suite; do not hide product regressions behind those baseline facts.

## 5. Root causes and key findings

- #2501's remaining latency was not solved by indexes alone. The app launched three expensive effective-scope RPCs simultaneously. Serializing only those requests kept full rows, exact totals, all filters, and responsive page results.
- Supabase JS sends an object-valued RPC filter through POST even when `head:true`; serializing the filter JSON string produces a real HEAD. The count path must select only `id` and bound range `0-0`.
- `api.plm_item_list` preserves a legacy UUID for compatibility on one canonical row. It is safe for display but unsafe as a canonical foreign key. #2753 exposes the true UUID explicitly.
- #2644 successfully separated mutable PopDAM dismissal state from immutable prediction history. Its live rollback proof confirmed history preservation.
- #2440's first poll after activation will reconcile the existing completed run before enqueueing; the following poll may enqueue one additional same-day rebuild because `last_enqueued_at` is absent. This is expected from the merged SQL and must be included in acceptance.
- Shared main movement invalidates exact review and preview-producer evidence even when migration bytes are unchanged. Coordinate short production holds and refresh once after maintenance batches.

## 6. Exact next steps

1. Open a new orchestrator session with a new route ID, open its own marker, and run `node scripts/check-orchestrator-marker.mjs --resolve`. Read this handoff and live issue #2704. Success: exactly one marker resolves to the new route.
2. Re-fetch main and inspect the maintenance programme. Wait for PR #2738 then PR #2640 to finish, record the final main SHA, and tell all active structural agents. Success: both PR states and final SHA are live-verified.
3. Resume PopDAM PR #119 from `C:/repos/popdam3-worktrees/119-canonical-delivery`. Complete the exact review of `13461e0...`, push to the existing PR branch, make it ready, pass current-head CI, merge, verify frontend/edge/worker deployments, then run authenticated UI acceptance including the authorized one-item dismiss/restore. Success: PR merged, deployed SHAs match, UI reads canonical identities correctly, final dismissed state is false, one legitimate audit row remains, and prediction digest is unchanged.
4. Resume PopDAM #127 from `C:/repos/popdam3-worktrees/2501-count-only` after PR #119 merges. Refresh once, rerun focused tests/build/lint, obtain one clean exact-delta review, commit/push/merge, deploy, and visually confirm filters, rows, and exact totals. Success: production UI returns stable page and exact count under realistic use without timeout.
5. Resume #2753/PR #2755. Refresh after final main, rerun all CI, obtain one exact review, guarded-merge, post-merge preview, production review/apply, and live one-row-per-item/RLS proof. Then ship the PIM app candidate with save/clear/reload tests. Success: authenticated picker shows true UUID plus company/division identity, anonymous access is denied, product FK saves and clears, unmatched products remain NULL.
6. Promote #2440 only after final main: rerun prepare/fresh selector and current-producer historical preview if required, then review/apply. Observe first reconciliation, the expected possible extra rebuild, no duplicate reconciliation, ten-minute cron, retired old count cron, and seven-day floor. Success: production ledger/catalog/runtime evidence all pass.
7. When reviewer tooling proves a supported terminal/replacement path, refresh PR #2726 once, rerun CI, obtain the required fresh independent review, guarded-merge, preview, production, and actual authenticated file/guide searches. Success: both real viewer paths complete below the 8-second bound with identical results.
8. Refresh PR #2740 once on final main, rerun CI/review, merge/apply, then implement #2744 with bounded memory and full rights/search/page parity. Success: real Data Admin UI loads the mapped/unmapped/conflict population without timeout.
9. Continue drafts #2743, #2746, and #2748 independently through current-main CI, one review each, guarded merge, preview, production, and business acceptance. Success: each source issue has exact live evidence and no shared lock collision.
10. Keep #2482 open until PR #119, PIM linking, soak, and all legacy-reader scans pass; only then author a separate governed drop migration for `public.erp_items_current` and `public.erp_items_raw`. Success: zero live readers and live applications work before and after removal.

## 7. Constraints and gotchas in force

- Do not touch #2705, #2709, #2290, the #2543 residual, or #2678.
- Never use `--admin`; use guarded merge workflows. Never fabricate a reviewer verdict, cancellation, terminal state, preview artifact, completion record, or green check.
- Use isolated worktrees. Canonical `C:/repos/shared-db` is landing-only and belongs to other sessions.
- Prove the exact database target immediately before every write. Production writes use the bounded workflow, never direct DDL.
- Serialize shared preview, guarded merge, and production writes. Parallelize diagnosis, code, tests, and independent reviews.
- Application success requires real authenticated UI/workflow evidence; ledger, CI, HTTP 200, or deployment health alone are insufficient.
- Preserve capabilities and all historical evidence. Do not delete locks, worktrees, audit rows, prediction history, or legacy tables merely to clear a blocker.
- PowerShell does not expand Unix globs. Use `rg PATTERN directory -g 'pattern'`. Use `exec_command` with `login:false` on this host.
- The marker route is live authority; handoffs and conversation history are context only.

## 8. Access and environment

- Host: EDGE-DEV, Windows PowerShell. GitHub CLI is authenticated as `u2giants`.
- Supabase MCP is production-bound and read-only for this session; `get_project_url` returned `https://qsllyeztdwjgirsysgai.supabase.co`.
- Secrets live only in 1Password vault `vibe_coding`. Referenced items: Supabase management token item `3t2xoqk5luyz7ffgdhj24gvtpq`, preview service item `qbvfk7umc3n75ejekd65zwd4ty`, production app item `3hhxwrljnaq2tykxi7hplq5ryi`, sealed viewer item `mbspkosvp2rf25qxhqufipxqca`. Never reveal values.
- Use `mcp__1password__op_run` with `op://` references in environment values. Serialize 1Password windows.
- Production project ref: `qsllyeztdwjgirsysgai`. Preview project ref: `mvpkijzfmfcxhnzqogzs`.
- Browser acceptance used an authenticated Albert Microsoft SSO session; do not copy private rows into public evidence.
- Secrets sweep completed at closeout. Pattern scanning of this handoff, the diff, and all six owned untracked probes found only environment-variable names in four probes; no credential values, connection strings, `.env` files, or new secrets were created. Nothing needed moving to 1Password.
- Documentation pass completed. No standing behavior outside this handoff is newly stale; current production/app facts belong here and in their existing issue evidence. No additional rulebook or plan edit was warranted.

## 9. Open questions and risks

- No owner decision is pending. Section 0 was rechecked against this section and all agent blocks.
- Moving main may already have invalidated every exact SHA, review, and prepared preview record named here. Re-resolve before action.
- PR #119 local head was not yet pushed at the moment closeout began; losing its worktree would lose unique work.
- #2501 app work is uncommitted and unique to its worktree. Do not clean or remove it.
- #2753 may need a current-main refresh after maintenance, and its PIM app candidate must not ship before the structural view is production-live.
- The #2506 provider may still have remote work state despite the local timeout. Only supported tooling recovery may release or replace it.
- #2440 performs real scheduled work immediately after activation; acceptance must watch both reconciliation and the possible extra rebuild.
- Twelve stale handoff files whose issues are closed and no open issue cites them were reported by `node scripts/report-stale-handoffs.mjs` at 2026-09-11 11:53 UTC. They remain deliberately untouched under closeout scope freeze and are tracked by open hygiene issue #2538. Sixteen additional closed-issue files are still cited by open issues and must not be retired.
- Queue sweep completed at closeout: all unfinished structural items named here have open `db-work` issues, with #2704 as the production umbrella and specific issues #2501, #2506, #2482, #2753, #2744, #2741, #2478, #2664, #2703, #2716, #2730, #2727, and #2301 carrying the detailed work. Application residuals are open in their application repositories (#119, #127, PIM #5, and PopDAM #123).
- Moving-state recheck at closeout found PR #2738 still open at `35581fa43a1ecb9c01f85118263367c0119b06a2`, PR #2640 open/draft at `28883256aca6169d390cb75fbcac7b7f958547e8`, and PR #2755 open/draft at `f78fd20625cc7db804fdd848a9446feddba4b3c2`. Recheck again before acting.

## Part B — sub-agent handoff blocks

### Agent: finish_popdam_2501 / `C:/repos/popdam3-worktrees/2501-count-only`

- **Asked to do:** finish PopDAM #127/#2501 after structural production, preserving rows, filters, facets, and exact totals.
- **Actually did:** reproduced real concurrency failures; implemented request serialization and category pushdown; added request-order/no-overlap tests; passed 21 focused tests and build; completed authenticated preview parity for seven shapes twice; preserved production evidence in the verification document.
- **Found:** sequential success was misleading; all three effective-scope requests required ordering. Exact production SQL proof is run 34595295842.
- **PR / branch:** no PR; branch `codex/2501-count-only`; base must refresh after PR #119.
- **Worktree:** live and dirty in three owned paths listed in §3. Never clean it.
- **Deliberately did NOT do, and why:** no commit, review, deploy, or live UI because PR #119 still owns the preceding app-main change and closeout froze new shipping work.

### Agent: finish_popdam_119 / `C:/repos/popdam3-worktrees/119-canonical-delivery`

- **Asked to do:** finish existing PopDAM PR #119 after #2466/#2644 production, repair canonical prediction identity, and verify deployment/UI.
- **Actually did:** created local commits `7f6135d...` and `13461e0...`; passed focused edge/app 10/10, worker 153/153, build, typecheck, and lint; the full app suite passed 345 tests with one unrelated known export timeout. It corrected the first review's critical identity and division findings.
- **Found:** compatibility-view IDs do not always equal canonical `plm.item` UUIDs; cross-division fallback can attach the wrong prediction.
- **PR / branch:** existing draft PR #119 remote head `9981d8bb...`; local branch `codex/119-canonical-delivery` head `13461e0...` was not yet pushed at closeout start.
- **Worktree:** live, clean, unique commits; preserve it.
- **Deliberately did NOT do, and why:** the exact review of `13461e0...` stalled for about six minutes, produced zero output/error files and no verdict, and was interrupted for closeout. Therefore no push, merge, deploy, or UI mutation occurred.

### Agent: finish_2753_pim / `C:/repos/shared-db-worktrees/issue-2753-pim-item-picker`

- **Asked to do:** expose true canonical item identity for PIM, then implement the PIM picker safely.
- **Actually did:** opened issue #2753, claim #2754, draft PR #2755, version `20260911093445`, implementation commit `28f7923f...`, evidence commits through pushed head `f78fd206...`; PostgreSQL identity/cardinality/RLS/auth/anonymous/write-denial contracts and full ephemeral run 34595552211 passed. A separate PIM app candidate passed all 50 tests, lint, TypeScript, and Vite compile.
- **Found:** neither existing API view is a safe picker: one preserves a legacy UUID, the other fans out and lacks division/source identity.
- **PR / branch:** PR #2755 draft, branch `codex/issue-2753-pim-item-picker`; full ephemeral CI was running at closeout.
- **Worktree:** shared-db worktree is clean/pushed. PIM worktree `C:/repos/poppim-web-worktrees/issue-5-item-link-2714`, branch `codex/issue-5-item-link-2714`, is intentionally dirty in the adapter, collaboration, API, modal, query, type, and test-double files plus new `ItemLinkField.tsx`, `itemLink.test.ts`, and `itemLink.ts`; preserve it.
- **Deliberately did NOT do, and why:** no review/merge/preview/production or PIM deployment because closeout froze scope. Reviewer assignment ref `refs/db-review-assignments/2753-2755-f78fd206...` points to `285510b6...`, but its command returned blank after 30 seconds and the wrapper was never launched. Validate or resume it; do not allocate again blindly.

### Earlier agents completed or returned

- `finish_2507` delivered #2507 production and #2501 structural history work; its diagnostic worktree for #2501 was left safe after releasing claim #2731.
- `finish_preview_evidence` delivered PR #2725 and prepared #2478 and #1275 evidence; no pending mutation was delegated to it.
- `production_readiness` delivered #2466/#2644/#2439 evidence and authored the initial #2753 candidate; later resumed as `finish_2753_pim` above.
- `app_123_failure_proof` completed the #2644 rollback-only live application proof and then became the PR #119 worker above. It deliberately did not inject a failure or send an alert for PopDAM #123.
- The external maintenance programme owns PR #2738 then PR #2640. The external ai-devops reviewer programme owns the safe timeout/terminal-recovery capability needed by #2506. Neither is owned or closed by this handoff.

## Self-audit

1. **Could a street-new developer continue without a question? Yes.** Sections 1–3 define the system, goal, exact live state, projects, versions, runs, worktrees, and ownership; section 6 gives ordered commands/outcomes; part B separates each agent.
2. **Could they continue as effectively as this session? Yes.** Sections 4–5 preserve every costly dead end and non-obvious identity, concurrency, evidence, and scheduling discovery.
3. **Are failures and their causes included? Yes.** Section 4 covers stale-main review, producer mismatch, terminalization refusal, concurrency failures, bad UUID assumptions, PIM timeout, reviewer cancellation uncertainty, UI timeout, and invalid historical bytes.
4. **Is every next step executable and verifiable? Yes.** Each of section 6's ten steps ends with a concrete success gate.
5. **Are terms, identities, paths, URLs, SHAs, and access defined? Yes.** Sections 1, 3, 7, and 8 define them and distinguish moving facts.
6. **Was the section-0 sweep run? Yes.** Sections 1–9 and every part-B block were checked for `owner`, `approve`, `decide`, `waiting`, `ruling`, and `unanswered`. No unresolved owner choice exists. Settled exclusions, no-review asks, automatic-promotion authority, and the no-guessed-backfill decision are all indexed in section 0.

Final synthesis:

1. **Is this comprehensive enough for a brand-new developer to continue without skipping a beat? Yes**, supported by sections 1–9 and part B.
2. **Is it detailed enough to continue with all current session knowledge? Yes**, especially sections 3–6 and part B.
3. **Is every relevant background, goal, state, failure, decision, constraint, risk, action, and proof present? Yes**, mapped across sections 1–9.
4. **If Albert read only section 0, would he see every decision needed from him? Yes.** The line-by-line sweep found no pending decision; all settled decisions and exclusions are explicitly listed there.

## Next-session prompt

```text
Open a fresh orchestrator session in C:/repos/shared-db using an isolated current-upstream worktree. Read AGENTS.md, the shared-db-orchestrator skill, and HANDOFF.d/2026-09-11T1152Z-edge-dev-codex-production-queue-closeout.md. Open your own orchestrator marker with a new route_id and verify it using node scripts/check-orchestrator-marker.mjs --resolve before dispatching anything. Resume the production queue from live GitHub state: coordinate final main after PR2738 then PR2640; finish PopDAM PR119 before PopDAM #127; finish shared-db PR2755 then the PIM app; promote #2440 with fresh evidence; recover #2506 only through supported reviewer tooling; refresh PR2740 once and then #2744; continue PRs2743/2746/2748. Never touch #2705, #2709, #2290, the #2543 residual, or #2678. Verify every completion with current exact-head CI, governed preview/production evidence, and real authenticated application behavior.
```
