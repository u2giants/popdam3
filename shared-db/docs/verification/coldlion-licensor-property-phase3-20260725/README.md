# ColdLion Licensor/Property Phase 3 — reconciliation and decisions

**Environment:** preview `rjyboqwcdzcocqgmsyel` only · **Date:** 2026-07-25 (UTC evidence `2026-07-26T02:06:51Z`)
**Mode:** read-only reconciliation — no canonical, source-reference, mirror-link, status, name, parent, or schedule mutation
**Production:** not connected or modified · **DesignFlow:** enabled (fresh read-only snapshot obtained) · **Schedule:** none (0 matching jobs)

This folder is the Phase 3 deliverable for
[`fix_coldlion_licensor_property_cutover.md`](../../../fix_coldlion_licensor_property_cutover.md) §15.3:
a row-level ruling ledger for every ColdLion source row and every canonical Licensor/Property row,
typed dispositions and named human owners for every non-automatic decision, parent-edge evidence,
and the **exact frozen + hashed Phase 4 approved-mapping input**. Phase 3 does **not** link or create
any canonical record (Phase 4 and Phase 5 only).

> **Headline ruling:** ledger coverage is **100%** (570 rows), there are **zero ambiguous automatic
> matches**, and every non-automatic decision has a **named human owner** (all pending). Because no
> human approval was recorded, the frozen **approved** mapping input is **empty** (hashed) and
> **Phase 4 is BLOCKED** until a human approves the proposed mapping set and dispositions.

## 1. Entry gate — fresh trustworthy DesignFlow comparison snapshot

The Phase 3 entry contract requires a trustworthy DesignFlow baseline. The last recorded preview
DesignFlow `ingest.sync_run` success was 2026-07-08 (stale). A **fresh read-only** DesignFlow
comparison snapshot was obtained on 2026-07-25 (UTC `2026-07-26T02:06:51Z`) by calling
`GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties` and captured by
`tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs` (read-only HTTP GET; no Supabase
read or write) into `designflow-fresh-snapshot.json` + `designflow-fresh-edges.json`.

| Evidence | Fresh result |
|---|---|
| HTTP status / elapsed | **200** / 18,727 ms (DesignFlow healthy) |
| Licensor rows / distinct codes | 37 / **20** |
| Property rows / distinct codes | 468 / **256** |
| Parent edges returned | 468 (division-duplicated → 256 distinct property codes) |
| Edge hash | `151bc8cedc988f9ad3ddc5eba6036275` |

This is the dated comparison evidence the delegation references (37 licensors / 468 nested
properties, matching the previously recorded DesignFlow staging shape). The distinct property-code
count (256) equals the canonical property count exactly, so the snapshot is internally consistent.

> **Title-field note.** The live API exposes each licensor/property name
> as **`title`**, but the snapshot tool that produced this file read `mg_desc`/`name` (absent in the
> payload), so **every emitted name is blank** and the `edge_hash` above is a hash over blank names.
> The tool is now fixed to read `title` first (`pickTitle`) and reports name completeness
> (`titles_complete`, blank counts). The **counts (37/468/256) and the parent-edge comparison
> (256/256) are unaffected** — they depend on codes, not names — but the names and `edge_hash` must
> be refreshed by regenerating the snapshot with the fixed tool (§7). This correction run had no
> secret access, so it could not regenerate; a precise command is in §7 and in
> `.ai/reviews/glm-phase3.md`.

> **Phase 6 clock:** this fresh pull is a one-off read-only API GET, **not** a scheduled preview
> refresh recorded in `ingest.sync_run` (whose latest `designflow_plm` success is still 2026-07-08).
> It satisfies the Phase 3 *entry* gate. The Phase 6 14-day parallel-run clock has **not** started.

## 2. Parent-edge evidence (DesignFlow vs canonical)

Every one of the 256 canonical property parent edges was compared against the fresh DesignFlow
edges, collapsed by property code (`parent-comparison.json`, recomputed locally by the generator
from `parent-edges.csv` + `designflow-fresh-edges.json`):

- **agreed: 256 · disagreed: 0** (every canonical property's licensor is among DesignFlow's licensors
  for that property).
- DesignFlow distinct property codes = 256 = canonical property count (no DesignFlow-only or
  canonical-only property on the DesignFlow side).
- ColdLion carries no parent edges; DesignFlow is the only comparison source for them and confirms
  all canonical parent edges unchanged. `parent-edges.csv` lists all 256 canonical edges with both
  UUIDs, codes, names, and statuses.

