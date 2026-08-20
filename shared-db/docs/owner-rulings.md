# Owner rulings and standing decisions (AGENTS.md section 6)

> **This file was section 6 of `AGENTS.md` until 2026-08-20.** It was moved because
> `AGENTS.md` had reached **229 KB** — nearly three times its own 80 KB hard ceiling — and is
> loaded in full at the start of every session. Section 6 alone was **100 KB of that, 43%**.
> Nothing was deleted; every ruling below is verbatim. See issue #1331.
>
> **Section numbers are unchanged and remain the way to cite these.** `AGENTS.md §6.4` still
> means what it always meant, and `AGENTS.md` still lists every number with a one-line summary
> and a link here. There are over 200 references to `§6.x` across this repo, its workflows and
> its handoffs; every one of them still resolves.
>
> **These grow by one entry per session, which is exactly why they no longer belong in the
> router.** Add new rulings HERE and add one index line to `AGENTS.md`.

## Index

| § | Ruling |
|---|---|
| [6.1](#61-merch-groups-licensors-properties-read-this-before-touching-them) | Merch groups / licensors / properties — read this before touching them |
| [6.1b](#61b-division-codes-two-encodings-and-the-one-that-will-bite-you-2026-08-17) | Division codes — TWO encodings, and the one that will bite you (2026-08-17) |
| [6.2](#62-coldlion-vendors-wrong-table-now-fixed-upstream-2026-07-22) | Coldlion `/vendors` — wrong table, now FIXED upstream (2026-07-22) |
| [6.3](#63-owner-ruling-coldlion-erp-data-is-canonical-albert-hazan-2026-07-31) | OWNER RULING — Coldlion ERP data is canonical (Albert Hazan, 2026-07-31) |
| [6.4](#64-owner-ruling-the-master-data-import-is-transitional-and-curated-data-outranks-it-albert-hazan-2026-08-03) | OWNER RULING — the Master Data import is TRANSITIONAL, and curated data outranks it (Albert Hazan, 2026-08-03) |
| [6.5](#65-owner-ruling-pr-408-is-held-and-ships-as-one-production-change-with-the-fr-removal-work-albert-hazan-2026-08-03) | OWNER RULING — PR #408 is HELD and ships as one production change with the FR removal work (Albert Hazan, 2026-08-03) |
| [6.6](#66-owner-ruling-db-data-admin-is-the-home-for-licensorproperty-parentage-albert-hazan-2026-08-03-this-reverses-the-previous-stance) | OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance |
| [6.7](#67-owner-ruling-branch-protection-on-main-is-on-and-ci-guards-are-no-longer-advisory-albert-hazan-2026-08-04) | OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04) |
| [6.8](#68-owner-ruling-the-six-hardblocked-coldlion-migrations-are-not-unblocked-individually-albert-hazan-2026-08-04) | OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04) |
| [6.9](#69-owner-ruling-the-33-unmatched-coldlion-property-codes-are-not-admitted-before-the-resolver-is-fixed-albert-hazan-2026-08-04) | OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04) |
| [6.10](#610-owner-rulings-the-licensorproperty-model-and-the-feed-should-not-drop-anything-albert-hazan-2026-08-06) | OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06) |
| [6.11](#611-dy-and-ds-are-one-company-the-disney-licensor-has-two-spellings-added-2026-08-07) | `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07) |
| [6.12](#612-correction-to-66-rule-5-there-is-no-parentage-durability-migration-added-2026-08-07) | CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07) |
| [6.13](#613-owner-rulings-paramount-landing-tables-and-sub-licensors-albert-hazan-2026-08-07) | OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07) |
| [6.13-A](#613-a-owner-ruling-the-paramount-five-table-cap-is-lifted-and-the-build-hold-is-released-albert-hazan-2026-08-09) | OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09) |
| [6.14](#614-owner-ruling-this-repository-is-public-no-personal-identifiers-in-anything-you-write-from-now-on-albert-hazan-2026-08-09) | OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09) |
| [6.15](#615-owner-ruling-there-are-exactly-two-kinds-of-property-list-and-coreproperty-universe-a-is-to-be-deleted-albert-hazan-2026-08-19) | OWNER RULING — there are exactly TWO kinds of property list, and `core.property` (Universe A) is to be DELETED (Albert Hazan, 2026-08-19) |
| [6.17](#617-owner-ruling-designflows-numeric-division-ids-are-wrong-and-do-not-come-to-this-database-the-coldlion-division-code-is-the-only-division-there-is-albert-hazan-2026-08-19) | OWNER RULING — DesignFlow's numeric division ids are WRONG and do NOT come to this database; the ColdLion division CODE is the only division there is (Albert Hazan, 2026-08-19) |
| [6.16](#616-owner-ruling-licence-contracts-are-not-a-source-for-this-database-and-licence-term-and-territory-do-not-belong-in-it-at-all-albert-hazan-2026-08-19) | OWNER RULING — licence CONTRACTS are NOT a source for this database, and licence TERM and TERRITORY do not belong in it at all (Albert Hazan, 2026-08-19) |

---

### 6.1 Merch groups / licensors / properties — read this before touching them

Start from the business object, not the old shared table:

- Licensor, Property, Character, Style Guide, Franchise, licensed Asset, source authority,
  or Property Active/Inactive starts at
  [`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md).
- MG01–MG14, `mgCategory`, product type/subtype, big theme, little theme, art type,
  art source, artist, age group, division meaning, or `mgTypeCode` starts at
  [`docs/business-rules/merchandise-and-product-taxonomy.md`](docs/business-rules/merchandise-and-product-taxonomy.md).

The merchandise-group document explains legacy shape. It does not override the settled
2026-08-16 licensing authority rules.

For the active ColdLion Licensor/Property source cutover, read the STATUS table in
[`plan_coldlion_licensor_property_accelerated_cutover.md`](plan_coldlion_licensor_property_accelerated_cutover.md)
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
  [`docs/advisory-lock-registry.md`](docs/advisory-lock-registry.md)), because the scheduled
  lane and a manual drill could otherwise promote the same rows at once and leave an
  unreadable audit trail. A caller that loses that race records an `ingest.sync_run` row with
  `status = 'cancelled'` and `metadata.outcome = 'skipped_already_running'`, and the runner
  exits **3**. Never "tidy" that into `failed` or into exit 1: the two-consecutive-**failed**-row
  `pg_notify` breaker in `tools/coldlion-sync-common.mjs` would then trip on two perfectly
  healthy overlapping cycles and block promotion until an authorized reset.

Evidence and the full defect list:
[`docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md`](docs/verification/coldlion-licensor-property-step7a-recurring-feed-20260729/README.md). Albert decided on 2026-07-26 to replace the original
14-day elapsed-time gate with an invariant-based readiness gate plus rapid post-cutover monitoring.
The existing production prohibition remains in force until that plan's preview rehearsal,
readiness, and explicit production-approval gates pass.

For **PopSG folder-derived Property matching and reconciliation**, the single
bounded execution plan is
[`fix_popsg_property_taxonomy_reconciliation.md`](fix_popsg_property_taxonomy_reconciliation.md).
It applies the ColdLion and style-guide architecture decisions without replacing
either authority document. Its phases are named `PSG-0` through `PSG-7` to
avoid collision with ColdLion phases. `PSG-0`–`PSG-4` are preparation only;
`PSG-5` requires a recorded ColdLion checkpoint and owner sign-off, and `PSG-6`
must not overlap ColdLion Phase 7.

**If your work touches characters, style guides, or royalty rates, read
[`docs/style-guides-characters-and-royalties.md`](docs/style-guides-characters-and-royalties.md)
FIRST.** Read its historical measurements under the controlling 2026-08-16 architecture in
[`docs/business-rules/licensing-master-data.md`](docs/business-rules/licensing-master-data.md).
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
1. [`docs/division-code-answers-from-uma-20260813.md`](docs/division-code-answers-from-uma-20260813.md) — the answers, with two withdrawn fix rules
2. [`docs/merchgroup-271-division-conflicts-back-to-uma-20260817.md`](docs/merchgroup-271-division-conflicts-back-to-uma-20260817.md) — why the 271-row fix creates 142 duplicates
3. [`docs/division-code-round2-answers-and-reference-check-20260817.md`](docs/division-code-round2-answers-and-reference-check-20260817.md) — the reference check: **178 of 363 unclean rows are safe to clean, 185 are not**

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
   > [`docs/plan_coldlion-landing-phases-2-6.md`](docs/plan_coldlion-landing-phases-2-6.md).
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
design/state: [`fix_vendor_sync.md`](fix_vendor_sync.md). Detail:
[`docs/coldlion-erp-api-reference.md`](docs/coldlion-erp-api-reference.md) (✅ box).

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
[`docs/google-sheets-import-authority-20260803.md`](docs/google-sheets-import-authority-20260803.md).

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
   [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md);
6. the change and the prior value are audited and reversible;
7. Property status is untouched, because only guarded ColdLion membership controls Active/Inactive.

This does **not** exempt a spreadsheet dump, pasted rows, a one-off API pull, direct SQL, or an AI
session that decides to imitate the future consolidator. Those remain fully bound by §6.4-C and
write nothing on matched rows. Until the guarded consolidator in
[`plan_licensing_master_data_implementation.md`](plan_licensing_master_data_implementation.md) is
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
`parse_allowlist` in [`scripts/production_migration_guard.py`](scripts/production_migration_guard.py)
refuses an allowlist containing ANY member of `FR_HELD_20260803` **or** `FR_COMPATIBILITY_VERSIONS`
until `FR_REMOVAL_VERSIONS` is populated and the whole ship set is present. Until 2026-08-18 the
code triggered only on `FR_HELD_20260803`, so `20260817225127` promoted **alone** parsed clean —
narrower than this prose. The prose is authoritative and the code now matches it.

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

### 6.6 OWNER RULING — DB Data Admin is the home for licensor→property parentage (Albert Hazan, 2026-08-03) — this REVERSES the previous stance

> "DB Data Admin screen should be where we monitor and establish the licensor→property parent-child
> relationship. It sits in designflow now but we all agreed it should not be only in 1 particular
> application."
> — Albert Hazan, 2026-08-03

This is a standing rule, ruled by the owner. **It is settled — do not re-ask it, do not treat it as
an AI's preference, and do not weaken it.**

**This is a REVERSAL. The repository currently says the opposite in two places, and both are now
superseded by this section:**

| Where it still says the opposite | Exact text | Status |
| --- | --- | --- |
| `supabase/migrations/20260722170000_db_data_admin_single_record_updates.sql` (the `-- Refused here:` comment) | `-- Refused here: name/code (source vocabulary), is_potential (trigger-owned), PLM status (…), aliases, source refs, related Customer, Licensor/Property, merge, bulk, deletion.` | **Applied migration — DO NOT EDIT IT.** |
| `apps/db-data-admin/src/LicensorTree.tsx` (orphan panel copy) | "The relationship is DesignFlow-owned; do not repair it here." | Superseded; correct by a FORWARD change when the curation path is built. |

Both were verified verbatim against the tree on 2026-08-03. Near-identical "the edge is
DesignFlow-owned" wording also appears in `20260722203000_db_data_admin_licensor_property_tree.sql`,
in `20260727154500_db_data_admin_bounded_production_forward.sql`,
and in `apps/db-data-admin/tests/browser/grid.spec.ts`. All of it is superseded as
**policy**; the migrations remain accurate as **history**.

**The never-edit-an-applied-migration rule still wins.** `20260722170000` is applied. An applied
migration never re-runs, so editing its text changes **nothing** in the database and desynchronises
the file from the ledger (§4 rule 4). **Leave it alone.** `AGENTS.md` — this section — is the
governing statement of policy. The application copy in `LicensorTree.tsx` and the behaviour it
describes are corrected by a **forward** change, authored when the curation path is actually built,
never by rewriting history.

**The rule.**

1. **DB Data Admin (`apps/db-data-admin/`, `https://data.designflow.app`) is the home for both
   MONITORING and ESTABLISHING the licensor→property parent-child relationship.** "Refused here" no
   longer describes the intended product; it describes the state of the code before this ruling.
   **"The home" means the cross-application curation surface, NOT an exclusive owner.** Albert's
   objection is to the capability living inside one *line-of-business application* (DesignFlow);
   DB Data Admin is the shared administrative surface over `core.*` that every app's data flows
   through, which is why it is the answer rather than a second lock-in. The authority that matters
   is the **curated data in `core.*`**, which any app may read; DB Data Admin is where a human
   establishes it. Do not read this section as a licence to forbid some future second curation
   surface, and do not read it as permission to leave the capability in DesignFlow.
2. **The relationship is no longer DesignFlow-owned.** Any doc, comment, UI string, or agent
   assumption that says "DesignFlow is the single writer of `core.property.licensor_id`, repair it
   there" is stale from 2026-08-03 onward.
   **This deposes DesignFlow as the OWNER, not as today's mechanism.** Until the DB Data Admin
   curation path actually ships, DesignFlow PLM remains the **interim writer of record** and a
   parentage repair made there is legitimate. Do not disable, block, or "clean up" the DesignFlow
   path on the strength of this ruling — that would leave no repair path at all (see rule 4).
3. **This does not by itself authorise a write path.** It sets the destination. The actual editing
   capability is new work: it needs a bounded write contract in the shape of §6.1/§4.2 (whitelisted
   typed parameters, optimistic concurrency, audit rows, the existing
   `app.db_data_admin_feature_gate`), plus durability so the PLM importer cannot revert it — see the
   related rulings below. **Do not ship a raw editable `licensor_id` column in the grid.**
   **The refusal in `20260722170000` is executable, not merely documentary.** That migration's
   comment records a refusal the shipped write contract actually enforces, so DB Data Admin will
   *reject* a parentage write today no matter what this section says. That is correct and expected
   — policy moved first, capability follows. **A rejection from that contract is NOT a bug to route
   around**, and it must never be routed around with direct SQL, a service-role write, or an ad-hoc
   session (§6.4-C forbids that last one outright). It is removed only by the forward migration that
   builds the new bounded contract.
4. **Until that path ships, here is the ONLY compliant way to repair a wrong parent** — stated
   explicitly because three rules read together otherwise appear to forbid every route. In order of
   preference: **(a)** fix it in DesignFlow PLM, still the interim writer per rule 2, and let it
   flow through; **(b)** if it cannot be fixed upstream, author it as a **shared-db migration** in
   this repo — branch, PR, preview first, §5 checklist — recording the human decision, and where the
   decision is the owner's, record it in `core.taxonomy_owner_ruling` too. A migration that encodes a
   named human's decision **is** hand curation, and is exactly what §6.5's removal work does for
   property `FK`; it is not the "inferred from product data" thing that is banned. What is never
   permitted is **(c)** an ad-hoc session typing the fix straight into Master Data. Note the
   durability caveat in rule 5 applies to (a) and (b) alike on production.
5. **Durability is not yet in force on production, and §6.5 deliberately holds the fix.**
   `20260802170000` — the migration that stops `plm.import_master_data` force-setting
   `core.property.licensor_id` — is merged but **held from production by §6.5** until the FR removal
   work ships. So on production today, any parentage set by any route is still reverted on the next
   successful PLM master-data sync. Two consequences: **do not treat "we have a durability
   migration" as "curated parentage is durable"** when scoping the DB Data Admin write path — the
   write path must not be enabled on production before `20260802170000` is applied there; and do not
   try to unblock it by promoting `20260802170000` early, which §6.5 forbids. (The lane has not
   succeeded since 2026-07-08 — see §6.4 — which is currently masking the problem, not fixing it.)

**How this sits with the related standing rulings.**

- **Parentage is HAND-CURATED, never inferred.** Albert ruled on 2026-08-03 that the
  property→licensor parent link must live in a curated Supabase table — which today **is
  `core.property.licensor_id`**, the existing canonical column; the ruling requires that it be set
  by hand, not that a new table be invented, and no session should design one on the strength of
  this wording — and must **never** be derived
  from product data. Item/style co-occurrence is an **audit tool only** — it may flag a suspicious
  parent for a human to look at; it may never set one. A curation *screen* is exactly what a
  hand-curated link requires, so the hand-curation ruling and this section point the same way.
  (Recorded in the
  orchestrator intake as ruling 4.)
- **`dflow.*` is being retired; `core.*` becomes the source of truth for all applications.**
  Under the controlling 2026-08-16 architecture as clarified on 2026-08-19, ColdLion supplies
  canonical Licensor names, uncovered ColdLion-only Property truth, and Property Active/Inactive.
  Authorized licensor scrapes supply Property identity, ownership and source-published relationships
  inside their coverage. The stale DesignFlow pull supplies neither.
  **§6.6 is the direct consequence of this.** If `core.*` serves every app, the surface on which
  humans curate `core.*` must not be locked inside one application — which is precisely Albert's
  "it should not be only in 1 particular application". Building further curation into DesignFlow
  would deepen a dependency the plan of record removes.
- **§6.4 protects the result.** Curated parentage set in DB Data Admin is exactly the kind of
  deliberate human decision an import may never revert or re-parent. Note that
  `plm.import_master_data` on production **still force-sets `core.property.licensor_id` on every
  matched row** (§6.4), so until `20260802170000` is applied to production, parentage curated
  anywhere — DB Data Admin included — is not durable there.

**Controlling answer, clarified 2026-08-19:** ColdLion owns official Licensor names. The applicable
authorized licensor scrape wins for Property spelling and ownership inside its coverage. For a
ColdLion-only Property under a Licensor with no scrape data, ColdLion's Property name and owning
Licensor are canonical. ColdLion also decides whether a Property is Active or Inactive. DesignFlow
has no authority. See the central licensing architecture document.

### 6.7 OWNER RULING — branch protection on `main` is ON, and CI guards are no longer advisory (Albert Hazan, 2026-08-04)

> ### ⛔ READ THIS FIRST — two owner rulings on 2026-08-07 that change everything below
>
> **(1) `u2giants/shared-db` is PUBLIC, and it stays public.** It was made private at
> ~15:10 UTC on 2026-08-07 and **public again at ~16:5x UTC the same day, on Albert's
> explicit and twice-repeated instruction.** Do **not** make it private again, and do not
> re-raise the question.
>
> **(2) OWNER RULING — the Disney OPA property/character extract is NOT sensitive
> (Albert Hazan, 2026-08-07).** `docs/verification/opa-characters-20260806/opa-characters.csv`
> — 10,262 rows of Disney property and character names with Disney's own IDs — may stay in
> this public repository. Albert was told plainly, twice, that making the repo public
> republishes that file and that it had never been moved to `licensor-source-data`. He
> ruled: *"that data is not sensitive."* **He owns the Disney licensee relationship and
> this is his call to make. It is settled.**
>
> **What this supersedes.** Request **R-SEC-1** — in the retired `COORDINATOR_INTAKE.md` queue,
> readable only in history via
> `git show 360b85b3eec79c5f498cf9e669350737db27e6ab:COORDINATOR_INTAKE.md` — asks for that
> CSV to be moved out and scrubbed from git history before the repo can go public. **Its
> premise is overruled.** Parts (a) and (b) — move the file, leave a pointer — are now
> optional tidying, not a blocker. Part (c), the git-history rewrite, is **cancelled**;
> do not rewrite this repository's history for that reason. Part (d) is done.
> The private repo `u2giants/licensor-source-data` exists and holds only a README.
>
> **Why this is written here and not only in the queue.** A future session reading R-SEC-1
> on its own would make the repo private again, which silently destroys branch protection
> (see the note below). This ruling is the stop.
>
> **⚠️ The trap that caused it, worth keeping.** Going private **silently removed all
> branch protection**, because a private repository on this account's plan cannot have it.
> `gh api …/branches/main/protection` returned `403 "Upgrade to GitHub Pro or make this
> repository public"` and `…/branches/main` reported `protected: false`. Nobody noticed for
> about two hours. Protection was **restored in full** at 2026-08-07 after the repo went
> public again, and read back live to the exact table below. **Visibility and protection
> are coupled on this plan. Never change one without checking the other.**

Albert turned branch protection **ON** for `main` on 2026-08-04. This is a standing decision, ruled
by the owner. **It is settled — do not re-ask it, do not treat it as an AI's preference, and do not
weaken it.**

**The verified fact, not a claim.** Read back live and **RE-DERIVED on 2026-08-12** (previous
re-derivation 2026-08-06 16:00 UTC) with:

```bash
gh api repos/u2giants/shared-db/branches/main/protection
```

The 2026-08-14 read matched every row below exactly, including `Migration author lease`,
`Migration guarded merge authorization`, and **not** `Backlog / queue sync`; `strict: true`, `enforce_admins: true`,
`allow_force_pushes: false`, `allow_deletions: false`. **The table is accurate as of that date —
and you must still run the command rather than trust it.**

| Setting | Value |
| --- | --- |
| `required_status_checks.contexts` | `["Promotion contract tests (offline)", "Cross-PR object collision", "Tools offline tests", "SQL migration guards", "Domain ownership", "Intake pointer guard", "Handoff contract", "Migration author lease", "Migration guarded merge authorization"]` (**nine**) |
| `required_status_checks.strict` | **`true`** (changed 2026-08-06 — see below) |
| `enforce_admins.enabled` | **`true`** |
| `allow_force_pushes.enabled` | `false` |
| `allow_deletions.enabled` | `false` |

> **`strict` was turned ON on 2026-08-06, by the owner's explicit instruction.** It had
> been `false`, which left a real hole: `.github/workflows/pr-object-collision.yml` says in
> its own header that it cannot re-run when a *sibling* PR appears later, so the last
> member of a colliding set must be re-checked — and *"require branches to be up to date
> before merging"* is what forces that. With `strict: false`, two PRs could both pass every
> check and both merge, silently erasing one another. That is the 2026-07-31 four-way
> incident's exact mechanism. **Do not turn it back off.**
>
> ⚠️ **This table was stale for two days once already** — it read `strict: false` and four
> contexts after both had changed. A reviewing model (Grok 4.5, 2026-08-06) read it and
> concluded a *correct* document was wrong.
>
> **STANDING INSTRUCTION: never quote this table as fact. Run the `gh api` command above and
> quote the live output**, in any issue, handover, review, or PR description that turns on
> branch protection — and re-read it back whenever you change protection, stamping the new date
> here. This follows §4.3 (point at the live reading, never at a number). Prose asserting mutable
> state goes stale; the command does not. Two rows are **owner rulings you may never weaken to
> make a check pass**: `strict` stays `true` and `enforce_admins` stays `true`.

**The rule.**

1. **CI guards on this repository are no longer advisory.** Merging through a red *required* check
   is now **mechanically impossible**, including for admins — `enforce_admins` is `true`, so there
   is no "orchestrator override". The event that motivated this ruling was real: on 2026-08-03 PR
   #431 was merged through a **red** `verify` check (run `30846938009`, job `91797438635`). That
   route is closed.
2. **`main` cannot be force-pushed or deleted.** Any recovery plan that assumes a rewrite of `main`
   is invalid. Fix forward.
3. **Branch protection must not be removed or weakened without an explicit, per-change owner
   instruction naming the setting.** "Unblock the merge", "CI is stuck", "fix the pipeline", or a
   deadline is **not** approval. If a required check is wrong, fix the check — never the protection.
   This mirrors the standing production-infrastructure rule: an AI session does not relax a control
   in order to get past it.
4. **Every PR to `main` — including a docs-only PR — must now pass all SIX required contexts
   before it is mergeable:** `Promotion contract tests (offline)`, `Cross-PR object collision`,
   `Tools offline tests`, `SQL migration guards`, `Domain ownership`, `Intake pointer guard`.
   *(Corrected 2026-08-07. This line said FOUR and listed four for days after there were six —
   re-derive the list with `gh api`, never from this sentence. `Backlog / queue sync` was
   removed and `Intake pointer guard` added on 2026-08-07 by owner instruction naming both.)* Confirm with `gh pr checks` before reporting
   a PR as ready, and check the run's `head_sha` — a green tick can be a **stale verdict from an
   older commit**. A green PR page is not the same as a satisfied required context.

**PATH FILTERING — where it still applies, and where this document was wrong.**
*(Corrected 2026-08-09, plan item F. This paragraph previously said BOTH database-touching
workflows were `paths:`-filtered and that neither could ever be required. That was stale, and
it discouraged the migrations-lane hardening it should have invited. Re-derive from the
workflow files, never from this sentence.)*

The mechanic is real: a `paths:`-filtered workflow reports **NO check at all** on a PR that
misses its paths, GitHub treats a required context that never reports as *pending forever*, and
making such a workflow required would **deadlock every unrelated PR**.

Measured live on 2026-08-09:

- `.github/workflows/shared-supabase-migrations.yml` is **NOT** path-filtered. Its `on:` block
  (`:4-9`) carries a comment saying the omission is deliberate, for exactly this reason. Its
  cheap `validate` job (`SQL migration guards`) runs on **every** pull request and is **already
  one of the six required contexts**. The expensive `preview` and `production-dry-run` jobs are
  gated on `workflow_dispatch`, not on paths.
- `.github/workflows/db-data-admin.yml` **IS** path-filtered (`:5-12`, `:15-22`) and therefore
  cannot itself become a required context. This does **not** leave domain ownership unguarded:
  the required `Domain ownership` context comes from the separate, unfiltered
  `.github/workflows/domain-ownership.yml` (`:26`).

**What is still honestly true.** The migrations lane's *cheap, static* guards block a merge; its
*expensive* jobs — the ones that talk to a real database — run only on `workflow_dispatch` and so
cannot block a merge. Do not let "protection is on" stand in for "a bad migration cannot be
merged": static SQL checks pass on a migration that is destructive at runtime. But do **not**
repeat the retired claim that path filtering makes hardening this lane impossible. It does not.

### 6.8 OWNER RULING — the six HARD_BLOCKED ColdLion migrations are NOT unblocked individually (Albert Hazan, 2026-08-04)

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not read it narrowly.**

**What is forbidden.** Unblocking any `HARD_BLOCKED` ColdLion migration **on its own** — one at a
time, a few at a time, or "just the safe ones". There is no size of subset that makes it allowed.

**What is permitted — one event, carrying all three parts together.** Any unblocking ships bundled
with:

1. **its negative test that proves the guard actually FIRES** (the backlog **B7** standard — an
   assertion that the guard *rejects* the bad input, not merely that the happy path passes); **and**
2. **a whole-batch pre-flight check that proves the ENTIRE promotion batch can run end to end** —
   not that the individual migration applies.

**Why, so a future session does not "helpfully" unblock one.** The production promotion lane
currently **ABORTS AT FILE 3 OF 14** — found by agent `prod-lane-design`, PR #403. A migration
unblocked on its own would therefore be handed to a lane that stops a third of the way through, and
production would be left **PARTIALLY PROMOTED**: some ColdLion migrations applied, the rest not,
with no undo (production changes here are forward-only). A half-applied taxonomy batch is worse than
an un-promoted one, because it looks finished. The pre-flight requirement exists precisely to catch
that before the first irreversible write, not after it.

**The count is SIX, not four — correct any document that says four.** Agent `hardblock-archaeology`
(PR #407) found **six** `HARD_BLOCKED` entries and confirmed the **42P01 (undefined table)** chain
behind them. Older docs say four. **A promotion list built from the old count ships a partial fix**
— which is the exact failure this ruling exists to prevent. Confirm the real scope live before
acting; do not inherit either number on trust.

### 6.9 OWNER RULING — the 33 unmatched ColdLion property codes are NOT admitted before the resolver is fixed (Albert Hazan, 2026-08-04)

> ### ⛔ SUPERSEDED 2026-08-20 — the codes ARE now admitted.
> Albert Hazan, 2026-08-20: **admit all 66 unmatched ColdLion property codes**, including the 51
> still marked active. The objection preserved below — that ColdLion has no licence-expiry flag, so
> admitting them resurrects lapsed licences — is answered by **owning the flag ourselves** rather
> than refusing the rows. `core.property.status` already accepts `inactive`.
>
> **The pairing is not optional:** the DB Data Admin application must gain a control to mark a
> property inactive on our side ([issue #1322](https://github.com/u2giants/shared-db/issues/1322)).
> Admitting without it recreates exactly the risk this ruling was protecting against.
>
> The original text is kept below as the reasoning, not as the current rule.

> "Fix the attachment logic first, then admit the codes."
> — Albert Hazan, 2026-08-04

This is a standing **DO-NOT**, ruled by the owner. **It is settled — do not re-ask it, do not treat
it as an AI's preference, and do not reorder it.**

**The rule.**

1. **The 33 unmatched ColdLion property codes must NOT be admitted until the status-blind resolver
   is fixed first.** The order is not negotiable and is not a preference about sequencing
   convenience: the resolver is what decides which status each admitted code lands on, so admitting
   first means admitting **against the wrong statuses**, and every one of those rows then has to be
   found and corrected by hand.
2. **In that order, in ONE reviewed change — never the admission alone.** A PR that only admits the
   codes is out of compliance with this ruling even if the resolver fix is "planned next". The fix
   and the admission are reviewed together so the reviewer can see the codes land against a resolver
   that is already correct.
3. **When they are admitted, they go in as `potential`, NOT `inactive`.** This is Kimi's
   recommendation and it is **already accepted** — it is not open for re-litigation. Marking an
   unmatched code `inactive` silently hides what may be a real, live property; `potential` says
   truthfully that it exists and has not yet been reconciled.

**Relationship to the 2026-08-16 licensing architecture.** The admission moment still follows rule
3: a reviewed create-new row starts `potential`, never `inactive` or `active` by default. After its
ColdLion identity is durably mapped and a complete guarded membership cycle proves it is present,
the newer settled rule permits the separate status function to make it `active`. Thus "Potential at
admission" remains in force; it does not mean "stay Potential after successful mapping forever."

**A count caveat, stated so nobody launders it into a fact.** The figure was **66** at the
2026-07-31 handover and is recorded as **33** now. That reduction has **not** been independently
re-verified. Re-derive the real count at the time of the work; do not build the admission list from
this section's number.

### 6.10 OWNER RULINGS — the licensor/property model, and "the feed should not drop anything" (Albert Hazan, 2026-08-06)

Five rulings, all given the same day, all **settled**. Do not re-ask them, do not treat them as an
AI's preference, and do not reorder ruling 5.

**1. Coco IS a Disney license.** This closes the long-open question of whether `Coco` sitting under a
"NO LICENSE" licensor was deliberate. It was not. Detail and the resulting open technical question
live in [`fix_characters_style_guides.md`](fix_characters_style_guides.md).

**2. The CODE alone is meaningless — the DESCRIPTION decides the licensor.**

> "If the CC is connected to a description that says Coco, it's Disney. If it says Coca Cola, it's
> under the Coca Cola licensor."
> — Albert Hazan, 2026-08-06

Never resolve a licensor from a property/item code by itself. Read the description that travels with
the row.

**3. Licensor → Property is parent-child, and property codes are NOT globally unique.** The same code
may exist under many licensors. `core.property` is keyed `(licensor_id, code)`
(`20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql`, and see
[`docs/licensor-property-parent-child-design-20260802.md`](docs/licensor-property-parent-child-design-20260802.md) §2.1).

> **This corrected a wrong assumption the orchestrator held on 2026-08-06, and that assumption is
> baked into at least one committed tool.** `tools/validate-licensing-answers.mjs` (the property
> lookup) resolves a property with `where p.code = any($1)` — no licensor scope.
> It selects the licensor name and then discards it; only `r.code` is used. It is safe **only**
> because today's `core.property` copy is crippled (256 rows, one row per code). **Repairing the feed
> before fixing that query would introduce silent wrong-licensor binding.** Fix the scoping FIRST.
> This is the same ordering principle as §6.9.
>
> Phrases like *"re-parent CC to Disney"* are not meaningful instructions and must not be planned in
> those words — say which `(licensor_id, code)` row you mean.

**4. "The feed should not drop anything."** The master-data feed must stop silently discarding rows.
There must be a **licensor/property triage page in DB Data Admin** (the app that serves
`data-dev.designflow.app`) where Albert fixes the problems the feed finds, instead of the feed
throwing them away. Requirement:
`docs/licensor-property-triage-page-requirement-20260806.md` (added 2026-08-06 on branch
`docs/licensor-property-triage-page-20260806`).

**5. STOP THE DATA LOSS FIRST — ordering ruling.** Asked whether to settle the storage question for
an ownerless property (nullable FK vs. a holding licensor vs. a quarantine table) before shipping, or
to stop the loss first, Albert chose **stop the loss first**. Ship quarantine/triage before settling
the model.

#### 6.10-A What was measured on 2026-08-06 (production `qsllyeztdwjgirsysgai`, read-only)

Recorded so nobody re-measures it, and so nobody quotes the one number that is **not** verified.

| Finding | Value |
|---|---|
| Supabase `core.*` vs DesignFlow | 26 licensors / 256 properties / 256 parent edges **vs** 82 / 614 / 503 |
| Why roughly half the tree never arrives | **By design** — the feed drops inactive properties, unparented properties, and childless licensors. This is the loss ruling 4 forbids |
| Parent data staleness | Every property row carries the same `updated_at`, **2026-07-08** — the day the PLM sync died. **29 days stale** as of 2026-08-06 |
| Sync ledger | All 15 sync runs recorded **"succeeded"**. The 502 is invisible in the ledger — never trust `sync_run` status as proof of freshness |
| Unparented properties in DesignFlow | 111, of which 51 active — VERIFIED live, matches the docs |
| `core.character` | **EMPTY on production** (0 rows) |
| `plm.item` | **EMPTY** (0 rows) — the modeled item master was built and never populated |
| `public.erp_items_current` vs `plm."itemHeader"` | 17,703 vs 19,563 rows; **14 items exist only in `plm."itemHeader"`** |
| The `CC` case | `core.property` holds one `CC` row named `COCO` under licensor `ZZ` (DTR - NO LICENSE). All **14** items filed there are Coca-Cola merchandise **by description**. Seven items under licensor `DY` (Disney) + property `CC` are genuinely Coco. The real COCA COLA licensor exists but is **INACTIVE with zero items** |
| Item numbering | `AAA00LLPP00` — chars 6-7 licensor, 8-9 property — holds for **~77%** of items |
| Parent edges pointing at a non-active licensor | **499 of 503.** Nobody knows what "inactive" means in this data — do not infer it |
| ⚠️ "241 of 322 property codes (75%) under more than one licensor" | **UNVERIFIED.** This figure has been quoted verbally but is recorded **nowhere** in the repo and was not reproduced on 2026-08-06. **Do not state 75% as fact.** Re-measure before using it |

#### 6.10-B Three corrections to statements already in this repo (2026-08-06)

1. **DB Data Admin lives in THIS repo**, at `apps/db-data-admin/`, despite serving a
   `designflow.app` hostname. Only the feed **endpoint** change is DesignFlow work. (Verified: the
   directory exists here.)
2. **The `NOT NULL` on `core.property.licensor_id` came from
   `20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql` lines 71–72**, not from the
   original `20260621150815` migration. (Verified against the file.)
3. **Blocker 8 was mis-stated across the handover docs.** The endpoint they cite is a **READ**
   endpoint. The real writer is `PATCH /api/admin/updateMerchGroup`
   (`designflow-backend/routes/admin.router.js:87`), and its real defect is that it is **type-blind**.
   Detail: `docs/licensor-property-cloudsql-cutover-plan-20260806.md` (branch
   `docs/licensor-property-cutover-plan-20260806`).

### 6.11 `DY` and `DS` are ONE company — the Disney licensor has two spellings (added 2026-08-07)

**`DY` in `core.licensor` is the canonical Disney licensor code. `DS` in the legacy
`public.licensors` table is the RETIRED spelling of the SAME COMPANY. They must never be treated as
two companies, and no session should re-open the question.**

This is not an inference. `supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
— merged and **already applied to production** — hard-codes the mapping in its own SQL:

```sql
case legacy.external_id
  when 'DS' then 'DY'
  when 'WWE' then 'WW'
  else legacy.external_id
end
```

That migration aborts loudly if any legacy licensor fails to map, and it did not abort. **136,697
`public.assets` rows and 10,618 `public.style_groups` rows were rewritten onto canonical
`core.licensor` UUIDs on that basis.** Current production data depends on `DS` = `DY` being right.

The full census — every Disney-related row in both licensor lists, the per-licensor child counts, the
4,048 `plm.style_tracker_item_bridge` rows that already carry the `DY` and `DS` UUIDs *on the same
row*, and the read/write map per application — is in
[`docs/verification/disney-licensor-identity-20260807/README.md`](docs/verification/disney-licensor-identity-20260807/README.md).
**Read it there; do not duplicate or re-measure those numbers here.**

**The same shape exists for WWE, and nobody has documented it.** `public.licensors` spells it `WWE`;
`core.licensor` spells it `WW`. Identical class of duplicate, mapped by the same `case` expression
above, still undocumented and unfixed. Treat it the same way: one company, two spellings, `WW`
canonical.

**What this section does NOT authorise.** It is paperwork, not surgery (Albert chose "Option 2" of
that document on 2026-08-07). Retiring `public.licensors`, moving the ~500 legacy property records,
or re-parenting MARVEL and STAR WARS under DISNEY are all explicitly **out of scope and declined** —
ColdLion pays royalties off Marvel and Star Wars being separate licensors.

### 6.12 CORRECTION to §6.6 rule 5 — there is NO parentage-durability migration (added 2026-08-07)

**§6.6 rule 5 above says `20260802170000` is "the migration that stops `plm.import_master_data`
force-setting `core.property.licensor_id`". That sentence is WRONG.** Verified against the file on
2026-08-07; its own header block says the opposite:

> "The property UPDATE still sets `licensor_id = parent_core_licensor_id`. Whether our curated
> parentage should outrank DesignFlow PLM's is an owner decision nobody has made."

`20260802170000` preserves curated **`status` only**. **No parentage-durability migration exists
anywhere in this repository — not merged, not held.** So promoting `20260802170000` would not make
curated parentage durable, and §6.5's hold is not what is blocking durability. Any curated
`core.property.licensor_id` — set by DB Data Admin, by DesignFlow, or by a migration — is reverted by
the next **successful** `plm.import_master_data()` run.

The exposure is currently **dormant, not fixed**: the PLM master-data lane has not succeeded since
2026-07-08 (§6.4, §6.10-A), which is why every `core.property` row still carries that `updated_at`.
**Parentage durability must be built before the lane is repaired**, or every curated parent edge
silently reverts the moment it comes back. Do not treat "we have a durability migration" as "curated
parentage is durable".

### 6.13 OWNER RULINGS — Paramount landing tables and sub-licensors (Albert Hazan, 2026-08-07)

> ### ⚠️ TWO OF THESE FIVE RULINGS CHANGED ON 2026-08-09 — read this before quoting any of them
>
> **Owner ruling, Albert Hazan, 2026-08-09** (recorded by orchestrator session `8b3f21c4`,
> marker issue [#622](https://github.com/u2giants/shared-db/issues/622)):
>
> | Ruling | Status as of 2026-08-09 |
> | --- | --- |
> | 1 — per-licensor landing tables | **STANDS UNCHANGED** |
> | 2 — "release 1 is FIVE tables, not fifteen" | **SUPERSEDED.** The five-table cap is **lifted**. |
> | 3 — authorized-title count closed at 26 | **STANDS UNCHANGED** |
> | 4 — "build waits for the second Paramount recon" | **SUPERSEDED.** The hold is **RELEASED**; its condition was met. |
> | 5 — sub-licensors stay flat | **STANDS UNCHANGED** |
>
> The original text of rulings 2 and 4 is kept below, marked, because sessions have been
> quoting it. Do not act on the struck parts. The replacements are in §6.13-A.

Five rulings, all made on the evening of 2026-08-07, **two of them since superseded** (see the box
above and §6.13-A). Full record with the reasoning and the
costs: [`docs/verification/owner-rulings-20260807/README.md`](docs/verification/owner-rulings-20260807/README.md).
Read that file before acting on any of them.

1. **Per-licensor landing tables, not one shared table.** Each licensor's raw scrape data gets its
   own `plm.*` tables. No shared multi-licensor landing table with a discriminator column. A shared
   table would force Disney's hard `CHECK`s to be softened for a licensor they have nothing to do
   with, and the importer's shrink-band guard counts rows in its own table — unscoped, a
   **completely truncated Paramount extract would pass by being measured against Disney's ~10,262
   rows**. Silent wrong answer, not a loud one.

2. ~~**Paramount release 1 is FIVE tables, not fifteen.**~~ **SUPERSEDED 2026-08-09 — see §6.13-A.1.**
   Original text, kept because it has been quoted:
   ~~Ships `plm.pmt_capture`, `pmt_property`,
   `pmt_character`, `pmt_property_character`, `pmt_asset`, plus importer, RLS/grants, one `api` view
   and contract tests. Eleven further tables, four views and the collection trigger are deferred —
   they model structure no capture has proven. **Known consequence: release 1 loads assets that
   connect to nothing.** It can answer which characters a property owns, but not which asset shows a
   character.~~

3. **The Paramount authorized-title list is 26, and the count is CLOSED.** The removed `902010`
   entry was a duplicate. Do not re-open it and do not hunt for a 27th title. The *"Viacom Multi
   (Paramount) — 27 codes"* section of
   [`docs/coldlion-unmatched-properties-by-licensor-20260731.md`](docs/coldlion-unmatched-properties-by-licensor-20260731.md)
   is a **different population** (unmatched ColdLion property codes) — do not reconcile the two.

4. ~~**Build waits for the second Paramount recon.**~~ **SUPERSEDED 2026-08-09 — the hold is
   RELEASED; see §6.13-A.2.** Original text, kept because it has been quoted:
   ~~The five tables are designed, reviewed, revised
   and approved, but implementation is **held** until a targeted second recon returns. Each of its
   four open questions can move a primary key, and a wrong key with rows already in it costs a
   migration **plus** a data repair. Do not start the migration because "the design is approved".~~

5. **Sub-licensors stay FLAT.** ColdLion produced 19 new `- DESPERATE` records (5 licensors, 14
   properties). Desperate is a **sub-licensor, not the brand owner**: POP reports sales to Desperate,
   who files royalty reports upward to the real owner. FanCreations is the same shape for NCAA and
   NFL. `core.licensor` will **NOT** model this; Desperate is stored as an ordinary licensor.
   **Consequence, invisible in the data: any report answering "who is the licensor" for those 14
   properties returns Desperate, not the ultimate brand owner.** Also: `ANHEUSER BUSCH - DESPERATE`
   and the existing `potential` `Anheuser Busch` record are **NOT duplicates** — brand owner vs
   sub-licensed route. A future dedupe pass must not merge them.

### 6.13-A OWNER RULING — the Paramount five-table cap is lifted and the build hold is released (Albert Hazan, 2026-08-09)

Recorded by orchestrator session `8b3f21c4`, marker issue
[#622](https://github.com/u2giants/shared-db/issues/622). This supersedes **parts** of §6.13:
rulings 2 and 4 only. Rulings 1, 3 and 5 stand unchanged and are not reopened by this.

**Evidence anchor for everything below.** The completed second Paramount capture lives in the
**private** repo `u2giants/licensor-source-data`, branch `codex/paramount-creative-library-20260807`,
HEAD **`f340f74a`**, with its manifest. `u2giants/shared-db` is **public**: the counts and the
structural shapes below are cleared for publication; Paramount titles, property names, entity names,
source IDs, asset IDs and filenames are **not** and must never be committed here.

#### 6.13-A.1 — Ruling 2 is superseded: the full landing schema is approved

The **five-table cap is lifted.** Approved for build: the full **21-table** landing schema specified
in GitHub issue [#623](https://github.com/u2giants/shared-db/issues/623), **plus two further tables
the orchestrator approved the same day** — `plm.pmt_capture_expectation` and
`plm.pmt_shrink_override`.

**Why the original reason no longer holds.** Ruling 2 deferred sixteen tables because they
"model structure no capture has proven". The completed capture proves all sixteen. **Every one now
has a nonzero proven row count; none would land empty.** Counts from the capture at `f340f74a`
(258 batches, 25,790 asset records):

| Table | Proven rows | Table | Proven rows |
| --- | ---: | --- | ---: |
| `plm.pmt_capture_batch` | 258 | `plm.pmt_asset_collection` | 27,880 |
| `plm.pmt_authorized_title` | 26 | `plm.pmt_asset_brand` | 25,983 |
| `plm.pmt_authorized_title_property` | 38 | `plm.pmt_property_character` | 52 |
| `plm.pmt_franchise` | 18 | `plm.pmt_property_collection` | 426 |
| `plm.pmt_collection` | 426 | `plm.pmt_property_franchise_evidence` | 51 |
| `plm.pmt_brand` | 7 | `plm.pmt_authorized_property_asset` | 25,858 |
| `plm.pmt_asset` | 25,790 | `plm.pmt_relationship_anomaly` | 4 |
| `plm.pmt_asset_property` | 26,451 | `plm.pmt_property_capture_log` | 33 |
| `plm.pmt_asset_franchise` | 25,116 | `plm.pmt_property` | 60 |
| `plm.pmt_asset_character` | 8,558 | | |

**The original caution was honoured, not overridden.** Two things ruling 2 deferred are
deliberately **still not built**:

- **`plm.pmt_franchise_property` is NOT created.** The capture proves Paramount publishes **no
  direct property-to-franchise pair**. The approved build lands
  `plm.pmt_property_franchise_evidence` instead, hard-checked so it can never present itself as a
  direct relationship.
- **There is NO collection trigger.** Collections are exposed as style guides through a
  **read-only view over one table**, so the two vocabularies cannot drift apart.

**What is no longer true.** Ruling 2's "known consequence — release 1 loads assets that connect to
nothing" is **void**. The approved build ships the asset link tables, so the database can answer
*"which asset shows this character?"* from day one.

#### 6.13-A.2 — Ruling 4 is superseded: the build hold is RELEASED

The hold's condition **has been met**. All four questions the second recon had to answer are
answered, verified against the capture at `f340f74a`:

1. **The property field's full-metadata descriptor is `PROGRAM_ID`.** Exactly **seven** metadata
   field descriptors exist across all 258 batches and 25,790 asset records.
2. **Collections carry a real hidden identifier, not just a display label.** 426 collections, 426
   distinct numeric source IDs, one name each. The ID comes from a `source_id` **attribute on the
   cascade element** — it is not parsed out of a label — and the ID-to-name mapping is proven
   **1:1 across all 25,790 assets**.
3. **No character identifier recurs across more than one property.** 52 explicit property-character
   pairs, 52 distinct character identifiers, **zero** overlap. **This is the question that could
   have moved the `plm.pmt_character` primary key. It confirms the approved design rather than
   changing it.**
4. **The combined property-character value is a structured value, not a delimited string.** It
   carries `raw_value`, `display_value`, and an `elements` array of **exactly two** elements, each
   with `key`, `source_id` and `display_value`. **Four** assets are missing the second element's
   source ID — precisely the **4 preserved anomalies** in the manifest, which is why
   `plm.pmt_relationship_anomaly` shows 4 rows above.

Because no answer moved a key, the "wrong key with rows already in it" risk that justified the hold
did not materialise. Building is now the correct action.

### 6.14 OWNER RULING — this repository is PUBLIC; no personal identifiers in anything you write from now on (Albert Hazan, 2026-08-09)

`u2giants/shared-db` is a **public** GitHub repository. Every file, commit message, PR
description, issue comment and CI log is world-readable, permanently and without warning.

**The forward rule — applies to everything you author from 2026-08-09 onward:**

Never write a person's **email address, full name, phone number, home or personal address,
or any other personal identifier** into:

- any file in this repository (migrations, docs, plans, tests, tooling, fixtures, JSON artifacts);
- any commit message;
- any pull-request title or description;
- any GitHub issue or comment;
- any CI job name, step name, or log line.

**Refer to people by their `app.profile` UUID only.** That is the existing precedent in this
repo and it is unambiguous, stable, and discloses nothing. If a human reader genuinely needs
to know *who* a UUID is, that mapping lives in the database, not in a public file.

If a verification artifact would otherwise embed contact data (a JSON baseline dump, a diff
of a vendor or roster table, a test fixture copied from real rows), **do not commit it**.
Commit row counts, checksums, and UUID-keyed diffs instead.

**What is NOT covered by this rule.** Personal names that are *the data itself* — for example
the designer roster seeded into `core.person`, where the name is the business value being
stored — are legitimate schema content and stay. The rule is about *incidental* disclosure:
identifying a person in a comment, a doc sentence, a commit message, or a debugging note,
where a UUID would have done the same job.

**The already-committed occurrences STAY. Do not "fix" them.**

By owner ruling of 2026-08-09, migrations already merged to `main` that contain personal data
are **left exactly as they are**. This is a *known, accepted exposure*, not an oversight, and
not a task waiting for a volunteer. Two reasons, both hard:

1. **They are applied migrations.** The ledger keys on the version string, so an edited file
   will never re-run — editing changes nothing in any database and desynchronises the file
   from the ledger. One of them is also inside the pending production promotion set, where
   changing a single byte is far more dangerous than the disclosure itself.
2. **History rewriting was explicitly rejected by the owner.** No `filter-repo`, no
   `filter-branch`, no BFG, no force-push. Do not propose it again. The old copies exist in
   the public history regardless; scrubbing the tip would not recall them.

The two files, named here so nobody "discovers" them later and opens a well-meaning PR:

- `supabase/migrations/20260726210000_popdam_access_reconcile_legacy_gmail_and_designer_grants.sql`
  — a UUID followed by a comment naming a live work email address.
- `supabase/migrations/20260809170500_db_data_admin_product_depth_mutations.sql`
  — a person's full name in the header comment.

Both are **untouchable**. If you believe you have found a reason to edit either one, you have
not; re-read this section and stop.

**Wider standing exposure (recorded 2026-08-09, no action taken).** A repo-wide sweep on this
date found personal data far beyond those two migrations: several hundred third-party vendor
contact records (email, phone, address) inside a committed verification baseline under
`docs/verification/`, plus work email addresses in a dozen older docs, incident write-ups and
migrations. All of it predates this rule and all of it is already public. It is listed here so
future sessions know the sweep was done and the result was consciously accepted, not missed.
Removing any of it from the working tree does not remove it from history, so removal buys
nothing and costs review risk. **Do not start a cleanup pass without a fresh owner ruling.**

### 6.15 OWNER RULING — there are exactly TWO kinds of property list, and `core.property` (Universe A) is to be DELETED (Albert Hazan, 2026-08-19)

**His words, in chat, 2026-08-19:**

> "Delete list A completely. There should be 2 types of lists: the lists that are the
> direct results of scrapes from the licensor websites, and the list that comes in from
> the Coldlion api. The scrape lists show what properties we are licensed for, and the
> Coldlion list shows which ones we actually use."

**This is the settled architecture for licensed properties and characters. Do not re-ask it,
and do not propose a third list.**

#### The two kinds, and what each one MEANS

| kind | source | business meaning | do not use it for |
|---|---|---|---|
| **Scrape lists** | direct captures from the licensor portals (Disney OPA, Warner STARLABS, NBCU Creative Assets, Paramount Creative Library, Peanuts/Tenovos, Sesame/NetX, WildBrain, Sega) | **what we are LICENSED for** | what we actually make |
| **ColdLion list** | the ColdLion ERP API feed | **which licensed properties we ACTUALLY USE** | what we are allowed to use |

Neither is a subset the other can be derived from. A property can be licensed and unused,
and an appearance in ColdLion that matches no scrape row is a finding, not a row to invent.

#### What "list A" is, and why it dies

"List A" is **Universe A** from issue #865:

- `core.property` — 256 rows, uuid keys, **no source-ID columns at all**
- `core.character` — empty
- `core.property_character` — empty
- linked to `core.licensor` (26 uuid rows) via `property_licensor_id_fkey`

It is hand-made. It carries none of the licensors' own primary keys, so it can never be
matched row-for-row against a portal capture, and 16 of its rows are stored at CHARACTER
grain in a table named `property`. It satisfies neither of the two kinds above.

**Universe B survives** — `core.properties_and_characters` (10,122 rows, integer keys,
`source_licensed_property_id` / `source_character_id`), `core.property_character_associations`
(9,622 rows), keyed to `core."licenseList"`. Membership in the portal captures is **proven,
not assumed**: 112/112 sampled Disney OPA `characterID` values present, 6/6 sampled Warner
STARLABS `characters.csv:source_id` values present. `licenseList` 13 (`CC`) is the one known
exception — synthetic hand-made IDs (`COKE-CHAR-00n`), not portal-derived.

#### The deletion is NOT authorized to just happen

The ruling settles the DESTINATION. It does not waive §4.2, the migration process, or the
blast-radius work. Before `core.property`, `core.character`, `core.property_character` and
(if it proves unused) `core.licensor` are dropped:

1. Prove which applications read them. `core.licensor`'s 26 codes are referenced by more
   than the property tables; do not assume it dies with them.
2. Land the drop as a normal shared-db migration — branch, PR, preview rehearsal, guarded
   merge, production evidence chain.
3. Anything genuinely worth keeping out of the 256 rows must be moved to a surviving list
   FIRST, with its licensor source ID attached, or it is gone.

**Do not drop anything on the strength of this section alone.**

#### What this ruling immediately settles

- **#640** — the licensor reconciliation runs against **Universe B**, never Universe A.
  A run against Universe A reports enormous meaningless gaps and ignores the 10,122 rows
  that already carry the licensors' own keys.
- **#865** — answered and closed. Both of its questions are resolved: the reconciliation
  target is Universe B, and the "how do we group `core.licensor`'s 26 mixed codes into four
  portal licensors" question is moot, because that table is on the deletion path.

### 6.17 OWNER RULING — DesignFlow's numeric division ids are WRONG and do NOT come to this database; the ColdLion division CODE is the only division there is (Albert Hazan, 2026-08-19)

**His words, in chat, 2026-08-19, after the live ColdLion feed was checked against the
DesignFlow item headers:**

> "Designflow's division numbers (1, 2, 7, 9) were wrong and will not be moving to the new
> Supabase db. Coldlion is correct"

#### What the evidence showed, and why the ruling settles it

Issue #1137 had been blocked for two days on "what does DesignFlow division `2` mean", because
`plm."divisionCode"` mapped id `2` to `CW001` while the agreed rule said id `2` was dead.
Both answers were wrong, because the question was wrong. Measured 2026-08-19, read-only,
against `http://x5.coldlion.com/EhpApi`:

- All **19,994** live ColdLion items carry a real division code — `CW001` 13,219, `EH001`
  4,084, `SP001` 2,217, `EP001` 474. **None is blank and there is no numeric division at all**;
  the API has no divisions endpoint.
- Matching all **15,185** `plm."itemHeader"` rows with `div_code_fk = 2` to the live feed by
  `item_num_id` resolved **15,183** of them (the 2 misses have a blank item number): `CW001`
  11,175, `EH001` 2,395, `SP001` 1,140, `EP001` 473.
- So the bridge row saying "id 2 means CW001" is wrong for **4,008 items, 26% of them**. A
  single-value backfill was never going to be right, whichever value was picked.

#### The rule

1. **DesignFlow division ids `1`, `2`, `7` and `9` — and the numeric division id space as a
   whole — are WRONG and are NOT migrating to this database.** Do not model them, do not carry
   them across as a legacy column, do not build a bridge or lookup table to preserve them, and
   do not write a migration that repairs them in place. They stop at the DesignFlow boundary.
2. **The ColdLion division CODE is the division.** `CW001`, `EH001`, `SP001`, `EP001` — a
   four-plus-three character code from the live feed, sourced per item, never a constant and
   never an id.
3. **Backfills read the feed, keyed on `item_num_id`.** Never assign a division from a mapping
   table, a majority vote, or "what the old id used to mean".
4. This is the §6.15/§6.16 canon applied to divisions: **ColdLion is what we actually use, so
   ColdLion wins.** A DesignFlow-vs-ColdLion division disagreement is not a finding to
   investigate; ColdLion is right by definition.

#### What this voids on issue #1137

Withdrawn outright, because they all repair the numeric id space: setting
`divisionCode_id_fk = 1` on five `mg_id` rows; setting `is_divcode_active = false` on
`plm."divisionCode"` ids `2` and `7`; the 217-row Block A fix; deleting the 4 empty rows; and
the `CHECK` constraint on division shape. The `erp_items_current.division_code` backfill goes
ahead as a **feed-sourced** backfill. Normalising `itemHeader.compan_code_fk` is a company
code, not a division, and is unaffected.

### 6.16 OWNER RULING — licence CONTRACTS are NOT a source for this database, and licence TERM and TERRITORY do not belong in it at all (Albert Hazan, 2026-08-19)

**His words, in chat, 2026-08-19, in reply to four questions about the NBCU Schedule "B" contract:**

> "you're not supposed to be referring to or using the contracts. the data scrapes + coldlion
> api feed are canonical. this is the 400th time i am saying this. why are we still talking
> about contracts over and over and over again?"

and, on adding term and territory columns:

> "this system has no connection to license term or territory. remove any and every record of
> that from this system for all licensors"

**He is right that it kept recurring, and it kept recurring because no section of this file
ever said it. This is that section. Read it before opening any licensor issue.**

#### The rule

1. **A licence contract, schedule, amendment or term sheet is NEVER a source of record for
   anything in this database.** Not for the property list, not for counts, not for names, not
   for restrictions, not for scope. Do not transcribe one. Do not cite one. Do not commit one
   into a repo so a loader can pin its SHA. Do not ask Albert to produce one.
2. **The only two canonical sources are the ones already named in §6.15**: the licensor portal
   scrapes (what we are licensed for) and the ColdLion API feed (what we actually use).
3. **Licence term and territory are OUT OF SCOPE for this system entirely** — no columns, no
   free-text notes, no `restriction_text`, no expiry date, no "US & Canada only". Not "model it
   properly later"; not at all. Existing records of either are to be **removed, for every
   licensor**.
4. A discrepancy between a contract and a scrape is **not a finding**. The scrape wins by
   definition, because the contract is not in the comparison.

#### Why the question keeps coming back, so it can stop

A contract makes an appealing source: it is signed, dated and authoritative-sounding, so each
new session that meets one reaches for it. The reason it is wrong is not that it is unreliable —
it is that **this database models what we scraped and what we make, and nothing else.** Legal
entitlement is a different system's job. A count "corrected" from a contract is a count that no
longer matches either canonical source.

#### What this ruling immediately kills

- **#732** ("NBCU is 58 Properties, not 57 — plus contract restrictions nobody transcribed") —
  closed in full. Its "58 not 57" count, its three amendment properties, its "Lamp Chop"
  transcription question, its two unsourced restrictions and its request for the Master
  Agreement are all void. The NBCU property count comes from the NBCU portal scrape.
- **`plm.nbcu_right`** — a table whose entire content is contract-derived (`business_title`,
  `rights_scope`, `restriction_text`, `global_rule_applied`, `source_document`). It is to be
  dropped. Nothing has ever been loaded into it, so this costs nothing. Removal tracked on its
  own issue.
- Any future issue proposing term, territory, expiry or restriction modelling. **Close it citing
  this section rather than escalating it to Albert.**

#### The one thing this does NOT change

Confidentiality obligations are unaffected. Licensed rows and licensor titles still never leave
their approved private repo, and §6.14 still governs what may be written into this public one.
Not using a contract as a data source is not permission to be careless with licensed data.

---

## 0.1-A OWNER RULING

> Moved from `AGENTS.md` §0.1-A on 2026-08-20 (issue #1331). Text unchanged.

> "remove from shared-db's own rulebook the rule that says this repo must not connect to Cloud SQL at all."
> — Albert Hazan, 2026-08-10

**What changed.** Until today §0.1 was read across this repo as putting the DesignFlow
production Cloud SQL database entirely out of bounds — no connection, no query, at all.
That reading is **withdrawn**. A shared-db session **may connect to production Cloud SQL
and run read-only queries**, under the conditions below.

**Why.** DesignFlow PLM production is the last environment still on Cloud SQL; every other
DesignFlow environment is already on the shared Supabase project, and the owner has decided
to start moving production over. Three separate migration plans over eight days
([`docs/cloudsql-first-migration-candidate-20260803.md`](docs/cloudsql-first-migration-candidate-20260803.md),
[`docs/age-group-cloudsql-migration-plan-20260804.md`](docs/age-group-cloudsql-migration-plan-20260804.md),
[`docs/licensor-property-cloudsql-cutover-plan-20260806.md`](docs/licensor-property-cloudsql-cutover-plan-20260806.md))
all stalled at the same wall: **nobody has ever looked inside that database**, so every
estimate of effort, downtime and risk was a guess. Reading it is how that stops.

**READ is permitted. WRITE is not.** That is the whole boundary. In detail:

*Permitted:*

- Connecting with a **read-only credential fetched from 1Password vault `vibe_coding` only**.
  Fetch 1Password items **serially** — never fan out `op read` / `op run` / 1Password MCP calls.
  Never write the credential into any file, commit, PR, report, issue, or chat message.
- **The credential must be PROVEN read-only BEFORE you use it.** Check `usesuper`,
  `usecreatedb`, role memberships (`pg_roles` / `pg_auth_members`) and schema/table privileges
  (`has_schema_privilege`, `has_table_privilege`, `information_schema.role_table_grants`).
  **If you cannot prove it is read-only, stop and report.** Never test the question by
  attempting a write. One credential is exempt from this proof, and only one — see §0.1-A.1.
- `SELECT` against `information_schema` and `pg_catalog` only. Nothing that takes a lock
  beyond a plain shared read — no `LOCK`, no `SELECT … FOR UPDATE`, no `VACUUM`/`ANALYZE`,
  no long or unbounded scans. **This is a live production database serving real users.**
- Reporting **counts, object names, data types, sizes, constraints and definitions**.

*Still forbidden — this ruling lifts nothing here:*

- **No DDL and no DML against Cloud SQL from this repo, ever.** Applying schema changes there
  is Uma's job via [`popcre/infrastructure`](https://github.com/popcre/infrastructure);
  issue **#696** is the live example and it stays hers.
- **No Secret Manager IAM, secret versions, or secret repointing.** §0.1 above is unchanged:
  **unsuffixed DB secret IDs are production-only** and are the 2026-07-17 outage boundary.
- **No Cloud Build substitutions or triggers, no Cloud Run bindings, no VPC routing changes.**
- **No changes to the connection contract or `cloudbuild.yaml`** in the four `popcre`
  DesignFlow repos — `popcre` org repos, PRs to `develop`, never self-merged.
- The standing global rules stand untouched: AI sessions are **read-only for production and
  shared cloud infrastructure**; no `terraform apply`/`destroy` against a production GCP
  project; no mutating `gcloud`.

**Never report row contents.** Counts, names, types, sizes and definitions only — never the
values in a row. Issue **#645** exists because vendor emails, phones and addresses were once
published into a repo file. A read permission is not a publication permission.

**This ruling permits reading; it does not require it.** Do not connect unless the task
actually needs a fact only that database holds.

### 0.1-A.1 OWNER RULING — the read-only proof is waived for `albert_read_only`, for reads of the DesignFlow schema and nothing else (Albert Hazan, 2026-08-10, issue #705)

> "ignore the 'read only is not read only' issue."
> — Albert Hazan, 2026-08-10

> "yes, use it to read production."
> — Albert Hazan, 2026-08-10, answering whether that also permits USING the account to read

**The proof rule in §0.1-A stands.** Proving a credential read-only before using it is still
the default and still applies to every other credential and every other database. What
follows is one named, bounded exception, not a relaxation.

**The exception.** Reading the `designflow` schema on the DesignFlow production Cloud SQL
instance with the account `albert_read_only` is permitted, even though that account fails the
attribute test in §0.1-A.

**Why the attribute test fails yet the read is safe.** Check the reasoning rather than
re-deriving it:

- The account holds `SELECT` on **296 relations and ZERO write privileges** in the
  `designflow` schema.
- All **386 relations are owned by `postgres`**, so membership of `cloudsqlsuperuser` is not
  a route to that data.
- For this account, what fails the proof is `rolcreatedb` / `rolcreaterole` / role membership,
  plus `CREATE` on database `postgres` and `CREATE` on schema `public` — the power to create
  **new** objects elsewhere, not the power to write DesignFlow. Those grants are a real
  production-infrastructure exposure and #705 records them; they are simply not a write path
  into `designflow`.
- [`scripts/capture-postgres-schema.sql`](scripts/capture-postgres-schema.sql) sets
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, which is why that particular run
  could not have written. It is a session-scoped guard that the same session can reset to
  `READ WRITE`, so it is **never** a substitute for the proof rule for any other credential.

**Boundary. This permits a READ.** It does not permit writes, DDL, DML, creating a read
replica, starting an export, restoring a backup, changing authorized networks, or any
mutation in `lithe-breaker-323913`. It does not generalise to any other credential, any other
database, or any other task. Everything under "Still forbidden" in §0.1-A is unchanged.

**Closure rule — read this before assuming anything is allowed because it is not listed
above.** This exception waives the read-only proof and **nothing else**. Every other condition
in §0.1-A still binds — catalog-only `SELECT`s against `information_schema` and `pg_catalog`,
no long or unbounded scans, and **no row contents read or reported** — and `pg_stats` is row
contents, not catalog metadata, because `most_common_vals` and `histogram_bounds` hold sampled
values from real columns. Catalog-only is the
scope Albert was asked about and the scope he approved. So a row count, a sample row, a
`SELECT` queued by a migration plan (for example
[`docs/parent-child-answers-20260803.md`](docs/parent-child-answers-20260803.md) or the
age_group plan's Step D1), and a client-side `pg_dump` are all **outside** this exception and
each needs **its own ruling from Albert**. Not from the Cloud SQL instance owner — instance
admin is not business authority here. The list above enumerates; this sentence closes.

**Do NOT fix #705.** Albert ruled the account is to be left alone. Stop proposing privilege
changes for it and do not re-raise it as a blocker.

**Operational specifics — do not rediscover these:**

- **On Cloud SQL the schema is `designflow`, NOT `dflow`.** The direction of the trap matters:
  on **Supabase** production, DesignFlow lives in **`dflow`**, and Supabase *also* has a
  separate schema named `designflow` — a 35-relation decoy. So do not "correct" either name to
  the other. Confirm which host you are on before reading (§4.2).
- Run with `exact_count_max_bytes=0` so the capture reads catalog only and touches no table
  data.
- The credential is in vault `vibe_coding`, item **`tcaf3o3u2cx52g6ivvczxbhola`**
  ("DesignFlow PRODUCTION Cloud SQL - read-only …"). Its title contains parentheses, which are
  invalid in an `op://` reference, so address it by **item ID**:
  `op read 'op://vibe_coding/tcaf3o3u2cx52g6ivvczxbhola/DB_PASSWORD'`. The password is in a
  **custom field named `DB_PASSWORD`**, not `credential`. 1Password item IDs can be re-keyed
  mid-session, so if that ID 404s, re-resolve by title with
  `op item list --vault vibe_coding --format json` (same pattern as §9 of this file).
  Never write the
  value anywhere.

**Evidence.** The completed capture is at
[`docs/verification/cloudsql-designflow-capture-2026-08-10/`](docs/verification/cloudsql-designflow-capture-2026-08-10/);
the ruling and the privilege analysis are on issue **#705**. That capture's README describes
the waiver as "for this capture only" and "not a general waiver"; **this section supersedes
that wording** — the exception is standing, on the terms above.
