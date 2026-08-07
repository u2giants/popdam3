# Owner rulings — Albert Hazan, 2026-08-07

**Status: SETTLED. Five rulings, all made by Albert Hazan on the evening of 2026-08-07.**
They were made in a chat window and existed nowhere else until this file. Do not re-ask them,
do not treat them as an AI's preference, and do not quietly record a different answer because a
better one seems available. If you believe a ruling is wrong, take it back to Albert — do not
route around it.

This file is the full record. `AGENTS.md` §6.13 is a short pointer to it.

## Who this is for

A developer who has never seen this project and was not in the conversation. Everything you need
to act on these rulings is on this page. Terms used below:

- **ColdLion** — POP Creations' ERP system. It is the canonical source for licensor and property
  records (`AGENTS.md` §6.3).
- **licensor** — the company POP holds a licence with. Stored in `core.licensor`.
- **property** — a licensed title/brand under a licensor. Stored in `core.property`, keyed
  `(licensor_id, code)` — property codes are NOT globally unique (`AGENTS.md` §6.10 ruling 3).
- **landing table** — a table that holds raw scraped portal data exactly as captured, before any
  interpretation. Lives in the `plm` schema.
- **capture** — one scrape run. A landing table holds many captures.
- **shrink-band guard** — an importer check that refuses a new capture when its row count is far
  below the previous capture's, on the theory that a sudden collapse means a broken extract rather
  than a real business change.

## Dating context — what else happened on 2026-08-07

So a future reader can place these rulings in time:

- `COORDINATOR_INTAKE.md` was **retired** on 2026-08-07 in favour of GitHub issues on
  `u2giants/shared-db` labelled `db-work`. If you find a doc telling you to write into
  `COORDINATOR_INTAKE.md`, that doc is stale.
- The Disney OPA (licensee portal) work merged the same day across five migrations,
  `20260807170000` through `20260807200000`.
- `AGENTS.md` §6.11 (`DY`/`DS` are one Disney licensor) and §6.12 (there is no parentage-durability
  migration) were also added on 2026-08-07.

---

## Ruling 1 — per-licensor landing tables, NOT one shared landing table

**Decided:** Albert Hazan, 2026-08-07.

**The decision.** Each licensor's raw scrape data gets its **own** `plm.*` landing tables. There is
no shared multi-licensor landing table with a `licensor` discriminator column.

**Why.** Two reasons, both accepted by Albert.

1. **Constraints are per-licensor, and a shared table would have to soften them.** Disney's landing
   table carries hard `CHECK` constraints that make a malformed Disney extract fail loudly at insert
   time. A shared table would have to relax those checks so Paramount rows could also be admitted.
   That weakens Disney's guarantee in order to accommodate a licensor Disney has nothing to do with.
   Loud failure is the whole point of the landing layer.

2. **The shrink-band guard would be measured against the wrong population — silently.** The importer
   counts rows in its own table to decide whether a new capture is suspiciously small. In a shared
   table that count is unscoped unless every single query remembers to filter by licensor. Get that
   wrong once and a **completely truncated Paramount extract passes the guard by being compared
   against Disney's roughly 10,262 rows.** The pipeline reports success and the data is empty. That
   is a silent wrong answer, and silent wrong answers are the failure mode this repo exists to
   prevent (global rule 11, "no silent failures").

**What it costs.** More tables, and per-licensor duplication of importer shape. Accepted. A second
set of tables is cheap; a silent empty load is not.

---

## Ruling 2 — Paramount release 1 is FIVE tables, not fifteen

**Decided:** Albert Hazan, 2026-08-07.

**The decision.** The first Paramount release ships exactly five tables plus their supporting
pieces. Everything else is deferred until a capture proves it is needed.

**Ships in release 1:**

| Object | Kind |
| --- | --- |
| `plm.pmt_capture` | table |
| `plm.pmt_property` | table |
| `plm.pmt_character` | table |
| `plm.pmt_property_character` | table |
| `plm.pmt_asset` | table |

Plus: the importer, RLS policies and grants, **one** `api` view, and contract tests.

**Deferred to a later release** (do not build these now):
`plm.pmt_brand`, `plm.pmt_franchise`, `plm.pmt_franchise_property`, `plm.pmt_collection`,
`plm.pmt_property_collection`, `plm.pmt_asset_collection`, `plm.pmt_asset_property`,
`plm.pmt_asset_character`, `plm.pmt_authorized_title`, `plm.pmt_authorized_title_match`, four
further views, and the collection trigger.

**Why.** The deferred objects model structure that **no capture has yet proven exists**. The
asymmetry is the argument: adding a table later is a cheap additive migration. Shipping a table with
the wrong key and then discovering rows are already in it is a migration **plus** a data repair, and
data repairs on a shared production database are the expensive kind of mistake.

**What it costs — write this on the wall.** **Release 1 loads assets that connect to nothing.**
`plm.pmt_asset` will hold rows with no link table joining them to properties or characters (that is
`pmt_asset_property` and `pmt_asset_character`, both deferred). So after release 1 the database can
answer *"which characters does this property own?"* but it **cannot** answer *"which asset shows
this character?"*. Anyone who assumes asset linkage exists will write a query that silently returns
nothing. This is a known, accepted, temporary gap — not a bug to file.