## 3. Canonical / source-reference immutability

Phase 3 writes nothing (hard boundary), so the **Phase 2B baseline hashes are authoritative** and are
carried forward unchanged in `coverage-summary.json` → `phase2_baseline_carried_forward`. A one-off
**read-only preview re-measurement** is recorded in `immutability.json` (captured `2026-07-26T01:25:52Z`,
target `rjyboqwcdzcocqgmsyel`, **pass: true**) and corroborates all 14 baseline checks unchanged:

| Check | Phase 2B baseline | Captured measurement |
|---|---|---|
| Licensor / Property UUID hash | `590ea83ea6df1487fcfc1e18b3ef6a0d` / `e0e6c36eb02bb2d320c0deaff7aa8f8c` | identical ✓ |
| Canonical status hash | `5960fa4c08b5da2d0880c138e3e32ef7` | identical ✓ |
| Property parent-edge hash / null parents | `7459f6826cc59468779e7ead33ec0edc` / 0 | identical ✓ |
| Source-reference count / hash | 505 / `5f7221c29bca6e755c448200da1a88c5` | identical ✓ |
| ColdLion source references | 0 | 0 ✓ |
| Mirror licensor / property key hash | `7170df28…` / `a0267038…` | identical ✓ |
| ColdLion snapshot hash | `a69332e05d9064723ffa1dfbd870506c` | identical ✓ |
| Mirror canonical links (lic/prop) / schedules | 0 / 0 / 0 | 0 / 0 / 0 ✓ |

Mirror rows remain 44 Licensor + 516 Property. `immutability.json` is captured evidence, not
regenerated by the local generator; reproduce it only with preview credentials via the read-only
query documented in §7.

## 4. Row-level ruling ledger (100% coverage)

Generator: `tools/generate-coldlion-licensor-property-phase3-report.mjs` — **deterministic and local**
(reads the frozen Phase 2B CSVs + the DesignFlow snapshot; no database connection, no credentials).
It carries each Phase 2 category into a Phase 3 typed disposition + decision status + Phase 4 action +
named owner. Output:

- `ruling-ledger-licensors.csv` — 44 ColdLion source licensors + 6 canonical-only licensors = **50 rows**
- `ruling-ledger-properties.csv` — 516 ColdLion source properties + 4 canonical-only properties = **520 rows**
- **Total: 570 ledger rows covering all 560 ColdLion source rows and all 282 canonical UUIDs**
  (272 distinct matched via source + 10 canonical-only).
- `dispositions.csv` — the **28 non-automatic** rows with full disposition / owner / decision / blocks.
- `review-findings.csv` — the 30 conservative database conflict findings (all `property/source/conflict`).

Category and disposition totals (`coverage-summary.json`):

| Phase 2 category | Rows | → Phase 3 disposition | decision_status | Phase 4 action | Owner |
|---|---:|---|---|---|---|
| exact compatible code match | 542 | `auto_link_eligible` | auto_eligible | link_if_set_approved | automatic |
| exact normalized-name match (NASA) | 2 | `nasa_name_only_pending` | pending_human | link_only_after_approval | Albert Hazan |
| entity-type collision (FRIDA KAHLO licensor) | 2 | `frida_kahlo_cross_entity_quarantine` | pending_human | no_link | Albert Hazan |
| ColdLion-only licensor (ZAG) | 2 | `zag_coldlion_only_lapsed` | pending_human | no_link | Albert Hazan |
| ColdLion-only property | 12 | `coldlion_only_new_candidate` | pending_human | create_phase5_if_approved | Albert Hazan |
| canonical-only licensor FR (FRIENDS TV) | 1 | `friends_tv_curated_only` | pending_human | no_link | Albert Hazan |
| canonical-only (5 `X-` licensors + 4 properties) | 9 | `canonical_only_preserve` | pending_human | no_link | Albert Hazan |

**Zero unexplained ambiguity** — there are no `code collision`, `name collision`, or unclassified rows,
and `status_differences.csv` is empty (0 status differences). No automatic match ever crosses entity
types: the only true unmatched collisions are the two FRIDA KAHLO *licensor* rows; all 30 conservative
database findings for 15 cross-entity codes reduce to same-entity exact matches except `FK`-as-licensor.

## 5. Named-case dispositions (typed)

