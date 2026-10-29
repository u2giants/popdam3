# Handoff — "spiderman coir" picture search still wrong (popdam3)

## 1. Goal
Searching the DAM for **"spiderman coir"** must return Spider-Man **coir doormats** (coir → doormat → floor covering). It must not return hampers, MDF door hangers, wall art or clocks, and must not hide real coir mats.

## 2. Current status — NOT DONE
Albert tested live after the last deploy (2026-10-29, ~10:15 AM EDT) and said: **"still didn't work. i got only 13 groups · 105 files."** He did not say which of these it is, so the next session must find out:
- (a) too few results: real Spider-Man coir mats missing, or the cutoff is too strict;
- (b) wrong items still showing in those 13 groups;
- (c) both.

Start by reproducing the search in the app as an admin. List the 13 style groups and judge each one.

## 3. What is shipped (all merged to main and deployed)
- **Query expansion:** a bare "coir" also searches as "coir mat". See [search-query-expand.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/search-query-expand.ts).
- **Picture-match cutoff:** each query keeps only picture matches within **0.045** of its best picture score, never below the admin floor `SEARCH_MIN_SEMANTIC_SCORE`. See `effectiveSemanticFloor` and `RELATIVE_SEMANTIC_MARGIN` in [semantic-floor.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/_shared/semantic-floor.ts).
- **Search wiring:** [dam-search-ai/index.ts](https://github.com/u2giants/popdam3/blob/main/supabase/functions/dam-search-ai/index.ts) works per query variant:
  - it calls the shared-db RPC `public.dam_search_semantic_anchor(p_query_embedding, p_document_types)`, which is fast (2–7 ms for assets, 110–130 ms for style groups);
  - it then passes that best score through `effectiveSemanticFloor` into `search_dam_documents.p_min_semantic_score`.
- **PR history:**
  - [#577](https://github.com/u2giants/popdam3/pull/577) added a slow probe. It caused statement timeouts and "No style groups found".
  - [#578](https://github.com/u2giants/popdam3/pull/578) reverted the probe.
  - [#579](https://github.com/u2giants/popdam3/pull/579) added the anchor wiring.
- **Shared-db:** the anchor RPC came from popcre/shared-db PR #5003, issue #4999. It is merged and promoted to production.

## 4. Evidence gathered
- SigLIP2 text→image cosine scores are low and flat:
  - for "spiderman coir", mats score 0.16–0.23;
  - unrelated Spider-Man wall art scores 0.15–0.16.
- **Ranking:** `search_dam_documents` ranks by keyword + 0.35×semantic, and `p_min_semantic_score` filters only the picture leg. Keyword hits are therefore never filtered. If junk is coming in through keyword matches on "spiderman", this cutoff cannot remove it.
- **SQL check run as postgres:**
  - the asset anchor for "spiderman coir mat" was 0.229, so the floor was max(0.172, 0.184) = 0.184;
  - this gave 140 asset results, nearly all VDC83/VDCS2/VDD83/VDE83/VDE86/HXPS2 …MVSP files and "Coir mat_MVSP" files.
- **Why the app can differ from that check:**
  - it runs both variants, "spiderman coir" and "spiderman coir mat", and merges them;
  - it searches style groups too;
  - it applies the user's DAM access.
- **How to embed text from SQL:** `net.http_post` to `TEXT_EMBED_URL` + `/embed-text`, with header `X-Embed-Key` set to admin_config `TEXT_EMBED_KEY` and body `{"text":…}`. Read `content->'vector'` from `net._http_response`.
- **Statement timeout:** 8 s for the authenticated role. A full search takes about 2.4 s, so never add extra full-search calls per request.

## 5. Tried and failed
- A per-variant probe that called the full search RPC: it timed out (#577).
- A fixed absolute floor alone: it cannot fit every query.

## 6. Next steps
1. Reproduce the search in the app, then classify it as (a), (b) or (c).
2. If (a): check the style-group anchor. The style-group best may be much higher than the asset best and cut real groups. Consider a separate or wider margin per document type, or applying the relative floor to assets only.
3. If (b): find out whether the junk arrives through the keyword leg ("spiderman" alone). If so, require the product noun ("coir"/"mat") to match, or down-rank keyword-only hits that miss the noun.
4. Add tests and ship through a PR to main (PopDAM needs no reviewer). Then verify live in the app with Albert's exact query.

## 7. Risks
- Do not slow search: watch the 8 s timeout and the "No style groups found" regression.
- Shared-db structural changes go through popcre/shared-db, claim-first.

## 8. Done when
"spiderman coir" in the live app shows only Spider-Man coir or floor mats, with all known ones present. Style-group search still works.

## 9. Session ownership
- This session holds no shared-db claims: the helper released its hold after #5003 was promoted.
- The branch `claude/semantic-anchor-floor` is merged.
