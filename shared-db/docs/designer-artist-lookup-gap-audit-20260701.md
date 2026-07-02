# Designer / Artist Lookup Gap Audit — 2026-07-01

This note records the first pass for replacing free-text designer/artist values
with approved lookup tables seeded from
`designer_artist_proposed_in_place_cleanup.csv`.

## New Lookup Tables

Migration `20260701154948_core_person_role_lookups.sql` adds:

- `core.creative_designer`
- `core.technical_designer`
- `core.freelance_designer`
- `core.artist`

Seed counts from the cleanup CSV:

| Table | Distinct names |
|---|---:|
| `core.creative_designer` | 19 |
| `core.technical_designer` | 11 |
| `core.freelance_designer` | 25 |
| `core.artist` | 46 |

Rows with `corrected_value = 'N/A'` are not seeded. Those source values should
be blanked/nullified only after the consuming app paths below are updated or
confirmed safe.

## Source Meaning

`plm.style_tracker_item_bridge.designer_name` is not ERP truth. It is copied
from `public.style_tracker_rows.designer`, which is imported from the legacy
style tracker workbook/sheet data used by PopDAM Master Data.

ERP/PLM artist truth is still the PLM MG09 artist path. In local PLM code this
shows up as `merchGroup09.udf_merchgroup09_fk_id` and UI labels such as
`Artist (MG09)`.

## App Gaps

### DAM / PopDAM (`u2giants/popdam3`)

Cleanly mappable:

- `public.assets.designer_name` -> `core.creative_designer`
- `public.assets.technical_designer_name` -> `core.technical_designer`
- `public.assets.freelancer_name` -> `core.freelance_designer`
- `public.style_groups.designer_name` -> rolled up from assets; should either
  continue as display text after cleanup or eventually become derived from
  lookup IDs.
- `public.style_groups.technical_designer_name` -> same.
- `public.style_groups.freelancer_name` -> same.
- `public.style_tracker_rows.designer` -> legacy workbook-derived designer
  text; can be cleaned or overlaid, but rows marked `Artist` in the CSV should
  not remain semantically treated as designers.

Code paths found:

- `apps/worker/src/handlers/ai-tagging.ts` and
  `supabase/functions/ai-tag/index.ts` still ask AI to extract free-text
  `designer_name`, `technical_designer_name`, and `freelancer_name`, then write
  those text columns.
- `supabase/functions/_shared/tag-propagation.ts` and old migrations roll asset
  designer fields up to `style_groups`.
- `src/hooks/useStyleGroups.ts` reads the three style group text fields.
- `src/components/library/StyleGroupDetailPanel.tsx` displays those three text
  fields.
- `src/pages/StylesPage.tsx` treats the style tracker `Designer` column as a
  directly editable text field and updates `public.style_tracker_rows`, then
  refreshes the bridge.

Likely implementation work:

- Change AI tagging so it either:
  - only writes raw extracted text to a staging/review field, or
  - resolves extracted names against the lookup tables before writing.
- Add dropdown/autocomplete controls for the three DAM person fields.
- Decide whether `style_groups` should store lookup IDs, keep display text, or
  become a view derived from asset-level IDs.
- For style tracker rows marked `Artist`, add an artist-to-SKU/item relationship
  instead of treating the value as a designer.

Owner decisions:

- If a record has a value from the wrong table in the wrong field, blank the
  wrong field and put the name in the correct field/relationship. For example,
  if a designer field contains an artist, do not leave that name in the designer
  field; attach it as artist data instead.
- `core.artist` is the future shared artist source for app dropdowns and
  attribution. ERP MG09 should not be treated as the future app source of truth.

### PLM (`C:\repos\dflow plm`)

Cleanly mappable:

- Existing PLM artist behavior already uses ERP MG09. Found code:
  - `designflow-tracking/models/lic.model.js` maps `artist` to
    `merchGroup09.udf_merchgroup09_fk_id`.
  - `designflow-frontend/src/app/pages/itemLibrary/newItem-dialog/*` exposes
    Artist with tooltip `MG09`.
  - `designflow-frontend/src/app/pages/itemDetail/itemDetail.component.html`
    shows Artist as `MG09`.
  - `designflow-item-master/services/art_piece.service.js` maps art piece
    artist through `merchGroup`.

Likely implementation work:

- Do not rewrite ERP-fed PLM artist/master tables.
- If shared Supabase needs SKU-to-artist attribution from cleanup rows, add a
  separate shared overlay table keyed by SKU/item, not a write into ERP-derived
  PLM tables.
- If `core.artist` is intended to become the shared app dropdown, decide whether
  it should be seeded only from cleanup CSV or reconciled with ERP MG09.

Owner decisions:

- `core.artist` is an app-owned approved artist list, not a mirror of ERP MG09.
- Art attribution should attach to `plm.art_piece`. One art piece can be linked
  to multiple SKUs/styles/items through the `plm.art_piece_item` junction table.
  DAM should read art-piece metadata through the shared schema/API view instead
  of creating a separate DAM-owned art-piece table.

### PM / PIM (`u2giants/poppim-web`)

Runtime code scan found no current direct dependency on:

- `designer_name`
- `technical_designer_name`
- `freelancer_name`
- `style_tracker_rows`
- `style_tracker_item_bridge`

Docs mention creative and technical designer concepts for future workflow.

Likely implementation work:

- When PM adds assignment/dropdown fields, use the new `core.*` lookup tables
  rather than introducing free-text person fields.

Question:

- Should PM products eventually link to `core.creative_designer` and
  `core.technical_designer`, or should assignments be modeled through app users
  (`app.profile`) when the person is internal?

### CRM (`u2giants/popcrm-web`)

Runtime code scan found no current direct dependency on these designer/artist
fields. The matches were generated types/docs and the app role named
`designer`, which is unrelated to product designer lookup values.

Likely implementation work:

- None for the initial lookup migration.

### Directus (`u2giants/directus`)

No direct runtime code dependency on the new lookup values was found in the
inspection copy. Directus docs discuss designer roles and product workflow, but
not these new tables.

Likely implementation work:

- None unless Directus is still used as an admin UI for the old fields.

## Safe Cleanup Order

1. Add and seed the four lookup tables.
2. Add `plm.art_piece.artist_id` and `plm.art_piece_item` so artists attach to
   art pieces and art pieces can link to many SKUs/styles/items.
3. Add app read paths/dropdowns.
4. Clean editable DAM text fields in place using the approved CSV mapping.
5. Treat PLM/import/workbook-derived tables as raw history unless an explicit
   owner decision says otherwise.
