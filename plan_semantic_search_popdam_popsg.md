# Semantic Search for PopDAM and PopSG — Implementation Plan

Created October 18, 2026, 12:32 PM EDT. Planning owner: Codex chat `01a14fcf-a38a-7a91-8609-fbb89b8c4eaf`.

**Application acceptance:** [DAM #97](https://github.com/u2giants/popdam3/issues/97) and [SG #107](https://github.com/u2giants/popdam3/issues/107). **New SG structure:** [shared-db #4437](https://github.com/popcre/shared-db/issues/4437). **Discoverable continuation:** [this session's handoff](HANDOFF.d/2026-10-18T1632Z-hetz-codex-semantic-search-plan.md).

## STATUS — read before executing

This is a combined delivery plan, not evidence that either application has semantic search enabled. The older [DAM hybrid plan](plan_hybrid_search_rollout.md) remains the detailed history of DAM's shipped foundation; this plan coordinates completion with SG's separate corpus. The [SG production-readiness plan](plan_popsg_production_readiness.md) still owns its other obligations. Do not redo completed foundations or claim their broader parent issues are finished.

| Step | State as of October 18, 2026 | Owner / dependency | Evidence or required artifact |
|---|---|---|---|
| 1. Reconcile source, live state and custody | Open | Implementing session | Re-run the read-only probes in [baseline](docs/verification/semantic-search-plan-20261018.md); refresh #96/#4210/#4212 |
| 2. Establish relevance and performance baseline | Open | Implementing session; metadata owners retain their jobs | Private query judgments plus public aggregate acceptance report |
| 3. Resolve SG repair custody and production prerequisite | Blocked | Existing #4212 claim owner / native successor | Existing [repair update](https://github.com/popcre/shared-db/issues/4210) is historical; resolve current issue comments and native custody before any action |
| 4. Author and land SG vector/freshness/query contract | Open, dependent on step 3 | Structural session on #4437 | Reserved migration, exact-object claim, SQL tests, review, preview, merge, promotion, catalog proof |
| 5. Extend shared embedding runtime and SG search edge | Open, dependent on step 4 production contract | Application session | Worker/edge tests, approved deployment and live lease/restart proof |
| 6. Integrate SG UI and independent switches | Open, dependent on steps 4–5 | Application session | UI adapter/tests, both modes, role/filter/page/facet visual evidence |
| 7. Complete bounded indexing and freshness | Open | Implementing session; DAM metadata gate rechecked | Current-content/model coverage, throughput, retry and residue artifacts per corpus |
| 8. Validate relevance, access, load and fallback | Open | Implementing session | Fixed-query scorecard and authenticated journeys against deployed source |
| 9. Activate separately, observe and rehearse rollback | Open | Implementing session after technical gates | Saved switch readback, ordinary worker/crawl observations, rollback and restoration proof |
| 10. Close delivery and update durable documentation | Open | Implementing session | Same-issue acceptance checklists, merged commits, live proof and updated plan/handoff |

**Fresh session starts at step 1.** This turn writes/reviews/publishes a plan only. It does not authorize pretending a blocked prerequisite is delivered. Before each new phase, re-read its downstream steps and current repository rules. At a context cut, use the fresh-session/handoff standards and preserve exact custody.

## 1. Ultimate goal

Designers and sales staff can describe what they need in ordinary language and find useful artwork and style-guide files, even when the description uses different words from a filename. An exact character name, SKU, product code or filename must still find the expected permitted record. Search should stay usable when semantic processing is unavailable, and new or changed files must become searchable without manual full rebuilds.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Semantic search here means adding meaning-based retrieval to ordinary search, with keyword precision retained. It does not mean removing exact matches, inventing visual facts, or returning vaguely related files to avoid an empty page.

## 2. Application and deployment context

- PopDAM is the licensed-artwork asset manager; its Library searches assets and Style Groups. PopSG is the style-guide library with Files and Guides views. They share a React/Vite/TanStack frontend and database, but have different searchable corpora and query contracts.
- App repository: [u2giants/popdam3](https://github.com/u2giants/popdam3), default `main`; work in a dedicated `codex/` branch/worktree from current upstream, land through a PR. Baseline for this plan: [9033ce3d548ac84463e4ca4f823f37d8dcc69e54](https://github.com/u2giants/popdam3/commit/9033ce3d548ac84463e4ca4f823f37d8dcc69e54).
- Live frontend: [PopDAM](https://dam.designflow.app) and [PopSG](https://sg.designflow.app), one Coolify-managed image from GHCR. Railway deploys the worker on every `main` push. Edge functions deploy through GitHub Actions. A Railway deployment badge does not prove frontend freshness.
- Canonical database repository: [popcre/shared-db](https://github.com/popcre/shared-db), separate dedicated worktree and exact-object claim. App `shared-db/` is a read-only mirror. No migrations or DDL originate in this app repository.
- Hosted production Supabase: `qsllyeztdwjgirsysgai` in Virginia. The retired Ohio project `ryltkzzernhwnojzouyb` can still answer and is not production. Resolve preview from current canonical `PREVIEW_PROJECT_REF`; do not reuse a historic preview identifier.
- `pgvector` supplies vector types/indexes inside PostgreSQL; an embedding model turns text into vectors. An index extension is not an embedding model, content extractor or complete search product. `gte-small` currently emits normalized 384-dimensional text embeddings through Supabase Edge AI.

## 3. Trigger and observable problem

Albert requested: “pull the latest repo and change popdam's and popsg's search to semantic search.” He asked whether [Timescale pg_vectorsearch](https://github.com/timescale/pg_vectorsearch), pgvecto.rs or VectorChord best suits this software. He then explicitly requested this plan and a Muse review that asks whether to use pg_vectorsearch.

The pre-plan October 18 live read established that DAM's vectors are mostly unfilled and SG has no semantic storage/query contract. Preserve this distinction when reproducing: an unsuccessful paraphrase in SG cannot be fixed by turning on DAM's switch. Baseline exact-word, synonym, description-only and no-match searches separately in DAM assets, DAM groups, SG Files and SG Guides. Save expected record identifiers and judgments only in protected private evidence, not in public planning/review packets.

## 4. Scope

### Included

- Complete DAM's existing meaning-plus-keyword rollout without reimplementing its established foundation.
- Add SG text embeddings for current eligible files; search maintained names, paths, guide metadata, active accepted tags and available extracted PDF text. Rank matching children before grouping Guides.
- Reuse the existing resumable worker/edge mechanism with explicit corpus adapters, one claimer, content-hash guards, leases, retries, categorized failures, stop/resume, and bounded automatic freshness.
- Authorization before return, filter/rank/page/facet/count parity, stable ordering, meaningful weak-match suppression, admin coverage, independent rollout and rollback switches.
- Measured relevance/performance, migration rehearsal/review/promotion, UI verification, production backfill and ordinary-run freshness proof.

### NOT included

- Image/CLIP embeddings, similarity by uploaded image, OCR or paid vision retagging, changing approved tagging models, taxonomy cleanup or new interpretation of licensing rules.
- Recovering the original ambiguous Muse tagging run, rotating its key, launching duplicate paid operations, or overriding #96's latest owner direction.
- Moving the shared database to another host, installing unsupported binaries, changing PostgreSQL major version, weakening permissions, raising statement timeouts, or replacing production infrastructure to accommodate an index.
- Search click tracking, query-content retention, a second analytics service, or completing every unrelated #107 obligation as a side effect of this feature.
- Implementation during this planning/review turn. The earlier implementation request remains tracked; the current deliverable is a reviewable plan.

## 5. Current source and live state

Source references below are at baseline `9033ce3d`; line numbers describe that snapshot and must be refreshed after upstream changes. “Exists” is not a claim of live acceptance.

| Area | Existing implementation | Gap / delivery state |
|---|---|---|
| DAM adapter | `src/lib/dam-search.ts:4–147`: keyword/hybrid type, config read with 30-second cache, caller edge request, ranked IDs, keyword fallback | Config absent defaults to keyword; changing the default would bypass rollout gates |
| DAM consumers | `src/hooks/useAssets.ts:380–402`, `src/hooks/useStyleGroups.ts:242–265`: filtered hybrid page, ranked materialization and fallback | Full current-corpus access/page/facet acceptance remains required |
| Query/embedding edge | `supabase/functions/dam-search-ai/index.ts:21–49,65–118,139–202`: gte-small, leased embedding action, caller-scoped ranking and configured semantic-only floor | Only DAM document types are accepted; no SG search action exists |
| Embedding worker | `apps/worker/src/handlers/embed-search.ts:8–132`: three-document default, worker claims, service edge invocation, status, opt-in automatic loop | Only DAM corpus, no SG operation; restart and sustained freshness proof are not supplied by the unit suite |
| Worker registration | `apps/worker/src/operation-loop.ts:437,659,823,887`, `supabase/functions/_shared/operation-constants.ts:26,52,182` | Extend every applicable registration consistently for SG |
| Admin coverage | `src/components/settings/SearchIndexCard.tsx:18–78`, `src/test/search-index-card.test.tsx` | DAM-specific operation/status; add distinct SG coverage without confusing totals |
| SG query | `src/pages/popsg/PopSGLibraryPage.tsx:130–172` invokes v2; `src/pages/popsg/popsgSearchV2.ts:76–125` defines bounded chunks, query expansion and sort/view routing | SG keyword contract only; pass raw natural-language query separately from expanded keyword syntax |
| SG structure | Canonical effective objects: `public.style_guide_search_documents`, `public.search_style_guide_library_v2`, `public.refresh_style_guide_matviews`, `public.complete_style_guide_pdf_text` | Live columns include keyword `search_vector` (tsvector), no vector embedding; current search RPCs have no query-embedding argument |
| Existing schema history | App mirror `shared-db/supabase/migrations/20260825082910_popdam_ai_search_reconciliation_and_activation.sql`; SG foundation `20260905104802_popsg_bounded_reconcile_pdf_text_and_search.sql`, subsequent v2/freshness changes | Read latest effective definitions from current canonical source and live catalog; do not copy a superseded foundation function |

**Read-only production snapshot:** October 18, 2026, approximately 12:21 PM EDT; role `supabase_read_only_user`, `transaction_read_only=on`, PostgreSQL 17.6, pgvector 0.8.0. DAM had **150,459 documents / 4,505 non-null embeddings / 145,954 null embeddings**. These are physical counts, not proof of content-hash/model freshness. Three keys had no rows: `SEARCH_MODE`, `SEARCH_AUTO_EMBED_ENABLED`, `SEARCH_MIN_SEMANTIC_SCORE`. Available extension inventory returned `vector` only among `vector`, `vectors`, `vchord`, `pg_vectorsearch`, `vectorscale`. No SG embedding count is claimed; no vector column exists. Reproduction SQL is in [baseline evidence](docs/verification/semantic-search-plan-20261018.md).

**Dependency/custody snapshot:** [SG repair #4210](https://github.com/popcre/shared-db/issues/4210) / [claim #4212](https://github.com/popcre/shared-db/issues/4212) remain open; PR [#4213](https://github.com/popcre/shared-db/pull/4213) is merged. Last recorded repair update, October 11, 2026, 11:20 PM EDT, reported preview applied and production-risk qualification refused. No #4212 native handoff-ready ref appeared in the October 18 inspection. Its exact function remains protected despite lease expiry; process activity is unverified, not “running.” Do not relabel merged preview as production delivery. Reconcile current catalog/ledger and qualification evidence before relying on this dated block.

[DAM metadata #96](https://github.com/u2giants/popdam3/issues/96) has later October 15, 2026, 10:45 PM EDT owner instructions: keep the original ambiguous operation and key unchanged; continue only the existing fresh Muse operation. Earlier broad rotation/original-recovery prescriptions are superseded for that work. Its complete saved-row acceptance remains unverified here. Do not turn “metadata completion” into permission to launch a new tagging run.

## 6. Findings and root causes

1. Search quality depends on current searchable content, matching query/document embeddings, ranking and permissions. An index swap does not fill missing embeddings or create SG's corpus contract. DAM's physical embedding coverage is approximately 3%; enabling globally now would yield uneven results.
2. SG's `search_vector` is full-text token data, not a numerical embedding. Its query expansion builds `OR` websearch syntax (`popsgSearchV2.ts:81–88`); embed the original user description, not that transformed expression.
3. Existing gte-small truncates input to 8,000 characters (`dam-search-ai/index.ts:45–49`). Important names, accepted tags and character facts must precede lower-priority extracted text. A long PDF must not displace identity fields. Changes after the embedded prefix must not falsely imply complete document understanding.
4. DAM claims are worker-owned and writes are lease/content guarded. SG must use the same concurrency invariant, not a browser-driven embedding loop or edge request that performs a whole-corpus rebuild.
5. SG already has a protected broad-query performance repair. Altering its search function or colliding table maintenance before custody/release would risk overwriting reviewed work. The old failure involved full matching totals/facets under the authenticated eight-second limit, not merely nearest-neighbor speed.
6. Hosting fit is a first gate. A faster benchmark on 100 million vectors does not establish better relevance or lower total cost for these filtered artwork/style-guide libraries. Compare like-for-like recall, permissions, count semantics, updates and operating cost before changing engines.

## 7. Alternatives and failed approaches

| Approach | Disposition / reason |
|---|---|
| Existing pgvector + HNSW + keyword retrieval | Recommended baseline, subject to Muse's independent challenge; installed and documented by Supabase; preserves current embedding types and deployment model |
| Timescale **pg_vectorsearch** | Explicit Muse question, not silently excluded. README checked October 18 labels it alpha/testing-only, warns prerelease upgrades may require index/extension recreation, and requires PostgreSQL 18+. Production here is 17.6 and the extension is unavailable. Not approved for production by this plan; reassess a supported stable release with workload evidence |
| **pgvecto.rs** | Do not start a new migration to it: maintainers encourage migration to VectorChord; unavailable on the current hosted project |
| **VectorChord** | Plausible later scale candidate, compatible with pgvector types, but unavailable here; no measured bottleneck yet justifies a host/provider migration. Keep as a benchmark candidate if pgvector fails the fixed gates |
| **pgvectorscale** | Separate Timescale project, not pg_vectorsearch. It is also unavailable in the inspected project. Do not cite its stability/features as evidence for pg_vectorsearch |
| Semantic-only replacement | Rejected: exact SKU/filename/character recall and fallback are required; keyword matches must survive semantic thresholds |
| One global switch or routing SG to DAM's RPC | Rejected: DAM and SG have different identifiers, permissions, grouping and corpus storage |
| Raise timeout / restrict corpus / paginate then filter | Rejected: suppresses the original capability or gives incorrect pages/counts; maintain the existing limit and full defined eligible scope |
| Full rebuild / new parallel claim loop / replay interrupted paid batch | Rejected: loses durable progress, creates duplicate work or bypasses ownership. Reuse incremental, leased, resumable maintenance |
| Direct owner-function status call through read-only management identity | Tried in planning: permission denied. Aggregate table/catalog inspection succeeded. Do not grant extra privileges merely to obtain status; use the authenticated admin endpoint for application status |
| Treating source annotations or historical counters as live proof | Rejected: source and old receipts are preparation. Verify saved current-content vectors and ordinary processing on deployed code |

Sources: [pg_vectorsearch README](https://github.com/timescale/pg_vectorsearch), [pgvecto.rs migration notice](https://github.com/tensorchord/pgvecto.rs), [VectorChord](https://github.com/tensorchord/VectorChord), [Supabase vector indexes](https://supabase.com/docs/guides/ai/vector-indexes), [Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search). Package statements are dated, not permanent claims. Read primary sources again before implementation. No vendor benchmark is our acceptance evidence.

## 8. Decisions

### Locked requirements — October 18, 2026

- Semantic retrieval is added to normal search while exact/keyword precision remains. No new user menu is needed to choose engines. Existing browse behavior and manual sorting when no query is present remain intact.
- Two corpora and independent feature switches; DAM remains `SEARCH_MODE`, SG receives `POPSG_SEARCH_MODE`, both default keyword. Automatic SG indexing uses `POPSG_SEARCH_AUTO_EMBED_ENABLED`; DAM retains its existing key. SG threshold key is `POPSG_SEARCH_MIN_SEMANTIC_SCORE`, parsed with the shared semantic-floor rules; do not reuse a DAM-tuned floor for SG.
- Reuse gte-small/384 normalized vectors initially; same model, dimension, normalization and preprocessing for each corpus's document and query embeddings. No change to vision tagging models. Existing matching vectors remain; invalidate only when input/model/preprocessing identity changes.
- Permission/filter eligibility precedes ranking, group formation, totals/facets and paging. No service-role ranked-result leak; caller-scoped database RPCs enforce access. Admin-only status and service-only claims/writes remain separate.
- Permanent exact-object claims, centrally reserved migration versions and native production promotion are binding; missing custody is a real blocker. No direct production DDL or manual risk-approval fabrication.
- This document contains no licensed record examples, secrets or private corpus rows. Reviewer sees code, synthetic fixtures, aggregate evidence and decisions only.

### Recommended engineering choices — independent review may revise with evidence

- Use installed pgvector/HNSW. No assumption that vendor-reported speed improves relevance. Muse must explicitly answer “Should we use Timescale pg_vectorsearch for this software now?” and compare pgvecto.rs and VectorChord as well.
- Prefer an additive SG hybrid RPC `public.search_style_guide_library_hybrid` with the same result envelope as v2 plus query embedding/threshold inputs; keep v2 as the keyword fallback. Do not create a default-argument overload that makes existing v2 calls ambiguous.
- Keep SG embedding state in new columns of the existing maintained SG documents, with one exact content/preprocessing digest and an embedding digest/model identity. Hash only the canonical embedding input plus version/model; store no second full extracted-text copy. Derive the canonical input through a shared SQL helper used by refresh/claim so hash and input cannot disagree.
- Ranking starts with the existing DAM hybrid policy for DAM; SG uses reciprocal-rank fusion (RRF, initial constant 60 and equal branch weights) over eligible keyword and semantic branches. Exact identifier matches form a higher relevance tier. Tune only against the fixed judgments; SQL must define deterministic ID/group-key ties.

### Open technical choices with a decision rule

- ANN candidate breadth versus filtered exact scan: compare against an exhaustive eligible-vector oracle. At small restrictive subsets a bounded exact scan can be cheaper; at broad subsets use pgvector 0.8 iterative HNSW scans and validate recall. Do not truncate before access/filter eligibility.
- Matching-set semantics: semantic rows are current eligible rows passing the cosine similarity floor, union all eligible keyword matches. Totals/facets refer to this entire set, not a top-K sample. Candidate approximation is allowed for ranking only if it cannot falsify membership/totals; otherwise a governed alternative contract must be explicitly designed, tested and reflected honestly in UI before adoption. No silent “exact total” over an ANN shortlist.
- Initial semantic score floor: choose separately per corpus from step 2 judgments; no arbitrary production value. If gte-small fails the required paraphrase cases, stop activation and prepare a separately reviewed model/dimension/cost migration rather than silently switching.
- Stable paging under content churn: preserve the current offset contract and deterministic ties; test an unchanged dataset. If live churn creates material duplicates/skips, implement a scoped snapshot/versioned continuation in the canonical contract before acceptance. No pretending multi-request consistency without a snapshot.

## 9. Executable delivery steps

### Phase A — baseline, acceptance, ownership (steps 1–3)

**1. Reconcile evidence and work ownership.** In current-upstream app and canonical worktrees, read `AGENTS.md`, this STATUS, current #97/#107/#96/#4437/#4210/#4212 comments, then only routed docs. Run task declaration for the actual scope; recheck at every stronger action. Re-run baseline SQL; inventory latest effective functions, grants, owner, RLS, indexes, vectors/model/digest freshness and current worker operation state. Resolve preview through current protected configuration. Do not change anything merely to measure it. Update STATUS with timestamp, source SHA and aggregate-only artifact.

**Verification:** baseline report proves production identity/read-only role, current coverage by corpus, effective function signatures/grants, feature states, current dependencies and exact source. Reproduction commands/SQL are preserved; dated counters are not copied as new proof.

**2. Freeze a representative synthetic/private relevance suite.** Add synthetic query fixtures to `src/test/fixtures/semantic-search-cases.json` and canonical `supabase/tests/popsg_semantic_search.sql`; keep real identifiers/judgments in approved private storage. Cover at least 40 queries, ten per view (DAM assets/groups, SG Files/Guides), including exact IDs, character spelling/aliases, paraphrases, multiple descriptive attributes, PDF-only phrases, tags-only phrases, restrictive filters, no useful match and unsupported-language queries. Record keyword baseline and paired semantic rankings. Relevance judgment concerns usefulness to designers, not whether cosine is high. Pre-label expected useful records before viewing new scores to avoid circular tests.

**Verification:** 100% of expected exact identifiers remain in top five; on the pre-labeled paraphrase subset semantic NDCG@10 improves at least 10% relative to keyword baseline (if baseline is zero, absolute gain at least 0.10); no overall NDCG@10 regression; no known wrong-property/character result in top five for the labeled negative set. Stop and revise input/ranking/model proposal if these gates fail. Performance baseline includes cold/warm timings and complete filtered result/facet counts, not a cached screenshot. No business question is needed to choose an index; any genuinely new content-meaning uncertainty goes to Albert with real examples only after a useful pilot exists.

**3. Resolve the protected SG repair first.** Follow #4210's current evidence, not its old handoff: verify whether `20261012005136` is now in production and broad-query behavior is accepted. If unfinished, existing owner finishes native qualification/release or publishes `--stop-author` ready custody. A successor consumes the exact owner-signed ready receipt through `--handoff-claim-author` (remote custody only when justified). No ready receipt means no assumption of the old identity or taking its lease. Assign any recovery work on that same issue; do not create an alternative implementation to evade the protected function.

**Verification:** production ledger/catalog and signed-in broad Files/Guides request prove the repaired search fits the existing eight-second ceiling; authoritative claim is released/transferred in the native system. If blocked, keep steps 4–6 dependent; synthetic tests/design may proceed independently, live writes may not.

**Context cut A:** record the baseline, fixed judgment set, custody state and unpassed gates before Phase B. Re-read downstream scope and current lane rules in the new session.

### Phase B — canonical SG contract (step 4)

**4. Claim, implement and land the SG contract on #4437.** This is database-shape work in canonical shared-db only. Refine #4437's scope to the exact effective objects below, re-prove collisions including source readers, acquire an author lane/version before creating a migration, and create a dedicated current-upstream worktree. Do not inherit #4212's scope or timestamp. Candidate exact objects, to finalize against catalog before claiming:

- Existing `public.style_guide_search_documents` plus its vector index; add embedding vector(384), content digest, embedded digest/model/preprocessing version, lease token/owner/expiry, attempt/retry timestamps and categorized error state. Name every index/constraint in the claim.
- New `public.style_guide_embedding_input`, `public.claim_style_guide_search_embeddings`, `public.upsert_style_guide_search_embedding`, `public.mark_style_guide_search_embedding_error`, `public.get_style_guide_search_embedding_status`, `public.reset_style_guide_search_embedding_errors` and `public.search_style_guide_library_hybrid`. Signatures/types are explicitly declared in the migration and generated contract; preserve v2's parameters/result fields in the hybrid wrapper and add a non-ambiguous query-embedding argument.
- Every latest effective source-maintenance writer, including `public.refresh_style_guide_matviews` and `public.complete_style_guide_pdf_text`, plus any queue/trigger helper discovered to update search source or activation state. Include all exact trigger/function/index objects actually changed; stop and amend scope if another writer is discovered.

Canonical input priority: normalized filename/guide/property/licensor identity, accepted active tags and appropriate canonical character labels, meaningful path context, then available extracted PDF text. No invented characters or cross-application metadata. Keep source provenance and preprocessing version deterministic. Hash the exact bounded model input; retain full-text search over the existing available searchable corpus. Document the limitation that text beyond embedding input is keyword-only; the index is not comprehensive visual understanding.

Maintenance recomputes digest only for touched rows, invalidates incompatible vectors, requeues changed inputs, removes inactive rows from eligibility, and preserves unchanged vectors. A backfill enumerates existing rows incrementally with a saved cursor; no unbounded full rewrite in migration/edge request. Claims use `FOR UPDATE SKIP LOCKED` or the established equivalent, one worker claimer, bounded batches, lease expiry/retry backoff and an immutable completion token/digest check. Stale completions are rejected without losing newer work. Terminal errors stay visible and never count as embedded. Admin requeue is explicit and bounded; never automatically reset a poison item forever.

The hybrid RPC authenticates and applies the same SG app permission predicate as the latest v2, filters active eligible files before similarity/keyword union, computes stable per-file scores, and groups matching children for Guides before page boundaries. Use keyword rank and cosine similarity as different quantities: apply the corpus score floor only to semantic-only membership; keep keyword hits even below floor. Exclude null/stale/wrong-model vectors from semantic comparison. Exact total and facets cover the full defined matched set (not just page or ANN shortlist), including empty and out-of-range pages. Keep current envelope, preview-filter meaning and bounded page-size behavior. Empty query uses existing browse; no query-embedding cost. Date/name/size browse sorts remain truthful.

The 8-second statement ceiling remains. Test broad and restrictive parameters, generic/custom prepared plans, concurrent reads/indexing and changed rows; do not fix broad totals by lying about them. If the exact semantic membership computation cannot meet the limit, stop for a measured contract redesign before deployment, not an undocumented candidate cap.

**Verification:** canonical SQL contracts from section 10 pass in preview on synthetic and representative private workloads; source fields/grants/owner/RLS/refresh behavior preserved, active vector index valid, all changed objects covered by claim. Independent exact-head review and native guarded merge succeed; current merged-main preview qualifies automatic production and target/catalog/ledger proof passes. App implementation using the new contract starts only after production structure exists. A merge or isolated preview alone is not this gate.

**Context cut B:** preserve canonical claim/version/PR/source and preview/production state, current exact contract and generated-type path. Never leave an untracked migration or abandon a rehearsed unmerged change. Re-read phases C–E.

### Phase C — runtime and application (steps 5–6)

**5. Extend runtime using explicit corpus adapters.** In `apps/worker/src/handlers/embed-search.ts`, factor reusable lease/send/status behavior into a small corpus adapter, retaining DAM's exact existing behavior. Add SG adapter/operation `embed-popsg-search`; register all branches in `apps/worker/src/operation-loop.ts`, edge operation constants and admin operation allowlists. Search for every existing `embed-dam-search` registration and explain which need the SG sibling. Do not add a second scheduler or provider client.

In `supabase/functions/dam-search-ai/index.ts` preserve the existing DAM actions and strict caller authentication. Add explicit SG leased-embed, admin-status/reset and search actions, or a factored shared handler in `_shared/` using the same model session. Validate corpus as a closed enum; no dynamic client-supplied table/RPC names. For SG search, embed raw trimmed user text once and call the SG hybrid RPC with the signed-in user's client. Service role is restricted to worker claims/completions and admin config/status; it must not rank user search. Preserve the existing DAM actions and response compatibility. Bound query length, request bytes, vectors, limits, offsets and batch size; malformed vectors/actions fail clearly. Introduce a tested query timeout/cancellation path that falls back to keyword without turning an authorization denial into alternate access. No credentials in browser bundles or logs.

Worker batch begins at three, not a previously timed-out 25/10/5. Separate operation keys/cursors and distinct corpus stats prevent DAM and SG from overwriting each other's progress. Unknown/malformed status is an error, not fabricated zero-ready coverage. Report terminal failures and stale completions accurately. Configuration disable prevents new claims and safely completes/abandons current leases without duplicates. Preserve saved operations over Railway restarts.

**Verification:** worker and Deno tests prove corpus isolation, existing DAM compatibility, concurrency, source-hash rejection, expiry/retry, stop/resume, malformed response and per-record error handling; deployed runtime SHA and real saved rows prove one lease cycle for each corpus plus an intentional restart/resume on preview. Production canary receives exact-scope technical review before execution.

**6. Wire SG UI, coverage and independent switches.** Factor `src/lib/dam-search.ts` config caching into a shared tested helper only if needed; preserve `getSearchMode()` behavior, add SG mode/floor state without making ordinary users read protected configuration directly. Prefer an authenticated edge capability response if config access is denied. Add `src/pages/popsg/popsgSemanticSearch.ts` adapter and tests, consuming the same SG payload parser as v2. In `PopSGLibraryPage.tsx:130–172`, use the raw `filters.nameSearch` for embeddings and expanded websearch syntax for keyword branch; query mode switches invalidate React Query data and reset page consistently.

Keep an entire requested page under one chosen retrieval path: if semantic lookup fails, discard its partial chunks and run the existing comprehensive keyword contract for the whole page, with counts/facets from that same path. Do not mix pages from hybrid and keyword, or fall back to path-only views for tag/PDF searches. Handle late responses, query changes, multiple chunks, zero/out-of-range pages and mode toggles without displaying stale results. Authentication failures still lead to the established login/access UI; fallback is for semantic availability, not denied access.

Extend `SearchIndexCard.tsx` with clear separate DAM/SG cards through a reusable corpus prop or shared component, and use existing admin config persistence with saved/readback state. Semantic floor remains optional until calibrated. Counts distinguish eligible/current embedded/pending/leased/retry/terminal/inactive, current freshness lag and actionable errors; progress must not imply readiness from absence of status. Ordinary Library search remains one natural-language box. Keep user-facing technical implementation detail out of the product flow.

**Verification:** targeted UI tests and production build pass; signed-in desktop/mobile screenshots show both Library modes, both coverage cards and saved independent switch readback. Exercise 500-row UI page chunking as well as default pages. Preview runtime failures prove whole-page comprehensive keyword fallback, late-request suppression and no cross-mode data leak. Deploy through normal app workflows, verify frontend and edge SHA separately from Railway.

### Phase D — indexing and quality (steps 7–8)

**7. Run measured indexing and prove ongoing freshness.** Recheck #96's current saved metadata acceptance and live retained profiles; preserve exact existing model/job decisions. DAM follows its current metadata prerequisite rather than re-embedding a knowingly changing corpus. SG indexing may progress independently once its own structure/runtime/custody gates pass; DAM's metadata gate does not unnecessarily block SG. Resume DAM's existing interrupted checkpoint using its normal operation; start SG's distinct operation through the authenticated admin workflow after target/gates/review. Never reset the original ambiguous tagging job.

Measure a bounded canary first: throughput, CPU/memory, edge runtime, rate failures, DB latency, retry category and current digest/model completion. Project full-corpus elapsed time and queue interference from observed results, not provider marketing; choose rate below measured limits and pause if application latency breaches section 13. Advance in durable batches; stop/resume and restart deliberately in preview before production. All eligible documents must be embedded with current identity or explicitly categorized; no silent omission from denominator and no fake 100% from a terminal operation counter. Activation requires 100% current embeddings for the eligible non-terminal set and zero unresolved unexpected failures; known unsupported/empty input exceptions have exact categories, are keyword searchable and must not overlap expected semantic relevance cases.

Enable each corpus's automatic indexing only after overlap/lease-expiry/disable tests pass. Observe an ordinary source edit, accepted tag change, completed PDF extraction, active→inactive→active transition and nightly/ordinary refresh. Hash invalidation and the next ordinary worker cycles must restore coverage without a full rebuild. Under a normal representative change burst, 95% of eligible changed inputs regain current vectors within ten minutes and all within thirty minutes; a deliberately stopped job is reported as paused, not fresh. If throughput cannot sustain measured daily churn, revise capacity/batching before activation.

**Verification:** per-corpus saved-row/hash/model coverage, categorized residue, worker restart receipt and at least one ordinary refresh cycle prove currentness and no duplicate claims/completions. Record preexisting exceptions separately; pause/resume works without data loss. Metadata owners' runs are unchanged by search work.

**8. Run the fixed acceptance suite against deployed source.** Repeat step 2 paired judgments for all four views and negative permissions with admin/designer/viewer, including a user without app access and invalid/expired tokens. Record synthetic/public aggregate results only. Exercise every exposed filter, combinations, complete multi-page traversal of a fixed fixture, a restrictive filter with the best vectors outside it, exact-code lookup and a broad common query. Compare ANN rankings to exhaustive eligible-vector results to measure recall, separately from search usefulness.

Measure at least 30 warm repeated queries per view and five cold runs of broad/restrictive cases, at five simultaneous sessions while indexing is active. Proposed engineering gates: no DB statement reaches eight seconds; end-to-end warm p95 ≤3 seconds, cold p95 ≤6 seconds; no query errors; filtered vector recall@20 ≥0.95 versus exhaustive oracle; relevance gates from step 2 pass; exact total/facet equality and no duplicate/missing fixture records across pages. These are plan acceptance targets, not claimed baseline performance. Run embedding timeout, unavailable model, malformed response and disabled mode drills; verify the whole requested keyword page remains useful. Access denial never becomes service-role fallback.

**Verification:** a dated artifact ties judgments/timing/access assertions to source and deployed SHAs, exact query-set version and full counts. Failure keeps that corpus off; fix the measured problem and rerun impacted gates rather than lowering criteria after seeing results.

### Phase E — activate and close (steps 9–10)

**9. Activate one corpus at a time and test rollback.** Snapshot exact prior config including absent versus explicit rows in private receipts. Check production/database gates and obtain the current required independent technical review on exact rollout inputs. Save `SEARCH_MODE=hybrid` for DAM or `POPSG_SEARCH_MODE=hybrid` for SG only after that corpus passed steps 7–8; do not couple them. Prove persisted values and actual signed-in result behavior, cache expiry/invalidation, positive semantic-only hits and exact keyword retention.

Observe at least 24 hours including an ordinary refresh/nightly processing cycle, with bounded checks during an active session or the existing durable issue/watch mechanism; do not promise background execution that is not running. Roll back immediately on access leaks, duplicate/missing stable-fixture pages, unexpected eligibility loss, error rates or sustained timing/freshness threshold violation. Restore the exact previous config using supported authenticated workflows and guarded receipt checks; no broad delete or disabling of the underlying worker capability. A rollback drill must show keyword retrieval works, then restore approved intended mode and re-prove it. Optional SG/DAM automatic switches roll back independently.

**Verification:** saved readbacks plus real user journeys show separate activation, ordinary freshness, fallback and exact-state rollback/restoration; deployed errors/timing remain within gates for the observation interval. A 200 response or image stamp alone is insufficient.

**10. Close every authorized deliverable.** Update this STATUS with openable artifacts, the older DAM plan's status (preserve historical reasoning), `docs/POPSG.md`, `docs/configuration.md`, model documentation if behavior changed and existing issue checklists. App code lands by PR with appropriate tests/review/checks and normal merge; canonical migration delivery uses its own protected route. Record commits, CI runs, frontend/edge/worker deployed versions and saved-data evidence. Retire only handoffs whose obligations are actually delivered or carried forward under the successor rule. Parent #107 may remain open for unrelated requirements; distinguish semantic delivery from its full production-readiness closeout.

**Verification:** section 13 checklist is complete for semantic search in both apps; any remaining obligation has one named owner and durable state on its same issue. Do not open a leftover-live-proof issue or mark preparation as delivery.

### Adversarial cases — must be implemented as named tests

| External input/boundary | Hostile or adverse case | Required named test / proof |
|---|---|---|
| Search text | Quotes, SQL fragments, OR/minus operators, Unicode, control characters, giant query | `popsgSemanticSearch.test.ts: raw query and keyword syntax remain separate and bounded`; SQL `semantic_query_is_parameterized` |
| Caller identity | Missing/expired token, viewer, user without SG permission | Edge `sg_search_auth_boundary`; SQL `sg_hybrid_access_before_return` |
| Client request | Unknown corpus/action, injected RPC name, NaN/negative/huge limits and offsets, wrong mode | Edge `semantic_request_bounds_and_closed_corpus`; UI `rejects_wrong_mode_payload` |
| Embedding provider | Timeout, rate limit, non-finite numbers, wrong dimension, zero norm, HTML/error payload | Edge `semantic_embedding_validation`; UI `whole_page_keyword_fallback_on_semantic_failure` |
| Lease/completion | Duplicate claimers, expired token, digest changed midflight, stale worker response | Worker `sg_embedding_lease_isolation`; SQL `sg_embedding_stale_completion_rejected` |
| Source metadata/PDF | Oversized text, identity after cutoff, untrusted instructions inside text, null fields | SQL `sg_embedding_input_priority_and_hash`; edge `document_text_is_data_only` |
| Membership | Inactive/deleted source, wrong property, filter excludes best global neighbors | SQL `sg_hybrid_active_filter_before_rank` |
| Similarity score | Weak semantic-only match and strong keyword match below same floor | SQL `sg_floor_preserves_keyword_hits`; UI `independent_corpus_floor_readback` |
| Paging/counts | 500-row request split into chunks, ties, empty last page, broad result set | UI `sg_semantic_chunk_consistency`; SQL `sg_hybrid_exact_counts_and_facets`, `sg_hybrid_stable_pages` |
| Async UI | Query/mode/filter changes while previous response is delayed | UI `sg_semantic_late_response_is_discarded` |
| Configuration | Absent/malformed mode, denied read, cached mode during rollback | `search_modes_are_independent_and_fail_keyword`; live `rollback_cache_invalidation` |
| Operator status | RPC throws, malformed status, terminal failures incorrectly zeroed | Worker `embedding_status_failure_never_ready`; card `coverage_error_is_not_complete` |
| Shared maintenance | Ordinary crawl/PDF/tag update while query/indexing runs | SQL `sg_refresh_preserves_unchanged_vectors`; live `ordinary_refresh_restores_current_vectors` |

## 10. Test and verification inventory

Existing app tests that must remain green: `src/test/dam-search.test.ts`, `asset-search.test.ts`, `style-group-search.test.ts`, `search-index-card.test.tsx`, `semantic-floor-card.test.tsx`, `auth-policy.test.ts` and `src/pages/popsg/popsgSearchV2.test.ts`. Add `src/pages/popsg/popsgSemanticSearch.test.ts` for the named adapter cases, extend search-card/mode tests, and add an SG page integration test using realistic deferred promises/chunk failures.

Worker: existing `apps/worker/src/handlers/embed-search.test.ts` plus all tests registered by `apps/worker/package.json`; add the SG lease/corpus/status cases without mirroring implementation internals. Run `npm test` in `apps/worker` and `npm run build` there. In the app run `npm test -- --run` (targeted suites first, full required suite before shipping), `npm run build`, repository lint/typecheck checks appropriate to modified paths and `scripts/test-task-gates.sh` if routing metadata changes. Do not claim a prose-only plan publication ran production code tests; link validation/self-audit is its verification.

Edge: add `supabase/functions/_shared/semantic-search.test.ts` for request/auth/vector/error contracts, and run the current repository Deno test/check/format commands from `docs/development.md` and workflow config. Tests must exercise the real shared handler; do not add a mock-only test disconnected from the deployed entrypoint. Preserve existing semantic-floor tests.

Canonical: new `supabase/tests/popsg_semantic_search.sql` tests all named SQL assertions above, old v2 envelope/grants/owner/filter/sort parity, concurrent claims and content transitions. `scripts/check-sql.sh`, current required contract checks and the governed preview suite must pass. Use a transaction/synthetic fixture cleanup in preview, never test insertions in production. Record exact old/new full JSON comparisons for keyword fallback; a matching first-page count is insufficient.

Performance/relevance/access/freshness artifacts follow steps 2, 7 and 8; visual evidence follows step 6. Static tests do not replace those live gates.

## 11. Rules and operational gotchas

- Read current app/canonical rulebooks and routed documents at implementation time; newer owner direction outranks stale handoff text. Declare task class before work, recheck before paid review, waiting, shipping, deployment and database actions. Plans do not grant a structural claim or bypass a refusal.
- Shared schema is claim-first in canonical shared-db. Read full current anti-collision/merge/custody procedures before claiming; never steal an expired protected claim. Re-prove production/preview target immediately before every write. Use only guarded merged-main preview→automatic production promotion; no hand-written DDL or qualification receipt.
- Preserve unrelated worktrees/untracked files; stage owned paths only. Verify committer identity `Albert Hazan <u2giants@users.noreply.github.com>` before first commit. No protected-main direct push, force-push or admin merge. Technical actions use the current assigned independent reviewer where required; never ask Albert for technical permission.
- Existing semantic floor is server-side. No user-supplied threshold override, service-role result ranking or browser-only access filtering. Preserve endpoint auth despite `verify_jwt=false` function configuration.
- `gte-small` prefix limit, three-document runtime default, one worker claimer, separate DAM/SG cursor and current digest/model checks are delivery constraints. Never mix vectors from different model/preprocessing versions. A terminal error is not a searchable embedding.
- `style_groups` UUIDs change during nightly rebuild; pin real acceptance cohorts by stable SKU and resolve current groups. Metadata scope is company-owned: active accepted tags/characters only; preserve file versus Style Group scope. Read `docs/business-rules/application-map.md` and the digital-assets/classification topics in canonical shared-db before changing metadata composition.
- Secrets stay in 1Password `vibe_coding`, injected via protected process/env or protected files, never command arguments/output/Git/reviewer snapshots. Use the secrets skill for any secret transport. No new embedding provider or key is needed by this plan. Keep licensed paths/source rows and real query judgments private.
- User-facing times in evidence, issue notes, handoff prose and plan updates use America/New_York labeled EST/EDT. Machine filenames/ISO keys may be UTC. Sign GitHub posts `Posted by Codex chat <id> on <machine>`.
- If implementation becomes mechanical under an accepted plan, apply current model-tier delegation instructions; keep business interpretation, schema/merge/production/security decisions and verification with the coordinator. A plan does not name its implementer.

## 12. Access and environment

Verified in this planning session: Git fetch/fast-forward and GitHub issue access; canonical source fetch; `ai-task-gates`; installed pinned Muse runner with protected key-store availability; production management API read-only SQL returning `supabase_read_only_user` and `transaction_read_only=on`. A doctor check is not proof a Muse review finished; only a qualified native terminal result and its report count. Runtime write access, preview target and QA login success must be re-proven before implementation. No credential values are recorded.

1Password locations in `vibe_coding`:

- `Supabase CLI Personal Access Token` for supported CLI/management reads; `Supabase DB Password - shared POP database` for governed DB workflow. Resolve preview credentials by current title/ID and repository target; parentheses in old titles may require an item ID instead of a title reference.
- `DAM AI tester login - PopDAM (administrator, dam.designflow.app, production)`; analogous viewer/designer items with the same title pattern were listed. `PopSG / PopDAM AI tester login (sg.designflow.app + dam.designflow.app)` supports the SG journey. Read concealed fields only inside protected processes/browser login, never print them or copy authentication traffic into evidence.
- Runtime keys, if required by the supported workflow, are in `Supabase Runtime Keys - shared POP database (production)`. Do not acquire extra privilege just because read-only status RPC is denied.

Local Node/npm versions follow `docs/development.md` and checked-in lockfiles. Install app dependencies with the current supported npm lockfile path, use `npm run dev` for port 8080. **Default local frontend points at production.** For write-capable rehearsal set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` through protected injection to the dynamically resolved preview; one without the other must fail. `?mode=popsg` selects SG locally; `?mode=popdam` resets it. Do not confuse a local mode override with production-host verification. Serve/test edges with supported Supabase/Deno commands; keep env files protected and untracked.

Documents to open only when needed: app `docs/POPSG.md`, `docs/BULK_JOBS.md`, `docs/WORKER_LOGIC.md`, `docs/configuration.md`, `docs/development.md`, `docs/deployment.md`, `docs/MODEL_RULES.md`, `docs/KNOWN_QUIRKS.md`; canonical `AGENTS.md` → current-workflow, anti-collision, merge, credential and production-promotion docs. The canonical database refs/roles and workflow files must be read from current source, not from a personal memory.

## 13. Done, risks, rollback and remaining questions

### Definition of done

- [ ] Both apps retrieve useful meaning-based results from their own current eligible corpus; exact identifiers/keyword matches survive and browse behavior is preserved.
- [ ] Canonical structure is claimed, reviewed, preview-tested, merged and automatically promoted with exact target/catalog/ledger proof; no unresolved protected source collision remains.
- [ ] App/worker/edge implementation is committed, pushed, reviewed and merged through required checks; deployed frontend, edge and worker versions each verified where applicable.
- [ ] Fixed relevance gates, ≥0.95 filtered recall@20, exact full-match totals/facets, stable fixture pages, access denials and the stated latency/concurrency limits all pass.
- [ ] Current-content/model embedding coverage and explicit non-semantic exceptions are reconciled from saved rows; resume/restart/retry/expiry/stop and ordinary update freshness are live-proven for both corpora.
- [ ] Independent activation/floor/automatic-index settings persist; real semantic-only and exact keyword journeys pass with administrator/designer/viewer where permitted; rollback and restoration preserve working keyword search.
- [ ] Observation includes 24 hours and one ordinary refresh/nightly cycle, with no promised unowned background run. Required evidence stays on #97/#107/#4437; no separate proof-only ticket.
- [ ] This plan's STATUS and relevant docs reflect final state; artifacts and source/deployment versions are linked; handoff retirement follows successor rules. Any other #107 obligations remain explicit instead of being silently closed.

### Risks and owned responses

- **Unreleased SG repair custody:** current claim owner/native successor owns repair recovery. Implementing session owns keeping #4437 blocked and rechecking current evidence; it cannot manufacture handoff authority.
- **Incomplete/changing DAM metadata:** its existing #96 owner retains protected tagging operations. Search owner checks saved current acceptance and delays DAM backfill/activation; SG may proceed on its independent gates. No duplicate tagging run.
- **Full semantic matching-set cost:** search owner measures exact totals/facets and filtered recall under concurrent load; redesign before activation if the eight-second ceiling fails. Never mask the problem with an ANN top-K total.
- **Embedding truncation/model quality:** search owner measures labeled paraphrases and input priority; document keyword-only long-text coverage. If the current model cannot meet usefulness criteria, produce a reviewed migration/cost proposal rather than secretly changing models.
- **Production regression:** search owner restores only that corpus's previous mode/automatic settings through guarded supported workflows, verifies cache expiry and actual keyword journeys, and keeps data/index state recoverable. Additive schema can remain off during rollback; no destructive extension removal is required.

No new business-meaning decision is required to write or execute the bounded technical plan. A future relevance pilot may reveal an unresolved content meaning; consolidate actual examples into one owner question then, without turning package choice, credentials or technical review into permission requests. The index recommendation remains explicitly reviewable by Muse. Revisit a different engine only if a supported hosting path and measured relevant improvement outweigh migration/operations cost at equal acceptance quality.

### Plan self-audit — completed before review

- All 13 sections: present. Goal and conflict rule: §1. Standalone system/background/source/live-state context: §§2–6 and §12. Failures and alternatives: §7. Locked/recommended/open decisions: §8. Scope: §4.
- Every numbered step names concrete files/contracts, dependencies and a verification gate: §9. Adversarial boundaries have named tests: §9 table and §10. Secrets are locations only: §§11–12. Shipping/live acceptance/rollback: §§9–10,13. STATUS and bidirectional handoff registration: opening links and STATUS.
- **Could a brand-new session execute without asking Albert for missing technical context?** Yes: §§2–8 define the current system/choices; §9 specifies ordered work, artifacts, tests and stop conditions; §§11–13 provide authority/access, acceptance and exact blockers. No missing source custody is presented as an implementer's discretionary takeover.
- **Does this carry the background, nuance and ruled-out approaches held by this session?** Yes: §§3,5–7 record the two separate corpora, physical-versus-current coverage, unsupported extensions, old status-RPC denial, protected #4212, current #96 direction and failed timeout/rebuild/switch approaches. These prevent known rediscovery and unsafe shortcuts.
- **Is the goal clear enough for a correct judgment if a step is wrong?** Yes: §1 prioritizes useful permitted discovery and exact identifiers; §8 leaves measured technical choices open under criteria; §§9,13 require a bounded redesign rather than weakening behavior to meet a recipe.

### Muse review record

Pending the requested independent review. The exact brief must ask whether **Timescale pg_vectorsearch** should replace the pgvector baseline, and what workload/hosting/maturity evidence would change the answer. Record the qualified report and address every material finding before publishing the final plan. Do not label an incomplete/failed provider turn as a review.
