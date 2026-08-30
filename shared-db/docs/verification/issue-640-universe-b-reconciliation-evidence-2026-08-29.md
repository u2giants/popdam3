# Issue #640 — Universe B licensor reconciliation evidence (2026-08-29)

**Status:** read-only verification. No database write was made, proposed, or authorized by this
document. Nothing here is a migration.

**Why this file exists:** issue #1684 will drop `core.properties_and_characters` and declares its
rows disposable. Before that happens, the licensor-key mapping that lives *only* in those rows is
captured here as committed evidence. If the table is dropped without this file, the mapping between
our property rows and the licensors' own primary keys is gone and would have to be rebuilt by hand.

**Target database proven at query time:** Supabase production project `qsllyeztdwjgirsysgai`,
PostgreSQL 17.6. Every figure below comes from a `SELECT` executed against that project on
2026-08-29.

**Governing instruction:** `docs/owner-rulings.md` §6.15 (line 1441) — *"#640 — the licensor
reconciliation runs against Universe B, never Universe A."* Issue #1684 supersedes the **entity
destination**; it does not mention #640, "reconcile", or "universe", and does not re-point the
**reconciliation target**. Those are two different questions. This run is against Universe B.

---

## 1. Correction: 510 property rows, not 10,122

Prior notes referred to "the 10,122 rows that already carry the licensors' own keys". That count
mixes two grains. Measured on production, `core.properties_and_characters` holds:

| Row set | Row count |
| --- | --- |
| `type = 'PROPERTY'` | 510 |
| `type = 'CHARACTER'` | 9,622 |
| **Total** | **10,132** |
| `core.property_character_associations` | 9,622 |

The licensor reconciliation is a **property**-grain question, so its denominator is **510 rows**,
not 10,132 and not 10,122. Every percentage below is stated against a named row count.

## 2. Result: 342 of 510 property rows (67.1%) reconcile by the licensor's own primary key

| Licensor | `licenseList` code | Universe B property rows | Matched on the licensor's own ID | Rate |
| --- | --- | --- | --- | --- |
| Warner (STARLABS) | WB | 164 | 164 | 100% |
| Disney (OPA) | DS | 124 | 124 | 100% |
| Marvel → Disney OPA | MV | 54 | 54 | 100% |
| **ID-verified subtotal** | | **342** | **342** | **100% of the 342** |
| NBCU (Creative Asset Factory) | NU | 123 | 0 | 0% — see §4 |
| Paramount (Creative Library) | VM | 34 | 0 | 0% — see §4 |

The full 342-row mapping is committed alongside this file as
`issue-640-universe-b-source-id-mapping-2026-08-29.csv`
(columns: `licenselist_code, universe_b_id, universe_b_name, source_licensed_property_id, portal,
portal_label`).

Warner is the only licensor of the five that issues UUIDs, so the 164 WB rows join UUID-to-UUID and
are the safest rows in the set.

## 3. Do not re-derive this mapping by joining on ID alone

Disney OPA and Sega both issue small integers in their own namespaces. A bare
`source_id = source_id` join across licensors therefore produces silent **false positives**, where
two unrelated properties share an integer. Four confirmed examples, all Sega-side integers colliding
with Disney OPA integers:

| Sega property | Sega ID | Falsely joins to Disney OPA property |
| --- | --- | --- |
| Sonic the Hedgehog: Classic | 126 | Goofy Movie |
| Sonic the Hedgehog: Modern | 127 | Great Mouse Detective |
| Retro: SEGA Saturn | 115 | Cinderella |
| Retro: SEGA Master System | 112 | Brother Bear |

A fifth collision exists between a DS integer and an NBCU integer in the same way.

**Rule, recorded here so it survives this issue:** a whole-licensor zero-match is an ID-system
finding, never a gap. **Scope every ID join by licensor first.** The 342 rows in the CSV were
produced with the licensor bound on both sides of the join; they are not reproducible by an
unscoped join, and an unscoped join will produce rows that are not in the CSV and are wrong.

## 4. NBCU and Paramount: namespace mismatch, not absence

Both licensors return 0 matches on `source_licensed_property_id`. That is **not** evidence that
their properties are missing. It is evidence that Universe B and the scrape hold different kinds of
key for the same rows:

- **NBCU** — the scrape keys properties by integer (e.g. `2 FAST 2 FURIOUS` = `1498`), while
  Universe B holds a UUID for the same row (`77d386da-d103-49bb-bd46-8ee1aaa578f7`).
  Matched by normalised name: **123 of 123 NBCU property rows (100%)**.
- **Paramount** — Universe B holds a slug (`footloose_1984`), the scrape holds an integer.
  Matched by normalised name: **19 of 34 Paramount property rows (55.9%)**.

