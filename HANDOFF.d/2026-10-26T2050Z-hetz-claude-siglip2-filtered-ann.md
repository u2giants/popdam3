# Handoff — SigLIP2 filtered search cap (#4825 parked)

## 1. Goal
Picture-meaning (SigLIP2) search must return all close matches when it is filtered to style groups. Albert's case: "spiderman floor covering" showed about 21 style groups, and he knows the server has far more.

## 2. Done (verified)
- SigLIP2 text-embed service moved from a dead trycloudflare tunnel to Coolify: https://text-embed.designflow.app. Supabase secret `TEXT_EMBED_URL` updated, and live `dam-search-ai` returns `semantic:"siglip2"`. Commit and workflow from https://github.com/u2giants/popdam3/pull/504; docs in https://github.com/u2giants/popdam3/pull/517 (docs/INFRASTRUCTURE.md, section "SigLIP2 Text-Embed Service").
- Compound-word and synonym expansion (spiderman/spider man, coirmat/coir mat, doormat/door mat, lapdesk/laptop desk, floor covering→mat) is LIVE on production via https://github.com/popcre/shared-db/pull/4805.

## 3. Not done
- HNSW filtered-scan cap: `search_dam_documents` runs SigLIP2 ANN with `hnsw.ef_search=100` and post-filters by document_type, so only about 3 style-group semantic rows survive (108 unfiltered). The fix uses `hnsw.iterative_scan=relaxed_order` plus max_scan_tuples. In read-only tests on prod it gave 3→2000 rows in about 0.1 s warm. It is in https://github.com/popcre/shared-db/pull/4825, which passed review but is CLOSED/parked with its branch kept. Its claim #4824 is released.

## 4. Why parked
Migrations merge in version order, and https://github.com/popcre/shared-db/pull/4813 and https://github.com/popcre/shared-db/pull/4819 (other owners) are ahead of it. Exact resume steps: https://github.com/popcre/shared-db/issues/4664#issuecomment-6426867712.

## 5. Next exact steps
1. Load `shared-db-change`. Reopen #4825, claim `public.search_dam_documents` claim-first on #4664, and re-version the migration with the lane tool so it lands after the current queue.
2. Get the recorded in-rotation review via `ai-review`, merge, and let preview and production promotion run.
3. Prove it live (section 6).

## 6. Verification
Use the viewer tester (1Password vibe_coding item mbspkosvp2rf25qxhqufipxqca) with a password grant using SUPABASE_PUBLISHABLE_KEY from item 3hhxwrljnaq2tykxi7hplq5ryi. POST `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/dam-search-ai` with `{"action":"search","query":"spiderman floor covering","document_types":["style_group"],"limit":200}`. Before the fix: 26 groups, 9 semantic, 8.5 s. Also run coirmat (201/4), doormat (201/13) and lapdesk (73/0). Success means semantic counts far above these, total time under 30 s, and `semantic:"siglip2"`.

## 7. Tried / learned
- The vector search outside the function uses an exact scan (2000 rows). Inside the function the generic plan uses HNSW, which hits the cap. Raising the LIMIT alone does nothing.
- If `semantic` reads "skipped", check the function logs for `text-embed call failed`.

## 8. Risks
`relaxed_order` returns approximately ordered candidates. That is fine because results are re-ranked afterward. Watch the cold-start time.

## 9. Owners
Albert has no technical decisions here. The next AI session owns steps 1–3.
