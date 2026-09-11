# `core.character` — the named backfill source decision

**Issue:** #562, first outstanding item · **Written:** 2026-09-02 ·
**Route:** curated-master-data-governance · **Database work: none.** This session
was read-only. No row, no schema object, and no production statement was executed.

> **This file answers one question and closes it:** when `core.character` is
> populated, **where do the rows come from?** It does not authorize a load, and it
> does not schedule one. It names the source so that the next session does not
> re-derive it, and so that the two wrong sources below are not reached for again.

---

## 0. The decision, in one line

**Canonical Character rows come from the per-licensor normalized portal capture
tables, promoted one licensor at a time through the `core_character_id`
resolution contract that already exists in those tables — and from nothing else.**

---

## 1. State of the target, verified rather than assumed

Two statements of record on #562 said `core.character` was empty; a third said it
had been dropped and that the item was blocked behind an unapplied migration.
**All three are now stale.** Checked 2026-09-02:

- `20260829004145_separate_property_and_character` **creates** `core.character`
  and is on `main`.
- The `Migration Ledger Drift` workflow run of 2026-09-02T15:23Z reports
  **`No drift`** against production, and version `20260829004145` appears
  **nowhere** in that run's RETIRED / HELD / not-applied list.
- **Instrument proved before it was believed.** The same log was grepped for a
  version known to be on the held list, which returned a hit, and for
  `20260829004145`, which returned none. A grep that finds nothing because it is
  malformed is indistinguishable from a genuine absence, so the positive control
  was run in the same pass.

**Therefore the table EXISTS and holds ZERO rows.** The blocker recorded on
2026-08-29 has cleared, and item 1 is answerable on this route without any
structural change.

The migration's own comment states the standing rule for the table: populate it
*only* from normalized authoritative sources through governed curated Master Data.
This document names those sources.

---

## 2. The two sources that are RULED OUT, and why

Both have been proposed before. Neither is available, and neither should be
re-proposed.

### 2.1 The retired mixed table — FORBIDDEN, not merely discouraged

The legacy appearance rows may **not** be copied into `core.character`. This is
not a preference:

- Owner ruling of 2026-08-27 (`docs/owner-rulings.md` §6.15) records those rows as
  **disposable**, and issue #1684 forbids salvaging them into either canonical
  dataset.
- Migration `20260829004145` states it in the file itself: no row is copied, and
  the dependent integer edges are deliberately retired because they cannot be
  mapped to UUID canonical identities without guessing.

**This supersedes the Phase 3 design that is still written down in the repository.**
`fix_characters_style_guides.md` Phase 3, `tools/resolve-character-identity.mjs`
and the analysis in `docs/verification/character-identity-rules-20260728/` were all
built to collapse those legacy appearance rows into canonical identities. That
apparatus is **correct work aimed at a source that is now closed.** A session that
finds those files and runs them will produce exactly the load this ruling forbids.
They are retained as evidence and as reusable *rules*, not as a row source — see §5.

### 2.2 The ColdLion ERP feed — wrong kind of list

Per §6.15 the ColdLion feed records which licensed properties we **actually use**.
It is not a statement of what exists or what we are licensed for, it carries no
licensor character identities, and it is not a character source. A canonical
Character row derived from it would be inventing an identity from a usage record.

---

## 3. The named source, tiered by whether the promotion contract exists yet

Classification below is derived mechanically from the `create table` statements in
`supabase/migrations/`, not from memory. The discriminator is whether the table
carries a `core_character_id` column referencing `core.character` — i.e. whether
the governed path from source row to canonical row is already built.

### Tier 1 — promotion-ready. These are the source.

Each of these carries the licensor's own character identity, a name, and a
`core_character_id` resolution column already pointing at `core.character`:

| Table | Resolution status column |
|---|---|
| `plm.opa_character` | yes |
| `plm.nbcu_character` | yes |
| `plm.pmt_character` | yes |
| `plm.dcp_character` | resolution columns, no status enum |
| `plm.marvel_dcp_character` | resolution columns, no status enum |
| `plm.lucasfilm_dcp_character` | resolution columns, no status enum |
| `plm.twentieth_century_dcp_character` | resolution columns, no status enum |

**The backfill is these tables' resolution columns being filled in, not a copy job.**
The contract is already in the schema: a source row is promoted by resolving it to
a canonical id. `plm.opa_character` additionally refuses to record a resolution
unless the resolver and timestamp are recorded with it. `plm.nbcu_character` and
`plm.pmt_character` currently enforce target coherence only; they do not yet
require resolver or timestamp evidence. The stronger OPA audit shape is the model
being propagated to newer promotion contracts. Do not route around these source
resolution records with a direct insert into `core.character`.

`plm.marvel_asgard_character` is a Tier-1 *input* but resolves through
`plm.marvel_asgard_character_opa_resolution` into the OPA identity space rather
than directly into `core.character`. Follow that table; do not promote it twice.

### Tier 2 — real identities, promotion contract NOT yet built

