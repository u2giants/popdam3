---
issue: 97
status: BLOCKED
owner: codex/semantic-search-20261018
---

# PopDAM and PopSG semantic-search plan and independent package review

## 0. Business decisions only the owner can make

None are required to write the plan or resolve technical package/custody/hosting choices. Already settled October 18, 2026: Albert wants semantic search for both apps and specifically asks Muse whether pg_vectorsearch is appropriate. Preserve exact-word/product-code search as part of useful discovery. Do not ask him to choose an index or provide technical approval. #96's later owner instruction keeps its original ambiguous operation/key unchanged and permits only its existing fresh run; never re-ask rotation/recovery under this work.

A future usable pilot could expose a real content-meaning question; the implementation session consolidates actual examples then, not a speculative technical menu now. No external business question is silently filed elsewhere in this handoff.

## 1. Application context

PopDAM manages licensed artwork; PopSG manages style-guide Files/Guides. Same React frontend/database, distinct searchable corpora. Live: [DAM](https://dam.designflow.app), [SG](https://sg.designflow.app). App source: [u2giants/popdam3](https://github.com/u2giants/popdam3). Canonical database shape: [popcre/shared-db](https://github.com/popcre/shared-db). Frontend uses Coolify/GHCR, worker Railway, edge/database Supabase. Production project is Virginia qsllyeztdwjgirsysgai; Ohio is retired.

## 2. This session's objective

Write a standalone implementation plan covering meaning-based search in both apps, then have Muse explicitly challenge pgvector versus Timescale pg_vectorsearch, pgvecto.rs and VectorChord. Current requested deliverable is planning/review/publication; this does not constitute implementation delivery. The original live feature request remains on the existing application issues.

## 3. Exact current state

[Combined plan](../plan_semantic_search_popdam_popsg.md), intended portable location [plan on this work branch](https://github.com/u2giants/popdam3/blob/codex/semantic-search-20261018/plan_semantic_search_popdam_popsg.md); [baseline/review evidence](https://github.com/u2giants/popdam3/blob/codex/semantic-search-20261018/docs/verification/semantic-search-plan-20261018.md). Publication is pending at initial drafting; verify the branch/PR or main before continuing. The final publication/review receipt belongs in the evidence file and this section before closeout.

App base [9033ce3d548ac84463e4ca4f823f37d8dcc69e54](https://github.com/u2giants/popdam3/commit/9033ce3d548ac84463e4ca4f823f37d8dcc69e54) is fetched. The plan describes source paths/line anchors at that base. No code, schema, production setting, embedding operation or paid tagging work has changed in this planning turn. The app canonical checkout's unrelated files are preserved.

Read-only October 18, 2026, approximately 12:21 PM EDT: PostgreSQL 17.6, installed pgvector 0.8.0; none of the proposed alternative index extensions available. DAM physical coverage 4,505/150,459, not current-digest proof. SG has a tsvector keyword column and no embedding contract. Current process status of predecessor work is unverified.

## 4. Failed approaches and dead ends

[Plan §7](https://github.com/u2giants/popdam3/blob/codex/semantic-search-20261018/plan_semantic_search_popdam_popsg.md) preserves the important exclusions: changing DAM's switch cannot add SG vectors; an index cannot fill missing content; do not use pgvectorscale evidence to justify the distinct pg_vectorsearch; do not increase timeouts, reduce searchable scope, use full rebuilds, duplicate paid operations or infer custody from expired leases. Read-only management status RPC denied permission, so aggregate table/catalog reads were used without adding privileges. Vendor benchmark speed is not our relevance acceptance.

## 5. Findings and dependencies

[SG repair #4210](https://github.com/popcre/shared-db/issues/4210) / [claim #4212](https://github.com/popcre/shared-db/issues/4212) still protect the search function; [PR #4213](https://github.com/popcre/shared-db/pull/4213) is merged but the last owner update says production qualification blocked. No native #4212 handoff-ready receipt was found. Existing owner or a valid native successor must finish recovery/release. Do not impersonate the predecessor or alter its protected function.

New SG structure is on [#4437](https://github.com/popcre/shared-db/issues/4437), blocked on that prerequisite. DAM acceptance stays on [#97](https://github.com/u2giants/popdam3/issues/97); SG application acceptance stays on [#107](https://github.com/u2giants/popdam3/issues/107). DAM's metadata prerequisite is [#96](https://github.com/u2giants/popdam3/issues/96), governed by its latest comments rather than older plan text. Search vectors must match current content/model, not just be non-null.

## 6. Exact next steps

1. Finish this planning turn: validate links and the plan's 13-section/self-audit/adversarial checklist; commit only owned Markdown; run the protected Muse conversation and explicitly ask whether to use Timescale pg_vectorsearch. Gate: qualified native completion/report and material findings addressed in plan/evidence.
2. Publish by branch/PR under current task gates, normal merge and repository rules. Gate: plan/handoff/evidence/router links open on GitHub; final source and review IDs recorded, no unstaged owned change.
3. For implementation, start at combined plan step 1, re-read all downstream phases and live issue/custody state. Gate: fresh read-only baseline and exact ownership; no dated snapshot promoted to current truth.
4. Deliver canonical contract before dependent app code, then runtime/UI, measured coverage, quality/access/fallback and separate activation. Gate: the plan's per-step checks and final checklist, including live proof and ordinary refresh observation, all pass. Blocked dependencies stay on existing issues with named owners.

## 7. Constraints and gotchas

[Plan §§8–13](https://github.com/u2giants/popdam3/blob/codex/semantic-search-20261018/plan_semantic_search_popdam_popsg.md) is the executable specification. Only canonical shared-db owns structure, with exact-object claim/version/review/preview/guarded merge/promotion. App mirror is read-only. Keep current gte-small/384 compatibility, raw query separate from keyword OR syntax, one worker claimer, three-document initial batches, distinct cursors/switches, exact full-match totals/facets, stable ranking and caller-scoped access. No browser/service-role ranking shortcut or silent top-K count. All human-facing times use EST/EDT.

Documentation-only publication does not implement the feature or require deploy. Do not edit the root HANDOFF pointer or another session's handoff. Preserve unrelated worktrees and stage only owned paths. An index recommendation can change with evidence; settled business requirements cannot quietly shrink.

## 8. Access and environment

Git/GitHub source and issue access and production management read-only SQL were exercised. Task gate and pinned Muse runner doctor work; provider completion must still be proved separately. 1Password vault `vibe_coding` owns Supabase CLI PAT, shared database password, preview credentials, shared runtime keys and administrator/designer/viewer QA login items. Exact item titles and local setup hazards are recorded in plan §12; no values are in these documents.

The app development server defaults to production; both preview URL and anon key overrides must be protected and present before write-capable rehearsal. Preview ref is resolved dynamically. Native custody on another machine cannot be assumed from a local source copy. No background execution is promised.

## 9. Open risks and decisions

Recommendation pending Muse challenge: installed pgvector/HNSW plus semantic-and-keyword fusion. Current pg_vectorsearch README says testing-only and PostgreSQL 18+; hosting is 17.6. pgvecto.rs points users to VectorChord, which is unavailable on this hosted project. Revalidate these dated facts before implementation. Full semantic match counts/facets may be more expensive than nearest-neighbor ranking; the plan sets performance/recall/quality gates and requires redesign rather than false totals. #4212 source custody and #96 metadata acceptance remain independent prerequisites, not business permission questions.

Self-audit: all ten sections are present. A fresh worker can continue using §§1–3,5–8 plus the linked complete plan; failures and rationale are explicit in §§4–5, risks/choices in §9. Line-by-line decision sweep found no technical approval that belongs to Albert; §0 carries all currently settled owner direction and the only conditional future content-meaning question. No missing owner decision is hidden in §§1–9.
