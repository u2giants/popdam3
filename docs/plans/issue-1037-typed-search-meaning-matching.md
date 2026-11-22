---
summary: Issue #1037 plan: meaning-based matching on PopDAM item descriptions and folders, named-character rule, picture guesses demoted. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-1037, or changing how typed PopDAM search matches or ranks
---

# Plan: typed search by meaning — descriptions and folders, named characters, picture guesses demoted (u2giants/popdam3#1037)

Issue: https://github.com/u2giants/popdam3/issues/1037
No open handoff: issues #1037 and #1252 are closed with live proof (Nov 22, 2026). Past handoffs are in git history.
Parent plan: [plan_vector_consolidation.md](../../plan_vector_consolidation.md) (its STATUS and "Reconciliation" section still govern the embedding worker, alarms and the scorecard; this plan adds one new leg to search and wins only where it says so).
Written November 17, 2026, 1:40 PM EST on `hetz` by Claude (session `semantic-search-investigation-8d17ef`). Investigation and planning only: **no code, database or configuration was changed.**

## STATUS — read before executing

| Step | State (Nov 19, 2026) | Evidence / artifact |
|---|---|---|
| 0. Confirm the text model on `edge-dev`, pick dimensions | ✅ done — Nov 17, 2026 | Qwen/Qwen3-Embedding-0.6B @ 97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3, 1024 dims, last-token pooling, query prefix; 6,102 MiB with picture worker; sims 0.493 vs 0.286. #1037 comment 6960263298 |
| 1. Add the failing searches to the private test set, take BEFORE score | ✅ done — Nov 17, 2026 | PR #1044; set version 2026-11-17-1037 (137 cases); BEFORE run 44203103018: PopDAM 128/137. mis-088/mis-092 failed from backend slowness (spelling budget), not code |
| 2. Named-character rule | ✅ live — Nov 18, 2026 3:30 AM EST | shared-db 20261204003329, 003530, 003633 (perf); popdam3 #1057 (reland, 58f73601). First landing (#1045) caused 503s and was reverted (#1055) |
| 3. Text-meaning vectors: storage and queue (shared-db) | ✅ done — Nov 17, 2026 | shared-db #6622 (20261204003429, reissue without bulk backfill), health fast #6631 (003532) |
| 4. Text-meaning vectors: GPU worker lane on `edge-dev` | ✅ done — Nov 18, 2026 12:48 AM EST | #1046 (edge-dev), #1058 (--text-only; second box 916-alien task PopDAM-TextEmbedWorker). 182,726/182,726 embedded. Refresh-on-edit proven only in preview rehearsal |
| 5. Query side: embed typed words with the same text model | ✅ done — Nov 17, 2026 | #1042, #1047; +~210 ms typical (O2 accepted, #1037 comment) |
| 6. Search function: add the text-meaning leg, demote picture-only matches | ✅ live, mode ON — Nov 18, 2026 8:20 PM EST | shared-db 20261204003632, 20261218084103; popdam3 #1051, #1181, #1183 (min score 0.45, margin admin setting, now 0.0925). Speed: shared-db #6738 (word-form cost), 20261218230700 (filtered-search visibility pretest), spelling budget fix; UI keeps backend order #1185 |
| 7. Word forms in the exact-word leg (frame / framed / frames) | ✅ live — Nov 18, 2026 10:41 AM EST | shared-db #6674, #6676, #6678, #6680; backfill 182,726 rows. Product-type rank: shared-db 20261222100000, 20261224120000 (#6792, #6813) |
| 8. AFTER score, live proof, docs, close #1037 | 🔄 acceptance open — November 19, 2026 | [AFTER score](https://github.com/u2giants/popdam3/actions/runs/44499851023): 137/137, p95 2.0 s. [Viewer result](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7005745339): frame case passes, clock case includes unexpected results. [Alarm drill](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7008861370) passed. Remaining: reconcile clock case, prove 24-hour unattended drain, and close. |

**Start at Step 8.** The meaning leg is live. Validate the two disputed must-find labels against the asset evidence before changing the scorecard or the search rule. Continue from the current handoff.

---

# Part 1 — Why

## 1. The ultimate goal

A POP Creations employee types ordinary words into PopDAM — a character and a product type, such as "marie frame" — and sees **every** product that is that character on that kind of product, first, and **nothing** that is a different character. Close wording works without anyone maintaining a word list: "frame", "framed" and "frames"; "lap desk", "lapdesk" and "laptop desk"; "picture frame" and "photo frame". This stays true as the catalog changes, with nobody re-running anything by hand.

Today the search matches product text by exact words only, and adds products a picture model guesses the words might look like. It has no matching by the *meaning* of product descriptions at all.

**If a step below conflicts with this goal, the goal wins — stop and flag it on #1037.**

## 2. What this application is

