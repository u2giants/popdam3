# Licensor / property cutover — re-measured baseline (2026-07-24)

**Why this exists.** [`fix_coldlion_licensor_property_cutover.md`](../../fix_coldlion_licensor_property_cutover.md)
§2 requires a fresh dated baseline before Phase 0, because the `20 / 256` figures it was
written against predate [PR #198](https://github.com/u2giants/shared-db/pull/198) (the PopSG
manual licensor backfill), which is now merged. This is that re-measurement.

Measured live against **production** `qsllyeztdwjgirsysgai` on **2026-07-24**. Supersedes the
`20 / 256` planning baseline in the plan's §2 table.

## Headline: what changed

| Metric | Plan baseline | **Now (2026-07-24)** | Cause |
|---|---|---|---|
| `core.licensor` total | 20 | **26** | #198 added 6 PopSG licensors |
| `core.licensor` active | (20) | **21** | 20 DesignFlow-backed + NASA |
| `core.licensor` potential | 0 | **5** | 5 of the 6 #198 additions |
| `core.property` total | 256 | **256** | unchanged |
| `core.property` active | 256 | **256** | unchanged |

**The cutover must reconcile against 26 licensors / 256 properties, not 20 / 256.** And it
must key on row identity, not counts — 6 of the 26 canonical licensors have **no ColdLion or
DesignFlow provenance at all** and must never be touched by a source-driven pull.

## Canonical counts by status

| Table | active | potential | total |
|---|---|---|---|
| `core.licensor` | 21 | 5 | **26** |
| `core.property` | 256 | 0 | **256** |

## Staging (unchanged since the plan was written)

| Table | rows | distinct canonical id |
|---|---|---|
| `plm.licensor_import` | 37 | 20 |
| `plm.property_import` | 468 | 256 |

## Provenance — `core.taxonomy_source_ref` (unchanged: 505 / 505 `designflow_plm`)

| entity_table | source_system | refs | distinct entities |
|---|---|---|---|
| licensor | designflow_plm | 37 | 20 |
| property | designflow_plm | 468 | 256 |

Zero ColdLion source refs exist yet — the cutover has not started. Note the gap this baseline
exposes: **20** licensors carry DesignFlow provenance, but **26** canonical licensors exist.
The other **6 have no `taxonomy_source_ref` row at all.**

## The 6 #198 additions — must be protected from any source-driven inactivation

These are manually curated, provenance-free, and identifiable by the `X-` code prefix and
`designflow_refs = 0`:

| code | name | status |
|---|---|---|
| `X-ANHEUSERBUSCH` | Anheuser Busch | potential |
| `X-FORD` | Ford | potential |
| `X-MILLERCOORS` | Miller Coors | potential |
| `X-NASA` | NASA | **active** |
| `X-NCAA` | NCAA | potential |
| `X-NFL` | NFL | potential |

The other 20 licensors are DesignFlow-backed (1–2 `designflow_refs` each, non-`X-` codes:
AA, CB, CC, DC, DY, FR, HP, MV, NB, PN, PP, SE, SM, SS, SW, VM, WB, WW, ZZ, 1P).

## Named high-risk cases from the plan §8 — current disposition

| Case | Plan's concern | Measured today |
|---|---|---|
| **NASA** | ColdLion returns it as a lapsed license with no inactive marker | Now a **canonical licensor** `X-NASA`, **active**, 0 source refs (added by #198). A ColdLion pull matching on name would collide with this curated row — must match without resurrecting/duplicating. |
| **ZAG** | lapsed license still returned by ColdLion | **Not present** in `core.licensor`. If a pull creates it, that is a *new-record* decision (Phase 5), not a match. |
| **FRIDA KAHLO** | lapsed license still returned by ColdLion | **Not present** in `core.licensor`. Same as ZAG. |
| **`FR` / FRIENDS TV** | `FR` is a Supabase licensor (FRIENDS TV) but a ColdLion **property** code (1ST ORDER TROOPER) in CW001 | Confirmed: `core.licensor` has `FR` = **FRIENDS TV**, active, 1 DesignFlow ref. The collision is real and live — reinforces the plan's `(divisionCode, mgTypeCode, mgCode)` keying rule. |

## ColdLion side (re-confirmed 2026-07-23, unchanged)

CW001: **22** licensors (`mgTypeCode=05`), **258** properties (`mgTypeCode=06`), no lifecycle
flag, no parent edge. See [`../coldlion-erp-api-reference.md`](../coldlion-erp-api-reference.md)
for the full division matrix and response shape.

## Implications for the plan

1. **Replace `20 / 256` with `26 / 256`** as the reconciliation target in
   [`fix_coldlion_licensor_property_cutover.md`](../../fix_coldlion_licensor_property_cutover.md) §2.
2. **The licensor delta is no longer "ColdLion 22 vs canonical 20" (2 rows).** It is now 22
   ColdLion vs 26 canonical, and 6 of the canonical rows are provenance-free manual adds that
   ColdLion will never contain. The reconciliation categories in §7.1 must include a
   "canonical-only, no source expected" bucket for the 6 `X-` licensors.
3. **NASA moved from "lapsed license ColdLion still returns" to "curated active canonical
   row."** The plan's §8.1 framing (prevent resurrection) is now the opposite risk: a pull
   must **match** ColdLion NASA to the existing `X-NASA` row rather than create a duplicate,
   while still honoring safety rule 4 (presence in ColdLion does not flip status).
4. Property side is fully unchanged; the plan's property numbers stand.
