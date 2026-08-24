---
issue: 97
status: OPEN
owner: codex/hybrid-search-grok-closeout-97
---

# HANDOFF — hybrid-search plan and Grok review closeout (2026-08-24T1711Z, hetz/codex)

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

Put this entire list to Albert in one message when each gate is reached; do not ask piecemeal.

### BLOCKING

1. **Production database promotion.** Albert must approve the exact merged shared-db migration after preview behavior, timing, authorization, and no-delete evidence. This blocks the production part of plan Step 2. Recommendation: approve only the combined #96/#97 incremental contract; reject any full-table delete/rebuild or competing function replacement.
2. **Full production embedding backfill.** Albert must approve after a small bounded production sample reports throughput, projected duration, worker impact, failures, and rollback. This blocks plan Step 8. Recommendation: keep keyword mode active and automatic embedding disabled during the sample.
3. **Turn on Smart search.** Albert must approve `SEARCH_MODE=hybrid` only after final corpus coverage, authorization across edge/direct RPCs, filtered pagination/facets, fallback, performance, and rollback proof. This blocks plan Step 9.

### RECOVERABLE, BUT MUST BE EXPLICIT

4. **Telemetry retention and fields.** Telemetry is unnecessary for the initial launch. If pursued later, Albert must approve captured fields and retention before implementation or enablement. Recommendation: keep it off; if approved, start with 30 days and exclude raw query text unless expressly permitted.
5. **Image embeddings.** They are a separate model, storage, pipeline, and cost investment. Recommendation: do not implement them under issue #97; prepare a separate costed proposal only if Albert requests it.

### ALREADY SETTLED — DO NOT RE-ASK

- 2026-08-24: keyword mode remains the default and immediate rollback until all launch gates pass.
- 2026-08-24: no production delete-all search rebuild.
- 2026-08-24: issues #96 and #97 share one governed shared-db workstream and one final embedding backfill; do not embed an intermediate corpus.
- 2026-08-24: only active asset/Style Group tags plus canonical character names enter ordinary search; candidate/rejected tags are excluded.
- 2026-08-24: the worker is the sole embedding lease claimer; `dam-search-ai` embeds only explicitly leased rows.
- 2026-08-24: authorization applies across the edge function, direct hybrid/keyword RPCs, and status/actions; browser filtering alone is insufficient.
- 2026-08-24: authorization, visibility, and active library filters precede ranked pagination; grid facets/counts describe the same result set.
- 2026-08-24: telemetry is a later optional phase and image embeddings are outside this implementation.

Section-0 sweep result: the only owner judgments found in §§1–9 are the five items above. Freshness SLO, semantic threshold, transition-table versus stale-queue implementation, and exact pagination mechanism are evidence-based engineering choices already bounded by the canonical plan and do not require a new owner decision unless measurements materially change business behavior.

## 1. What this application is

PopDAM and PopSG are POP Creations' shared digital-asset libraries for licensed consumer-product artwork. Designers and sales staff search more than 100,000 art files, thumbnails, tags, characters, licensed properties, PDFs, and SKU/style groups.

