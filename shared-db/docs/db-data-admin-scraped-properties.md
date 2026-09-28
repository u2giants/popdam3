# DB Data Admin Scraped Properties

## Purpose

The Scraped Properties page at `https://data.designflow.app` is the
Licensing-manager view of source-declared Property vocabularies. It preserves
source identities and provenance; it does not make source rows canonical or
expose raw licensed payloads.

Every section heading identifies one Licensor and one business purpose:

- `<Licensor> - Submissions`
- `<Licensor> - Creative`

Portal names may follow in parentheses. Landing-table names, folders, brands,
and Property-like internal labels never create additional Licensors.

## Canonical licensor grouping (#2905, #3539)

`api.db_data_admin_scraped_source_inventory` returns `licensor_group_key` and
`licensor_group_name` on every row of the Property, Character and Style Guide
inventories. The page groups by that key, never by splitting label text, so each
licensor shows exactly one Creative and one Submissions section. Disney, Marvel,
Lucasfilm / Star Wars and 20th Century are separate groups. DCP Vault rows
group by their source system; Marvel OPA rows and Marvel ASGARD rows group under
Marvel. A DCP Vault authority or mapping conflict stays visible in its row
status or mapping state without changing the source-system licensor group.

Pixar is part of Disney and is not its own licensor (#3539). Rows whose
`licensor_key` is `pixar` or `pixar-opa` group under Disney; section labels say
Disney, with Pixar kept in parentheses as the portal/brand. The existing
`licensor_key` and `row_key` are unchanged, so paging cursors stay stable.

DCP Vault licensor comes from the source system (#3539, superseding the #2905
unresolved-authority rule). Rows with `source_system` `disney_dcpvault` group to
Disney, `marvel_dcpvault` to Marvel, `lucasfilm_dcpvault` to Lucasfilm / Star
Wars, and `twentieth_century_dcpvault` to 20th Century, regardless of mapping
authority status. Authority and mapping conflicts may still appear as row status or mapping state, but they never move a
row into the unresolved group.

Rows whose licensor is genuinely undetermined and is not covered by source-system
DCP Vault grouping go into one trailing group, key `unresolved`, named "Licensor
not yet determined": OPA scope conflict or unresolved scope outside those source
systems. They are never dropped and never assigned to Disney.

NBCUniversal Property rows whose `source_kind` is `property` or
`franchise_asset` come from the Product Submissions picker and are Submissions;
`asset_metadata_label` rows are Creative. NBCU Character and Style Guide rows
come from Creative asset pages only and stay Creative.

Warner Bros. `plm.wb_property` rows with `source_namespace`
`warner_product_catalogue` (STARLABS Product catalogue) are Submissions, labelled
`Warner Bros. - Submissions (STARLABS Product catalogue)`; `warner_art_assets`
rows stay Creative (#3104). Their `licensor_key`, `source_id` and `row_key` are
unchanged.

## Mapping presentation

Each Creative Property displays its authoritative Submissions equivalent when
one is proven. The association preserves both source identities and its reviewed
evidence. Name similarity alone is never sufficient.

Since #3104 every Property row also carries the mapped value itself. A Creative
row returns `submissions`: the Submissions members of its winning mapped
decision, each as `source_system`, `source_table`, `source_id` and
`display_label` (empty unless `mapping_state` is `mapped`). A Submissions row
returns `mapped_creative`: the Creative rows whose winning mapped decision names
it, in the same shape. Conflicted decisions contribute nothing. The frontend
renders these labels in the Mapping column instead of "Mapped" or a dash.

An unmapped Creative Property remains visible and its full row is highlighted
red. Conflict and unmapped states are explicit; rows are never guessed,
silently dropped, or presented as matched.

Contract Property evidence is a separate privacy-protected source. It may show
whether reviewed contract evidence exists and whether its document chain is
complete, but never exposes contract text, financial terms, or private evidence
locators to the browser.

## Production state - 2026-08-30

The complete source-purpose presentation, privacy-safe Creative-to-Submissions
mapping status, contract status, and red-row frontend are live in production.
The completed work is recorded by shared-db issues #1669, #1676, #1713, and
#1872, plus frontend PR #1874. Production deployment run 33345235373 verified
the current main build through external HTTPS, health, and build-SHA checks.

Future source landings must be compared with `api.source_capture_inventory` and
added deliberately to this page. Adding landing tables does not automatically
add a section. Private capture manifests remain authoritative where source
evidence has not yet been loaded.

## Change boundaries

Changing database tables, mapping contracts, or the API response is structural
shared-db work. Changing row styling or other frontend-only presentation is
ordinary application work in `apps/db-data-admin`. Licensed mapping rows and
contract evidence remain in the private source-data workflow.