- **NASA** (`NA` licensor, CW001 + SP001): ColdLion `NA` matches canonical **`X-NASA`** (active) by
  *unique normalized name* — one same-entity candidate, no type conflict, but the **code differs**, so it
  is an **alias/rename candidate**, not an exact compatible match. **Disposition:** link to `X-NASA` and
  **preserve canonical code `X-NASA`** (no rename; field-ownership §5.2 = report drift, not overwrite).
  Lapsed-license-aware: linking never changes its status. **Owner: Albert Hazan** — Phase 4 link gated
  on approval.
- **ZAG** (`ZG` licensor, CW001 + SP001): ColdLion-only, known lapsed license, no canonical candidate.
  **Disposition:** mirror faithfully; no link; no create/activate. **Owner: Albert Hazan** (Phase 5 create
  decision).
- **FRIDA KAHLO** (`FK`): appears as a ColdLion **licensor** (`mgTypeCode` 05) with **no same-entity
  canonical licensor**; the canonical `FK` is a **property** (different entity). **Disposition:**
  quarantine the licensor; **never match across entity types by code**. The ColdLion **property** `FK`
  (mgTypeCode 06) is a separate, correct auto-eligible match to canonical property `FK`. **Owner: Albert
  Hazan** (Phase 5 decision on whether a FRIDA KAHLO *licensor* is ever needed — recommended no).
- **FRIENDS TV / `FR`**: canonical **licensor** `FR` = FRIENDS TV (active) has no ColdLion licensor;
  ColdLion `FR` is the **property** "1ST ORDER TROOPER". **Disposition:** the ColdLion property `FR`
  auto-matches canonical **property** `FR` (1ST ORDER TROOPER) and is **never** cross-linked to the
  FRIENDS TV licensor; FRIENDS TV is preserved curated/DesignFlow-only (cutover §8.2 option 1, the
  recommended default). **Owner: Albert Hazan** (final option 1/2/3 decision).
- **`X-` licensors** (`X-NASA`, `X-NCAA`, `X-FORD`, `X-MILLERCOORS`, `X-NFL`, `X-ANHEUSERBUSCH`):
  provenance-free PopSG manual backfill, `potential` status, no ColdLion source. **Disposition:** preserve
  UUID/status; absence never deletes/inactivates. **Owner: Albert Hazan** (review).
- **canonical-only properties** (`ADT` Adventure Time, `OGW` Over the Garden Wall, `RS` Regular Show,
  `SFS` Smiling Friends): curated/legacy, no ColdLion source. **Disposition:** preserve. **Owner: Albert
  Hazan** (review).
- **ColdLion-only properties** (`55` Shrek 5, `75` Peanuts 75th, `CHR` Cheers, `EX` The Exorcist, `LB`
  The Lost Boys, `SGT` Supergirl Theatrical 2026 — each in CW001 + SP001): no canonical candidate and also
  absent from the 2026-07-25 DesignFlow snapshot. **Disposition:** Phase 5 may create **only if Albert
  approves AND an approved `licensor_id` parent is assigned first** (`core.property.licensor_id` is NOT
  NULL). **Owner: Albert Hazan** (create + parent decision).
- **30 conservative DB conflict findings**: all `property/source/conflict` rows for 15 codes reused
  across entity types in both divisions (`1P, CB, CC, DC, DY, FK, HP, MV, PN, PP, SE, SM, SS, SW, WW`).
  Phase 2B already proved most have an exact same-entity canonical match (auto-eligible). The only code
  with **no** same-entity candidate is `FK` (FRIDA KAHLO licensor), quarantined above. These findings are
  evidence only; Phase 3 has not resolved or auto-linked them through the review table.

## 6. Frozen + hashed Phase 4 approved-mapping input

`phase4-approved-mapping.json` freezes **exactly what is approved** for Phase 4 `link_approved`:

- **Approved mappings: `[]` (empty).** Phase 3 recorded **no human approval** — every non-automatic row
  is `pending_human`, and the 542 exact-compatible matches are **proposed** (`auto_eligible`), not
  approved. `approved_by: null`, `approved_at_utc: null`,
  **`approved_mapping_hash: d41d8cd98f00b204e9800998ecf8427e`** (md5 of the empty set). `phase4_ruling:
  BLOCKED`.
