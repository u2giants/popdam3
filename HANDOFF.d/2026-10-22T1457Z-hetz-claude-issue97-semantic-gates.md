---
issue: 97
status: OPEN
owner: claude/coordinator-5ad0641a-8b6d-4992-b794-fcd04535db5d
---

# PopDAM #97 semantic search — waiting on embeddings, then gates and activation

Written 2026-10-22 10:57 AM EDT by Claude coordinator session
`5ad0641a-8b6d-4992-b794-fcd04535db5d` on `hetz`. Earlier handoffs for the same
issue (not edited here):
[2026-10-21T0400Z-edge-dev-mimo-issue97-semantic-search.md](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-21T0400Z-edge-dev-mimo-issue97-semantic-search.md),
[2026-10-18T1730Z-hetz-codex-dam-semantic-readiness.md](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-18T1730Z-hetz-codex-dam-semantic-readiness.md),
[2026-10-18T1632Z-hetz-codex-semantic-search-plan.md](https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-10-18T1632Z-hetz-codex-semantic-search-plan.md).

## 0. ⚠️ Business decisions only the owner can make

None. Every remaining step is technical and gated by measured thresholds below.

## 1. What this application is

PopDAM (repo [u2giants/popdam3](https://github.com/u2giants/popdam3)) is POP
Creations' digital asset manager: designers search ~150k artwork/style records.
Data lives in the shared Supabase project `qsllyeztdwjgirsysgai` (Virginia),
whose structure is owned by [popcre/shared-db](https://github.com/popcre/shared-db).
Web app deploys via Coolify on merge to `main` (see
[AGENTS.md](https://github.com/u2giants/popdam3/blob/main/AGENTS.md)).

## 2. Goal

Issue [#97](https://github.com/u2giants/popdam3/issues/97): let DAM search find
artwork by meaning (hybrid keyword + vector), without slowing keyword search,
then switch the live DAM to `SEARCH_MODE=hybrid` only after measured gates pass.
PopSG is out of scope — do not touch PopSG search.

## 3. Current state (as of 2026-10-22 10:57 AM EDT)

- Search speed fix live: shared-db migration `20261021190510`
  ([PR #4562](https://github.com/popcre/shared-db/pull/4562), merged; issue
  [#4529](https://github.com/popcre/shared-db/issues/4529), open). spider-man and
  stitch return the right top-5 in 3–4 s. Totals over 1,000 are flagged as lower bounds.
- Search-only precomputed table live via
  [#4573](https://github.com/popcre/shared-db/issues/4573) (open): wall-art-canvas,
  spider-man, stitch and a 3,000-deep page all under 5 s. #4573 stays open only for
  cleanup of indexes the old table no longer needs (structural, claim-first).
- popdam3 [PR #456](https://github.com/u2giants/popdam3/pull/456) merged, live build
  `ddf5b26`: UI shows "N+" for lower-bound totals. Live DAM still runs keyword mode.
- Embedding run `0e63843f-e8b1-4ce3-a921-321d7d8d6dcb` runs on the `edge-dev`
  Windows machine (`durable-embed-loop.mjs`): 44,468 / 150,679 at 9:34 AM EDT Oct 21,
  ~3k/hour, expected to finish evening Oct 22 EDT. Style-group vectors 0 / 11,161
  until it drains.
- Shared-db closeout check for this session: ok, zero owned claims/stages
  (10:56 AM EDT Oct 22).

## 4. What did NOT work

- Migration `20261021063716`: rejected by reviewer Muse (REJECT). Replaced by
  `20261021190510`.
- Migration `20261021152741`: superseded. Both `20261021063716` and
  `20261021152741` remain unapplied files on shared-db `main` and must NEVER be
  promoted or applied. Do not reuse their version numbers.
- Exact counts for broad terms were too slow; replaced by capped lower-bound totals.

## 5. Key findings

- Broad terms (high document frequency) were the timeout cause; a precomputed
  search-only key table fixed deep pages.
- Vector scores must use query vectors from the deployed edge function (not a
  local model) or thresholds will not transfer.

## 6. Exact next steps

1. Check embedding progress for run `0e63843f-...` (read-only SQL on the run row /
   vector counts). Never reset or restart it. Done when 150,679 assets and 11,161
   style groups have vectors.
2. Re-score the evaluation set with deployed-edge query vectors, similarity floor
   0.85, plus designer grades on the private judgments set. Done when every gate in
   the #97 plan passes (top-5 relevance, exact-ID unchanged, latency under 5 s).
3. Only if all gates pass: set DAM `SEARCH_MODE=hybrid` with a documented rollback
   (set back to keyword), observe 24 h (errors, latency, zero-result rate).
4. Post live proof on #97 and close it; then delete this file in the same PR.
5. Separately, #4573's index cleanup is claim-first in popcre/shared-db (load
   `shared-db-change`); its owner is whichever session claims it.

## 7. Constraints

- Feature branch + PR; never push to protected `main`.
- Shared-db structure changes only through popcre/shared-db with exact-head APPROVE.
- Never touch PopSG. Never reset the embedding run.

## 8. Access

`gh` as `u2giants` (popcre org repos readable). Supabase MCP / SQL for project
`qsllyeztdwjgirsysgai` (default MCP may point at old Ohio project — check).
Secrets in 1Password vault `vibe_coding`. `edge-dev` is the Windows machine running
the embed loop.

## 9. Open questions and risks

- ETA is an extrapolation from Oct 21 9:34 AM EDT; re-measure.
- If hybrid gates fail, DAM stays on keyword mode (decided 2026-10-21); do not lower
  the 0.85 floor without new measurement.
- `ai-shared-db-closeout-check` failed closed several times on 2026-10-22 because
  GitHub intermittently returned an empty open-issue list; a retry passed.