- Application repo: `/worksp/popdam`, GitHub `u2giants/popdam3`, branch `main`.
- Canonical shared-schema repo: `/worksp/shared-db`, GitHub `u2giants/shared-db`; database structure is branch + PR work owned by its single orchestrator.
- Frontend: React/Vite, production `https://dam.designflow.app` and `https://sg.designflow.app`, GHCR/Coolify deployment.
- Search edge function: `supabase/functions/dam-search-ai/index.ts`, deployed to shared Supabase project `qsllyeztdwjgirsysgai`.
- Persistent batch worker: `apps/worker/`, deployed by Railway from PopDAM `main`.
- Canonical plan: [`../plan_hybrid_search_rollout.md`](../plan_hybrid_search_rollout.md), tracked by PopDAM issue [#97](https://github.com/u2giants/popdam3/issues/97).
- Related scoped-tag plan: [`../plan_style_group_scoped_ai_metadata.md`](../plan_style_group_scoped_ai_metadata.md), tracked by issue #96. Both share search functions, triggers, and final corpus order.

## 2. What we set out to do this session, and why

Albert supplied a proposed plan to finish keyword + pgvector hybrid search, asked for an assessment, requested a standalone implementation plan, asked Grok 4.6 to review it, and then requested that Grok's correct findings be integrated.

The business goal is safe, useful natural-language discovery: users can search phrases such as “cozy winter snowman scene,” tag-only signals such as “blue glitter,” and character-only signals such as “Groot,” while keyword fallback remains available, unauthorized records never leak, relevance survives paging/filtering, and new metadata is embedded automatically and recoverably.

This session's technical objective was planning and independent review only. It did not implement schema, application code, config changes, backfills, or production activation.

## 3. Current state — what is true right now

- The canonical plan exists at `plan_hybrid_search_rollout.md`; its STATUS table is authoritative. Step 1 is in progress, Step 2 is routed, and Steps 3–11 remain open.
- Combined #96/#97 structural work is routed through shared-db issue `u2giants/shared-db#1427` to the active orchestrator marker identified in the plan/handoff. Do not open a competing search-function issue or branch.
- Scoped-tag baseline evidence from the concurrent #96 work exists under `verification/ai-tagging-scope/`; search-specific live deployment/auth/coverage probes remain pending.
- Grok 4.6 Build independently reviewed the plan in a read-only snapshot and returned **APPROVE WITH CHANGES**. Successful review cost was `$0.28274026`, 17 turns. The saved private local report is `.ai/reviews/grok-popdam-hybrid-search-plan-retry-20260824T152638Z-3183330.md` and is intentionally git-ignored.
- Every confirmed Grok correction was integrated into the plan, handoff, and `fix_search.md`: #96 coordination; old/new group membership refresh; latest rich-PDF corpus preservation and 8,000-character ordering; worker-only claiming; edge/direct-RPC authorization; admin-only embedding status/actions; unified keyword/hybrid group ranking; filters before paging; facet/count parity; eight-second timing; tag/character degraded fallback; `SEARCH_MODE` cache invalidation; and three-map operation synchronization.
- Plan integration commit `19f9c12a09015cb1710f19bbf1b323473f2b1d16` was pushed to both configured GitHub remotes and recorded on issue #97. Subsequent concurrent commits advanced `main`; at closeout local `HEAD`/`origin/main` was `766a8dac` and contained the plan commit in its ancestry. Verify current SHA again on resume.
- No hybrid-search application/schema/config implementation was performed, no production database write or backfill ran, and `SEARCH_MODE` was not changed by this session.
- Previous planning handoff `HANDOFF.d/2026-08-24T1433Z-hetz-codex-hybrid-search-plan.md` remains open because issue #97 is unfinished. It was not retired: its implementation obligations are not proven complete.

## 4. Everything we tried that did NOT work

1. **First Grok review attempt failed before review.** The repository initially lacked `.ai/reviews/` ignore safety, so `ai-grok-review` refused to spend. After the safety entry existed, the first run waited to the 900-second wrapper ceiling and reported an expired Grok refresh token (`invalid_grant`); no verdict/session was created. Why not repeat blindly: timed-out paid turns retain a fail-closed repository lock because remote cancellation is unconfirmed.
2. **Normal Grok continuation failed.** After Albert logged Grok in, `ai-grok-review ask popdam-hybrid-search-plan` reported no resumable session because the failed first turn never established one. A new review was correctly blocked by the retained uncertain lock.
3. **Safe recovery.** The stale lock's local PID was gone, there was no provider session, and the failure was pre-request authentication. The exact lock directory was moved to a timestamped recoverable `.reconciled-*` backup before the single permitted retry. The retry completed successfully; do not delete/bypass active review locks without equivalent proof.
4. **Initial push of the integrated plan was rejected non-fast-forward.** Another session had pushed a shared-db sync. With a clean worktree and zero stashes, the isolated documentation commit was rebased onto `origin/main` without conflicts, then pushed normally. No force push was used.
5. **Rejected architecture paths are recorded in plan §7.** The important ones are delete-all rebuilds, row-level refresh thrash, asset-only refresh, hash-only concurrency, two embedding claimers, edge-only authorization, paging before filters, copying the obsolete foundation refresh body, arbitrary limit increases, launch-coupled telemetry, and image embeddings in this scope.

## 5. Root causes and key findings

1. Existing search documents omit AI tags and canonical character names, making paid-for extraction unavailable for discovery (`plan_hybrid_search_rollout.md` §§5–6).
2. The latest known refresh body is `shared-db/supabase/migrations/20260715183000_dam_rich_pdf_extraction.sql`, not the 20260713 foundation. A replacement must preserve content type, item description, materials, dimensions, rich metadata, and PDF text.
3. Embedding claims truncate `search_text` to 8,000 characters, so active tags/characters must be placed before long PDF text or semantic discovery will fail on rich PDFs.
4. Once group documents aggregate member metadata, `assets.style_group_id` moves, delete/undelete, relationship moves, and eligibility changes must refresh/enqueue the asset plus OLD and NEW groups.
5. `claim_dam_search_embedding_documents()` is currently a select, not an exclusive claim. Hash checking prevents stale commits but not duplicate compute; real leases and one claimer are required.
6. `dam-search-ai` authenticates the caller and then searches with service role. Direct security-definer hybrid/keyword RPCs also remain callable by authenticated users. Authorization must cover every externally callable path before IDs, ranks, counts, or metadata leave the server.
7. Keyword style-group search currently includes a member-asset rollup while hybrid group search requests only group documents. One ranking contract must serve both modes so fallback does not reshuffle results.
8. Current relevance paging fetches a global 500-ID set and applies library filters afterward. Correct pagination applies authorization, visibility, and active filters before page boundaries; facet/count results must describe the same set.
9. `getSearchMode()` caches a promise for the module lifetime, so activation/rollback needs TTL or explicit invalidation for already-open browser sessions.
10. Operation name/lane/conflict maps are already drifted (`rich-pdf-extract` missing from the worker lane map); Step 4 must reconcile the entire maps and add an equivalence test.
11. The final ILIKE fallback cannot find tag-only/character-only signals today. The plan requires a safe indexed degraded path or explicit operational limitation and tests.

## 6. Exact next steps

1. **Resume from the plan STATUS table, not this narrative.** Re-read `AGENTS.md`, `CLAUDE.md`, `plan_hybrid_search_rollout.md`, both hybrid handoffs newest first, `plan_style_group_scoped_ai_metadata.md`, and current `/worksp/shared-db/AGENTS.md`. Refresh `git status`, HEAD, open issues/PRs, and shared-db orchestrator state. You'll know it worked when current evidence has replaced every possibly stale SHA/status assumption.
2. **Finish plan Step 1 read-only verification.** Prove production project `qsllyeztdwjgirsysgai` before each read; capture search-document counts, embedding coverage/errors, live `SEARCH_MODE`, deployed edge/frontend/worker SHAs, manual auth behavior, current RLS/functions, tag-only/character-only baselines, and production-scale timing. Update the plan STATUS table with artifact paths. You'll know it worked when every live assumption has target proof and no write occurred.
3. **Let shared-db issue #1427 own Step 2.** Ensure the orchestrator uses the latest effective refresh bodies, preserves rich-PDF fields, includes only active asset/Style Group tags plus canonical characters before PDF text, refreshes OLD/NEW groups, installs bounded incremental maintenance and worker-owned leases, secures external RPCs, and proves all preview tests listed in plan §10. You'll know it worked when preview evidence, merged SHA, exact production approval, target proof, and post-apply object definitions are recorded; do not self-author this migration in PopDAM.
4. **Implement plan Steps 3–7 only after the shared contract lands.** Add all-path authorization, worker-only embedding, bounded freshness, admin coverage UI, unified group ranking, filtered ranked pagination/facets, eight-second timing, fallback coverage/limitations, mode-cache invalidation, and operation-map equivalence. Use the plan's named files and tests. You'll know it worked when each step's explicit verification gate passes and deployed component SHAs are separately proven.
5. **Stop for Albert before Step 8.** Run only the approved small bounded production sample after confirming #96's final corpus has landed, then report throughput/duration/impact/residue/rollback. You'll know approval is sufficient when Albert names the exact full backfill after seeing that evidence.
6. **Stop for Albert before Step 9.** Enable hybrid only after full eligible coverage, security, filtered paging/facets, fallback and rollback evidence. You'll know launch worked when live browsers use hybrid, authorization isolation passes, edge→keyword→ILIKE behavior is proven, and setting keyword mode back is demonstrated.
7. **Close out correctly when issue #97 is complete.** Update durable docs and STATUS, run checks, prove GitHub/CI/deploy/live SHAs, close issue #97, and delete both open issue-97 handoffs only when every obligation is carried into durable history and proven complete. You'll know it worked when no stale handoff, untracked migration, or undocumented owner decision remains.

## 7. Constraints and gotchas in force

- Shared database structure changes go only through canonical `/worksp/shared-db`, its single orchestrator, branch/PR, preview-first process, and exact-target proof. Never use app migrations, Dashboard SQL, or direct DDL.
- PopDAM is trunk-based `main`; stage owned paths only, preserve concurrent work, rebase safely on non-fast-forward, and never force push.
- Do not edit generated `src/integrations/supabase/types.ts`; use the deployment generation process.
- Keep keyword mode active until final launch approval; preserve one-setting rollback.
- Do not call the delete-all `rebuild_dam_search_documents()` in production.
- Start replacement functions from the latest effective definitions and preserve all current rich-PDF/product fields.
- Stable sorted aggregates are required so hashes do not churn nondeterministically.
- Candidate/rejected #96 tags never enter ordinary search.
- The worker is the sole embedding claimer; edge and scheduler cannot independently claim.
- Direct keyword/hybrid RPCs cannot bypass edge authorization; embedding status/actions are admin/service only.
- Apply authorization/visibility/filters before ranking-page boundaries and keep facet/count semantics aligned.
- Do not log licensed search text, query contents, metadata rows, secrets, or credentials in public artifacts.
- Telemetry stays off without retention approval; image embeddings remain outside issue #97.
- A green Railway deployment does not prove the frontend; verify frontend, edge, worker, schema, config, and database coverage separately.

## 8. Access and environment

- Working repo: `/worksp/popdam`; current branch `main`.
- Canonical DB repo: `/worksp/shared-db`; read its live rulebook before acting.
- Production URLs: `https://dam.designflow.app`, `https://sg.designflow.app`.
- Production Supabase project: `qsllyeztdwjgirsysgai`; resolve/prove protected refs through `ai-private-config` and the shared-db runbook.
- GitHub CLI worked for issues/comments and pushes in this session.
- Grok 4.6 authentication was repaired and the successful review completed; verify again before future paid use. Use `AI_GROK_CALLER=codex ai-grok-review`, never direct `grok` review commands.
- 1Password vault is `vibe_coding`. Supabase CLI PAT item is `Supabase CLI Personal Access Token`; shared production/preview DB password items are named in `/worksp/shared-db/AGENTS.md`. Never print values.
- Railway owns worker runtime `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; Coolify owns frontend runtime/deploy state; Supabase/GitHub Actions owns edge deployment.
- The private Grok report lives under ignored `.ai/reviews/`; it is supporting local evidence, not a durable public artifact. The plan/handoff contains every accepted finding needed to proceed without it.

## 9. Open questions and risks

- Live production coverage, current `SEARCH_MODE`, deployed component SHAs, current RLS, and current effective function bodies remain Step 1 verification questions, not assumed facts.
- Transition tables versus a durable stale queue remains an evidence-based preview choice: use transition tables only if deduped statement-level refresh stays bounded under bulk tagging; otherwise use the queue.
- Initial semantic score floor and freshness SLO require measured dark-mode evidence; use conservative configuration and report values before launch.
- Search-scoped exact counts may exceed the eight-second limit. Use honest `has_more` or disabled facets rather than a slow/misleading count.
- Main risks are database write amplification, lost rich-PDF fields, stale old/new groups, duplicate embeddings, permanent error residue, direct-RPC leakage, weak semantic tails, filtered pagination/facet mismatch, and false deployment proof. The plan contains tests and rollback for each.
- The previous and this handoff both remain open intentionally because implementation is unfinished. The completing successor should retire both only under the handoff successor rule.
- Stale-handoff audit found `HANDOFF.d/2026-08-16T0228Z-hetz-codex-ai-model-routing-plan.md` owned by `codex/ai-model-routing-plan-90` while issue #90 is CLOSED. This session did not delete another session's file; its informed successor/owner should verify the retirement conditions and remove it. Issues #92, #93, #96, and #97 remain OPEN. Two older legacy handoffs have no contract block, so their stale status cannot be inferred from an issue number alone.

## Mandatory handoff self-audit

1. **Could a zero-context developer continue without asking a question? Yes.** §§1–3 define the product, repos, goal, current commits/routing, and what is not implemented; §§5–8 define the exact architecture, paths, order, access, and verification gates.
2. **Could they continue as effectively as this session? Yes.** §§4–5 preserve both the failed Grok/auth/lock/push paths and every accepted technical finding; §6 maps them to the canonical plan and exact next gates.
3. **Are failed attempts included with reasons? Yes.** §4 records the ignore safety refusal, expired-auth timeout, non-resumable session, retained-lock recovery, non-fast-forward push, and rejected architectures.
4. **Is every next step executable and verifiable? Yes.** Every numbered item in §6 names the route/files or canonical plan section and ends with “You'll know it worked when…”.
5. **Are unfamiliar terms, identifiers, paths, and URLs explained? Yes.** §§1 and 8 define both repos, issue numbers, project ID, component ownership, production URLs, tools, and secret locations.
6. **Was the section-0 sweep performed? Yes.** Every approval/decision phrase in §§1–9 was checked. Production promotion, full backfill, hybrid activation, telemetry retention, and image embeddings all appear in §0; evidence-based engineering choices are explicitly classified there as non-owner gates.

### Final synthesis

1. **Is this handoff comprehensive enough for a brand-new developer to pick up without missing a beat? Yes.** §§1–9 cover background through risk, and §6 gives the executable continuation.
2. **Is it detailed enough for them to continue with all knowledge from this session? Yes.** Grok's verdict, failed attempts, accepted findings, routed state, commits, constraints, and live unknowns are preserved in §§3–9.
3. **Is every relevant detail present for flawless execution? Yes.** The business outcome is in §2; current state/evidence in §3; failures in §4; design facts in §5; actions/gates in §6; constraints/access/risks in §§7–9.
4. **Would Albert see every needed decision by reading only §0? Yes.** The line-by-line sweep found five owner decisions: database promotion, full backfill, hybrid activation, telemetry retention, and image embeddings. All five are consolidated in §0 with recommendations and what they block; no other sentence in §§1–9 requires his judgment at closeout.
