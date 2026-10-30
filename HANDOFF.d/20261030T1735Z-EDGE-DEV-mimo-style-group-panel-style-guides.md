# PopDAM style-group panel — show licensor-scrape style guides

**Session:** MiMo chat `ses_ffe5e75175c08ffeTCI4DzDWj7` on EDGE-DEV
**Left:** 2026-10-30 ~17:35 UTC (1:35 PM EDT)
**Branch started:** `mimo/style-guide-sources` (worktree `C:\repos\popdam3-worktrees\style-guide-sources`) — **no commits, no code changes yet**
**Companion shared-db handoff (authoritative, read it first):**
https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261030T1730Z-EDGE-DEV-mimo-sku-style-guide-links-closeout.md
**Shared-db issue:** https://github.com/popcre/shared-db/issues/5092

## 1. What this is

Albert's request: *use Indra to scan all the licensed style PDFs in PopDAM to extract
the file names used to create the art, attach those file names to the item (style group,
not individual file) in the database, then use the licensor scrape data to cross-reference
the file name and find the style guide attached to that item, and store the style guide(s)
associated with that style in the database.*

The scan and the database half are done (see the shared-db handoff). **This file is the
PopDAM half: showing the result in the style-group flyout panel.**

## 2. Current behaviour of the panel

`src/components/library/StyleGroupDetailPanel.tsx` (~line 126) has a "Style Guide
Sources" section. It queries `public.sku_files_used` by `group.sku` and renders:

- `row.file_name` — the source art file name extracted from the item's licensing sheet /
  tech pack. **Accurate; keep it.**
- `row.style_guide_files.filename` + `licensor_name` / `property_folder` — shown when
  `style_guide_file_id` is set. **This is a fuzzy-matched document from the PopSG NAS
  crawl** (trigram similarity ≥ 0.6, `resolve_sku_files_used_fuzzy`), presented as if it
  were the item's style guide. **This is the part to replace.**

It is gated on `group.sku && group.is_licensed`. Today only ~1,811 of 9,450 licensed
groups have any `sku_files_used` rows at all, so most panels show nothing.

## 3. What to change

1. Read `public.sku_style_guide_links` for the style guide(s) instead of (or in addition
   to) `sku_files_used.style_guide_file_id`. Columns worth showing:
   `style_guide_label`, `source_system`, `match_method`, `match_confidence`,
   `matched_asset_count`, `file_name`.
2. Keep the file-name list — it is verbatim from the licensing sheet.
3. Label the source honestly. `match_method` distinguishes:
   - `filename_exact` / `filename_normalized` — the licensor portal asserts this file
     belongs to that style guide
   - `sheet_declared` — the sheet's own `CORE/STYLE GUIDE USED:` line, verbatim
   - `sheet_label_match` — that declared line matched to a portal guide label
   A row with `matched_asset_count > 1` is ambiguous; show it as such rather than
   confident.
4. Drop or demote the fuzzy PopSG document pointer. It answers a different question
   ("which document in our library resembles this name?") and is not a licensor
   statement. Do **not** delete the underlying `sku_files_used.style_guide_file_id`
   values — quarantine model, never auto-unlink.

## 4. Blocked on

The shared-db migration `20261030043848` reaching production. It is **merged**
(PR https://github.com/popcre/shared-db/pull/5098) but was **not applied** as of
2026-10-30T17:20Z. Until it lands, `public.sku_style_guide_links` does not exist and
there is nothing to display. Verify first:

```sql
select count(*) from information_schema.tables
 where table_schema = 'public' and table_name = 'sku_style_guide_links';
```

Then the data has to be populated (`backfill_pdf_files_used_v2()` +
`resolve_sku_style_guide_links()`) before the panel has anything to show.

## 5. What was tried that did NOT work

Nothing on the PopDAM side — no code was written. The dead ends were all in shared-db
and are listed in the companion handoff §7; the one that matters here is that the
fuzzy PopSG match is **not** a style-guide answer and must not be presented as one.

## 6. Delivery

Normal popdam3 route: feature branch → PR to protected `main` → review → merge →
`publish-frontend.yml` → GHCR → Coolify. Verify against `dam.designflow.app` by opening
a licensed style group's flyout and confirming both the file names and the
licensor-scrape style guides appear.

---
Posted by MiMo chat ses_ffe5e75175c08ffeTCI4DzDWj7 on EDGE-DEV