- **Proposed auto mappings: 542 source rows → 271 distinct canonical UUIDs** (`phase4-proposed-auto-mapping.csv`,
  status `proposed_pending_human_approval`, hash **`1230f5a12d0f2a3029f1d3df17fc5b5f`**). This is the
  deterministic set a human can approve in one act to populate the approved input; Phase 4 would then add
  the ColdLion source ref (`source_id` = `<companyCode>/<divisionCode>/<mgTypeCode>/<mgCode>`, §4.3) and
  the mirror→canonical link, changing no code/name/status/parent.
- **Pending link mappings: 2 NASA rows → `X-NASA`** (`phase4-pending-link-mapping.csv`, status
  `pending_human_approval`, owner Albert Hazan, hash **`2edf77b7ddd8d0405f93d020003b9540`**).
- **Not linked (26):** 2 FRIDA KAHLO licensor, 2 ZAG, 12 ColdLion-only properties, 10 canonical-only
  UUIDs (listed in `phase4-approved-mapping.json` → `not_linked` with owners).

The two non-empty hashes (`1230f5a1…` proposed, `2edf77b7…` pending) are identical to the values an
independent preview-DB-connected pass produced, cross-checking that the frozen Phase 2 CSVs faithfully
represent live preview.

**Phase 4 readiness: BLOCKED.** Phase 4 may not start until (a) a human approves the proposed
auto-mapping set (populating the approved input) and (b) the 28 pending rows are dispositioned. When it
runs, Phase 4 must link only approved rows, preserve every §3 hash, and add ColdLion source refs
**beside** (not replacing) the 505 existing DesignFlow refs.

## 7. Reproducible verification commands

The ledger, dispositions, mapping hashes, parent comparison, and coverage summary are **fully
reproducible locally** with no credentials and no database:

```text
# regenerate all Phase 3 artifacts deterministically from the frozen Phase 2 CSVs + DesignFlow snapshot
node tools/generate-coldlion-licensor-property-phase3-report.mjs
#   -> 570 ledger rows, 542 auto-eligible, 28 pending, parents 256/0,
#      approved_hash d41d8cd9… (empty), proposed_hash 1230f5a1…, pending_hash 2edf77b7…

# deterministic local validation: 100% coverage + hash stability + no cross-entity + named owners
node --test tools/coldlion-licensor-property-phase3.test.mjs

# repo + Phase 1/2 contract tests
scripts/check-sql.sh
node --test tools/coldlion-licensor-property-phase1.test.mjs
node --test tools/coldlion-licensor-property-phase2a.test.mjs
node --test tools/sync-coldlion-licensors-properties.test.mjs
```

Commands that require external access (run only when refreshing evidence; credentials via 1Password,
never committed):

```text
# fresh read-only DesignFlow comparison snapshot (entry gate) — produces designflow-fresh-*.json.
# RERUN THIS after the `title` fix so names populate (titles_complete=true, 0 blanks) and edge_hash
# refreshes; then rerun the local generator + test and update the edge_hash citations in the docs.
DESIGNFLOW_API_KEY="$(op read 'op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key')" \
  node tools/coldlion-licensor-property-phase3-designflow-snapshot.mjs
node tools/generate-coldlion-licensor-property-phase3-report.mjs
node --test tools/coldlion-licensor-property-phase3.test.mjs   # expect 13/13

# read-only preview re-measurement of the 14 baseline hashes — refreshes immutability.json
#   (Node pg from C:\repos\oracle\node_modules against the preview pooler; read-only SELECTs only)
```

## 8. Forward-impact notes (Phases 4–8)

- **Phase 4 (BLOCKED):** consumes only the approved input once a human approves it (the 542 proposed
  set, plus NASA after Albert). It must prove UUID/row-count/status/parent/dependent-FK hashes unchanged
  and that the 505 DesignFlow refs remain alongside the new ColdLion refs. No canonical creates (Phase 5).
- **Phase 5** is **needed only if** Albert approves any of: ZAG licensor, FRIDA KAHLO licensor, or the
  12 ColdLion-only properties — each property requiring an approved parent first. If none are approved,
  Phase 5 is explicitly "not needed."
- **Phase 6** clock has not started (needs scheduled ColdLion + DesignFlow refreshes over ≥14 days).
- **FRIENDS TV** final disposition (option 1/2/3) is an owner decision that does not block Phase 4
  (no link either way) and can be settled before Phase 8.
- No schema, key, permission, function signature, source-reference encoding, or schedule changed in
  Phase 3; the only additions are the two read-only/local tools and this evidence folder.