Both name-matched sets are committed as
`issue-640-universe-b-name-matched-nbcu-paramount-2026-08-29.csv`, with the portal's own integer id
carried in the last column, so the correspondence does not have to be re-derived.

**Could not be established:** which ID system NBCU and Paramount actually issue as their canonical
property key, and therefore whether the UUID/slug in Universe B is the licensor's key at all or a
key we minted locally. Settling it requires one authoritative field from each portal — the property
detail record showing the licensor's own primary identifier.

## 5. The two real disagreements, by name

These are the only substantive content disagreements the run found. Neither is a gap; both are rows
that matched and then disagreed.

**(a) Warner title-and-year drift on a matched UUID.**
Universe B row `10055` and Warner STARLABS agree on the key
`e01f0a1f-0ca6-42ac-8e9d-8e5e50421631`, but disagree on what it is called:

| Side | Label |
| --- | --- |
| Universe B (`core.properties_and_characters` id 10055) | `Mortal Kombat 2 (2025)` |
| Warner STARLABS | `Mortal Kombat II (2026)` |

Both the numeral style and the year differ. Per §6.4-C matched-row abstention, nothing was written.
This is a lookup-key disagreement on a matched row: it is a quarantine item for the owner, not
something an ad-hoc session resolves.

**(b) 15 of 34 Paramount property rows have no name match in the extract.**
Named in full: `90210 (2008)`, `Beverly Hills 90210 (1990)`, `Footloose (1984)`,
`Anchorman 2: The Legend Continues`, `Avatar: The Last Airbender (2005 Animated Series)`,
`Garfield - Retro/Classic`, `Garfield Theatrical 2024`, `It's A Wonderful Life (B/W)`,
`Scream 6 (2023)`, `Scream 7 (2026)`, `Tales of the Teenage Mutant Ninja Turtles (2024 Series)`,
`Teenage Mutant Ninja Turtles Classic`, `The Brady Bunch`, `The Twilight Zone (2019)`,
`Twilight Zone (1959 Series)`.

**Caveat, and it is a large one:** the Paramount Creative Library extract is the thinnest of the
four (134 property rows loaded, against Disney 1,518 / Warner 525 / NBCU 249). Absence from the
thinnest extract is the weakest possible evidence of absence from the licensor's catalogue. These 15
titles are **not** established as unlicensed. Settling it requires a complete Paramount extract, not
a deeper join against the one we have. Note also that several of the 15 look like sibling titles of
rows that *did* match (`Anchorman` matched, `Anchorman 2` did not; `Scream 2022` matched, `Scream 6`
and `Scream 7` did not), which is the pattern a partial capture produces.

## 6. Other verified facts from this run

- **All four extracts are loaded on production.** Property row counts: Disney OPA 1,518;
  Warner STARLABS 525; NBCU Creative Asset Factory 249; Paramount Creative Library 134. Any note
  describing the landing tables as empty is obsolete.
- **`core_property_id` is populated on 0 of 2,426 landing rows.** The extracts are not linked back
  to curated Master Data by that column today.
- **`core.character` does not exist on production** (`ERROR: 42P01` against a full
  `information_schema.tables` enumeration of the `core` schema). The #1684 restore has not landed.
- **Universe B is not fully source-keyed.** The `WWE` and `Strawberry Shortcake` property rows carry
  a NULL `source_licensed_property_id`, so they cannot be reconciled by key in either direction.
- **Blaze and Peanuts are not Disney claims.** `plm.opa_property_studio_resolution` marks both
  `unresolved` under `owner-ruling:2026-08-26:opa-studio-classification-rule`.

## 7. Issue #933 evidence correction

#933 measured `core.property.licensor_id` against the DesignFlow mirror on 2026-08-13 and reported
"503 edges over 261 codes". Re-measured on production 2026-08-29, the true figures are **614 rows
over 322 distinct codes, of which 111 (18.1% of 614) have a NULL parent**. #933's query joined to
the parent and silently dropped those 111. Its structural conclusion is confirmed: **0 codes have
more than one parent**, so no junction table is required and no schema change is required — for
#933 or for #640.

## 8. What this document does not do

- It authorizes no write, load, backfill, or migration. It is a record, not a plan.
- It does not resolve the `Coco` studio question or the five candidate insertions; those remain
  owner decisions.
- It does not open the licensor-grain question, which concerns `core.licensor` and sits outside this
  reconciliation's target.
- It takes no position on whether #1684 should proceed. It only ensures that if #1684 proceeds, the
  342-row key mapping and the 157 name-matched NBCU/Paramount rows survive the drop.
