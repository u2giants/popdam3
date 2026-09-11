# `core.style_guide_character` — the appearance-axis source decision

**Issue:** #2124, routed out of #562 · **Written:** 2026-09-04 ·
**Route:** repo-maintenance / documentation · **Database work: none.** Every
statement below was a read against production `qsllyeztdwjgirsysgai`, proved with
`get_project_url` immediately before the first query. No row, no schema object and
no write was executed.

> **This file answers one question and closes it:** when `core.style_guide_character`
> is populated, **where do the rows come from, and by what contract?** It does not
> authorize a load and it does not schedule one. It is the appearance-axis
> counterpart to `docs/core-character-backfill-source-decision-20260902.md`, which
> answered the identity axis and deliberately left this one open.

---

## 0. The decision, in one line

**A `core.style_guide_character` row is a DERIVED EDGE, never a copy. It comes into
existence only when both of its endpoints — one style guide and one character — have
already been resolved to canonical ids through `plm.source_resolution`, and the edge
is then projected from the per-licensor `*_style_guide_character` relationship row
that asserted it.**

Nothing is promoted from a relationship table directly, and no row is inserted with
an endpoint that was resolved on the way in.

---

## 1. §5 of the #562 decision was right about the input and silent about the contract

#562 §5 pointed at the `*_asset_character` and `*_style_guide_character` relationship
tables as the expected source. That was to be **confirmed against
`api.source_capture_inventory`, not assumed.** Confirmed, with one correction and one
important qualification.

**Confirmed:** those tables are the authoritative assertion of the appearance edge,
and the inventory lists them as captures of record.

**Correction — the promotion contract is NOT in those tables.** Checked live: of the
thirteen `*_asset_character` / `*_property_character` / `*_style_guide_character`
tables in `plm` and `api`, **not one carries a `core_character_id`, a
`core_style_guide_id`, or any other resolution column.** The identity axis promotes
through per-table resolution columns because `plm.opa_character`,
`plm.nbcu_character`, `plm.pmt_character` and the DCP family each carry one. The
appearance axis has no such column anywhere, and **should not be given one.** An edge
has no identity of its own to resolve; it is entailed by its two endpoints.

**The contract already exists, in one place:** `plm.source_resolution`.

```
source_system, entity_kind, source_id,
core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
resolution_status, resolution_reason, resolved_at, resolved_by,
created_at, updated_at
```

It is a generic, per-entity-kind resolution register carrying the **full audit shape**
— resolver and timestamp, not merely a target — which §3 of the #562 decision named as
the stronger OPA model being propagated to newer promotion contracts. It holds
**0 rows** today. `api.source_resolution` is its read-side view.

**So the promotion contract for the appearance axis is:** resolve the style guide
(`entity_kind` = style guide) and the character (`entity_kind` = character) in
`plm.source_resolution`, each keyed by `source_system` + `source_id`; then and only
then project the edge.

---

## 2. Two empty parents, not one

Verified live, 2026-09-04, in a single statement:

| Table | Rows |
|---|---|
| `core.style_guide_character` | **0** |
| `core.style_guide` | **0** |
| `core.character` | **0** |
| `plm.source_resolution` | **0** |

`core.style_guide` being empty matters more than the target being empty. #562 recorded
the appearance axis as waiting on `core.character`. It is waiting on **both**
endpoints, and the style-guide endpoint has no decision document of its own at all.

**Consequence for sequencing:** the appearance axis cannot start when the identity
backfill lands. It starts when the identity backfill lands **and** a style-guide
identity decision has been made and executed for the same licensor. Naming the source
for `core.style_guide` is the next unanswered question on this chain, and it is not
answered here.

---

## 3. The target table records no provenance, by construction

`core.style_guide_character` is four columns:

| Column | Type | Null |
|---|---|---|
| `style_guide_id` | uuid | NO |
| `character_id` | uuid | NO |
| `metadata` | jsonb | NO |
| `created_at` | timestamptz | NO |

There is no licensor column, no source system, no source id, no resolver and no
resolution timestamp. **This is correct and must not be "fixed" by adding them.** The
edge's provenance is the pair of `plm.source_resolution` records for its two
endpoints; duplicating provenance onto the edge creates a second version of the truth
that can disagree with the first.

It also means the edge table **cannot be audited on its own.** An edge whose endpoints
have no resolution records is unattributable and uncorrectable after the fact. That is
the whole reason for the ordering rule in §0.

---

## 4. Coverage, measured directly — and why it had to be

`api.source_capture_inventory` names the capture tables authoritatively. **It cannot
size them.** Across all **392** rows of that view, `retained_row_count` is non-null in
**0** and `latest_complete_row_count` is non-null in **0**. Every count column is empty
view-wide, not merely for the character tables.

That control was run deliberately. #562 §6 precondition 1 says a NULL there means the
count cannot be derived and **does not mean zero** — but a per-table NULL and a
globally empty column call for different responses, and only the whole-view count
tells them apart. Reporting "the character captures have no counts" without it would
have described a view-wide defect as a character-specific gap. Filed separately.

Counts below are therefore direct reads, 2026-09-04:

