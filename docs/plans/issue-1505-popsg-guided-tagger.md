---
summary: Plan for issue 1505 — PopSG picture tagger guided by the shared catalog (folder → licensor/property → characters), wipe of all vision_ai tags, full re-tag, and search no-regression proof.
kind: plan
status: active
read-when: Working on ai-tag-popsg, PopSG vision tags, or catalog-guided tagging.
---

# Issue 1505 — catalog-guided PopSG picture tagger

Handoff: [HANDOFF.d/2026-11-27T2110Z-edge-dev3-claude-popsg-guided-tagger.md](../../HANDOFF.d/2026-11-27T2110Z-edge-dev3-claude-popsg-guided-tagger.md)
Issue: https://github.com/u2giants/popdam3/issues/1505

## STATUS (update on every change)

| Step | State | Evidence |
|---|---|---|
| 0. Pause old run | ✅ done 2026-11-27 4:05 PM EST | `admin_config.BULK_OPERATIONS` → `ai-tag-popsg.status = paused` (re-check with the step 0 query) |
| 1. Licensor map row | ✅ 2026-11-27 | `admin_config.POPSG_LICENSOR_CATALOG_MAP` (25 folder keys; query `select jsonb_object_keys(value) from admin_config where key='POPSG_LICENSOR_CATALOG_MAP'`) |
| 2. Catalog guide module + tests | ✅ 2026-11-27 | `apps/worker/src/handlers/popsg-catalog-guide.test.ts` (commit ab8e976a9) |
| 3. Guided prompt + save (vision-v2) | ✅ 2026-11-27 | `apps/worker/src/handlers/popsg-ai-tag.test.ts` (commit ab8e976a9) |
| 4. PR merged, worker deployed | ✅ 2026-11-27 4:10 PM EST | merge ab8e976a9; Railway deployment 03328571 SUCCESS |
| 5. Backup + wipe vision_ai | ⬜ open | |
| 6. Sample run + quality check | ⬜ open | |
| 7. Full re-tag | ⬜ open | |
| 8. Search test set, no PopSG regression | ⬜ open | |
| 9. Phase 2: scraped file-name candidates (shared-db) | ⬜ open | |

A fresh session starts at the first ⬜ row.

## 1. Ultimate goal

PopSG search must return the right style-guide files when someone searches a
character or property name. Picture tags may add names to a file only when our
own catalog says that name belongs to that file's licensor or property; the
model confirms or chooses among those candidates and never invents names. All
older picture tags (which were guessed freely and are partly wrong) are wiped
and redone. **If a step conflicts with this goal, the goal wins — stop and flag it on the issue.**

## 2. What this application is

PopDAM / PopSG (repo `u2giants/popdam3`, public; default branch `main`, protected).
PopSG is the style-guide library mode of the same web app. Files live on a NAS;
rows are in `public.style_guide_files` of the shared Supabase project
`qsllyeztdwjgirsysgai` (structure owned by `popcre/shared-db`). The Railway
cloud worker (`apps/worker/`) runs bulk operations; it auto-deploys when
`apps/worker/**` changes on `main`. Picture tagging is the `ai-tag-popsg`
operation: `apps/worker/src/handlers/popsg-ai-tag.ts`.

## 3. What triggered this work