`plm.wb_character_normalized` and `plm.wildbrain_character` carry genuine source
identities and labels, and `plm.wb_character_normalized` records explicitly whether
its identity came from a real source id or a fallback natural key. Neither has a
`core_character_id` column. **They cannot be promoted until one is added by a
structural migration on the migration-author route.** That is a separate issue, not
work this route may absorb.

### Tier 3 — EXCLUDED. Not character identities at all.

- `plm.sesame_character`, `plm.peanuts_character` — these are **asset-tag facet
  dictionaries** (`value_key` / `value_label` / `asset_count`), i.e. the values a
  filter offers, not an identity register. Promoting a facet value to a canonical
  Character invents an identity out of a search facet.
- `plm.sega_character_candidate`, `plm.wwe_character_candidate` and their
  `_inferred` companions — **derived guesses by construction.** Inferred data is
  not authoritative evidence and may not seed a canonical dataset.
- Every `*_asset_character` and `*_property_character` table — these are
  **relationship** tables. They are the source for the association and style-guide
  bridges, never for the identity itself.

---

## 4. Identity key — settled, not an open question

**A Character's identity is `licensor + source id`. Never the source id alone.**

Licensors independently issue small integers, so a join on the bare id merges
unrelated characters across licensors and misattributes royalties. `core.character`
already encodes this: its uniqueness index is on `(licensor_id, code)`, not on
`code`. This is a standing technical fact in our record and is **not** to be
re-opened as an owner decision.

Consequence for sequencing: **a licensor must be resolvable in `core.licensor`
before any of its characters are promoted.** A character promoted with a null
licensor is unattributable and cannot be corrected later without re-doing the load.

---

## 5. Where the appearance grain goes, and what the licensing answers are for

One legacy row is one character **appearance in one style guide**, not one
character. The property-to-character relationship is many-to-many. That axis has
its own table, `core.style_guide_character`, which exists and is unpopulated.

So the Phase 3 question splits cleanly in two, and only the first is answered here:

1. **Identity** — `core.character`, sourced per §3. **Answered.**
2. **Appearance** — `core.style_guide_character`, sourced from the `*_asset_character`
   and `*_style_guide_character` relationship tables. **Separate work, separate issue.**

**The round-2 and round-3 licensing answers survive this change of source.** They
adjudicate *what is and is not a character* — which combination labels are real
characters, which rows are not characters at all, and that a character may belong
to more than one property. Those are **resolution rules**, and they apply to any
source. They are recorded in
`docs/verification/character-identity-rules-20260728/round2-licensing-answers.md`
and its round-3 companion. **The licensing question stream is CLOSED. There is no
round 4, and nothing in this document reopens it.**

Likewise `tools/resolve-character-identity.mjs` keeps its value as a rule engine —
sentinel exclusion, abbreviation folding, qualifier stripping — and loses only its
input. Point it at Tier-1 source rows; do not point it at the retired mixed table.

---

## 6. Preconditions before anyone executes this

None of these are satisfied by this document, and this route may not satisfy them.

1. **Read the authoritative capture inventory first.**
   Since migration `20260825011609` (issue #1284) the plain view deliberately returns
   **NULL for every count column** so that ordinary reads stay bounded. Its own
   `count_note` column says so on every row. Reading `api.source_capture_inventory`
   alone therefore tells you nothing about size — that is by design, not a fault.

   For the shape and the per-table contract:
   `select source_system, table_name, count_basis, latest_complete_status, count_note from api.source_capture_inventory order by source_system, table_name;`

   For the actual numbers, opt in to the exact path — one table per call keeps it to a
   single table scan, and a NULL argument returns the full historical exact inventory:
   `select * from api.source_capture_inventory_exact('<table_name>');`
   (`EXECUTE` is granted to `authenticated` and `service_role`. A read-only inspection
   role such as the MCP reader is refused; use an application-grade connection.)

   Use `latest_complete_row_count` with `count_basis` and `latest_complete_status`.
   A NULL **from the exact function** means the count cannot be derived — **it does not
   mean zero.** Never judge a licensor's coverage by counting one guessed table; that
   error was made on 2026-08-13 and understated the landed data by hundreds of thousands
   of rows.
2. **Confirm `core.character` is still empty and still exists**, live, with a
   control in the same statement. Both facts have already flipped once on this issue.
3. **A structural migration is required for Tier 2** before those two licensors can
   be promoted. That is the migration-author route, not this one.
4. **One licensor per change.** A single load across all Tier-1 licensors makes an
   identity-key error unattributable and unrecoverable.
5. **AI sessions are read-only against production.** This proposes the source; it
   does not run the load.

---

## 7. What this closes on #562

- Item 1 is **answered**: the source is named in §3, the exclusions are named in
  §2 and §3, the identity key is settled in §4, and the appearance grain is routed
  to its own table in §5.
- The premise correction of §1 matters more than the answer: the item was recorded
  as blocked behind an unapplied migration, and it is not.
