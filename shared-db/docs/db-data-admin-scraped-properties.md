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

## Mapping presentation

Each Creative Property displays its authoritative Submissions equivalent when
one is proven. The association preserves both source identities and its reviewed
evidence. Name similarity alone is never sufficient.

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