On 2026-11-26 the `ai-tag-popsg` run saved ~155k licensor/property/character
names guessed from pictures as `vision_ai` tags. They feed the PopSG keyword
search (`tag_names` → `search_vector`), so name searches matched unrelated
files; the Search test set dropped below 65/65 (issue 1430). Owner ruling,
2026-11-27 (Albert's words): "if they might be wrong, just wipe them out and
redo the correctly from scratch. and tagging should be done with our data
'guiding' it." 

## 4. Scope

In: catalog guide for PopSG files; guided prompt and save rules; new rule
version `vision-v2`; recoverable wipe of every `vision_ai` link; full re-tag;
sample quality check; Search test set proof; Phase 2 file-name candidates.

NOT in this plan: changing how the search vector weighs tags (that is the 1430
session's call); PopDAM (`assets`) tagging; new models or paid providers;
editing `core.*` catalog contents; UI changes.

## 5. Current state of the code (2026-11-27)

- `popsg-ai-tag.ts` `tagPopSGFile` builds the shared PopDAM prompt with
  `licensor_id: null, property_id: null`, so the model gets **no** character
  catalog, and calls `callTagAssetModel(..., [])` (empty binding). Names come
  only from free-text `asset_tags`.
- `popsgVisionTags` marks exact licensed names `suggested`; partial names
  ("<name> logo") stay `accepted`. `demoteLicensedNameTags` walks old links.
- The PopDAM tagger already supports a bound character catalog:
  `buildImageTaggingPrompt` (`ai-tagging-shared.ts` ~441–530) lists
  characters with ids, `onCharacterCatalog` returns the ids, and
  `tagAssetSchemaForCharacters` / `validateTagCharacterBinding` force
  `character_ids` to that list. Reuse this; do not build a second mechanism.
- Data (read-only checks 2026-11-27): 223,275 active PopSG files (221,034 with
  thumbnails); 391 (licensor folder, property folder) pairs; vision links
  751,927 accepted + 155,213 suggested; vision state 62,696 completed + 2,968
  failed (`vision-v1`). Old run paced ~2.7k files/hour at concurrency 48.
- Catalog: `core.licensor` 39, `core.property` 855, `core.character` 15k,
  `core.property_character_associations` 16k current links,
  `core.property_character_source_edge` (co-occurrence). The cross-licensor
  views `core.property_style_guide_current` and `core.style_guide_character_current`
  are **empty**. `plm.asset_file_style_guide_index` maps scraped asset file
  names → style guide per source system (uses `file_name_norm`, which the
  read-only role cannot execute).

## 6. Key findings

- PopSG licensor folder names differ from `core.licensor` names (abbreviations,
  brand vs company, one folder mapping to several core licensors). Exact
  folder → property name match covers only ~10% of files; trigram similarity
  alone gives confident wrong matches across licensors. So: map licensor folder
  → core licensor ids explicitly (small data row), then match property folder
  **within those licensors only**.
- Generic folders (holiday, packaging, multi-property, year folders) have no
  single property; they fall back to the licensor's whole character list only
  when that list is small (existing rule `LICENSOR_CHARACTER_LIST_LIMIT` = 400),
  else no characters.

## 7. Rejected approaches

- Keep guessed names as `suggested` (1430 repairs 1470–1476): owner ruled wipe and redo.
- Global name filter on free text only (1465): misses partial names and names
  absent from core; still lets the model invent names.
- Trigram similarity across all licensors: wrong cross-licensor matches.
- Hard-coded licensor alias table in code: repo is public; licensed names must
  not be in public files. The map lives in `admin_config` (private DB).

## 8. Design decisions

Locked (2026-11-27): candidates come only from the catalog; names outside the
candidate list are dropped; descriptive tags stay; rule version `vision-v2`;
licensor folder map in `admin_config.POPSG_LICENSOR_CATALOG_MAP`
(`{"<folder licensor name lowercased>": ["<core licensor uuid>", ...]}`);
property match inside mapped licensors only; character names saved as facet
`character`, `accepted`; wipe exported first.
Open: Phase 2 RPC shape (step 9).

## 9. Steps

**Step 1 — licensor map (lead-only: business mapping judgment).** Write
`admin_config` row `POPSG_LICENSOR_CATALOG_MAP` for every distinct
`style_guide_files.licensor_name`; unmapped folders get `[]`. Gate: a query
listing licensor folders with no key returns 0 rows.

**Step 2 — `apps/worker/src/handlers/popsg-catalog-guide.ts` (lead-only).**
Pure function `resolvePopSGGuide(file, catalog)` → `{licensorIds, propertyIds,
characters:[{id,name}]}` plus a cached loader (1 h) of licensors, properties
(name, short_name, nickname, submission_property_name), current
property→character links and co-occurrence edges. Matching: normalize
(lowercase, `&`→and, drop bracketed text, non-alphanumerics → space, drop
leading "the"); try `style_guide_folder` then `property_folder`; exact
normalized name = best; else every token of the folder (≥3 chars, not numeric,
not a generic word) appears in the property name. Keep the best-scoring tier.
Characters = union of the properties' characters; if >400, keep exact-tier
properties only; if still >400 → none. No property → licensor characters if
≤400. Gate: `popsg-catalog-guide.test.ts` passes.

**Step 3 — guided prompt and save (lead-only).** `buildImageTaggingPrompt`
gains `options.characters` that replaces the scope lookup. `tagPopSGFile`
passes the guide's characters and binds `callTagAssetModel` to their ids. New
`saveTags`: character names from `character_ids` (facet `character`,
accepted); any `asset_tags` text containing a licensed name (word boundary)
not in the file's candidate names/its property or licensor names is dropped;
rule `vision-v2`. Handler: a file is done only when its state is `completed`
with `vision-v2`. Remove `demoteLicensedNameTags` call (wipe replaces it).
Gate: `popsg-ai-tag.test.ts` cases below pass; `npm test` in `apps/worker`.

**Step 4 — PR, merge, deploy (lead-only).** Gate: Railway worker deployment
shows the merge SHA.

**Step 5 — backup and wipe (lead-only: destructive).** Export all
`style_guide_file_tags` rows with `source='vision_ai'` to a private local file
(`~/backups/popdam3-1505/vision_ai_links.jsonl.gz`, outside any repo), count
rows, then delete in id batches of 20k; reset `vision` tagging state to
pending by deleting `pipeline='vision'` state rows. Gate: vision link count 0;
backup line count equals pre-count.

**Step 6 — sample (lead-only: live judgment).** New run id, `concurrency` 8,
let ~300 files tag, pause. Check 50 random files with character tags: each
name belongs to the folder's property (catalog) and is visible. Gate: ≥90%
correct, 0 names from another licensor.

**Step 7 — full re-tag.** Concurrency 48, run to `done`. Gate: `vision-v2`
completed ≈ files with thumbnails (failures retried by next pass).

**Step 8 — Search test set.** Run the "Search test set" workflow; PopSG must be
no lower than the 1430 session's baseline (target 65/65). Gate: workflow run id.

**Step 9 — Phase 2 (lead-only, shared-db, claim first).** Shared-db function
returning, for given PopSG file ids, character ids linked (in per-licensor
scrape tables) to scraped assets whose normalized file name equals the PopSG
file's. Add those to candidates. Load `shared-db-change`, claim on a
popcre/shared-db issue.

## 10. Tests

`popsg-catalog-guide.test.ts`: exact match; containment match; bracket and
`&` normalization; generic folder → licensor fallback; licensor list >400 → no
characters; unmapped licensor → empty; never matches a property of an unmapped
licensor. `popsg-ai-tag.test.ts`: off-list licensed name in free text dropped;
partial name ("<name> logo") off-list dropped; on-list character saved
accepted with facet `character`; `vision-v1` completed file is re-tagged.
Whole suite: `cd apps/worker && npm test`.

## 11. Constraints and gotchas

No licensed names/SKUs in this public repo, PRs or issues (tests use made-up
names). No DDL here; structure via `popcre/shared-db`. Wipe/export is app data
(allowed) but destructive: export first. Search records refresh from a queue;
expect lag. The worker runs one operation at a time; `ai-tag-parallel` blocks it.
Times quoted in EST.

## 12. Access

Supabase Management API token: 1Password `vibe_coding` → "Supabase CLI Personal
Access Token" (read via `op_run`, never print). `gh` as `u2giants`. Railway MCP for deploy checks.

## 13. Done and risks

Done = steps 1–9 ✅ with evidence, issue checklist ticked, PR merged and
deployed SHA verified, docs/POPSG.md updated. Risk: fewer names → some name
searches lose recall from pictures (folder tags still cover them). Rollback:
re-insert from the backup file.

## Self-audit

1. Fresh session executable? Yes — goal §1, state §5, steps with gates §9, access §12.
2. Background and rejected paths carried? Yes — §3, §6, §7.
3. Goal clear for judgment calls? Yes — §1 plus locked decisions §8.

## Lead launch prompt

```
Read docs/plans/issue-1505-popsg-guided-tagger.md (STATUS first) and AGENTS.md.
Do every lead-only step yourself. Your helper is your own tool's smaller model —
Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX,
Mimo Flash for Mimo Pro. Never a full-strength model. Rules:
https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
Helpers return finished work or an evidenced blocker, make no design decisions,
never merge or post, and are taken back after 30 minutes stuck. Verify each gate
yourself and update STATUS with evidence.
```
