---
summary: Owner rulings verbatim, part 1 of 4: §6.1–§6.5 (6 sections); section list is in owner-rulings.md.
kind: living
status: current
read-when: a citation of AGENTS.md §6.1–§6.5 or the owner ruling text in that range
---

# Owner rulings and standing decisions (AGENTS.md section 6) — part 1 of 4

> Moved **verbatim** from [`owner-rulings.md`](owner-rulings.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

### 6.1 Merch groups / licensors / properties — read this before touching them

Start from the business object, not the old shared table:

- Licensor, Property, Character, Style Guide, Franchise, licensed Asset, source authority,
  or Property Active/Inactive starts at
  [`docs/business-rules/licensing-master-data.md`](../docs/business-rules/licensing-master-data.md).
- MG01–MG14, `mgCategory`, product type/subtype, big theme, little theme, art type,
  art source, artist, age group, division meaning, or `mgTypeCode` starts at
  [`docs/business-rules/merchandise-and-product-taxonomy.md`](../docs/business-rules/merchandise-and-product-taxonomy.md).

The merchandise-group document explains legacy shape. It does not override the settled
2026-08-16 licensing authority rules.

For the active ColdLion Licensor/Property source cutover, read the STATUS table in
[`plan_coldlion_licensor_property_accelerated_cutover.md`](../plan_coldlion_licensor_property_accelerated_cutover.md)
before re-deriving or re-planning anything.

**Step 7A (the real recurring feed) is BUILT and preview-proven as of 2026-07-29; the next action
is Step 8, the production business-risk gate in §4.** Two rules that catch sessions out:

- **A one-time 542-link run is NOT the feed switch.** The recurring lane is
  `.github/workflows/coldlion-licensor-property-production.yml` (production-only, currently
  **DISABLED**), driven by `tools/promote-coldlion-source-owned.mjs` in mode
  `promote_source_owned`. It is the deliberate mirror image of the preview-only
  `coldlion-licensor-property-phase6-parallel.yml`: each hard-refuses the other's project.
  **Never edit one into the other.**
- **Do not "simplify" the promotion collision rule.** Quarantining any canonical row reachable
  from more than one typed key quarantines **542 of 542 approved rows — the entire feed** —
  because the approved mapping deliberately fans 542 source rows into 271 canonical rows. Fan-in
  quarantines only when the arms propose *different* names. This is enforced by a regression test.

- **A skipped promotion cycle is NOT a failed one.** Since 2026-07-31 the promotion is
  serialized by transaction-scoped advisory lock `720260729` (registry:
  [`docs/advisory-lock-registry.md`](../docs/advisory-lock-registry.md)), because the scheduled
  lane and a manual drill could otherwise promote the same rows at once and leave an
  unreadable audit trail. A caller that loses that race records an `ingest.sync_run` row with
  `status = 'cancelled'` and `metadata.outcome = 'skipped_already_running'`, and the runner
  exits **3**. Never "tidy" that into `failed` or into exit 1: the two-consecutive-**failed**-row
  `pg_notify` breaker in `tools/coldlion-sync-common.mjs` would then trip on two perfectly
  healthy overlapping cycles and block promotion until an authorized reset.

Evidence and the full defect list:
[`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](../docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md). Albert decided on 2026-07-26 to replace the original
14-day elapsed-time gate with an invariant-based readiness gate plus rapid post-cutover monitoring.
The existing production prohibition remains in force until that plan's preview rehearsal,
readiness, and explicit production-approval gates pass.

For **PopSG folder-derived Property matching and reconciliation**, the single
bounded execution plan is
[`fix_popsg_property_taxonomy_reconciliation.md`](../fix_popsg_property_taxonomy_reconciliation.md).
It applies the ColdLion and style-guide architecture decisions without replacing
either authority document. Its phases are named `PSG-0` through `PSG-7` to
avoid collision with ColdLion phases. `PSG-0`–`PSG-4` are preparation only;
`PSG-5` requires a recorded ColdLion checkpoint and owner sign-off, and `PSG-6`
must not overlap ColdLion Phase 7.

**If your work touches characters, style guides, or royalty rates, read
[`docs/style-guides-characters-and-royalties.md`](../docs/style-guides-characters-and-royalties.md)
FIRST.** Read its historical measurements under the controlling 2026-08-16 architecture in
[`docs/business-rules/licensing-master-data.md`](../docs/business-rules/licensing-master-data.md).
There are **two axes, and chaining them is the classic bug**: Licensor-to-Property is one-to-many;
Property-to-Character is many-to-many; and style is many-to-many — **a style guide holds many
characters and a character appears in many style guides**. A style guide is *not* a level
between property and character. The legacy table
`dflow.properties_and_characters` is misleadingly named — its `type='PROPERTY'` rows are
**style guides**, not properties, and its `type='CHARACTER'` rows are character *appearances*
(one per style guide), not distinct characters — those 9,622 rows are the **style-guide ↔
character bridge**, not a canonical character list. Batman is one character appearing
in 15 style guides, each with its own external id. That doc also records the Marvel-only +2% talent-likeness
royalty rule and the fact that likeness attaches to a **style guide asset (file)**, never to a
character. Two AI sessions have already corrupted their understanding by reading those column
names literally — do not be the third.

The three rules that cause the most damage when ignored:

1. **`mgTypeCode` has no fixed meaning.** `05` is Licensor in CW001/SP001 but "Big Theme" in
   EH001 and "Product Line" in EP001. Always resolve through
   `(divisionCode, mgTypeCode) → mgTypeDesc`. Keying on the number alone corrupts the taxonomy.
2. **Coldlion has no licensor→property relationship and no active/inactive flag.** Both are
   DesignFlow-owned. A direct Coldlion sync cannot reproduce either.
3. **Merch-group codes are unique only within `(division, mgTypeCode)`.** `FR` is a licensor
   in our DB and a *property* in Coldlion. Never look up by `mg_code` alone.

### 6.1b Division codes — TWO encodings, and the one that will bite you (2026-08-17)

`division_code` / `divisionCode_*` columns hold **two different encodings of the same
divisions**, in the same database, sometimes under the identical column name:

| ColdLion spelling | DesignFlow id | Name |
|---|---|---|
| `CW001` | `1` | POP Lic |
| `SP001` | `8` | Spruce Lic |
| `EH001` | `9` | Spruce non-Lic |

**Rules (settled, do not re-litigate):** shared PLM item tables store the **ColdLion
spelling**; never the raw ids `1`/`8`/`9`; never the deprecated id `2` or unused id `7`;
company is always `EDGEHOME` (`SPRUCE` and `UCI` in old rows are legacy labels, not tenants);
`plm."divisionCode"` is the single source of truth. Proven live on item `BRT10DYWP01`
(2026-08-14) — do not re-verify.

**Division `2` is a DesignFlow-only MIXED legacy bucket — resolve it per item, never map it.**
**78% of item headers (15,185 of 19,463) carry `dflow."itemHeader".div_code_fk = 2`**, an id
that exists only in DesignFlow's numbering. **ColdLion has no division `2` and never did** —
their system has four codes (`CW001`, `EH001`, `SP001`, `EP001`). The tell is in our own data:
every `div_code_fk = 2` row has its ColdLion text column **empty**, while ids 1 / 8 / 9 carry
their codes.

**Do NOT blanket-map `2` → `CW001`.** A 250-item random sample checked against the full
ColdLion catalogue (2026-08-18) shows division 2 holds items from *every* division:

| ColdLion says | Share of sample |
|---|---|
| `CW001` | 83.5% |
| `EH001` | 8.4% |
| `SP001` | 6.8% |
| `EP001` | 1.2% |
| absent from ColdLion | 1 of 250 |

A blanket map would misfile roughly **1 item in 6 — about 2,500 rows**. An earlier 19-item
sample returned `CW001` every time and produced exactly that wrong conclusion; it is recorded
here so nobody repeats it.

**The rule (owner ruling, Albert Hazan, 2026-08-18: "go according to ColdLion"):** for any
item whose DesignFlow division is `2`, take the division **from ColdLion by item number**, not
from `div_code_fk` and not from a mapping table. `plm."divisionCode"` remains correct for the
three live ids; it simply has nothing honest to say about id `2`.

⚠️ `2` must never be *stored* in a shared PLM table.

**Also settled:** `EP001` is a **real retired book/education division** (grade bands, page
counts, flash cards, 2019–2020), *not* a mis-keyed `EH001`. Never "correct" it to `EH001`.
`EP001` is retired but **not empty**: the full ColdLion sweep (2026-08-18, 97 pages,
**19,326 items**) still returns **451** items under it. Catalogue by division: `CW001` 12,914 ·
`EH001` 3,860 · `SP001` 2,101 · `EP001` 451.

**Never judge "is this item still sold" from `is_item_active` (checked 2026-08-19).** That
DesignFlow app-level boolean is **NULL on 18,186 of 19,463 rows** — NULL means *nobody set it*,
not "inactive". Reading it as inactive produced a false alarm that ColdLion and the mirror
disagree about the catalogue. **They agree.** The mirror carries ColdLion's own fields:

| Field | ColdLion | `dflow."itemHeader"` |
|---|---|---|
| `active` | Y 18,866 / N 459 | `item_active_status` Y 18,979 / N 453 |
| `itemDiscontinued` | Y **546** | `discont_status` Y **546** (exact) |
| `itemAvailable` | N 11 | `item_avail_status` N 8 |

Spot-checked item by item on 11 items flagged discontinued / inactive / unavailable — all
matched. **Use `item_active_status` and `discont_status`.** ColdLion's own "currently sellable"
set is `active = Y` **and** `itemDiscontinued = N` **and** `itemAvailable = Y` → **18,397 of
19,326**. ColdLion retires very little (546 discontinued in total), so a narrower
"in the current line" list does not exist there and must come from elsewhere.

**Before touching any `core."merchGroup"` division value**, read all three, in this order:
1. [`docs/division-code-answers-from-uma-20260813.md`](../docs/division-code-answers-from-uma-20260813.md) — the answers, with two withdrawn fix rules
2. [`docs/merchgroup-271-division-conflicts-back-to-uma-20260817.md`](../docs/merchgroup-271-division-conflicts-back-to-uma-20260817.md) — why the 271-row fix creates 142 duplicates
3. [`docs/division-code-round2-answers-and-reference-check-20260817.md`](../docs/division-code-round2-answers-and-reference-check-20260817.md) — the reference check: **178 of 363 unclean rows are safe to clean, 185 are not**

⚠️ Three rows (`mg_id` 2, 3, 4) carry **no division at all**, look like obvious junk, and hold
**573 item references** between them. Deleting them on sight is the mistake this section exists
to prevent.

**OWNER CONFIRMATION (Albert Hazan, in chat, 2026-08-19).** Verbatim: *"Coldlion has the
correct data. We only have 4 divisions: cw001, ep001, eh001, sp001. And ep001 has been retired
and will not be used in our systems."*

Three things this settles for good:

1. **ColdLion is authoritative for division, full stop.** Not `div_code_fk`, not a mapping
   table, not the DesignFlow id space. This confirms the 2026-08-18 ruling above rather than
   changing it.
2. **The division list is CLOSED at four codes** — `CW001`, `EP001`, `EH001`, `SP001`. A
   division value outside that set is a data defect, not a new division. Do not add one
   without a fresh owner ruling.
3. **`EP001` is retired and will NOT be used going forward.** It stays a real historical
   division (the 2019–2020 book/education line) and must never be "corrected" to `EH001`,
   but nothing new lands in it. New or backfilled rows must not be assigned `EP001`; a
   pipeline that would assign it is producing a wrong answer and must fail loudly rather than
   write it.

   > ### ⚠️ EXTENDED the same day — `EP001` is FILTERED OUT of new ingest entirely (Albert Hazan, in chat, 2026-08-19, later)
   >
   > The paragraph above originally ended *"Historical `EP001` rows stay exactly as they are —
   > this is not licence to rewrite or delete them."* That sentence is **withdrawn for NEW
   > ingest** and survives only for rows we already hold.
   >
   > He was shown the exact consequence before ruling — that the ColdLion plan's history depth
   > is **2019-01-01 to today** (decision D9), which is precisely the period `EP001` was
   > trading, so filtering it at the loader means the seven-year backfill captures **none** of
   > that division's sales or purchase history — and he chose to filter it out completely
   > anyway. This confirms decision **D11** in
   > [`docs/plan_coldlion-landing-phases-2-6.md`](../docs/plan_coldlion-landing-phases-2-6.md).
   >
   > **What this means, by table:**
   >
   > - **New ColdLion landing tables (`coldlion.*`) and every loader:** filter `EP001` at the
   >   loader on every feed, master and history alike. Do not land it.
   > - **Rows we already hold:** unchanged. This is still not licence to rewrite or delete
   >   existing `EP001` data. It is a rule about what we bring IN.
   > - **The `public.erp_items_current.division_code` backfill (#1137):** an item ColdLion
   >   reports as `EP001` gets **`NULL`**, not `EP001` and not a substituted division.
   >     ⚠️ **This last line is a DERIVATION, not his words.** He ruled on filtering; the
   >     `NULL` is the only reading that neither invents a division nor smuggles `EP001` in
   >     through a different table. It reverses the #1137 comment posted earlier the same day,
   >     which said to record `EP001` where ColdLion reports it. If a future session needs
   >     those rows, re-ask him — it is one cheap question, and roughly 1.2% of the
   >     division-2 sample is affected.
   >
   > **Accepted, stated cost:** the 2019–2020 book/education line's transaction history is not
   > captured. Recovering it later means re-running the whole seven-year pull.

**No further questions are owed to Uma on division codes.** Her 2026-08-13 and 2026-08-17
answers plus this confirmation cover the ground; issue #903 (the unsent 8-question briefing)
is closed as superseded.

### 6.2 Coldlion `/vendors` — wrong table, now FIXED upstream (2026-07-22)

`core.factory` = **merchandise vendors (factories)**. Coldlion's `/vendors` endpoint was returning a
mixed population (factories PLUS freight/government/banks/couriers/real-estate). **Coldlion corrected
it 2026-07-22 — `/vendors` now serves 97 factory-only records.** This is **DONE** (2026-07-22):
`core.factory` reconciled to **93 rows (91 active / 2 inactive)** (`fix_vendor_reconcile.md`), the silver
mirror `plm.erp_vendor` refreshed to 97 (migration `20260722171500`), and a **guarded recurring importer**
is live — `plm.sync_coldlion_vendors` via `public.sync_coldlion_vendors`, with `plm.vendor_exclusion`
(435 seeded) + `plm.vendor_quarantine`, status app-owned (set on INSERT only), upsert by
`(source_system,source_table,source_id)` (migration `20260722213000`). **Never re-introduce the old
`plm.import_coldlion_vendors` pattern** (it clobbered curated status; it was dropped). Recurring
**scheduling (Phase B — Edge Function + alerting) is NOT built yet**; the importer runs on demand. Full
design/state: [`fix_vendor_sync.md`](../fix_vendor_sync.md). Detail:
[`docs/coldlion-erp-api-reference.md`](../docs/coldlion-erp-api-reference.md) (✅ box).

### 6.3 OWNER RULING — Coldlion ERP data is canonical (Albert Hazan, 2026-07-31)

> **Coldlion ERP data is canonical.** When Coldlion inactivates or removes a vendor, property or
> licensor, **follow it** — do not preserve the old value on the grounds that the raw/bronze record
> is immutable. Ruled by Albert Hazan, 2026-07-31.

Why this is written down: on 2026-07-31 a session deleted 442 ColdLion vendor rows from bronze
`ingest.raw_record` on **production** `qsllyeztdwjgirsysgai` (539 → 97 surviving rows;
`pg_stat_all_tables.n_tup_del` for `ingest.raw_record` reads exactly 442). The owner reviewed it and
confirmed it was **intended and correct** — those vendors had been inactivated in the ERP. **This is
not an incident. Do not propose a restore, a PITR, or a corrective migration for it.**

**What this ruling supersedes.** Two migrations that are already **applied to production** carry
comments asserting the opposite. They are applied, the ledger records their versions, and the CLI
will never re-run them — so **do not edit them**; editing changes nothing in the database and
desynchronises file from ledger. Read them as historical, and read this ruling as the current
policy:

| Applied migration | Stale comment it carries |
| --- | --- |
| `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` | "Bronze `ingest.raw_record` is intentionally left untouched — it is the immutable [record]" |
| `20260722213000_vendor_sync_guarded_importer.sql` | "Bronze `ingest.raw_record` still holds the original payload"; "Bronze: always land the raw row (nothing is ever lost)" |

Scope note: this ruling is about **ColdLion-sourced master data** (vendors, properties, licensors)
following the ERP. It does **not** relax the append-only rule for **evidence and audit** tables
(`plm.coldlion_promotion_audit`, `plm.coldlion_promotion_quarantine`,
`plm.taxonomy_parallel_observation`, `plm.taxonomy_circuit_breaker_event`,
`app.db_data_admin_audit_event`) — those stay append-only and must not be deleted.

### 6.4 OWNER RULING — the Master Data import is TRANSITIONAL, and curated data outranks it (Albert Hazan, 2026-08-03)

> "importing Master Data info from Google Sheets is a temporary thing until all the employees
> are ready to do all work in our Master Data and then Google Sheets version gets deprecated
> and never touched again. so any improvements we've made should no longer be overwritten by
> the imports from Google Sheets. those imports should only be data that gets us up to date
> until we're ready to cut-over (hopefully soon)."
> — Albert Hazan, 2026-08-03

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not treat it
as an AI's preference, and do not weaken it.**

**The rule, in three parts.**

1. **The import is transitional, not an integration.** It exists only to carry us to cut-over,
   after which the spreadsheet-era source is **deprecated and never touched again**. Do not
   build durable architecture on it, do not extend it, and do not design any long-lived feature
   that assumes it keeps running. When a choice is between hardening the import and shortening
   the road to cut-over, choose cut-over.
2. **Curated beats imported — our Master Data is the winner.** An import may **never** overwrite
   an improvement made in our Master Data. It is a **catch-up feed**: it may fill a gap and
   bring in a record we do not have, and it may create a new row. It may **not** revert, reset,
   re-parent, rename, or re-status anything a human has deliberately set here.
3. **Direction of authority is per FIELD, not per row.** Decide field by field. **On a MATCHED
   row**, the question for each field is only "has a human deliberately set this here?" — if
   yes, the import loses that field, even while it wins the neighbouring fields on the same
   row. A **matched** row is never wholly imported or wholly curated. (A genuinely new row is
   the separate case governed by the row-level rule below.)

**The two loopholes to close, not to use.**

**Field level — "it was missing, so I filled it."** An importer must not be free to *decide* that
a field was merely absent. **Absence is not a licence.** A field counts as deliberately set — and
is therefore off-limits to the import — whenever a human touched it, including when the human's
decision was to set it to `NULL`, to `inactive`, or to blank. That means the "deliberately set"
state must be **recorded**, not inferred from the current value: a value that happens to equal
the default is not evidence that nobody chose it. An importer that cannot tell curated from empty
must abstain, not guess.

**Row level — "we don't have this record, so I created it."** The same dodge works one level up:
fail to match an existing curated row, declare it absent, and INSERT a fresh, fully-imported
duplicate. That defeats curation just as completely — the curated original is orphaned while a
new `active` row supersedes it — and it is **not** what "bring in a record we do not have"
licenses. **An importer must justify "we do not have it" as rigorously as "this field was
unset."** If the matching keys disagree — if one lookup key finds a row that another key would
not — that is a **possible match, not an absence**: quarantine it as evidence for a human, and
never resolve it by inserting.

**Durable source-resolution decisions.** `plm.source_resolution` is the capture-independent
home for a human decision that a Paramount or NBCU source identity matches a canonical property,
character, style guide, or asset. Source loaders never write it and must leave the deprecated
resolution columns on capture rows unresolved and null. Human tools use
`plm.set_source_resolution()`; a later capture cannot bypass that decision.

**What this means in practice TODAY.** The durable resolution record above does not identify
which ordinary fields on a matched `core.*` row were curated. So the operative rule remains
non-advisory: **an import writes a curated field only on INSERT of a genuinely new row, and writes no
curated field at all on a matched row.** Gap-filling a matched row becomes permissible only once
"deliberately set" is recorded per field and the importer actually consults that record.

**This ruling is currently VIOLATED in production — read before running any import.**
`plm.import_master_data(jsonb, jsonb)` on production (`qsllyeztdwjgirsysgai`) force-sets
`core.property.licensor_id`, `core.licensor.status = 'active'` and `core.property.status =
'active'` on every matched row of every re-pull. The corrective migration
`20260802170000_plm_import_preserve_curated_licensor_property_status.sql` is merged to `main`
but is **NOT applied to production**. Until it is, a single re-run silently reverts every
curated ruling, **including the 2026-08-02 FRIENDS TV / FRIDA KAHLO decision (§6.3 neighbours)**.
The daily `systemd/plm-sync.timer` lane still exists; it has simply not succeeded since
2026-07-08. **Do not run, re-enable, or repair that lane before the fix is applied.**
Full evidence, every overwrite path, and the scoped proposal (not an implementation):
[`docs/google-sheets-import-authority-20260803.md`](../docs/google-sheets-import-authority-20260803.md).

**The compliant reference already exists — copy it, do not reinvent it.** `plm.sync_coldlion_vendors`
refreshes non-status fields only and states in-line that status/name are app-owned;
`tools/promote-coldlion-source-owned.mjs` documents an explicit can/cannot list and refuses
`core.property.licensor_id`, lifecycle status and canonical codes outright. That shape is what
honouring this ruling looks like.

**Scope note.** Albert names "Google Sheets". No importer in this repository carries that name;
the live mechanism that carries this Master Data content is the DesignFlow PLM master-data pull
(`getLicensorsWithProperties` / `getCustomers` → `plm.import_master_data`). This ruling is
recorded as governing **any catch-up import into Master Data**, which is the behaviour he
described. Whether he also intends a separate spreadsheet-era feed outside this repo is the one
open scoping question and is flagged in the linked document — it does not soften the rule for
the importer we do have.

**Relationship to §6.3 (ColdLion ERP data is canonical).** These do not conflict; they cover
different sources. ColdLion is a **system of record** we follow, so a ColdLion inactivation is
authoritative. The Master Data import is a **transitional catch-up feed** with no such standing,
so it never outranks curation. If a future source claims both roles, that is an owner question,
not an agent's judgement call.

#### 6.4-C CORRECTION — the "Google Sheets import" is an AI SESSION, not a pipeline (Albert Hazan, 2026-08-03)

**This subsection corrects the SCOPE of §6.4 above. Everything above stands; this widens what it
binds. The "Scope note" above — which flagged that no importer in this repository carries the name
"Google Sheets" and left that as the one open scoping question — is now ANSWERED. Do not re-open it.**

> "Google Sheets imports are just done when i open an ai session and tell it to take the data from
> Google Sheets and dump it into our Master Data"
> — Albert Hazan, 2026-08-03

**What this changes.** The thing §6.4 governs is not a coded pipeline with a schedule, a repo file,
a workflow, or a code path anyone can review. It is **an AI session performing ad-hoc writes on
instruction**. The search for "the Google Sheets importer" was therefore looking for an artefact
that does not exist and never will.

**The corrected rule.**

1. **§6.4 binds AI SESSIONS DOING AD-HOC DATA LOADS, not only automated importers.** An agent told
   to "take this spreadsheet and dump it into Master Data" is squarely inside §6.4 and is the
   *primary* addressee of it. Read every occurrence of "the import" and "an importer" in §6.4 as
   including **you, right now, typing the statement**. There is no "I am not an importer" exemption.

   **The trigger is the SOURCE, not the verb, and it is not yours to adjudicate.** §6.4 binds you
   whenever the content you are about to write into Master Data (`core.licensor`, `core.property`,
   `core.character`, `core.customer`, `core.factory` and their `*_ext` tables) **originated outside
   this database** — a spreadsheet, a CSV, an export, a pasted block of rows, a screenshot, a chat
   message, an API pull. It is irrelevant whether you call it a load, a dump, an import, a sync, a
   backfill, a correction, a cleanup, a one-off, or "just applying what Albert sent me". It is
   irrelevant whether you write one row or ten thousand, and irrelevant whether you use INSERT,
   UPDATE, MERGE, an RPC, or a migration. **None of these labels create an exemption; only §6.4's
   own INSERT-a-genuinely-new-row allowance does.** If you find yourself reasoning about whether
   your activity counts as an "import", the answer is yes.

   **"The spreadsheet IS the curation" is not an exit either.** A human saying "the team curated
   this sheet, put it in" does not convert outside content into curated data. Curation, for the
   purposes of §6.4, is a decision recorded **in this database**. A claim about a spreadsheet's
   provenance is exactly the kind of unverifiable assertion §6.4 exists to stop you from acting on.
   The only thing that changes this is an owner ruling naming the specific rows, recorded here or
   in `core.taxonomy_owner_ruling`.
2. **The operative rule of §6.4 applies to you unchanged:** on a **matched** row you write **no
   curated field at all**; you may INSERT a genuinely new row; and you must justify "we do not have
   this record" as rigorously as "this field was unset". If your lookup keys disagree about whether
   a row exists, that is a **possible match — quarantine it as evidence for a human, never resolve
   it by inserting**. Since no per-field curation record exists in this database, an ad-hoc session
   has **no way to tell curated from untouched** and must therefore abstain on every matched row.

   **Two clarifications, because the wording above has been read loosely.**
   - **"No curated field at all" means, TODAY, no field at all.** The abstention sentence is the
     operative one, not a summary of the first. Because nothing in this database records which
     fields a human set, you cannot identify a non-curated field, so **on a matched row an ad-hoc
     session writes NOTHING**. "I did not believe that field was curated" is not compliance — the
     rule already tells you that you cannot form that belief.
   - **You do not get to pick a weak matching key.** "If your lookup keys disagree" is not
     permission to use one key and never see a disagreement. Before you may claim a row is absent
     you must probe **every identifying key the entity has** — canonical code, name (normalised:
     case, whitespace, punctuation), any alias table (`core.licensor_alias`), and
     `core.taxonomy_source_ref` — and get a miss on **all** of them. A hit on any one is a match. A
     disagreement between any two is a quarantine. Anything less is not "we do not have this
     record", it is an unexamined guess, and the resulting INSERT duplicates a curated row and
     silently supersedes it downstream — the row-level loophole §6.4 already names.
3. **The control cannot be code review — there is no code.** It is (a) this rule, which the agent
   reads and follows, and (b) wherever it can be built, **database-side protection that does not
   care who is writing** — a constraint, trigger, or `SECURITY DEFINER` write function that refuses
   the curated columns regardless of caller. Prefer (b) over (a) whenever (b) is available:
   a rule an agent can forget is weaker than a database that says no. Building (b) is in-scope
   work for a future session; until it exists, (a) is all that stands between a spreadsheet dump
   and every curated ruling in Master Data.
4. **§4.2 interacts directly with this and is not optional here.** An ad-hoc spreadsheet dump is
   precisely the shape of operation §4.2 exists for: bulk writes, typed by hand, in a session that
   believes it knows which database it is on. **Prove the connection target immediately before every
   statement §4.2 covers** — that is §4.2's own scope, unchanged and not widened here: every write,
   change, or removal of data, schema, or privileges, including `INSERT`. §4.2's batching allowance
   applies as written (one proof covers what is submitted in the same tool call as the check or the
   immediately following one), so a single dump does not need a proof per row — it needs a proof per
   submission, and any tool call, reconnect, or turn boundary in between invalidates it. Quote that
   proof in your report. A spreadsheet dump aimed at preview that lands on production
   `qsllyeztdwjgirsysgai` is unrecoverable in exactly the way §4.2 describes.

**Relationship to §0.0-B (2026-08-13).** §0.0-B hands ordinary application data writes back to the
application sessions, and **explicitly preserves this subsection as its one carve-out**. Nothing
here is relaxed. The scope is unchanged and is defined by **provenance and target**: outside-sourced
content written into curated Master Data (`core.licensor`, `core.property`, `core.character`,
`core.customer`, `core.factory` and their `*_ext` tables). Do not read §0.0-B's "app sessions own
their data" as an exemption from §6.4 — it names §6.4 as the exception to itself. Equally, do not
read §6.4 as reaching an application's own rows in its own tables; it does not, and never did.

**What has NOT changed.** §6.4's three parts, its two loopholes, the production violation warning
(`plm.import_master_data` still force-sets curated status on production; `20260802170000` is merged
but **not applied there**), and the compliant reference implementations all stand exactly as written
above. This subsection adds addressees; it removes nothing.

#### 6.4-D OWNER RULING — authorized licensor scrape consolidation is a governed authority path, not an ad-hoc load (Albert Hazan, 2026-08-16)

> "What comes in from the licensor scrape ... is canonical as to which licensor a property belongs
> to and how the property is spelled ... the scrapes are canonical (and have to be run weekly)."
> — Albert Hazan, 2026-08-16

**This is the narrow exception that §6.4-C requires an owner to name.** For an authorized licensor
portal that POP has implemented, the portal is the approved authority for its scoped Licensor,
Property spelling and ownership, Characters, Style Guides, Asset metadata, Franchises, and direct
source-published relationships. A future guarded consolidator may therefore update those specific
facts on a matched canonical row. That is intentional authority application, not gap-filling.

#### 6.4-E OWNER RULING — ColdLion owns Licensor names and uncovered ColdLion-only Property truth (Albert Hazan, 2026-08-19)

ColdLion is canonical for official Licensor names. For a ColdLion-only Property under a Licensor
that has no authorized scrape data, ColdLion's Property name and owning Licensor are canonical
truth. Inside an authorized scrape's Property coverage, §6.4-D still controls Property spelling,
ownership, entities, and direct source-published relationships. ColdLion also remains authoritative
for Property Active/Inactive. Ambiguous identity or scrape coverage waits for review rather than
guessing. This later ruling narrows and supersedes every statement that ColdLion supplies only
status or has no naming/ownership authority at all.

The exception applies only when all of these are true:

1. the full `source_system` identity is explicitly authorized and mapped to its Licensor scope;
2. the capture is complete, validated, and the exact capture identity is recorded;
3. durable source resolution identifies the matched canonical row without ambiguity;
4. a dry-run plan is reviewed and its exact hash is required by the apply;
5. every changed field is inside the source-authority matrix in
   [`docs/core-master-data-consolidation-aim.md`](../docs/core-master-data-consolidation-aim.md);
6. the change and the prior value are audited and reversible;
7. Property status is untouched, because only guarded ColdLion membership controls Active/Inactive.

This does **not** exempt a spreadsheet dump, pasted rows, a one-off API pull, direct SQL, or an AI
session that decides to imitate the future consolidator. Those remain fully bound by §6.4-C and
write nothing on matched rows. Until the guarded consolidator in
[`plan_licensing_master_data_implementation.md`](../plan_licensing_master_data_implementation.md) is
implemented, preview-proven, and applied, the existing matched-row abstention remains the only safe
behavior for manual sessions. The exception is a contract for that named controlled path, not a
permission shortcut.

### 6.5 OWNER RULING — PR #408 is HELD and ships as one production change with the FR removal work (Albert Hazan, 2026-08-03)

> "hold it and ship it together with the removal work"
> — Albert Hazan, 2026-08-03, answering whether to promote the two merged migrations
> `20260802170000` (durable curated licensor/property status) and the ruling originally recorded in `20260802171000`
> (the FRIENDS TV / FRIDA KAHLO ruling) to production now, or hold them and combine them
> with the `FR` removal work as ONE production change.

This is a standing decision, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference.**

**What is forbidden, stated so it cannot be read narrowly:** historical `20260802171000` is now
permanently retired from production because the #1090 licensing guard makes its unguarded write
unsafe. **Neither `20260802170000`, compatibility prerequisite `20260817225127`, nor guarded
replacement `20260818174350` may reach production until the FR removal work is ready with them.**
Not alone, not as a subset, not in a wider sweep, and not via `--include-all`. The permitted event
is one bounded production apply carrying those three versions and every removal/cleanup member in
dependency order. This is a safety-preserving supersession of the implementation, not a change to
Albert's settled business ruling.

**All three are enforced by name, and the version numbers here are load-bearing (2026-08-18).**
`parse_allowlist` in [`scripts/production_migration_guard.py`](../scripts/production_migration_guard.py)
refuses an allowlist containing ANY member of `FR_HELD_20260803` **or** `FR_COMPATIBILITY_VERSIONS`
until `FR_REMOVAL_VERSIONS` is populated and the whole ship set is present. Until 2026-08-18 the
code triggered only on `FR_HELD_20260803`, so `20260817225127` promoted **alone** parsed clean —
narrower than this prose. The prose is authoritative and the code now matches it.

**`FR_REMOVAL_VERSIONS` is no longer empty (2026-08-20, issue #1339).** It holds exactly one
version, `20260820183334`, which ERASES `core.licensor` `FR` "FRIENDS TV" — a real delete, on
Albert's 2026-08-03 ruling reaffirmed on 2026-08-20 as "erase FRIENDS TV completely". It extends
the licensing write guard to cover `DELETE` (the guard was `before insert or update` only, so the
most destructive operation on canonical licensing identity was the one it never saw) and performs
the removal through a one-use transaction-bound authorization, leaving an immutable audit row and a
`core.taxonomy_owner_ruling` record — which, once the row is gone, are the only remaining
explanation of what happened. **The ship set is therefore now assemblable, and it is exactly
`20260802170000`, `20260817225127`, `20260818174350`, `20260820183334` and (ordering permitting)
`20260819151527` — all together, in dependency order, or none of them.** This version string is a
safety control on the same terms as the ones above, so it lives in the guard, in
`test_the_real_fr_removal_version_is_registered_by_name`, and here.

**The FRIDA KAHLO property is DELETED, not re-homed — and that removes the last sequencing
dependency (owner ruling, 2026-08-20).** `core.property.licensor_id` is `NOT NULL` and `ON DELETE
RESTRICT`, and one Property row (`FK` "FRIDA KAHLO", `cb26ec58-0edb-4d45-8c0b-ba283ffb23f8`) pointed
at `FR`. Albert ruled: *"FRIDA KAHLO was never supposed to be under Friends. they have no relation
to each other. and FRIDA KAHLO is a defunct license anyway. you can delete it if that's the easiest
way to get this done."* So `20260820183334` deletes that row too, bounded to its exact primary key,
through the same guarded one-use mechanism under a second write kind
`owner_ruling_fk_removal`. **The bundle no longer waits on #1238.**

This satisfies 6.5's re-homing step by a different disposal, not by skipping it: 6.5 called for
bringing in a real FRIDA KAHLO licensor and re-pointing `FK` onto it; the owner says the licence is
defunct, so there is nothing to re-point to. The outcome 6.5 requires — nothing left pointed at
`FR`, and `FR` removed last — is met exactly. It is also where 6.15 was sending that row anyway.

**What did NOT change: the unexpected-row refusal.** If any `core.property` row *other than* that
one uuid is parented to `FR`, the migration still REFUSES rather than widening its predicate. The
owner ruled on one row; a second row would be one nobody has measured or ruled on. That half of the
old block stands and must not be deleted along with the half that was lifted.

**Both guard triggers now cover DELETE.** `property_licensing_write_guard` was extended alongside
`licensor_licensing_write_guard`, because this migration deletes a `core.property` row itself and an
unguarded delete of canonical master data inside the very change that closes the unguarded-delete
hole would have been indefensible. **Permanent consequence: after this migration no `core.licensor`
or `core.property` row can be deleted by anything except those two rows.** There is deliberately no
authorization shape for deleting an arbitrary Licensor or Property.

On the same day, `--supersede-active-claim-version` re-reserved the guarded forward migration from
`20260817232425` to `20260818174350` and updated only the filename, leaving the guard holding a
version that named no file and the real file in no hold set at all (issue #1182). **A migration
version in this section is a safety control, not a file index.** If you rename a migration named
here, change it here and in the guard in the same commit; `test_every_hold_set_member_is_a_real_migration_file`
now fails the build otherwise.

**Why this is the right answer, so a future session does not "helpfully" unblock it.**

- Albert's ruling on `FR` "FRIENDS TV" is that it **was never a real licensor and must be REMOVED**
  — not kept, not merely flagged. FRIENDS has always been a *property* under `WB` WARNER BROS, so
  genuine FRIENDS items already have a correct home.
- Guarded replacement `20260818174350` records the ruling and sets `core.licensor` `FR` to
  **`status = 'inactive'`**. Historical `20260802171000` is retained as evidence but never applied
  to production. The inactive step is a
  *different remedy*, written before the removal ruling existed, and the removal ruling
  **supersedes** it.
- So promoting #408 alone would change production master data **twice**: once into `inactive` — a
  state the owner has said he does not want — and again later into removed. Every production change
  here is **forward-only with no undo**; buying an extra irreversible step to reach a state nobody
  asked for is strictly worse than waiting.
- Combining them means production moves once, from today's state to the intended end state.

**How the ruling reaches production without leaving `FR` inactive — read this before you conclude
the ruling is impossible.** Preview truthfully retains applied historical `20260802171000`; its
text and ledger row are immutable. Production instead uses guarded forward `20260818174350`,
which records the same ruling while satisfying the licensing authorization/audit contract. Inside
one bounded promotion, `FR` passes from `active` to `inactive` to removed
without ever being an observable steady state, and no application, sync, or human sees `FR` as an
inactive licensor. That is the "moves once" the ruling means: one promotion event, one end state.
An agent that promotes `20260818174350` on its own produces the forbidden thing — a production that
sits at `inactive`, indefinitely, until a second irreversible change.

**The consequence you must NOT report as a bug.** Until the combined change ships, **production and
preview DISAGREE about `FR`**: production has `FR` **active**, preview has `FR` **inactive**. This
divergence is **KNOWN, EXPECTED and ACCEPTED** — it is the direct result of this ruling. Do not
"fix" it, do not promote #408 to close it, and do not re-report it as drift, as a failed promotion,
or as an incident. It resolves when the removal work ships, and only then.

**What "the removal work" is.** A single ordered change in which nothing is orphaned at any step:
bring the real FRIDA KAHLO licensor in from ColdLion with proper `core.taxonomy_source_ref`
provenance; re-point property `FK` FRIDA KAHLO onto it; re-home **every remaining row that still
references `FR`** to its correct home — in practice the FRIENDS property under `WB`, which is where
anything genuinely about the TV series belongs (as measured on 2026-08-02, `FK` was the *only*
property under `FR`, with zero characters, so this step is expected to move nothing; **prove that
again at the time rather than assuming it**) — and **remove `FR` LAST, only after proving zero
dependents**. There is no judgement call hidden in the word "genuinely": `FR` was never a real
licensor, so **nothing** may remain pointed at it. The
curated-status durability of `20260802170000` must be in the same production change, or the data
corrections revert on the next PLM sync.
