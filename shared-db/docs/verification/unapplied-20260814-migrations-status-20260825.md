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

## Bottom line for Albert

**One thing is genuinely broken in production right now, and it is not one of the six.** A new
Paramount capture cannot run. Production's Paramount loader was repaired on 2026-08-24 against a
version of itself that production does not have, so it now points at a table that does not exist and
skips two fields the database still insists on. A capture attempted today stops at the first chunk.
It stops **safely** — nothing is corrupted, nothing is half-written — but Paramount has not been
re-captured since 2026-08-13 and cannot be until this is repaired forward. Repair work is already in
flight (issue #1459, PR #1491, first of three stages).

**Everything else is latent risk, not an outage.** Nothing else in the business is degraded today.

**Five of the six migrations you asked about are no longer open questions.** The picture in issue
#949's 2026-08-24 comment moved substantially in the day after it was written:

| Migration | Status today | Recommendation |
|---|---|---|
| `20260814193351` pmt duplicate name columns | Rehearsed on preview 08-24; **must not be applied as-is** | **Retire the version, supersede it** — stage 1 shipping in PR #1491 |
| `20260814213043` pmt metadata element | Rehearsed on preview 08-24; same ordering trap | **Retire and supersede** — stage 2, not yet authored |
| `20260814223552` pmt collection term | Rehearsed on preview 08-24; same ordering trap | **Retire and supersede** — stage 3, not yet authored |
| `20260814233342` source capture inventory | **Already retired** (owner ruling 08-24, PR #1402) | Nothing to do — closed |
| `20260814233423` remaining source resolution | **Already retired** (owner ruling 08-24, PR #1402) | Nothing to do — closed |
| `20260814170749` wb retire legacy capture paths | **Still pending everywhere** — the only untouched one | **Apply**, after a preview rehearsal. Needs a window. |

**The one item that still needs a decision from you is the Warner cleanup.** It has been sitting
unapplied for eleven days, is safe to apply today, and nobody has scheduled it.

---

## The numbers, re-derived today

Both figures below come from the two workflow runs launched for this report, not from any earlier
comment.

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

## 1. Paramount — broken today, and the fix is *not* "apply the three" {#paramount}

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

### Why applying the three now would make things worse

All three sort *below* `20260824135515`, which is already recorded in production's ledger and will
never re-run. Applying them in version order would leave production with the 2026-08-14 loader body
— **silently deleting the JSON-null repair** and bringing back the exact bug issue #1418 fixed.
Nothing in the apply path would warn: the function exists either way, so catalog verification passes.

This is why the 2026-08-23 audit's recommendation ("apply all three in one window") is now out of
date, and why I am **not** repeating it.

### What is happening instead

Issue #1459 sets out the correct route: reproduce each of the three under a **fresh version number
that sorts above the repair**, prove byte-equality with the original, hard-block the original from
any production allowlist, and keep `20260825094455` (the forward JSON-null repair, already merged)
last in the eventual set. PR #1491 does stage 1 of 3 — `20260825102727`, byte-identical to
`20260814193351` (both SHA-256 `baa4593a…`). Stages 2 and 3 follow once #1491 is previewed and
merged.

### Recommendation

**Retire all three 2026-08-14 Paramount versions and let the supersession chain finish.** This is a
real change of direction from the 2026-08-23 audit and needs your ruling to be formal: a retirement
row for each of `20260814193351`, `20260814213043` and `20260814223552`, on the grounds that they
cannot be applied in their merged position without reverting an applied repair. The replacements
carry the identical SQL, so nothing about the intended change is lost.

Your 2026-08-24 authorization to promote the trio to production **should not be acted on as written**
— promoting those exact three versions is the unsafe path #1459 documents. The safe equivalent is
promoting the four replacement versions in order once all three stages exist and a preview rehearsal
of the full set passes.

**Business effect of applying nothing yet:** Paramount stays un-capturable. That is already true and
does not get worse. There is no data loss and no corrupted row; the 2026-08-13 capture is intact and
readable.

---

## 2. Warner legacy cleanup — `20260814170749` — safe to apply, and nobody has scheduled it {#warner}

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
feeds (zero references in `types/`, `apps/`, `tools/`), so no screen or report is affected. Second,
the sixteen old loader functions remain callable and the capture guard still accepts the retired
target names, so a stale script could land a fresh Warner scrape into tables nothing reads.

**Recommendation: apply as-is**, after a preview rehearsal, in the next available window. Do not
edit the merged file — `tools/sync-warner-starlabs.test.mjs` asserts its contents. If you later want
the direct Warner assertions exposed on the API surface, that is a separate new migration, not part
of this one.

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

1. **Decide the Paramount retirement** ([section 1](#paramount)). Three retirement rows, so the
   originals can never be promoted by accident, and the supersession chain in #1459 becomes the only
   route. This is the finding that most needs your word.
2. **Schedule a window for the Warner cleanup** ([section 2](#warner)) — preview rehearsal, then
   production. It is safe today, self-protecting, and eleven days overdue.
3. **Let #1459 finish stages 2 and 3** before any Paramount production window. Promoting a partial
   set is what caused this.
4. **Keep issue #949 open** until Warner and Paramount are resolved. The alarm now clears on its own,
   which it could not do before 2026-08-23.

## Limits of this report

Production was queried read-only and its identity proved in the same statement. Preview was not
queried directly; preview facts come from the preview drift run launched for this report and from the
capture evidence recorded on issue #949. No migration was applied, promoted, rehearsed or pushed to
any database by this session, and no production command was run.
