# The six 2026-08-14 migrations — where they actually stand on 2026-08-25

**Date:** 2026-08-25 · **Scope:** investigation only. **Nothing was applied, promoted or pushed.**
**Supersedes the status half of** `unapplied-20260814-migrations-audit-20260823.md`, which remains
the reference for what each migration contains. That file is being edited by the in-flight PR #1491
and was not touched here.

**Evidence:** two fresh `migration-ledger-drift` runs launched for this report
([production 32838038103](https://github.com/u2giants/shared-db/actions/runs/32838038103),
[preview 32837941868](https://github.com/u2giants/shared-db/actions/runs/32837941868)), the SQL on
`main`, issues #949, #958, #1418, #1450, #1459, PRs #1402/#1465/#1491, and read-only queries against
the **production** database (identity proved in the same statement: `plm.pmt_metadata_element` is
absent, which is true only of production).

---

> ## ✅ RESOLVED, 2026-08-25 — the Paramount promotion is DONE. Section 1 is history, not a plan.
>
> This file recommended retiring the three 2026-08-14 Paramount versions and rebuilding them
> through the #1459 supersession chain. That route was killed by owner ruling (#679), a
> four-version window was authorized instead, and the window then ran into a third answer that
> is the one actually on production. **Read this box, not section 1.**
>
> **What is applied to production, run 32851388854:**
> `20260814193351 → 20260814213043 → 20260825124200 → 20260825130500`.
>
> **What is hard-blocked and must never be promoted** (PR #1510): `20260814223552` and
> `20260825094455`. Both carry correct SQL. Both are unpromotable because their only preview
> applies ran on commits a squash merge left outside `main`'s history, so the production
> business-risk gate refuses their byte binding (measured: runs 32845346966, 32850264285), and
> neither can ever earn a qualifying rehearsal because preview already has them applied. They
> were replaced by `20260825124200` (the `pmt_collection` vocabulary DDL) and `20260825130500`
> (the forward loader repair). Promoting either original now would overwrite the repaired
> `plm.load_pmt_capture_chunk` body with an older rewrite and silently restore the #1418 defect.
>
> **Verified on production after the apply:** `plm.pmt_metadata_element` exists,
> `plm.pmt_collection.paramount_term` is gone, the loader carries the `nullif` repair and
> references `pmt_metadata_element`, `api.pmt_style_guides` returns the constant label, and
> `pmt_authorized_title_property.paramount_property_name` is nullable. A Paramount capture can
> run.
>
> **CORRECTION, 2026-08-26.** The last sentence of this box originally read "No production Paramount
> data capture has been authorized or performed." That was true when written and is now false: the
> first real production load — the deliverable of issue #679's own title — ran on **2026-08-25,
> 10:24-10:26**. Capture `d4d678ae-44c4-4edb-a5ea-edde413dc0fc`, status `complete`, kind `full`,
> 33,862 assets and 207,522 metadata values, `captured_by` "Codex production capture", noted as a
> "brand-new governed production capture after issue #679 structural handback". Measured read-only
> against production `qsllyeztdwjgirsysgai` on 2026-08-26. The capability is not merely unblocked in
> principle; it has been exercised.
>
> **What in this file still stands:** the analysis of the problem, and sections 2, 3 and 4. The
> Warner cleanup `20260814170749` (section 2) is structurally stranded and must never be
> rehearsed or promoted. Owner ruling #1517 replaces it with fresh version `20260825201330`,
> carrying identical executable SQL and no replacement API view.
>
> Independent reviews behind the ruling: Kimi K3 and GLM 5.3 (AGREE WITH CONDITIONS).

---

## RESOLVED 2026-08-25 13:16 — read this first

**Paramount is no longer broken. The production window completed.** Issue #679's session promoted
the corrected set (`20260814193351`, `20260814213043`, `20260825124200`, `20260825130500`) in run
[32851388854](https://github.com/u2giants/shared-db/actions/runs/32851388854). Verified read-only
against production from this session afterwards: `plm.pmt_metadata_element` now exists,
`pmt_authorized_title_property.paramount_property_name` is now nullable, and the loader carries the
JSON-null repair. **A Paramount capture is unblocked.**

`20260814223552` and `20260825094455` could not be promoted directly — both hit the preview
byte-binding gate — so they were superseded by `20260825124200` and `20260825130500`. The end state
is the one this report recommended; the route differed.

**Warner is also resolved.** Owner ruling #1517 requires the stranded original `20260814170749`
to remain retired and hard-blocked. Its byte-identical replacement `20260825201330` was rehearsed,
merged in PR #1541, and applied alone to production in run
[32901820150](https://github.com/u2giants/shared-db/actions/runs/32901820150). Everything below
describes the state before these 2026-08-25 resolutions and is kept as the record of how it was
diagnosed.

---

## Bottom line for Albert

**One thing is genuinely broken in production right now, and it is not one of the six.** A new
Paramount capture cannot run. Production's Paramount loader was repaired on 2026-08-24 against a
version of itself that production does not have, so it now points at a table that does not exist and
skips two fields the database still insists on. A capture attempted today stops at the first chunk.
It stops **safely** — nothing is corrupted, nothing is half-written — but Paramount has not been
re-captured since 2026-08-13 and cannot be until the fix is applied. **Every migration needed to fix
it is already written, merged and rehearsed on preview.** It needs a production window, not more
work.

**Everything else is latent risk, not an outage.** Nothing else in the business is degraded today.

**Five of the six migrations you asked about are no longer open questions.** The picture in issue
#949's 2026-08-24 comment moved substantially in the day after it was written:

| Migration | Status today | Recommendation |
|---|---|---|
| `20260814193351` pmt duplicate name columns | Rehearsed on preview 08-24 | **Apply** — first of a four-version window |
| `20260814213043` pmt metadata element | Rehearsed on preview 08-24 | **Apply** — second |
| `20260814223552` pmt collection term | Rehearsed on preview 08-24 | **Apply** — third |
| `20260825094455` pmt loader forward repair *(not one of the six)* | Merged 08-25, pending | **Apply last** — without it the other three revert a live fix |
| `20260814233342` source capture inventory | **Already retired** (owner ruling 08-24, PR #1402) | Nothing to do — closed |
| `20260814233423` remaining source resolution | **Already retired** (owner ruling 08-24, PR #1402) | Nothing to do — closed |
| `20260814170749` wb retire legacy capture paths | **Retired and hard-blocked** — replacement `20260825201330` is production-live | Never apply the original; replacement completed in run 32901820150 |

The Paramount window and the fresh Warner replacement both completed. The Warner replacement was
rehearsed separately and later applied alone to production in run 32901820150.

---

## Historical audit snapshot — superseded for Warner by #1517

Both figures below came from the two workflow runs launched for the original report. They are kept
as dated evidence, not as current drift totals. The Warner original is now retired and its fresh
replacement is `20260825201330`; use the live drift workflow for current totals.

**Production** — 517 versions merged on `main`, 498 applied, 19 in the drift list: **8
genuinely-pending**, 11 retired or deliberately held (which no longer make the check fail).

**Preview** — 517 merged, 509 applied, 8 in the drift list: **1 genuinely-pending**
(`20260814170749`), 7 retired or held.

Of the eight genuinely-pending on production, three are the 2026-08-14 Paramount versions, one is
the Warner cleanup, and four are ordinary recent work moving through the normal flow
(`20260819011639`, `20260819151536`, `20260824181600`, `20260825094455`).

**The drift alarm is red for real reasons and will clear on its own** once these are resolved. The
verdict fix (`1920ec6`, 2026-08-23) is done and was not touched here.

---

## 1. Paramount — broken today, and the fix is four migrations in one window {#paramount}

### What is actually wrong

Production runs a Paramount loader function that was rewritten on 2026-08-24 by migration
`20260824135515`, a repair for a JSON-null bug (issue #1418). That repair was written as a
re-derivation of the loader **as it stands on `main`** — that is, after all three 2026-08-14
rewrites. But none of those three ever reached production. The repair was promoted alone.

Measured first-hand on production today:

| Check | Value | Consequence |
|---|---|---|
| Loader references `plm.pmt_metadata_element` | `true` | |
| `plm.pmt_metadata_element` exists in production | **no** | capture fails, error 42P01 |
| Loader still writes `paramount_property_name` | `false` | |
| `pmt_authorized_title_property.paramount_property_name` is nullable | **NO** | capture fails, error 23502 |

So the loader and the tables it writes into disagree in two independent ways. **A Paramount capture
run today aborts on its first chunk.** Preview is fine — the three migrations *are* applied there,
and the 2026-08-24 preview capture (33,862 assets, 55 finalization checks, 0 failures) proves it.

### The ordering trap — real, but already solved

All three sort *below* `20260824135515`, which is already recorded in production's ledger and will
never re-run. Applying **only** the three would therefore leave production with the 2026-08-14
loader body — silently deleting the JSON-null repair and bringing back the exact bug issue #1418
fixed. Nothing in the apply path would warn: the function exists either way, so catalog verification
passes.

That is why a fourth version, `20260825094455`, was written and merged on 2026-08-25. It sorts above
everything else and re-establishes the JSON-null repair on top of the trio's final body. With it in
the same window, the trap does not fire.

### Recommendation — CORRECTED 2026-08-25 after independent review

**Apply the three, then `20260825094455` last, in one bounded window of four versions. Do not
retire them.**

This reverses the recommendation first published in this file. An independent review by Grok 4.6
(session `pmt-trio-ordering`, $0.04) refuted it, and I verified the refutation against the SQL
before accepting it.

**What I got wrong.** The ordering trap is real, but it only bites if the three are applied *alone*.
`20260825094455` — already merged, and sorting above both the trio and the applied repair
`20260824135515` — exists precisely to close it. Its own header states the required production
order in terms:

> `20260814193351` → `20260814213043` → `20260814223552` → `20260825094455`
> … Applying only the trio would leave the older `20260814223552` body last and silently restore
> the defect.

So the safe window is those four, in that order. The already-applied `20260824135515` is skipped
because the ledger holds it; the forward repair re-establishes the JSON-null fix on top of the
trio's final body. Retiring the three is unnecessary — and it would leave the real defect unfixed,
because `20260825094455` only rewrites the loader function. It does **not** create
`plm.pmt_metadata_element` or relax the `NOT NULL` columns. Only the trio does that. Retire them and
Paramount stays broken.

**Your 2026-08-24 authorization to promote the three was right.** It was simply incomplete: it needs
`20260825094455` appended as a fourth version in the same window.

**A defect this surfaced in the in-flight repair work.** PR #1491 (open, issue #1459) introduces
`20260825102727` as a byte-identical replacement for `20260814193351` and hard-blocks the original.
But `20260825102727` sorts *above* `20260825094455`. That makes the order stated in
`20260825094455`'s own header unachievable: the first structural prerequisite would run *after* the
loader repair that assumes it. This needs resolving on #1459 before that approach goes further; I
have raised it there. The four-version window above does not have this problem.

**Business effect of applying nothing yet:** Paramount stays un-capturable. That is already true and
does not get worse. There is no data loss and no corrupted row; the 2026-08-13 capture is intact and
readable.

---

## 2. Warner legacy cleanup — original `20260814170749` retired; replacement `20260825201330` {#warner}

**Plain English.** Warner (STARLABS) source data was moved from a first-generation set of tables to
a cleaned-up set. This migration finishes the job: it locks the capture contract so a new Warner
scrape can only write to the current tables, and removes the eight abandoned tables, their sixteen
old loader functions and the two API feeds that read them.

**Destructive — but only of empty objects.** It drops 8 tables, 18 functions and 2 views. Named in
full: tables `plm.wb_asset`, `wb_style_guide`, `wb_character`, `wb_franchise_property`,
`wb_property_character`, `wb_asset_character`, `wb_asset_style_guide`, `wb_asset_franchise_property`;
functions `sync_wb_*` (eight in `public`, eight in `plm`) plus `begin_wb_capture_legacy` and
`finalize_wb_capture_legacy`; views `api.wb_property_character` and `api.wb_property_reconciliation`.
**No column is renamed and no data is rewritten.**

**Verified on production today:** all eight tables hold **0 rows**, the 4,158 real
property→character relationships live safely in `plm.wb_property_character_normalized`, and no
legacy-target capture is in flight. The migration's own preflight refuses to run if either of those
changes, so it is self-protecting.

**Still safe after eleven days?** Yes. Only two later migrations touch Warner objects —
`20260816045120` (inferred relationship views) and `20260823175638` (canonical relationship edges) —
and both read the *normalized* tables only. Nothing later redefines what this file drops.

**Broken today by its absence?** **No — but it is quietly wrong in two ways.** The two surviving API
feeds read the emptied tables, so anyone querying them by hand is told "no Warner property/character
relationships exist" while 4,158 of them sit next to it. Nothing in the codebase consumes those
feeds (zero application or tool consumers; generated types still describe the legacy table), so
no screen or report is affected. Second,
the sixteen old loader functions remain callable and the capture guard still accepts the retired
target names, so a stale script could land a fresh Warner scrape into tables nothing reads.

**Independently reviewed and confirmed.** Muse Spark 1.2 (session `wb-legacy-cleanup-safety`)
re-ran the consumer search, the preflight analysis and the eleven-day conflict check and confirmed
the cleanup SQL is safe, not that the stranded original can be promoted. It corrected one detail of
mine — `types/database.types.ts:28883` does
contain a `wb_property_character` entry, but it is the *generated definition of the legacy table*,
not a query against the dropped view. It disappears when types are regenerated after the apply, so
**regenerating `types/` is a required follow-up step in the same window.** It also confirmed the
preflight cannot pass while real data exists, and that both later Warner migrations
(`20260816045120`, `20260823175638`) read only the normalized tables.

**Current ruling:** never rehearse or promote the original `20260814170749`. Its authoring-era
preview no longer exists and current producer bytes cannot create qualifying evidence. Issue #1517
reissues its executable SQL as `20260825201330`, permanently hard-blocks the original, and adds no
replacement API view. Rehearsing the fresh version and promoting it are separate governed actions.
Do not edit the original file — `tools/sync-warner-starlabs.test.mjs` asserts its contents and the
replacement's executable-SQL equivalence.

---

## 3. The two already-retired versions — closed, no action {#retired}

`20260814233342_source_capture_inventory_latest_complete` and
`20260814233423_remaining_source_resolution_durable_home` were retired by your ruling of 2026-08-24
and hard-blocked in the guard scripts by PR #1402. Both fresh drift runs now list them as `[RETIRED]`
with reasons, and neither makes the check fail.

The reasoning stands and is worth restating because it is the strongest argument in this whole file
for reading SQL before applying it: `20260814233342` would have replaced the source-coverage report
with its 2026-08-14 body, **silently** removing the Sega, Peanuts and WildBrain branches that later
applied migrations added. Same ten columns, no error, wrong answers. Post-apply catalog verification
could not have caught it.

The capability `20260814233423` was meant to deliver — a permanent home for "this source record
means this POP record" decisions — is **not delivered and is not scheduled**. Nothing is lost today
(production holds zero such decisions), but until a replacement ships, recording one is not properly
supported. That belongs to a fresh workstream; the 2026-08-23 audit sets out the trap the rework must
avoid.

---

## 4. The two 2026-08-19 migrations — the process working normally

`20260819011639_popdam_bulk_operation_revision_lease` and
`20260819151536_wildbrain_inventory_classification_and_finalize_extra_key_sweep` are applied to
preview and await a production window. They are rehearsed, they behave, and they are not part of
this problem. Mentioned only so the drift list reads cleanly.

---

## What I recommend, in order

1. **Authorize the four-version Paramount window** ([section 1](#paramount)):
   `20260814193351` → `20260814213043` → `20260814223552` → `20260825094455`, in that exact order,
   after a preview rehearsal of the full set. This is what restores Paramount capture. Promoting
   fewer than four is the unsafe path.
2. **Completed:** fresh Warner version `20260825201330` ([section 2](#warner)) was rehearsed and
   promoted alone in production run 32901820150. Never name superseded original `20260814170749`
   in a preview or production allowlist.
3. **Resolve the `20260825102727` ordering contradiction on #1459** before PR #1491 merges. A
   replacement that sorts above the forward repair cannot satisfy the required order.
4. **Keep issue #949 open** until Warner and Paramount are resolved. The alarm now clears on its own,
   which it could not do before 2026-08-23.

## Independent review

Both decisions were put to an independent reviewer, because the owner is not a programmer and asked
for a second opinion before ruling.

- **Paramount** — Grok 4.6, session `pmt-trio-ordering`, 139,932 tokens, **$0.0389**. It *refuted*
  this report's original recommendation. I verified its argument against the SQL, found it correct,
  and reversed the recommendation above rather than defending mine. Its finding of the
  `20260825102727` ordering contradiction in PR #1491 is raised on issue #1459.
- **Warner** — Muse Spark 1.2, session `wb-legacy-cleanup-safety`. It confirmed the recommendation
  and added the `types/` regeneration step.

An earlier broad Grok session (`unapplied-20260814-decisions`, $0.183) exhausted its turn budget
without a verdict — the brief covered too much ground. Recorded here so the cost is accounted for.

## Limits of this report

Production was queried read-only and its identity proved in the same statement. Preview was not
queried directly; preview facts come from the preview drift run launched for this report and from the
capture evidence recorded on issue #949. No migration was applied, promoted, rehearsed or pushed to
any database by this session, and no production command was run.
