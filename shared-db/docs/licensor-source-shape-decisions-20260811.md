# Licensor source-shape answers vs. what the database enforces

**Date:** 2026-08-11
**Author:** shared-db sub-agent, dispatched by orchestrator session fcc2a1 (marker #793)
**Status:** decision record. No migration is written by this document. No database was written to.

This document reconciles a direct questionnaire answered by the three licensor scrape
sessions (NBCU, Disney, Paramount) against what the merged migrations in
`supabase/migrations/` actually enforce today.

**Reading rule, applied everywhere below.** `NO` and `NOT KNOWN` are different answers and
are never collapsed. `NO` is a fact the scrape established. `NOT KNOWN` is an absence of
evidence. **Where an answer is NOT KNOWN, the schema must stay permissive.** A constraint
built on a NOT KNOWN manufactures a certainty nobody has, and it fails at load time
against real data rather than at design time against a reviewer.

Where a design needs a fact nobody supplied, this document writes the exact follow-up
question instead of inventing the fact. Those questions are collected in section 8.

**No licensed data appears in this file.** No NBCU, Disney or Paramount title, property
name, character name, franchise label, asset path or file name is reproduced. Field and
column names only.

---

## 1. THE SOURCE OF RECORD — the answers, verbatim

Recorded verbatim, attributed to the three licensor scrape sessions, dated 2026-08-11.
These answers were read off the real output files by those sessions and are treated as
authoritative for the purposes of this record.

### 1.1 NBCU

Re-capture: **full replacement YES, delta NO**. Old asset absent means deleted at source:
**NO**. Old asset absent may mean **missed by scrape: YES**. Field distinguishing deleted
from missed: **NO**. No superseded-capture field, no parent-capture field, no
delta-operation field.

Stable keys (all "stable across the two captures YES", all "guaranteed permanent NOT
KNOWN", all "limited to page/filter/parent NOT KNOWN"):
asset = `asset_source_key`; portal property = `property_source_id`; asset-metadata
property = `property_label`; character = `character_source_id`; style guide =
`style_guide_natural_key`.

- **Single identifier covering every Property row: NO**
- **`property_source_id` present on every Property row: NO**
- `character_source_id` present on every Character row: YES
- **`style_guide_source_id` present on every style-guide row: NO**
- `style_guide_natural_key` equals `folder_path`: YES
- `asset_source_key` equals `asset_path`: YES

IP family: one asset can carry **two or more** `ip_family_labels`: **YES**. **An
`ip_family_labels` value can match NO `property_label` in properties.csv: YES.**

`source_kind`: observed `property`, `asset_metadata_label`, `franchise_asset`. Fourth
value observed: NO. Future fourth impossible: **NOT KNOWN**. Fixed three-value contract
present in output: **NO**.

### 1.2 Disney — DCP Vault

`UUID` unique per asset: **NOT KNOWN**. `collectionDmcId` unique per asset: **NOT KNOWN**.
Asset can have multiple portal tiles: **YES**. Tile can match no property: NOT KNOWN.
**Source path can change for same file: NOT KNOWN.** Capture full replacement: NOT KNOWN.
Capture delta: NOT KNOWN. Absent asset means deleted: NOT KNOWN. **Absent asset can be
missed: YES.** Source-deletion field exists: **NO**.

### 1.3 Disney — OPA

Property id = `licensedPropertyID`; character id = `characterID`. Both "stable across
complete recaptures": **NOT KNOWN**. Negative sentinels other than -9999 / -9998 possible:
**NOT KNOWN**.

### 1.4 Paramount

Re-capture: full replacement NOT KNOWN, delta NOT KNOWN, deleted-at-source NOT KNOWN,
**possibly missed YES**, distinguishing field **NO**. Available fields: `captured_at`,
`generated_at`, `complete`, `failures`.

Keys: asset = `asset_id` (stable across re-scrapes NOT KNOWN, unique within current output
YES, page/filter-only NO); property = `source_id` / `PROGRAM_ID`; character = `source_id` /
`CHARACTER_ID`; collection/style guide = `source_id` / `COLLECTION_ID` — **all three
"stable across re-scrapes NOT KNOWN", "parent-scoped NOT KNOWN"**.

Caret pair: **present in every output file: NO**. Element
`CUSTOM.CP_CREATIVE_LIBRARY.CASCADE_CHARACTER_ID`; machine value `source_value`; position
`source_path`; split into `property_id`, `character_id`. No current malformed or empty
pair. Malformed pair allowed into link output: **NO**; can enter
`relationship-anomalies.csv`: YES.

Field drift: `source_value` + `display_value` both emitted; both guaranteed non-null NO;
both null together NO; element name `metadata_element_id`; type `data_type`; order
preserved YES via `value_ordinal`; position `source_path`; order meaning beyond array
position NOT KNOWN.

Missing three (Garfield / Invader Zim / The Garfield Movie): capture-mode field **NO**;
fresh full capture NOT KNOWN; addition to existing NOT KNOWN.

---

## 2. THE SUSPECTED CONFLICT (item 1) — RESOLVED: NOT A DEFECT, NOT A BLOCKER

**Verdict: this is a false alarm. The NBCU load is not hard-blocked, and no change to
`20260811070000_nbcu_asset_ip_family_relationship.sql` is required on these grounds.**

The alarm was that issue #757 rules "a missing or ambiguous label must REJECT
finalization", while the NBCU scrape session states an `ip_family_labels` value can
legitimately match **no** `property_label` in `properties.csv`. If those were the same
resolution step, finalization would reject every real capture.

They are not the same resolution step. Read from the merged migrations, not the issue text:

1. **What the label resolves against is the IP Family table, not the Property table.**
   `20260810070000` section 5 creates `plm.nbcu_ip_family` and its own comment states the
   loader generates it "from the UNION of the asset metadata's `ip_family_labels` and the
   ip-family-to-property evidence file." A label that appears in `assets.csv` is therefore
   **guaranteed by construction** to have a matching `plm.nbcu_ip_family` row. Resolution
   of an asset's label can never come up empty.

2. **What the migration actually enforces.** `plm.nbcu_asset_ip_family` carries a
   composite FK to `plm.nbcu_ip_family (capture_id, ip_family_key)` and, in the replaced
   finalizer, one new check **F2**:

   > count rows in `nbcu_asset_ip_family` where the joined `nbcu_ip_family.ip_family_label`
   > is null or is distinct from the link's stored `ip_family_label`; non-zero raises
   > `unknown_or_mismatched_ip_family_label`.

   F2 is a **label-fidelity** check on rows the loader already emitted. It proves the
   loader resolved onto the right family row. It does **not** require every family to have
   a Property, and it does **not** scan `ip_family_labels` demanding a Property match.

3. **There is no Property involvement in the asset link at all.** The
   IP-Family-to-Property relationship lives in a *separate*, *optional* table,
   `plm.nbcu_ip_family_property`. Nothing requires an IP Family to appear in it. A family
   with zero Property edges is a legal, fully-loadable state.

4. **The "no matching property" case is already a first-class modelled state.**
   `plm.nbcu_property.source_kind` explicitly permits `asset_metadata_label`, and its
   comment says these are "exact asset-metadata Property labels ... that the picker never
   showed." The schema was built to hold exactly the case the scrape session described.

5. **Counting.** The new relationship is added to the finalizer's `v_pairs` list, so it is
   compared against a loader-supplied `expected_counts.asset_ip_family`. The migration adds
   no rule tying the link count to `cardinality(ip_family_labels)`; grep confirms
   `cardinality` and `jsonb_array_length` appear only in unrelated scope-paging and
   error-array code.

**Residual, and it is a documentation defect only.** The migration header repeats the
issue's wording — "A missing or ambiguous match must REJECT the capture" — without saying
*which* resolution it governs. A future loader author could read that line and build a
Property-match requirement that would be wrong. **Recommended action: a comment-only
clarification, not a constraint change.** See work item W1.

**Answers to the two questions asked:**
- Is this a real defect? **No.** The enforced behaviour and the scrape's answer are
  compatible. The wording is ambiguous; the SQL is not.
- Does it hard-block the NBCU load? **No.** Nothing in the merged migrations rejects a
  capture because an IP Family label has no Property.

---

## 3. THE UNIVERSAL RULE — absence is never deletion

All three sources agree on the one thing that matters most, from three different
directions:

| Source | Absent asset means deleted at source | Absent asset may mean missed by scrape | Field that distinguishes them |
|---|---|---|---|
| NBCU | **NO** | **YES** | **NO** |
| Disney DCP | NOT KNOWN | **YES** | **NO** |
| Paramount | NOT KNOWN | **YES** | **NO** |

> ### THE RULE
> **Absence of a row from a newer capture must NEVER cause a delete, a truncate, a
> soft-delete, an `is_deleted` flag, an `end_dated` marker, or any other removal or
> retirement of a previously captured row — for any licensor, in any schema, ever.**
>
> No source can distinguish "deleted at source" from "missed by the scrape". Two of three
> cannot even say deletion happens. All three confirm a miss is possible. Therefore any
> absence-driven removal destroys real data on evidence that does not exist.
>
> Retirement of a row requires a POSITIVE deletion signal from the source. No source
> supplies one today (all three answered NO to a source-deletion field). Until one does,
> the correct representation of "this row was in capture A and not in capture B" is
> **exactly that fact, recorded** — never a removal.

### 3.1 Verification: is anything violating it today?

**No. Verified, not assumed.** Every licensor landing migration on `origin/main` was
scanned for `delete from`, `truncate`, `is_deleted` and `deleted_at`:

```
20260807170000, 20260807170100, 20260807180000, 20260807190000, 20260807200000  (OPA)
20260810020000, 20260810090000, 20260811030000                                   (Paramount)
20260810030000, 20260810110000, 20260810120000, 20260810130000                   (Warner)
20260810070000, 20260810080000, 20260811070000                                   (NBCU)
20260810190000, 20260810190100, 20260811050000, 20260811060000                   (Disney DCP)
```

**Zero matches across all nineteen files.** No licensor migration deletes, truncates or
soft-deletes anything.

Two nearby things were checked and cleared:

- **The OPA importer** (`20260807170100`) does `on conflict (licensed_property_id,
  character_id) do update set ...`. It is an upsert with **no** "deactivate what is
  absent" clause and no `active` flag. It does not violate the rule. It does, however,
  *overwrite* prior values in place rather than keeping history — see section 5.3.
- `is_deleted` / `delete from` / `truncate` hits elsewhere in the repo are all in
  `dam.*` / `public.assets` / `crm.*` search-index and one-off data-cleanup migrations.
  None of them is licensor capture data and none is absence-driven.

**The rule is currently satisfied but is written down nowhere in the repo.** That is the
actual risk: it is unwritten, so the next agent to build a "current view" or a "sync"
step has nothing stopping them. See work item W2.

---

## 4. NBCU — reconciliation

### 4.1 No single identifier covers every Property row; `property_source_id` is absent on some rows

**The schema already survives this. No change needed.** `20260810070000` section 4:

- `property_source_id` is **nullable**.
- The primary key is `(capture_id, property_key)`, and `property_key` is built by an
  enforced rule: `nbcu_property_key_rule_chk` requires
  `property_key = 'source-id:' || property_source_id` when the source id is present, and
  `property_key like 'metadata-label-sha256:%'` when it is not.
- Uniqueness on the source id is a **partial** unique index
  (`where property_source_id is not null`), so the id-less rows do not collapse into one
  NULL group. The migration's own comment records the measured split.

This is exactly the right shape for "NO single identifier". **Agreement, not conflict.**

### 4.2 `style_guide_source_id` absent on some rows

**Also already survives.** `plm.nbcu_style_guide` has nullable `style_guide_source_id`, a
PK of `(capture_id, style_guide_key)`, and `nbcu_style_guide_folder_uk unique (capture_id,
folder_path)`. The scrape confirms `style_guide_natural_key` **equals** `folder_path`
(YES), so the folder-path unique key *is* the natural key. **Agreement.**

### 4.3 `asset_source_key` equals `asset_path` (YES)

Consistent with the asset PK `(capture_id, asset_source_key)`. **Agreement.** Note this
makes NBCU asset identity path-based, the same choice Disney DCP made — with the same
consequence if a path ever changes (section 5.2). NBCU answered "stable across the two
captures YES", which is weaker than a guarantee but is at least positive evidence Disney
does not have.

### 4.4 `source_kind`: the hard CHECK vs. "future fourth value NOT KNOWN"

**This is the one genuine NBCU schema disagreement.**

- Enforced: `nbcu_property_source_kind_chk check (source_kind in ('property',
  'franchise_asset','asset_metadata_label'))`. A fourth value **fails the INSERT** and, in
  a chunked loader, aborts the load.
- Answered: fourth value observed **NO**; fourth value impossible in future **NOT KNOWN**;
  fixed three-value contract present in the output **NO**.

A hard CHECK encodes "impossible". The source says "not known". That is a NOT KNOWN being
treated as a NO.

**Recommendation: keep the CHECK. Do not loosen it now.** Reasoning, stated plainly so it
can be overturned on evidence rather than taste:

- The consequence of the CHECK firing is a **loud, immediate, total** load failure with
  the offending value visible. That is the correct failure mode for an unknown enumeration
  value in licensed source data — it is precisely "no silent failures".
- The alternative — quarantine the row and continue — is *worse* here, because
  `source_kind` participates in what a Property row *means*. A quarantined Property row
  silently drops every relationship that referenced it, and the finalizer's count checks
  would then fail anyway, just further from the cause.
- The CHECK is not a data-loss risk: nothing is written, so nothing is lost. The capture
  is re-run after a one-line schema addition.

**But the loosening must be pre-designed, not improvised under pressure.** If and when a
fourth value appears, the correct response is a forward migration that adds the new value
to the CHECK **after a human has decided what it means** — never a blanket removal of the
CHECK, and never an `else 'unknown'` coercion in the loader. Recorded as W3
(documentation of the escalation path), not a schema change.

**What would change this recommendation:** an answer to follow-up question Q1 (section 8)
establishing that NBCU's portal can introduce new kinds without notice at a rate that makes
full re-capture costly. That is a fact nobody has today.

### 4.5 "Guaranteed permanent NOT KNOWN" on every NBCU key

Every NBCU key is "stable across the two captures YES / guaranteed permanent NOT KNOWN".
The schema does not assume permanence: **every** key is scoped by `capture_id` and every
relationship FK carries `capture_id`. A key that changes meaning between captures corrupts
nothing — it simply produces a different row in the newer capture. This is the correct
posture for NOT KNOWN. **Agreement.**

---

## 5. Disney — reconciliation

### 5.1 `UUID` and `collectionDmcId` uniqueness is NOT KNOWN

**Confirmed: the schema does NOT constrain either unique. Correct as built; do not add
one.** In `20260811050000_dcp_vault_metadata_landing.sql`, `plm.dcp_metadata_asset` has:

```
source_uuid            text null,
collection_dmc_id      text null,
```

Both plain, both nullable, neither in any unique constraint or unique index. The table's
PK is `(metadata_run_id, dcp_asset_id)` — run-scoped and keyed on the DCP asset identity,
not on either Disney id. **Agreement, and this is the model case for how a NOT KNOWN
should be handled: capture the value losslessly, constrain nothing.**

**Explicit instruction for future sessions: do not add a unique constraint to
`source_uuid` or `collection_dmc_id` on the strength of "they look like ids". Uniqueness
is NOT KNOWN, and NOT KNOWN is not YES.**

### 5.2 Source path is the locked identity, and path stability is NOT KNOWN

This is **the most consequential Disney disagreement**, and it is a real design exposure —
though not a defect in what was built, because no better identity exists.

Enforced today (`20260810190000`):
- `plm.dcp_asset` — `constraint dcp_asset_unique unique (source_system, source_path)`.
- `plm.dcp_style_guide` — `constraint dcp_style_guide_unique unique (source_system,
  source_path)`.
- Migration rule, quoted from `20260811050000`: "THE PATH IS THE ASSET IDENTITY."
- These tables are **not** capture-scoped. They carry `first_seen_crawl_id` and
  `last_seen_crawl_id` and are upserted across crawls.

**What breaks if a path changes for the same underlying file:**

1. The re-crawl inserts a **new** `plm.dcp_asset` row at the new path.
2. The old row **stays forever** — correctly, per the universal rule in section 3, since
   absence is not deletion. It simply stops having its `last_seen_crawl_id` advanced.
3. The database now holds **two asset identities for one real file**, with no link
   between them and nothing that flags the situation.
4. Every downstream count is inflated. Any future resolution to `core.*` resolves the same
   file twice, potentially to different targets.
5. Because `dcp_asset.id` is a surrogate UUID referenced by `plm.dcp_metadata_asset`, the
   metadata history splits too: pre-rename metadata hangs off the old identity, post-rename
   off the new. Nothing joins them.
6. There is **no automatic recovery**, and no signal. It is silent.

**Recommendation: do not change the identity now.** `source_uuid` and `collection_dmc_id`
are the only candidate alternatives and their uniqueness is **NOT KNOWN** — swapping a
path identity for an id of unproven uniqueness trades a known, detectable failure for an
unknown, undetectable one. That is a worse trade.

**Recommendation: make the failure visible instead.** A detection-only, read-only report
(a view, not a constraint, not a mutation) that lists candidate duplicate identities —
same `file_name`, same `file_size_bytes`, same `checksum` where present, different
`source_path` — and lets a human adjudicate. It deletes nothing and merges nothing. This
is W4. It is deliberately a *report*, because an automatic merge would be exactly the kind
of inference the licensed-source rules forbid.

**And this needs an answer, not a guess:** follow-up question Q2 (section 8).

### 5.3 Disney OPA — `licensedPropertyID` / `characterID` stability NOT KNOWN

Enforced today (`20260807170100`): the importer upserts on
`on conflict (licensed_property_id, character_id) do update set ...`, and the five
resolution columns are deliberately excluded from the update so a re-import cannot clobber
a human resolution. That exclusion is good and should not be touched.

**What the schema assumes:** that `licensedPropertyID` and `characterID` are stable
identities across recaptures. That assumption is **NOT KNOWN** to be true.

**What breaks if it turns out false:** an id that is reassigned to a different
property/character causes the upsert to **overwrite** the earlier row's descriptive
columns in place. Unlike the NBCU and Paramount capture-scoped tables, OPA keeps no
history, so **the prior values are gone**. This is not a violation of the section 3 rule —
nothing is deleted on the basis of absence — but it is the same class of harm arriving by
a different door: silent, irreversible loss of a previously captured fact.

**Recommendation: do not restructure OPA now.** The B7 migrations are unapplied but
**atomic** (guard batch B7 = `20260807030000, 20260807170000, 20260807170100,
20260807180000, 20260807190000, 20260807200000`), so an in-place edit is off the table,
and a forward migration restructuring an unapplied batch is churn for a hypothetical.
Record the exposure, ask Q3, and revisit when answered.

### 5.4 Disney DCP re-capture semantics are entirely NOT KNOWN

Full replacement NOT KNOWN, delta NOT KNOWN, deleted means absent NOT KNOWN. The schema's
`first_seen_crawl_id` / `last_seen_crawl_id` shape is **semantics-neutral** — it works for
either mode and asserts neither. That is the right answer to a NOT KNOWN. **Agreement.**

---

## 6. Paramount — reconciliation

### 6.1 All four `source_id` values: "stable NOT KNOWN", "parent-scoped NOT KNOWN"

**What the schema currently assumes.** From `20260810020000`:

- `plm.pmt_property` — PK `(capture_id, property_source_id)`, `property_source_id bigint
  not null`.
- `plm.pmt_franchise` — PK `(capture_id, franchise_source_id)`.
- `plm.pmt_character` — PK `(capture_id, character_source_id)`.
- Link tables key on the same composites with `on delete restrict` FKs.
- `plm.pmt_asset_metadata_value` — PK `(capture_id, asset_id, metadata_element_id,
  value_ordinal)`.

So the schema assumes each `source_id` is **unique within one capture** and needs nothing
more. It does **not** assume stability across captures.

**Cross-capture stability (NOT KNOWN) — what breaks if false: nothing structural.** Because
every Paramount key is `capture_id`-scoped, an id that changes meaning between captures
produces a different row in the newer capture. No corruption, no overwrite. **The schema is
already correctly permissive here.** The cost is analytical, not structural: "is this the
same property as last time?" cannot be answered from ids alone. That is an honest
limitation, not a bug.

**Parent-scoping (NOT KNOWN) — this one is a real exposure.** The schema assumes each
`source_id` is unique **capture-wide**. If an id turns out to be unique only within a
parent (e.g. a character id unique only within its program), then:

1. Two genuinely different characters sharing an id **collide on the primary key**.
2. The second insert either fails the PK (loud, recoverable — acceptable) **or**, if the
   loader upserts, silently overwrites the first (**data loss**).
3. Relationship rows keyed on the id then attach to whichever row survived — **silently
   wrong edges**, the worst outcome, and the hardest to detect after the fact.

Note this cuts the opposite way from NBCU: NBCU answered the same question "NOT KNOWN"
too, but NBCU never keys on a bare source id — it hashes to a `*_key` with an enforced
construction rule. Paramount keys on the raw id.

**Recommendation: do NOT restructure the Paramount keys.**
- The evidence does not support it: parent-scoping is NOT KNOWN, not YES. Restructuring on
  a NOT KNOWN is the exact error this document exists to prevent.
- The Paramount migrations `20260810020000`, `20260810090000` and `20260811030000` are
  **applied to preview**, so they are off-limits to in-place editing; any change is a
  forward migration.
- The PK already fails **loudly** on collision, provided the loader does not upsert.

**Recommendation: verify the loader does not upsert Paramount entity rows** — a plain
`insert` lets the PK do its job; an `on conflict do update` converts a detectable
collision into silent loss. This is W5, and it is a **data-load** item, not a schema item.

**And ask Q4** (section 8) before anyone considers a key change.

### 6.2 Caret pair not present in every output file (NO)

The pair (`CUSTOM.CP_CREATIVE_LIBRARY.CASCADE_CHARACTER_ID`, split into `property_id` /
`character_id`) is **absent from some files**. This is a positive NO, not a NOT KNOWN.

Enforced today: `plm.pmt_asset_metadata_value` makes `source_value` and `display_value`
both nullable, with `pmt_amv_has_a_value_chk check (source_value is not null or
display_value is not null)` — at least one, never both null. The scrape confirms both
non-null NO and both-null NO. **Exact agreement.**

Absence of the caret element entirely simply means no rows for that element. Nothing
requires it. **Agreement.** The scrape's rule that a malformed pair must not enter the link
output and may enter `relationship-anomalies.csv` is a **loader** contract; the schema
correctly does not encode it.

### 6.3 Value ordering

Order preserved YES via `value_ordinal`; order meaning beyond array position NOT KNOWN.
Enforced: `value_ordinal integer not null`, in the PK, `check (value_ordinal >= 0)`, and
the loader takes it from the payload rather than from row order. The column comment claims
position and nothing more. **Correctly permissive on the NOT KNOWN. Agreement.**

### 6.4 The missing three titles

Capture-mode field **NO**; whether the fix is a fresh full capture or an addition to an
existing capture is **NOT KNOWN**.

**This matters and it is unresolved.** With the capture-scoped design, "add three titles to
the existing capture" and "run a fresh full capture" produce structurally different
results, and there is no field in the output that says which happened. Under the section 3
rule the safe answer is always **a new capture**, never a mutation of an existing one — the
existing capture's tables are insert-only by grant, which enforces this. **Ask Q5.**

---

## 7. THE NBCU SUPERSEDE PATH — design (no SQL)

**The gap.** NBCU confirms full-replacement captures (YES) with absence carrying no
deletion meaning (NO / missed YES / no distinguishing field NO). The landing migration
already keeps every capture and never overwrites one — its header says so, and grants make
snapshot rows immutable. What does **not** exist is any statement of **which capture is
current**, so every consumer must re-derive it. The landing migration's own section 61
notes this: "NO `nbcu_current_*` VIEWS", consumers are told to filter `status='complete'`
ordered by `source_captured_at desc`.

That instruction is repeated per-consumer, which means it will eventually be got wrong.

### 7.1 Design goals, in priority order

1. **Never delete.** Every capture stays, forever, exactly as landed.
2. **Exactly one current capture** per licensor, unambiguous, cheap to read.
3. **Absence is recorded, never acted on.** A row present in capture A and absent from B is
   a *fact to report*, not a change to apply.
4. **Currency is a pointer, not a rewrite.** Promoting a new capture must touch no snapshot
   row.
5. **Reversible.** A capture promoted in error must be demotable without data movement.

### 7.2 The objects

**A. A currency pointer table — `plm.nbcu_current_capture`**

- Columns: `capture_id` (FK to `plm.nbcu_capture(id)`, `on delete restrict`),
  `became_current_at`, `made_current_by`, `reason`.
- **Singleton enforced** by a one-row constraint (a constant-valued column with a unique
  constraint, or a partial unique index on a literal). Never two current captures.
- A CHECK-equivalent guard that the referenced capture's `status = 'complete'`. A
  `rejected` or `loading` capture must never be current. Enforced by trigger, since a CHECK
  cannot read another table.
- Insert/update only. **No delete path.**

**B. A supersession ledger — `plm.nbcu_capture_supersession`**

- One row per promotion: `superseded_capture_id`, `superseding_capture_id`,
  `superseded_at`, `reason`.
- Append-only. This is the history the source does not give us: it says *this capture
  replaced that one*, without asserting anything about individual rows.
- This is where the answers' "no superseded-capture field, no parent-capture field, no
  delta-operation field" is compensated for **on our side**, honestly labelled as our
  bookkeeping and never as source truth.

**C. Current-capture views — `plm.nbcu_current_<entity>`, one per snapshot table**

- Each is a plain `select * from plm.nbcu_<entity> where capture_id = (select capture_id
  from plm.nbcu_current_capture)`.
- Read-only, `security_invoker`, `plm`-schema (not `api`) — licensed source material stays
  off PostgREST unless a separate access decision is made.
- These exist so no consumer ever hand-writes the currency rule again.

**D. A promotion function — `plm.promote_nbcu_capture(uuid, text)`**

- Verifies the capture exists and is `complete`.
- Writes the supersession row for the outgoing capture.
- Repoints the singleton.
- **Touches zero snapshot rows.** Deletes nothing. This is the whole point.
- `service_role` execute only.

**E. A drift report — `plm.nbcu_capture_drift(uuid, uuid)`**

- Given two captures, returns rows present in the older and absent from the newer, per
  entity.
- **Returns a report. Changes nothing. Flags nothing as deleted.** Its output is labelled
  "present in A, absent from B" — the exact fact — and never "deleted".
- This is the honest replacement for the delete that must never be built. It is also the
  thing that makes the absence *visible*, satisfying "no silent failures" without acting on
  evidence nobody has.

### 7.3 What this design deliberately does NOT include

- No `is_deleted`, `deleted_at`, `retired_at`, `end_date`, or `active` column anywhere.
- No trigger that reacts to absence.
- No merging of rows across captures.
- No cross-capture identity resolution. NBCU keys are "guaranteed permanent NOT KNOWN", so
  asserting that capture A's key and capture B's key are the same thing would be an
  invention.

### 7.4 Should this design also serve Disney and Paramount?

**No — committing now would be premature for both. Recommendation: build it for NBCU only.**

- **NBCU is ready.** Full replacement is a positive **YES**. The design's core assumption
  ("a capture is a complete world") is established fact, not inference.
- **Disney DCP is not ready.** Full replacement NOT KNOWN *and* delta NOT KNOWN. Worse, DCP
  is not even capture-scoped — `plm.dcp_asset` and `plm.dcp_style_guide` are global,
  upserted, `first_seen`/`last_seen` tables. A capture-currency pointer has nothing to
  point at. Applying this design to DCP means restructuring DCP first, which needs the
  answer to Q2 before it is even arguable.
- **Paramount is not ready.** Full replacement NOT KNOWN and delta NOT KNOWN. Paramount
  *is* capture-scoped, so the design would drop in almost unchanged — but on a NOT KNOWN.
  If Paramount captures turn out to be deltas, a "current capture" pointer is actively
  wrong: currency would then be the *union* of a base and its deltas, and a pointer would
  silently hide data.

**The safe sequencing:** build the NBCU objects with NBCU-specific names (`nbcu_*`), not a
generic licensor-wide framework. A generic framework built now would bake NBCU's
full-replacement semantics into two sources that have not confirmed them. Generalise later,
from three confirmed answers, at a cost of one rename. That is much cheaper than
un-baking a wrong assumption from live schema.

---

## 8. FOLLOW-UP QUESTIONS — facts nobody has

These are written out exactly as they should be put to the scrape sessions. **No design in
this document proceeds past a NOT KNOWN by guessing; each of these is where a guess would
otherwise have been made.**

**Q1 — NBCU, to the NBCU scrape session.**
> Does the NBCU portal's Property picker have a published or observable set of kinds, or
> is the three-value set (`property`, `franchise_asset`, `asset_metadata_label`) purely a
> description of what these two captures contained? Specifically: is there any portal
> screen, API field, filter list, or documentation that enumerates the possible kinds? If a
> fourth kind appeared, would the scrape notice it as a new kind, or would it silently map
> it into one of the three?

**Q2 — Disney DCP, to the Disney scrape session.**
> When a file is moved or renamed inside the DCP Vault DAM, does anything in the crawl
> output stay constant across the move? Specifically, for the same underlying file before
> and after a path change: is `UUID` the same value? Is `collectionDmcId` the same value?
> Is any checksum or file-size field emitted that could confirm the two paths are one file?
> If nothing is constant, say so — that answer is as useful as a yes.

**Q3 — Disney OPA, to the Disney scrape session.**
> Has any `licensedPropertyID` or `characterID` ever been observed to point at a different
> property or character than it did in an earlier extract? And separately: are these ids
> visibly sequential or visibly opaque? If two extracts are available, a direct diff of
> id-to-name pairs would answer this outright.

**Q4 — Paramount, to the Paramount scrape session.**
> For `PROGRAM_ID`, `CHARACTER_ID` and `COLLECTION_ID`: is each value unique across the
> entire Creative Library, or only within some parent (a program, a franchise, a
> collection)? A concrete check that would answer it: in one complete capture, does any
> `CHARACTER_ID` value appear under two different `PROGRAM_ID` values while naming
> different characters?

**Q5 — Paramount, to the Paramount scrape session.**
> When the three missing titles are recovered, will the output be a brand-new complete
> capture covering the whole library, or a supplementary file covering only those three? If
> it is supplementary, does it carry the same `captured_at` / `generated_at` as the
> original run or new values?

**Q6 — all three, to all three scrape sessions.**
> Does any portal expose a "deleted", "archived", "retired", "expired", "inactive" or
> "unavailable" state on an asset, property, character or style guide — a positive signal
> that something was intentionally removed, as distinct from simply not appearing? This is
> the single fact that would let the database ever retire a row, and today all three
> answers say no such field is emitted. Confirm whether that is "the portal does not have
> one" or "the scrape does not capture one."

---

## 9. SCHEMA BLOCKERS vs. DATA-LOAD BLOCKERS

These are separated because conflating them has already cost this project a session.

- **A SCHEMA blocker** is something that must change in `supabase/migrations/` before a
  load can succeed. It requires a migration, a review, and a promotion.
- **A DATA-LOAD blocker** is something the loader, the scrape output, or an operator must
  get right. The schema is already correct. **No migration fixes it.**

### 9.1 SCHEMA blockers

**There are none.**

Every schema question examined in this document resolved to either "the schema is already
correctly permissive" or "the schema is correctly strict and should stay that way". The one
thing that looked like a blocker — the item-1 IP Family conflict — is not a defect
(section 2).

Stated plainly so it is not mistaken for hedging: **nothing in this document blocks the
NBCU, Disney or Paramount loads at the schema level.**

### 9.2 DATA-LOAD blockers

**L1 — NBCU loader must resolve IP Family labels against `plm.nbcu_ip_family`, not against
Property.** Section 2. The schema permits both readings; only one is right. Getting this
wrong produces spurious rejections on every real capture.

**L2 — Paramount loader must not upsert entity rows.** Section 6.1. A plain `insert` lets
the PK surface a parent-scoping collision loudly. An `on conflict do update` converts it
into silent overwrite plus silently-misattached relationships. **This is the single most
damaging loader behaviour identified in this review.** Verify before the next Paramount
load.

**L3 — NBCU `expected_counts.asset_ip_family` must be supplied.** The replaced finalizer
adds `asset_ip_family` to `v_pairs`; an absent expected count raises
`expected_count_missing` and the capture is rejected. A loader written against the
pre-`20260811070000` finalizer will fail. Schema is correct; the loader must be updated.

**L4 — no loader may implement absence-driven removal.** Section 3. Currently nothing does.
This is a standing constraint on everything not yet written.

### 9.3 Not blockers — recorded exposures

- Disney DCP path-change duplicate identity (section 5.2). Real, silent, unaddressed. Not a
  blocker: it cannot occur within a single crawl.
- Disney OPA in-place overwrite on id reuse (section 5.3). Real. Needs Q3.
- Paramount parent-scoping (section 6.1). Needs Q4.

---

## 10. WORK LIST

For each: what changes, which migration, additive or restructure, and whether it can be an
in-place edit or must be a forward migration.

### 10.1 Deployment state — verified per version, not inferred

**The rule is deployment state, not age.** Production's ledger is applied **out of order**,
so the maximum applied version proves nothing about any specific version. Each was checked
by set membership.

**Production `qsllyeztdwjgirsysgai`** — queried read-only on 2026-08-11 for the fifteen
licensor versions (`supabase_migrations.schema_migrations`). **Result: the empty set. None
of the OPA, Paramount, NBCU, Warner or Disney DCP migrations is applied in production.**

**Preview `rjyboqwcdzcocqgmsyel`** — the MCP in this session is bound to production and
takes no project parameter, so the preview ledger was **not** independently queried here.
The Paramount-applied-to-preview status is carried from the orchestrator's brief and is
**unverified by this agent**. Any work item touching a Paramount migration must re-verify
against the preview ledger before acting.

**Editability, derived:**

| Version | Batch | Applied | Editable in place? |
|---|---|---|---|
| `20260811070000` NBCU IP Family | none | **nowhere** | **YES** — in no atomic batch, applied in neither environment |
| `20260810070000` NBCU landing | **B9 (atomic)** | not in prod | **NO** — editing an atomic batch member breaks the allowlist |
| `20260810020000`, `20260810090000` Paramount | **B9 (atomic)** | not in prod; **preview: per brief, yes** | **NO** — atomic *and* reportedly applied to preview |
| `20260811030000` Paramount lossless | none | not in prod; **preview: per brief, yes** | **NO** — applied to preview |
| `20260807170000`–`20260807200000` OPA | **B7 (atomic)** | not in prod | **NO** — atomic |
| `20260810190000`–`20260810190100`, `20260811050000`–`20260811060000` Disney DCP | none | **nowhere** | **YES** |

B7 membership, read from `scripts/production_migration_guard.py`: `20260807030000`,
`20260807170000`, `20260807170100`, `20260807180000`, `20260807190000`, `20260807200000`.
B9 membership: the fourteen versions `20260810010000` through `20260810170000` listed in
the guard.

### 10.2 The items

**W1 — Clarify the IP Family resolution comment.** *(recommended, low risk)*
- **What changes:** the header wording in `20260811070000` that says "A missing or
  ambiguous match must REJECT the capture", to state explicitly that the resolution is
  against `plm.nbcu_ip_family` (which is built from the union including the asset labels,
  so it cannot come up empty) and **not** against `plm.nbcu_property`. Add one line: a
  label with no matching Property is a **legal** state, confirmed by the source, and is
  represented by `source_kind = 'asset_metadata_label'` when the label is also a Property.
- **Migration:** `20260811070000_nbcu_asset_ip_family_relationship.sql`.
- **Additive or restructure:** neither — **comment text only. Zero SQL semantics change.**
- **In-place or forward:** **IN-PLACE EDIT.** This version is applied in **neither**
  environment (production verified empty; it postdates the preview promotions) and is a
  member of **no** atomic batch. It is the one file in this review that can be edited
  safely.
- **Owner note:** `supabase/migrations/` is owned by `fix/788-leftover-review` in this
  round. This item is handed to that branch or to a follow-up dispatch; **this agent wrote
  no migration.**

**W2 — Write the universal rule down.** *(recommended, highest value per effort)*
- **What changes:** the section 3 rule is added to the repo's standing guidance — the
  natural home is `AGENTS.md`, as a numbered rule in the licensor-landing section, so it
  is read by every future agent before they design anything.
- **Migration:** none. Documentation.
- **In-place or forward:** n/a.
- **Why it is first among equals:** the rule is currently satisfied by nineteen migrations
  and written in none of them. The next agent to build a "current view" or a "sync" has
  nothing stopping them from building the one thing that would destroy real licensed data.

**W3 — Document the `source_kind` escalation path.** *(recommended)*
- **What changes:** a note recording that the CHECK is deliberate, that a fourth value is
  NOT KNOWN rather than impossible, that the CHECK firing is the *intended* loud failure,
  and that the only sanctioned response is a forward migration adding the value after a
  human decides its meaning — never removing the CHECK, never coercing in the loader.
- **Migration:** none today. Documentation. If a fourth value ever appears: a **forward
  migration**, because `20260810070000` sits in atomic B9 and cannot be edited in place.
- **Additive or restructure:** additive when it happens (`drop constraint` +
  `add constraint` with the wider list).

**W4 — Disney DCP duplicate-identity detection report.** *(recommended, but not urgent)*
- **What changes:** a new read-only `plm` view listing candidate duplicate asset
  identities — same `file_name`, matching `file_size_bytes` and/or `checksum`, different
  `source_path`. **Reports only.** No merge, no flag, no mutation.
- **Migration:** a **new** migration file, version allocated by the orchestrator.
- **Additive or restructure:** **purely additive** — one view, no table touched.
- **In-place or forward:** **FORWARD.** It is new work; it edits nothing.
- **Sequencing:** hold until Q2 is answered. If Q2 reveals a stable id across path changes,
  the right fix is different and better, and this view is wasted work.

**W5 — Verify the Paramount loader does not upsert entity rows.** *(recommended, do before
the next Paramount load)*
- **What changes:** loader behaviour, not schema. Confirm `plm.pmt_property`,
  `plm.pmt_franchise` and `plm.pmt_character` are populated with plain `insert`.
- **Migration:** **none. This is a DATA-LOAD item.** The schema is already correct.
- **In-place or forward:** n/a.

**W6 — Build the NBCU supersede path.** *(recommended; the largest item)*
- **What changes:** the five objects in section 7.2 — `plm.nbcu_current_capture`,
  `plm.nbcu_capture_supersession`, the `plm.nbcu_current_<entity>` views,
  `plm.promote_nbcu_capture()`, `plm.nbcu_capture_drift()`.
- **Migration:** a **new** migration, version allocated by the orchestrator.
- **Additive or restructure:** **purely additive.** It creates new objects and alters no
  existing table, so it does not disturb atomic B9 and does not require editing
  `20260810070000`. The landing migration's "NO `nbcu_current_*` VIEWS" note becomes
  superseded-by-a-later-file, not contradicted-in-place.
- **In-place or forward:** **FORWARD**, necessarily.
- **Scope discipline:** **NBCU-named objects only.** Do not build a generic licensor
  framework — sections 7.4 and 5.4 explain why that would bake NBCU's confirmed
  full-replacement semantics into two sources that have not confirmed it.
- **Prerequisite:** none. NBCU full replacement is a positive YES. This is the one design
  in this document that rests on established fact rather than absence of evidence.

**W7 — Put Q1 to Q6 to the scrape sessions.** *(recommended, cheapest item on the list)*
- **What changes:** nothing in the repo. Six questions, asked.
- **Why it is on the work list:** W4 waits on Q2, the OPA decision waits on Q3, the
  Paramount key decision waits on Q4, and the whole question of whether any row may EVER be
  retired waits on Q6. Four blocked decisions, six questions.

---

## 11. WHAT THIS DOCUMENT DELIBERATELY DID NOT DO

- **No database was written to.** One read-only `select` against production's migration
  ledger; `get_project_url` called first and the ref (`qsllyeztdwjgirsysgai`) stated before
  it. No DDL, no DML, no `apply_migration`, no workflow trigger.
- **No migration was written or edited.** `supabase/migrations/` is owned by
  `fix/788-leftover-review` this round.
- **No NOT KNOWN was resolved by choosing.** Every one is either left permissive in the
  schema or turned into a follow-up question in section 8.
- **No fact was invented.** Where a design needed something nobody said, the question was
  written instead.