- **PopDAM** (`u2giants/popdam3`, branch `main`, **public repository**): internal library of licensed consumer-product artwork for POP Creations. React + Vite front end on Coolify at https://dam.designflow.app; Deno edge functions on Supabase (`supabase/functions/`); Node worker on Railway (`apps/worker/`); Python GPU worker `apps/image-embed-worker/` on the Windows PC **`edge-dev`** (NVIDIA RTX 3060 Ti); always-on query-embedding service `apps/text-embed/` on Coolify.
- **Products are "style groups"**: 11,477 of them, holding 171,066 files ("assets"). The library's main view lists style groups.
- **Shared database**: Supabase project `qsllyeztdwjgirsysgai` (Virginia), PostgreSQL 17, pgvector 0.8.2. **All structure lives in `popcre/shared-db`**; this repo carries a read-only copy under `shared-db/`. Never add a migration here.
- **Search table** `public.dam_search_documents`: one row per file and per style group. Columns that matter: `search_text` (all catalog text for the row), `search_tsv` (word index), `embedding vector(768)` (a **picture** fingerprint of the row's thumbnail, model `google/siglip2-base-patch16-naflex`). A slim copy for word matching is `public.dam_search_keys`; style-group picture vectors are mirrored in `dam.search_group_vectors`.
- **Search entry point**: the browser calls edge function `dam-search-ai` (`src/lib/dam-search.ts:12-19`), action `search` (`supabase/functions/dam-search-ai/index.ts:454-655`), which calls database function `public.search_dam_documents(...)`.

## 3. What triggered this work

Owner report, November 17, 2026, on https://dam.designflow.app: natural-language search "is not working". Searching **`marie frame`** (Marie is a character in Disney's The Aristocats) returned:

- (a) not all the Aristocats framed styles, and
- (b) products that are not framed (a Marie lap desk) or not Marie (a Minnie, a Mickey and a Lion King product).

Reproduce: sign in as any viewer, style-group view, type `marie frame`. Read-only database reproduction of the word half:

```sql
-- products the exact-word half returns (5 today)
select title from public.dam_search_keys
where document_type = 'style_group'
  and search_tsv @@ websearch_to_tsquery('simple', 'marie frame');

-- products that are Marie AND framed by their own catalog text (9 today)
select title from public.dam_search_documents
where document_type = 'style_group'
  and search_text ~* '\mmarie\M' and search_text ~* 'fram';
```

Product codes are deliberately not printed in this file: the repository is public (`docs/SEARCH_EVAL.md` rule). Re-derive them with the SQL above.

## 4. Scope

**In**

- A text-meaning leg for PopDAM typed search: embeddings of each style group's and file's description and folder tree, produced on `edge-dev`, queried with the same model.
- A rule that a search naming a character returns only products containing that character.
- Demoting picture-only matches so a weak picture guess can no longer add unrelated products to a word search.
- Word-form matching (frame / framed / frames) in the exact-word leg, as a rule.
- Scorecard cases for the failures above.

**NOT in this plan**

- Replacing or re-embedding the picture model (SigLIP2, locked on shared-db #4664), or picture-upload search (`plan_image_similarity_upload_search.md`). Both keep working unchanged.
- PopSG (sg.designflow.app) search. It has its own search function and plan (`plan_vector_consolidation.md` Step 6).
- Fixing wrong character tags on files (tagging, #680). Measured and reported in Step 2, not repaired here.
- Hand-maintained synonym lists. `public.dam_search_synonyms` (27 active rows) stays as it is; do not add rows to solve this issue (owner, §8 D3).
- Raising any database statement timeout; an external vector database; a different vector extension.
- Order List, HTS/customs search (`hts_rag_*` is another product; do not reuse its tables).

---

# Part 2 — What we already know

## 5. Current state of the code

Nothing for this plan exists yet. What exists and works today (all on `main`, deployed):

1. **Exact-word leg** — `public.search_dam_documents`, CTEs `queries` → `full_text_matches` → `keyword_candidates`. The typed text becomes `websearch_to_tsquery('simple', …)`: **every word is required, and words are compared exactly** (`'simple'` does no word-form reduction). Variants come from `public.expand_dam_search_queries` (splits/joins compounds such as "spiderman"/"spider man" and "door mat"/"doormat" only when the catalog itself writes them that way, plus the synonym table) and from `expandProductQueries` in `supabase/functions/_shared/search-query-expand.ts:57` (product-type phrases).
2. **Picture leg** — the typed words go to `apps/text-embed/main.py` (SigLIP2 **text tower**, 768 numbers, 64-token limit), and `search_dam_documents` (CTEs `semantic_ann` / `semantic_exact`) returns the rows whose **thumbnail** fingerprint is nearest. This is the only "meaning" matching today, and it compares words to pictures, not to descriptions.
3. **Picture floor** — `supabase/functions/_shared/semantic-floor.ts`: a picture match is kept if its score is within `RELATIVE_SEMANTIC_MARGIN = 0.035` of the best picture match for that query (anchor from `dam_search_semantic_anchor`). `admin_config.SEARCH_MIN_SEMANTIC_SCORE` (optional absolute floor) has **no row** today.
4. **Ranking** — `candidate_ranks`: `rank = keyword_rank + 0.35 × semantic_rank`. A picture-only match is a full result; nothing requires it to agree with the words.
5. **Licensor rule (#892)** — when the words contain a licensor's whole name, `namedLicensorIds` (`dam-search-ai/index.ts:527`) passes `p_filters.semanticLicensorIds` and a picture-only match must belong to that licensor. There is **no equivalent for characters or properties**.
6. **Names vocabulary** — `spellingNames` / `loadNames` (`dam-search-ai/index.ts:51-100`) already loads every licensor, property and character name (≈15k characters from `core.character`) hourly for spelling help. Step 2 reuses it.
7. **Search text** — built by `public.refresh_dam_search_style_group_document(uuid)` (and `refresh_dam_search_asset_document`): SKU, folder path, cover/item/AI descriptions, every leaf of `rich_metadata`, customer, program, licensor, property, category and merchandise-group names, size, active tags, and the names of every character tagged on any member file (not de-duplicated).
8. **Document embedding lane** — `apps/image-embed-worker/image_embed_poller.py` on `edge-dev` claims unembedded rows with `public.claim_dam_search_embedding_documents`, embeds the **thumbnail**, writes through `public.upsert_dam_search_embedding`, reports failures through `public.mark_dam_search_embedding_error`. Coverage today: 11,476 of 11,477 style groups have a picture vector. `apps/image-embed-worker/README.md` documents leases, batch sizes and the heartbeat.
9. **Character data** — `public.asset_licensor_characters` (73,546 rows → `core.character`, licensor-scoped names, aliases in `core.character_alias`) and legacy `public.asset_characters` (49,483 rows → `public.characters`). Tags are per file; a style group "contains" a character when any non-deleted member file is tagged with it.
10. **Scorecard** — `docs/SEARCH_EVAL.md`, `scripts/search-eval/`, cases in `admin_config` key `SEARCH_EVAL_SET_V1` (private). Last official run (Nov 10, run 42873291754): PopDAM 119/119.

## 6. Key findings and root cause

Measured read-only on production, November 17, 2026, about 1:20 PM EST.

1. **Missing framed products = exact word forms.** Of 51 Aristocats style groups, 9 are both Marie and framed by their own text. The word leg returns 5 products for `marie frame`; 4 framed Marie products are missed because their text says "Framed" and never the word "frame". Library-wide, **1,297 style groups contain "framed" but not "frame"** and are invisible to any search using "frame".
2. **The non-framed product = an honest word match.** A lap desk's description reads "Marie in pink frame pattern": both words are present. So is a ceramic planter "with Photo Frame". Words alone cannot tell a product *type* from a word in the artwork description.
3. **The other characters = picture guesses.** The Minnie, Mickey and Lion King products contain no "marie" (checked: the Lion King framed print has `kw = false`). `search_dam_documents` has only two sources of results, so they came from the picture leg: the picture model does not know Marie is a specific cat, turns "marie frame" into roughly "framed cartoon art", and the relative floor keeps everything within 0.035 of the best guess. The owner confirmed by eye that those products do not look like the Marie products — the picture score for a text query is flat and low (0.14–0.23, `semantic-floor.ts` comment), so "near the best guess" is not evidence of relevance.
4. **Why it reads as "semantic search is broken":** there is no text-to-text meaning matching anywhere in PopDAM search. `docs/SEARCH_PERFORMANCE.md` still describes a 384-number `gte-small` text embedding; that was replaced by picture vectors on October 23 (`20261023184940_dam_search_siglip2_768_embeddings.sql`) and the document is stale on that point (fix in Step 8).
5. **Character tags are usable for the named-character rule, with one known defect.** 39 style groups are tagged Marie; only 1 style group says "marie" in its text without a tag, and 2 tagged groups do not mention Aristocats. But group text shows foreign characters on some products (for example Marie products carrying "Nightmare Before Christmas", an Aristocats product carrying "Winnie the Pooh"), because a group inherits every tag from every member file and some files are mis-tagged. Under the named-character rule those wrong tags would let a product appear for the wrong character. Step 2 measures this; repair belongs to tagging (#680).
6. **`core.character` has two rows named "Marie"** under the same licensor. The rule must treat every character row whose name or alias equals the typed name as the same request.
7. **Size of the job:** 11,477 style-group texts (average 477 characters) and 171,066 file texts (average 926 characters). On one RTX 3060 Ti a small text-embedding model processes this in hours, not days; measure in Step 4, do not assume.

## 7. Approaches considered and rejected

| Approach | Why rejected |
|---|---|
| Add synonym rows ("frame" → "framed", "lapdesk" → "lap desk" …) | Owner, Nov 17: "we can't do this one-by-one with every possible search term. There has to be a way for the search function to know that as a rule". |
| Tighten the picture floor / margin again | Already tuned five times (#577, #579, #586, #690, #699; margin 0.045 → 0.035). Text-to-picture scores are flat; no threshold separates Marie from Minnie. The defect is using a picture guess as proof of relevance. |
| Property-level version of the licensor rule (#892) | Tested against the scorecard on #892 and rejected: it broke a misspelling case. A **character** rule is different (the owner ruled it, and it filters on tags, not on picture ownership), but re-run the misspelling cases in Step 2 for the same reason. |
| Replace SigLIP2 with a better picture model | Locked on shared-db #4664; picture-upload search depends on it and works. A better picture model still cannot read "framed" from flat art. |
| Embed text with the existing SigLIP2 text tower and compare to description vectors | SigLIP2's text tower is trained to match captions to pictures, has a 64-token limit and is not a general text-similarity model. |
| Have a language model rewrite every query into filters | Adds a paid, slow, failure-prone call to every search; the 3-second target (`plan_vector_consolidation.md` §1) leaves no room. Not needed if descriptions are matched by meaning. |
| Remove the picture leg from typed search entirely | Loses purely visual searches ("cute yellow character") that no description covers. Demote it instead (Step 6). |
| Reuse `hts_rag.hts_rag_product_embeddings` | Different product, different roles and retention; `plan_vector_consolidation.md` §4 keeps HTS out. Copy its good idea only: record the model on every row. |

## 8. Design decisions

**Locked — do not relitigate**

- **D1 (owner, Nov 17, 2026):** "naming a character should show only products that contain that character." Applies to every leg, including exact-word matches.
- **D2 (owner, Nov 17, 2026):** build embeddings "on the item descriptions and directory tree", using the Qwen text-embedding model and NVIDIA RTX card already on `edge-dev`.
- **D3 (owner, Nov 17, 2026):** close wording is solved by a general rule, never by a per-term list.
- **D4 (plan_vector_consolidation "Reconciliation" item 4, owner Nov 1):** when a required embedding fails, search shows error and Retry, never silently fewer results. The new text leg follows the same contract.
- **D5:** the picture vector column, model and index are untouched. Text vectors live in their own table with the model name on every row, so either can be rebuilt without the other. A text change must not clear a picture vector and a thumbnail change must not clear a text vector.
- **D7 (owner, Nov 17, 2026):** a product whose text truly contains every typed word is a correct result even when it is another product type (the lap desk described as "Marie in pink frame pattern"): "the system was right to have returned that lap desk." It ranks below products of the requested type; it is never hidden.
- **D8 (owner question, Nov 17, 2026): use the characters-per-property index.** `core.property_character_associations_current` (16,124 links across 855 properties and 15,117 characters) is the index; Step 2 uses it as described there.
- **D6:** database structure goes through `popcre/shared-db` (load the `shared-db-change` skill first; claim-first on a shared-db issue).

- **D9 (owner discussion, Nov 17, 2026, 3:25 PM EST): where license knowledge comes from.** The owner needs search to "understand our entertainment licenses (disney, warner bros, nbc universal) and their properties". No embedding model is relied on for that. The knowledge comes from our own data: each product's licensor, property and character names are written into the embedding input (Step 3) and enforced by the rules in Step 2.
- **D10 (same discussion): model size.** Larger Qwen3-Embedding models were discussed and not chosen. Reasons given to the owner: the 8B model does not fit `edge-dev`'s 8 GB card even alone at full quality; the 4B model would fit only compressed and alone (estimate, not measured). A nightly rotation (load DINOv3, embed, unload; SigLIP2; then the text model) is acceptable to the owner in principle for **document** embeddings, with the trade-off that a new item is findable by meaning only the next morning. It does not solve the **query** side: every typed search must be embedded live by the same model, and the always-on Coolify service has no graphics card. A larger model therefore needs a rented server with a graphics card, or makes typed search depend on `edge-dev` being on. Build with 0.6B. **Pending owner answer (asked, not answered):** whether a monthly fee for a rented graphics-card server is acceptable if 0.6B falls short on the test set. Do not ask again until Step 8 shows a measured shortfall.

**Open — implementer's judgment, with criteria**

- **O1. Vector size and model revision.** The model is `Qwen/Qwen3-Embedding-0.6B` (owner, Nov 17, 2026; found on `edge-dev` over SSH the same day, see STATUS). It is the smallest of its family; the larger 4B and 8B versions score higher on public benchmarks but do not fit this 8 GB card beside the picture worker (about 3.2 GB was free) and would slow every typed search. Keep 0.6B unless the Step 1 test set fails after Step 6 for reasons a larger model would plausibly fix; then raise it on #1037 with the measured gap. Step 0 records the revision. Prefer the model already installed. Store vectors as `halfvec` at the model's native size unless the model card documents shortened ("Matryoshka") outputs, in which case 768 is acceptable; decide by the Step 1 test set, not by taste. Treat anything remembered about Qwen embedding models (dimensions, instruction prefix, pooling) as unverified until read from the model card on the day.
- **O2. Where typed words are embedded.** Query and documents must use the identical model and normalisation. Default: add the model to the always-on `apps/text-embed` service on Coolify (CPU), in the same batched request as the SigLIP2 text. Accept if added p95 is ≤ 300 ms measured with `scripts/search-eval/step-timing.mjs`. If it is slower, the fallback is a small GPU query lane on `edge-dev`, but then typed search depends on that PC being up — flag that on #1037 before choosing it.
- **O3. Ranking weights and the text floor.** Starting point in Step 6; tune only against the scorecard.
- **O4. Whether Step 7 (word forms) is still needed after Step 6.** Do it unless the AFTER score shows the text-meaning leg already returns every word-form case in the top 10; it is cheap and makes exact-word ranking honest.

---

# Part 3 — How to build it

## 9. Steps

### Step 0 — Confirm the text model on `edge-dev`

- On `edge-dev` (`ssh edge-dev` over Tailscale works from `hetz`), the model is at `D:\models\huggingface\hub\models--Qwen--Qwen3-Embedding-0.6B`. Record model id, revision hash, native output size, maximum input length, the pooling and normalisation its model card prescribes, and whether queries need an instruction prefix that documents do not.
- Load it next to the running picture worker and record GPU memory with both loaded (the card has 8 GB; the picture worker holds DINOv3 and SigLIP2).
- Embed three short strings and confirm unit-length vectors and that "framed print" is closer to "picture frame wall art" than to "lap desk".
- **Gate:** a comment on #1037 with model id, revision, size, memory headroom and the three similarity numbers. If no Qwen embedding model is present, or it does not fit beside the picture worker, stop and report on #1037 — do not substitute another model silently.

### Step 1 — Failing searches into the private test set, BEFORE score

- Add cases to `admin_config.SEARCH_EVAL_SET_V1` as a new `version` (procedure: `docs/SEARCH_EVAL.md` → "Judging new results"). Keep names and codes out of the repo and the issue.
- Cases: (a) `marie frame`, must-find = the 9 products from the §3 SQL that are genuinely framed (judge by eye; exclude the lap desk and planter), must-not-appear = any product without the character; (b) at least five more "character + product type" searches chosen from real catalog names, including one where the type is written differently in the catalog; (c) word-form pairs: frame/framed/frames, and two more found with the query below; (d) compound and near-synonym pairs: lap desk / lapdesk / laptop desk, picture frame / photo frame; (e) two purely visual searches with no character or product word, to protect the picture leg.
- Scoring additions in `scripts/search-eval/score.mjs`: a `must_not_contain_other_character` check (fails when any top-20 result lacks the named character) and a `must_find_all` check (every must-find id within the first 50). Add unit tests beside `score.test.mjs`.
- Run the workflow "Search test set" with label `before-1037`.
- **Gate:** the new cases fail today for the reasons in §6, the original 119 still pass, run id recorded in STATUS.

```sql
-- find more word-form gaps: words present only with an -ed / -s ending
select count(*) from public.dam_search_documents
where document_type = 'style_group'
  and search_tsv @@ to_tsquery('simple', 'framed')
  and not search_tsv @@ to_tsquery('simple', 'frame');
```

### Step 2 — Named-character rule (D1). Ships on its own.

- **Recognise the character.** In `dam-search-ai/index.ts`, beside `namedLicensorIds` (line 527): add `namedCharacterIds(texts, characters)` using the same whole-name, word-boundary matching as licensors, over `core.character.name` and `core.character_alias.alias`, plus legacy `public.characters.name`. Load through the existing hourly cache pattern (`licensorNames`, lines 100-155). Return every id whose name or alias matches (§6 finding 6). Longest match wins when names overlap; a licensor or property name that is also a character name counts as the licensor/property, not the character (measure how many such collisions exist and list the count on #1037).
- **Apply the rule in the database.** shared-db change to `public.search_dam_documents`: read `p_filters->'requiredCharacterIds'` (core ids) and `p_filters->'requiredLegacyCharacterIds'` the same way `semanticLicensorIds` is read in `params`, and in `candidate_ranks` keep a candidate **from any leg** only if a non-deleted file of its style group (or the file itself, for an ungrouped file) has a matching row in `public.asset_licensor_characters` or `public.asset_characters`. Strip both keys in `visibility_params` exactly as `semanticLicensorIds` is stripped so the fast count paths still apply. Apply the same condition in the anchor function used for the floor (a new scoped anchor or an extra argument to `dam_search_semantic_anchor_scoped`) — otherwise another character's closer picture raises the floor past every allowed match (the #6024 lesson).
- **Use the characters-per-property index (D8).** `core.property_character_associations_current(property_id, character_id)` links characters to properties. Use it two ways: (1) to tell same-named characters apart — when the words also name a property, keep only the character rows linked to that property; (2) when the words name a **property** and no character, pass the ids of that property's characters as an *accepted* set for the picture and text-meaning legs only (a match from those legs must carry the property itself or one of its characters); exact-word matches are untouched. This is not the rejected #892 property experiment, which scoped by picture ownership and broke a misspelling case — re-run the misspelling cases anyway. **The index is thin in places:** Aristocats is split across three property rows with five links in total, and one of the two "Marie" rows has no property link. Before enabling (2), report on #1037 how many properties with ≥ 5 tagged style groups have fewer than two linked characters; where a property has none, the rule is skipped for it rather than hiding its products. Filling the index is licensing data work (from licensor scrapes, never by asking the owner) and is not part of this plan.
- **Do not let untagged products vanish silently.** Before enabling, measure for every character name with ≥ 5 tagged style groups: how many style groups carry the name as a whole word in `search_text` but have no tag. Marie: 1. If the library-wide share of untagged-but-named groups is above 5%, keep the rule but also accept "the character's name appears as a whole word in the group's `search_text`" as containing the character, and say so on #1037. Either way, record the foreign-tag measurement from §6 finding 5 on #680.
- **Behaviour when done:** `marie frame` returns no Minnie, Mickey or Lion King product, whatever the picture leg thinks. A search with no recognised character behaves exactly as before.
- **Depends on:** nothing. **Gate:** Step 1 `must_not_contain_other_character` cases pass; all misspelling cases still pass (the reason the property rule was rejected); p95 not worse than the BEFORE run by more than 200 ms.

### Step 3 — Storage and queue for text-meaning vectors (shared-db)

Open a shared-db issue, claim the objects, and add by migration (names are a proposal; keep the shape):

- Table `dam.search_text_vectors`: `document_type text`, `entity_id uuid`, primary key on both; `model text not null`; `input_sha256 text not null`; `embedding halfvec(N) not null` (N from Step 0); `embedded_at timestamptz`. HNSW index with `halfvec_cosine_ops`. A second partial index or a mirror for `document_type = 'style_group'` if the planner needs it (the picture side needed `dam.search_group_vectors` for exactly this reason — read the comments in `search_dam_documents`, CTE `semantic_exact`, before designing).
- A queue that does **not** reuse the picture lease columns on `dam_search_documents`: either a small `dam.search_text_embed_jobs` table or lease columns on the new table. Enqueue when the *embedding input* (below) changes, never when only the thumbnail changes (D5).
- Function `dam.search_text_embedding_input(document_type, entity_id) returns text`: the clean text to embed. **Not** raw `search_text`, which carries legal boilerplate, UPC placeholders and the same character name eight times. Compose, in this order, labelled in plain words: product type (category and merchandise-group names), item description, cover description, AI group description, licensor, property, distinct character names, customer and program, and the last four folders of the path with separators turned into spaces. Keep it under the model's input limit from Step 0.
- RPCs mirroring the picture lane so the worker code stays familiar: `claim_dam_search_text_embedding_documents(p_limit, p_worker_id, p_lease_seconds)`, `upsert_dam_search_text_embedding(...)`, `mark_dam_search_text_embedding_error(...)`, `get_dam_search_text_embedding_status()`. Grants to the existing worker role `dam_image_embed_worker` only. Row-level security on; no access for `anon` / `authenticated`.
- Extend `public.get_search_embedding_health()` (or add a sibling) so the existing Production Canary (`plan_vector_consolidation.md` Step 1) can alarm on a stalled text lane. Reuse the "pending excludes rows that can never drain" lesson (Reconciliation item 5).
- **Gate:** shared-db preview rehearsal and contract tests green; automatic promotion completes; `select * from get_dam_search_text_embedding_status()` on production reports every document pending and none embedded.

### Step 4 — GPU worker lane on `edge-dev`

- In `apps/image-embed-worker/image_embed_poller.py` add a **text lane** beside the search-document lane: claim → fetch input text → embed with the Step 0 model exactly as its card prescribes (document side: no query instruction) → upsert with the model id and revision as the `model` stamp. Style groups claim first (as today). Add tunables to `config.py`, a `--no-text-lane` switch, and README sections. Follow the existing cooldown behaviour: a missing grant logs one error and retries in 10 minutes without stopping the other lanes.
- Load the text model lazily and release it when the lane is idle if Step 0 showed tight memory.
- Do not restart the service between 1:00 and 3:30 AM EST (Reconciliation item 2). Stopping it pauses picture-upload search — deploy outside business hours.
- **Gate:** backlog reaches zero with no manual resume; `get_dam_search_text_embedding_status()` shows all style groups and all files embedded; then change one product's description and see its vector refresh within 10 minutes while its picture vector's `embedding_updated_at` does not change. Record documents per second on #1037.

### Step 5 — Query side

- `apps/text-embed/main.py`: load the same model and revision; extend `/embed-text-batch` to return, per text, both the SigLIP2 vector and the text-model vector (query side: with the instruction prefix if the model card requires one). Report both model stamps in `/health`. Keep the API key check.
- `dam-search-ai/index.ts`: extend `queryEmbedder.embedAll` (lines 220-300) to carry both vectors from the one batched call (#804: one call, one latency draw). A missing text vector when the text leg is required = `err("Search unavailable", 503)` (D4).
- Reject a model-stamp mismatch between the service and the stored vectors: read the expected stamp from `admin_config` key `SEARCH_TEXT_EMBEDDING_MODEL` (new, set in the Step 3 migration) and fail closed with 503 rather than compare vectors from different models.
- **Gate:** `/health` shows both models; p95 of the `embed` timer within O2's limit across 50 real queries; unit tests in `dam-search-ai/index.test.ts`.

### Step 6 — Add the text-meaning leg; demote picture-only matches

shared-db change to `public.search_dam_documents` (new optional parameters, so the old signature keeps working during rollout) plus the edge function:

- New parameters `p_query_text_embedding halfvec(N) default null`, `p_min_text_score real default null`. New CTE `text_candidates`: nearest rows in `dam.search_text_vectors` for the requested document types, model equal to the configured stamp, limit 2000, floor applied after the scan (same shape as `semantic_candidates`).
- **Ranking (O3 starting point):** `rank = keyword_rank + 0.6 × text_rank + 0.15 × picture_rank`.
- **Text floor:** relative to the best text score for the query, like the picture floor, with its own anchor; start at "within 0.10 of the best" and tune on the scorecard. Text-to-text scores spread far wider than text-to-picture scores, so do not copy 0.035.
- **Demotion rule for the picture leg:** a candidate matched by its picture **alone** (no exact-word match and no text-meaning match above the floor) is kept only when the exact-word and text-meaning legs together produced fewer than 10 visible results for the query. Otherwise the picture score only reorders results the text legs already justified. This is what answers "that doesn't look enough like Marie": a picture guess can no longer add a product by itself when words and meaning found real answers.
- The named-character rule (Step 2) and the licensor rule (#892) apply to text-leg candidates too.
- Product-code searches keep skipping every embedding (`codeSearch`, `index.ts:502`).
- Roll out behind `admin_config` key `SEARCH_TEXT_LEG_MODE` = `off` | `on` (read in the edge function like the floor, lines 516-534; default `off`). Ship dark, score, then switch on.
- **Behaviour when done, for `marie frame`:** all 9 framed Marie products appear first (the four that say only "Framed" arrive through the text leg); the lap desk and planter, which truly contain both words, rank below every framed product; no other character appears.
- **Gate:** every Step 1 case passes with the mode `on`; the original 119 PopDAM cases still pass; the two visual-only cases still return picture matches; p95 within 300 ms of BEFORE and under the 3-second target; `explain (analyze)` of the function for a broad query shows no statement near the 8-second ceiling noted in `plan_vector_consolidation.md` §3 item 4.

### Step 7 — Word forms in the exact-word leg

- Add a stemmed word index beside the exact one: a generated `search_tsv_en` (English configuration) on `dam_search_keys` with a GIN index, matched as a **second, lower-scored** alternative in `full_text_matches` (exact form keeps today's score; a word-form-only match scores below every exact match). Never replace the `'simple'` index: product codes and names must stay exact.
- Guard names: English reduction turns "marie" into the same stem as other words and would blur character names. Words recognised as a character, licensor or property name (Step 2 vocabulary) are matched in exact form only; reduction applies to the remaining words.
- **Gate:** the frame/framed/frames cases and the two extra word-form cases pass with the text leg switched **off** (proves this leg alone); exact-code cases unchanged; keyword-only p95 unchanged within noise (two clean runs, `docs/SEARCH_EVAL.md` → "Taking a scored run that can be trusted").

### Step 8 — AFTER score, live proof, documentation

- Run "Search test set" with label `after-1037` following the trusted-run rules (one run at a time, five minutes after the last release).
- Live proof on https://dam.designflow.app as the viewer tester: screenshots of `marie frame` and two other Step 1 searches, posted on #1037 without product codes in the text.
- Update: `docs/SEARCH_PERFORMANCE.md` (remove the stale `gte-small`/384 description; describe three legs), `docs/SEARCH_EVAL.md` (new case kinds and checks), `apps/image-embed-worker/README.md`, `apps/text-embed/README.md`, `plan_vector_consolidation.md` STATUS (one line pointing here), this STATUS table, `docs/INDEX.md`.
- **Gate:** see §13.

## 10. Tests required

- `supabase/functions/dam-search-ai/index.test.ts`: `namedCharacterIds` — whole-name match, alias match, two rows with the same name both returned, name inside a longer word not matched, licensor/character collision resolves to licensor, no character → no filter keys sent; text-leg required and embedding missing → 503; `SEARCH_TEXT_LEG_MODE=off` sends no text vector; model-stamp mismatch → 503.
- `supabase/functions/_shared/semantic-floor.test.ts` (extend): text floor computed from the text anchor, independent of the picture floor.
- `scripts/search-eval/score.test.mjs`: `must_not_contain_other_character` and `must_find_all` pass/fail cases.
- `apps/image-embed-worker/tests/`: text lane — claim/upsert round trip against a fake cursor; input over the length limit is truncated, not failed; empty input is marked as a permanent skip, not retried forever; model stamp written exactly.
- shared-db contract tests (`shared-db/supabase/tests/` pattern): `search_dam_documents` with `requiredCharacterIds` drops a keyword match lacking the character; keeps one whose only tagged file is in the group; text vectors survive a thumbnail change; picture vectors survive a description change; anonymous and ordinary signed-in roles cannot read `dam.search_text_vectors`.
- Must stay green: `npm test` (vitest), `deno test supabase/functions`, the image-embed-worker pytest suite, the shared-db test suite, and the 119-case scorecard.

**Adversarial cases (typed query and catalog text are outside inputs)**

| Input | Hostile case | Test that proves it |
|---|---|---|
| Typed query | 8,000 characters / thousands of words | `index.test.ts`: query is truncated to the model limit before embedding; no 500 |
| Typed query | SQL or regex metacharacters in a "character name" | `index.test.ts`: `namedCharacterIds` matching is literal; shared-db contract test passes ids as uuids only |
| `p_filters.requiredCharacterIds` from a caller | non-uuid strings, 10,000 ids, another tenant's ids | shared-db contract test: invalid entries ignored or rejected with a clean error; visibility still enforced by `require_dam_access()` |
| Caller-supplied text vector | wrong length or model | shared-db contract test: wrong dimension errors cleanly; edge function never accepts a vector from the browser (`index.test.ts`) |
| Catalog description | empty, emoji-only, or megabytes of pasted legal text | worker test: skip / truncate, never crash the lane |
| Character alias data | an alias equal to a common word ("frame") | `index.test.ts`: aliases shorter than 3 characters or equal to a product word in the spelling vocabulary do not trigger the rule |

## 11. Constraints, standing rules, gotchas

- Public repository: no licensed names beyond those already in docs, **no product codes, file ids or thumbnails** in commits, issues or PR text.
- Branch + pull request; never push to `main`. The AI merges its own PR (Albert does not merge). Reviews are advisory and never block.
- Database structure only through `popcre/shared-db` (`shared-db-guard.yml` fails app PRs containing DDL). Production is reached only by shared-db's automatic promotion; no manual production SQL beyond read-only checks.
- Every merge to `main` redeploys all edge functions; schedule scored runs accordingly.
- `search_dam_documents` is `SECURITY DEFINER` with `statement_timeout 30s`; the platform ceiling for other calls is 8 seconds. Do not raise either. Cold first calls are slow — measure warm and cold (`project_prod_cold_warm_statement_ceiling`).
- Large backfills in batches of about 20,000 rows (larger crashed the database compute before).
- HNSW gotchas already paid for: keep constant tests in `WHERE` so a null vector skips the scan (comment in `semantic_ann`); a parameter instead of a literal on `document_type` caused a 3.5 s sequential scan (comment in `semantic_exact`).
- No silent downgrade: when the text leg is on and its vector is missing, the search fails with Retry (D4).
- Secrets only in 1Password vault `vibe_coding`; never in chat, commits or logs.
- Times quoted to people are New York time.
- Two Supabase MCP servers may be configured; confirm the project URL is `qsllyeztdwjgirsysgai` before trusting a result.

## 12. Access and environment

- GitHub: `gh` authenticated as `u2giants` for `u2giants/popdam3`; shared-db is `popcre/shared-db`.
- Database (read-only checks): Supabase MCP `execute_sql` against `qsllyeztdwjgirsysgai`.
- `edge-dev`: Windows PC with the GPU worker; install, service and connection details in `apps/image-embed-worker/README.md`; host notes in `docs/INFRASTRUCTURE.md` and `docs/WINDOWS_AGENT_RUNBOOK.md`. Worker database login: 1Password `vibe_coding`, item referenced in that README (role `dam_image_embed_login`).
- Text-embed service: Coolify app for `apps/text-embed`; URL and key are edge-function secrets `TEXT_EMBED_URL` / `TEXT_EMBED_KEY` (1Password `vibe_coding`; see `docs/1password.md`). Deploy path: `docs/deployment.md`.
- Tester logins for live proof and the scorecard: per-role items in 1Password `vibe_coding` (`docs/SEARCH_EVAL.md`, `scripts/search-eval/viewer-session.mjs`).
- Local: `npm install && npm run dev` for the web app; `npm test`; `deno test supabase/functions`; scorecard `node scripts/search-eval/run.mjs --raw <private file>`.

---

# Part 4 — Landing it

## 13. Definition of done, risks, open questions

**Done when all are true**

- [ ] Steps 0–8 gates met and STATUS rows cite run ids, commit SHAs or commands.
- [x] Viewer frame case passed on production on November 19. All seven verified framed results ranked first and every result matched the character. [Viewer receipt](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7005745339)
- [ ] The viewer clock case agrees with the confirmed business labels. Two current must-find results conflict with ordinary expected relevance. [Diagnosis](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7006078524)
- [x] The November 19 scorecard passed all 137 cases at p95 2.0 seconds. A changed label set or implementation needs a fresh run.
- [x] The text-lane canary opened and cleared its alert after a controlled outage and recovery. [Alarm receipt](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7008861370)
- [ ] Text lane drains unattended for a continuous 24 hours.
- [ ] Code merged, CI green, deployed commit verified, docs updated, this plan's STATUS final, handoff file deleted, #1037 closed with live proof.

**Risks and rollback**

- *Text leg makes results worse or slow:* set `SEARCH_TEXT_LEG_MODE` to `off` (no deploy). Vectors and the lane are inert when off.
- *Named-character rule hides untagged products:* measured before enabling (Step 2); the text-name fallback is the mitigation. Rollback = stop sending the filter keys (edge-function revert).
- *Wrong character tags let foreign products through:* reported to #680; not fixable here.
- *GPU memory on `edge-dev`:* Step 0 measures; lazy load/unload is the mitigation; picture-upload search must not regress.
- *Query embedding too slow on CPU:* O2 fallback, flagged to the owner first because it makes typed search depend on one PC.
- *Word-form reduction blurs names or codes:* exact forms always score higher and recognised names are exempt (Step 7).

**Open questions and how to decide them**

- O1–O4 in §8.
- Should a search naming a **property** ("aristocats frame") hide exact-word matches from other properties, as a named character does? Not ruled. Step 2 applies the property's character set to the picture and text-meaning legs only (D8). Measure the property cases in Step 1 and ask the owner only if they still fail after Step 6.
- ~~Should the lap-desk kind of match be hidden?~~ Settled Nov 17, 2026 (D7): shown, ranked lower.

## Self-audit (November 17, 2026)

1. *Could a new session execute this without asking anything?* Yes: §2 and §5 name every component and file; §9 gives each step its files, behaviour, dependencies and gate; §12 gives access. The one thing this session could not see — the exact model on `edge-dev` — is Step 0 with a stop condition, not an assumption.
2. *Does it carry all background, including what was ruled out?* Yes: measurements and root causes in §6, rejected approaches in §7 (including the earlier property-rule failure and the five floor patches), owner rulings quoted in §8.
3. *Is the goal clear enough to steer by when a step is wrong?* Yes: §1 states the outcome in the owner's terms with the "goal wins" instruction, and §13 restates it as a checkable production result.