| Relationship table | Rows | Grain | Usable for this axis |
|---|---|---|---|
| `plm.peanuts_style_guide_character` | 1,033 | style guide × character | see §5 — blocked |
| `plm.sesame_style_guide_character` | 0 | style guide × character | empty |
| `plm.peanuts_asset_character` | 37,238 | **asset** × character | no — see §6 |
| `plm.pmt_asset_character` | 19,458 | **asset** × character | no — see §6 |
| `plm.wildbrain_asset_character` | 5,450 | **asset** × character | no — see §6 |
| `plm.nbcu_asset_character` | 0 | **asset** × character | empty |
| `plm.sesame_asset_character` | 0 | **asset** × character | empty |
| `plm.opa_property_character` | 10,262 | property × character | no — different axis |
| `plm.nbcu_property_character` | 190 | property × character | no — different axis |
| `plm.pmt_property_character` | 124 | property × character | no — different axis |

**Only two tables in the entire database are at the style-guide × character grain**,
and one of them is empty.

---

## 5. The Peanuts trap

`plm.peanuts_style_guide_character` is the only populated table at the correct grain.
It is **not loadable**, and the reason is not about this axis at all: §3 of the #562
decision classifies `plm.peanuts_character` as **Tier 3, EXCLUDED** — an asset-tag
facet dictionary (`value_key` / `value_label` / `asset_count`), not an identity
register. Promoting a facet value to a canonical Character invents an identity out of
a search facet.

An edge cannot be more real than its endpoint. **Until Peanuts has a genuine character
identity source, its 1,033 appearance rows have nothing to point at.** A session that
finds the only populated table at the right grain and loads it will manufacture 1,033
canonical characters out of a filter dictionary. That is the specific mistake this
section exists to prevent.

The practical effect: **there is no licensor that can be promoted on this axis today.**

---

## 6. `*_asset_character` is the wrong grain and is NOT a source here

#562 §5 named `*_asset_character` alongside `*_style_guide_character`. On inspection
they are not interchangeable, and the distinction is load-bearing.

An `*_asset_character` row says *this character appears on this asset*. A style guide
contains many assets. Collapsing asset-grain rows to style-guide grain by joining
through the asset's style guide **invents an assertion the licensor never made**: it
converts "the licensor tagged this character on this artwork file" into "the licensor
lists this character in this style guide". Those differ wherever an asset is filed
under a guide the character is not part of, and the 37,238 Peanuts asset rows against
1,033 style-guide rows show the two grains are not a restatement of each other.

`*_asset_character` is the source for the **DAM asset-to-character** association
(`dam_asset_id` in `plm.source_resolution` exists for exactly that). It is not the
source for `core.style_guide_character`. Do not derive one from the other.

Likewise every `*_property_character` table is the **property × character** axis. That
is a third relationship, not this one.

---

## 7. Carried forward from #562, unchanged

- **The retired mixed table may not be copied here either.** Owner ruling §6.15 as
  amended for #1684 forbids salvaging those rows into either canonical dataset. It is
  the same prohibition on this axis, for the same reason, and one legacy row being *an
  appearance* does not make it loadable into the appearance table.
- **The round-2 and round-3 licensing answers apply here as resolution rules.** They
  adjudicate what is and is not a character, and a character may belong to more than
  one property — which is precisely why this axis is many-to-many and has its own
  table. **The licensing question stream is CLOSED. There is no round 4, and nothing
  here reopens it.**
- **Identity is licensor + source id, never source id alone.** On this axis it binds
  twice: both endpoints are resolved within their licensor's space. A bare source-id
  join would connect a Disney style guide to a Sega character.
- **Inferred tables are excluded.** `api.wb_inferred_style_guide_character` and
  `api.wb_inferred_property_character` are derived guesses by construction and may not
  seed a canonical dataset, on this axis as on the identity axis.

---

## 8. Preconditions before anyone executes this

None are satisfied by this document, and this route may not satisfy them.

1. **A style-guide identity decision must exist and be executed first.**
   `core.style_guide` is empty and has no named source. This is the binding
   blocker (§2).
2. **The licensor's characters must already be promoted** into `core.character`
   through the identity contract, with a `plm.source_resolution` record each.
3. **One licensor per change**, so an endpoint-resolution error stays attributable.
4. **No resolution column may be added to a relationship table.** The contract is
   `plm.source_resolution` (§1). A structural change that adds one should be refused.
5. **No edge may be inserted whose endpoints were resolved in the same operation.**
   Resolve first, project second; otherwise the audit record and the edge are the same
   act and neither checks the other.
6. **AI sessions are read-only against production.** This names the source; it does
   not run the load.

---

## 9. What this closes on #2124

- The source is named (§0, §1), and the promotion contract is named and located in
  `plm.source_resolution` rather than assumed to live in the relationship tables.
- The confirmation against `api.source_capture_inventory` was performed and the
  inventory's own limitation is recorded with a control (§4).
- Three ways to get this wrong are named and closed: the Peanuts facet dictionary
  (§5), the asset-grain collapse (§6), and provenance duplication onto the edge (§3).
- **One question is left open on purpose and belongs to a new issue:** where
  `core.style_guide` rows come from. It blocks this axis and nothing in the record
  answers it.