---

## Ruling 3 — the Paramount authorized-title list is 26, and the count is CLOSED

**Decided:** Albert Hazan, 2026-08-07.

**The decision.** The Paramount authorized-title list contains **26** titles. Albert confirmed that
the entry that was removed (internal reference `902010`) was a **duplicate**, not a loss.

**The question is closed.** Do not re-open it. Do not hunt for a 27th title. Do not treat the
difference between 26 and 27 as evidence of a dropped row.

**Trap — a nearby 27 that is NOT this 27.**
`docs/coldlion-unmatched-properties-by-licensor-20260731.md` contains a section headed
*"Viacom Multi (Paramount) — 27 codes"*. That is a **different population**: unmatched **ColdLion
property codes** under the Viacom Multi licensor, from a 2026-07-31 analysis. It is not the
Paramount portal authorized-title list, and its 27 is not this 26 plus one. Do not reconcile them.

---

## Ruling 4 — build waits for the second Paramount recon

**Decided:** Albert Hazan, 2026-08-07.

**The decision.** The five release-1 tables are **designed, reviewed, revised and approved** — but
implementation is **held** until a second, targeted reconnaissance of the Paramount portal returns.

**What the second recon must answer** (four questions, all of which can change a key or a column
type, which is exactly why building first would be the expensive order):

1. What is the property field's full-metadata descriptor?
2. Do collections carry a real hidden identifier, or only a display label?
3. Does any one character identifier recur across more than one property?
4. How does the combined property-character value behave?

**Why the hold.** Each answer can move a primary key. Under ruling 2's logic, a wrong key discovered
after rows exist costs a migration plus a data repair. Waiting costs one recon.

**What this means for you.** If you pick up Paramount work and the second recon has not landed, the
correct action is to run or chase the recon — **not** to start writing the migration "since the
design is approved anyway".

> Confidentiality note: the recon answers are Paramount source evidence. Record the *answers'
> effects on the schema* in this repo. Do **not** commit Paramount internal IDs, character names, or
> relationship values here — `u2giants/shared-db` is a **public** repository.

---

## Ruling 5 — sub-licensors stay FLAT (the one with an invisible consequence)

**Decided:** Albert Hazan, 2026-08-07.

### What was found

ColdLion produced **19 new records whose names end in `- DESPERATE`** — 5 licensors and 14
properties, mostly beer and car brands.

### What Albert established about the business

**Desperate is a sub-licensor, not the brand owner.**

- POP Creations does **not** hold the brand relationship for those properties. **Desperate does.**
- POP reports its sales to **Desperate**, broken down by ultimate licensor.
- Desperate then files royalty reports **upward** to the real brand owner.

**FanCreations is the same shape**, for NCAA and NFL. Those two sit at status `potential` because
sampling has not started — unlike Ford, where sampling has started.

### The ruling

**Keep it flat for now.** `core.licensor` will **NOT** model the sub-licensor relationship. There is
no parent-licensor column, no sub-licensor link table, and no royalty-chain modelling.
**Desperate is stored as an ordinary licensor.**

### The consequence — this is the part that is invisible in the data

**Any report that answers "who is the licensor?" for those 14 properties returns *Desperate*, not
the ultimate brand owner.** The royalty chain is real in the business and completely absent from the
database. Nothing in the data will tell you it is missing — the rows look ordinary and correct.

So: a licensor-level royalty or sales report built off `core.licensor` alone attributes those
properties to Desperate. If a report is meant to reflect brand ownership, that gap has to be handled
outside the data until the model changes. Say so on the report.

### Do NOT dedupe these

**`ANHEUSER BUSCH - DESPERATE` and the existing `potential` record `Anheuser Busch` are NOT
duplicates.** They are two different things that happen to share a brand name:

- `Anheuser Busch` — the **brand owner**, as a direct licensor relationship.
- `ANHEUSER BUSCH - DESPERATE` — the **sub-licensed route** to the same brand, through Desperate.

A future dedupe or fuzzy-match pass **must not merge them**. Merging them destroys the only
signal in the database that distinguishes the two commercial routes. If you are writing a dedupe
rule, exclude the `- DESPERATE` suffix pattern explicitly and cite this ruling.

### Scope of the ruling

This is "flat **for now**" as Albert ruled it — a decision about the current model, not a claim that
a sub-licensor model is never warranted. Changing it is an owner decision, not an engineering one.
Do not model the hierarchy on your own initiative, and do not restate this ruling as a
recommendation to do otherwise.

---

## Where the rest of the context lives

- `AGENTS.md` §6.3 — ColdLion ERP data is canonical.
- `AGENTS.md` §6.10 — the licensor/property model rulings (2026-08-06), including
  licensor→property parent-child and "the feed should not drop anything".
- `AGENTS.md` §6.11 / §6.12 — the other two 2026-08-07 additions.
- `docs/coldlion-unmatched-properties-by-licensor-20260731.md` — the unrelated "27 codes" section,
  see the trap note under ruling 3.
