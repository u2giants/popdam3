# OPA property→character — BUILD NOTE

**Status: BUILT, APPLIED TO PREVIEW (`rjyboqwcdzcocqgmsyel`) and VERIFIED. All FIVE migrations applied; both contract test files pass unmodified. Two review rounds closed — sections 8.9 and 8.10. No open defects.**

This records what was actually built from
[`README.md`](./README.md) (the authoritative design, PR #485, which supersedes
`../opa-characters-20260806/DESIGN.md` from PR #476), where the build
**deliberately departs** from that design, and every migration it depends on.

**Author:** sub-agent `opa-build`, dispatched by the shared-db coordinator
(session `697b5b87`, machine `al8960ofc`, coordinator marker: GitHub issue #491).
**Database claim:** issue #496.
**Branch:** `agent/opa-build-20260807`, cut from `origin/main` at
`5613fb042a4cf0677ea365102e62fe38f3fac124`.
**Date:** 2026-08-07.

---

## 0. PROMOTION LIST — all FIVE migrations, in order

> **Promote all five or none.** A previous session shipped a partial fix because
> three of four correction migrations were named nowhere. These are the complete,
> exact, 14-digit versions this work consists of:
>
> | # | Version | File |
> | ---: | --- | --- |
> | 1 | **`20260807170000`** | `opa_property_character_landing.sql` |
> | 2 | **`20260807170100`** | `opa_property_character_importer.sql` |
> | 3 | **`20260807180000`** | `opa_sync_reentrancy_fix.sql` |
> | 4 | **`20260807190000`** | `opa_security_and_view_corrections.sql` |
> | 5 | **`20260807200000`** | `opa_comment_corrections.sql` |
>
> Order matters and is strict: 1 creates the table, 2 creates the functions, 3
> replaces one of them, and 4 replaces the read policy, the reconciliation view and
> the function again.
>
> **Promoting a subset is dangerous, not merely incomplete:**
> - 1+2 without 3 ships a loader that raises `42P07` on any second in-transaction call.
> - **Anything without 4 ships a read policy that lets EVERY authenticated account —
>   including `vendor` and `viewer` — read the entire confidential Disney extract.**
>   4 is a security fix. It is not optional.
>
> All five are applied to preview `rjyboqwcdzcocqgmsyel`; none has been promoted to
> production.

## 1. What was built

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260807170000_opa_property_character_landing.sql` | Landing schema (§7.1) + the junction (§7.2) + both `api` views (§7.5, §7.6) |
| `supabase/migrations/20260807170100_opa_property_character_importer.sql` | Privilege predicate + guarded `SECURITY DEFINER` loader + `public.*` wrapper |
| `supabase/migrations/20260807180000_opa_sync_reentrancy_fix.sql` | Forward fix making the loader re-entrant within a transaction (§8.5) |
| `supabase/migrations/20260807190000_opa_security_and_view_corrections.sql` | Review round: closes the read policy, NULL-safe shrink band, pg_temp staging, node-grain view, leak-free diagnostics (§8.9) |
| `supabase/migrations/20260807200000_opa_comment_corrections.sql` | Re-review round: comment corrections plus non-null, stably-ordered view arrays (§8.10) |
| `supabase/tests/opa_property_character_landing_contracts.sql` | Contract tests for the landing |
| `supabase/tests/opa_property_character_importer_contracts.sql` | Contract tests for the loader |
| `tools/sync-opa-property-character.mjs` | Runner — **logic only, no data** |
| `tools/sync-opa-property-character.test.mjs` | 18 offline runner tests — **invented fixtures only** |

### Migration versions this work depends on — all 14 digits, in full

| Version | Migration | Why it is a dependency |
| --- | --- | --- |
| `20260621150815` | `app_core.sql` | Defines `core.licensor`, `core.property`, `core.character`, `app.entity_status`, `app.has_role` / `app.has_any_role`. The junction FKs and the RLS posture require all of these. |
| `20260710135950` | `reconcile_dflow_baseline.sql` | Creates `dflow.property_character_associations` — the pre-existing third table analysed in §4 below. Not modified. |
| `20260724030000` | `coldlion_licensor_property_phase1_mirror_schema.sql` | The `plm.erp_*` mirror pattern (raw typed mirror in `plm`, view in `api`, nullable resolution columns) that the landing copies. |
| `20260724060000` | `coldlion_licensor_property_phase2a_mirror_importer.sql` | The `SECURITY DEFINER` + thin `public.*` wrapper + advisory-lock + guarded-snapshot pattern that the importer copies. |
| `20260727230000` | `core_style_guide_axis.sql` | Creates `core.style_guide` and `core.style_guide_character` — the axis-2 sibling. The junction's RLS posture is copied from it, and the reconciliation invariant is asserted against it. |
| `20260807170000` | *(this work)* `opa_property_character_landing.sql` | Required by `20260807170100`, which writes the table it creates. |
| `20260807170100` | *(this work)* `opa_property_character_importer.sql` | Superseded in behaviour by `20260807180000`, but still the migration that CREATES the functions. Must be promoted BEFORE it. |
| `20260807180000` | *(this work)* `opa_sync_reentrancy_fix.sql` | Superseded in behaviour by `20260807190000`, which replaces the function again. Must be promoted BEFORE it. |
| `20260807190000` | *(this work)* `opa_security_and_view_corrections.sql` | Its comments and view are corrected by `20260807200000`. Must be promoted BEFORE it. |

The highest migration version on `origin/main` when these were authored was
**`20260807030000`**. All four versions were **allocated by the coordinator**, not
derived from `now()` — two agents dispatched in the same minute pick the same
number, and a duplicate version means one migration is **silently skipped**,
because Supabase's ledger keys on the version alone and not on the filename.
That has happened twice in this repository.

### Objects created — matching what the migrations actually declare

Not what the design doc's prose listed; see §3 for where those disagreed.

**`20260807170000` (landing)**

| Object | Kind |
| --- | --- |
| `plm.opa_property_character` | table |
| `opa_property_character_pkey` | PK `(licensed_property_id, character_id)` |
| `opa_property_character_property_name_chk` | check |
| `opa_property_character_character_name_chk` | check |
| `opa_property_character_option_source_chk` | check |
| `opa_property_character_lob_chk` | check |
| `opa_property_character_resolution_status_chk` | check |
| `opa_property_character_property_id_fkey` | FK → `core.property(id)` ON DELETE RESTRICT |
| `plm.idx_opa_property_character_property_name` | index |
| `plm.idx_opa_property_character_character_name` | index |
| `plm.idx_opa_property_character_character_id` | index |
| `plm.idx_opa_property_character_licensed_property_id` | index |
| `plm.idx_opa_property_character_property_id` | partial index |
| `plm.idx_opa_property_character_resolution_status` | index |
| `plm.idx_opa_property_character_base_property_name` | expression index |
| `opa_property_character_read` | RLS policy |
| `core.property_character` | table |
| `property_character_pkey` | PK `(property_id, character_id)` |
| `property_character_property_id_fkey` | FK → `core.property(id)` ON DELETE RESTRICT |
| `property_character_character_id_fkey` | FK → `core.character(id)` ON DELETE CASCADE |
| `property_character_source_chk` | check |
| `core.idx_property_character_character_id` | index |
| `shared_read`, `admin_write` | RLS policies on `core.property_character` |
| `api.opa_property_character` | view (`security_invoker`) |
| `api.opa_property_reconciliation` | view (`security_invoker`) |

**`20260807170100` (importer)**

| Object | Kind |
| --- | --- |
| `plm.opa_loader_privilege_ok(text, text)` | function — pure, immutable, testable |
| `plm.sync_opa_property_character(jsonb, text, numeric)` | function — `SECURITY DEFINER` |
| `public.sync_opa_property_character(jsonb, text, numeric)` | function — thin wrapper |

**Nothing existing is altered or dropped. Nothing in `core.*` is modified.
`core.character` is not populated. Nothing is resolved. Nothing is deleted.**

---

## 2. The biggest deliberate departure: NO SEED MIGRATION

**The design doc's §7.7 instructs a seed migration generated from the committed
CSV. That was NOT done, and must never be done.**

§7.7's justification is explicit: the seed *"crosses no new confidentiality
boundary"* because the CSV *"is already committed to this **private**
repository (PR #466)."* **That premise is false as of today.**

- `u2giants/shared-db` was **public for seven weeks** while holding the
  confidential Disney extract.
- The CSV was **removed** from this repo by **PR #495** and now lives only in the
  private repo **`u2giants/licensor-source-data`** at
  `disney-opa/opa-characters.csv`.
- **This repository is public right now.**

A seed migration would re-materialise the same 10,262 confidential Disney rows
as SQL `INSERT`s under `supabase/migrations/` — permanently, in git history, in a
public repository. It would reopen the exact leak PR #495 just closed, in a new
file, and no later deletion could undo it.

> **The rule this build follows: SCHEMA IN GIT, DATA OUT OF GIT.**
> No `INSERT` of a Disney row appears in any migration. No CSV is committed
> anywhere in this repo. Not one sample row — not in a comment, not in a test
> fixture, not in a doc. **Every fixture in both test files is invented.**

Instead, rows arrive at runtime, following the repository's real and safe
precedent — the `plm.erp_*` ColdLion vendor mirror (`20260724030000` /
`20260724060000`): a `SECURITY DEFINER` function taking a `jsonb` snapshot, a
thin `public.*` wrapper so a service-role caller needs no raw DB password, and a
runner under `tools/` that supplies the payload. The runner reads the CSV from
the **private** repo and contains no data itself.

Two consequences worth stating plainly:

1. **Applying these migrations loads zero rows.** The tables land empty. That is
   correct and intended.
2. **The database is now the only place the Disney rows exist outside the private
   repo.** They are production-sensitive there. `plm.opa_property_character`
   grants `anon` nothing and both `api` views are `security_invoker`.

---

## 3. Naming defects in the design doc, and what was actually written

The doc's §7.2 lists constraint names its own DDL contradicts. Resolved
deliberately, and the object list in §1 above matches the catalog, not the prose.

| Design doc said | Actually written | Why |
| --- | --- | --- |
| `core.property_character_pkey` (prose) vs `constraint core_property_character_pkey` (its DDL) | **`property_character_pkey`** | The two cannot both be right. Chose the name Postgres itself would generate, so prose, DDL and `pg_constraint` agree. A constraint name is not schema-qualified in `pg_constraint.conname`; the schema comes from the table. |
| J3/J4 listed as *named* FK constraints, but the DDL used inline `references` (auto-generating `property_character_property_id_fkey` / `property_character_character_id_fkey`) | **Named explicitly** as `property_character_property_id_fkey` and `property_character_character_id_fkey` | Same names, but declared rather than inferred, so a test can assert them. |
| §7.1 lists indexes unqualified | Land in their table's schema — **`plm.*`** for the landing, **`core.*`** for the junction | Stated explicitly; the tests assert `schemaname`. |

Two further departures, both deliberate:

- **The junction's RLS posture is copied from `core.style_guide_character`, not
  from the design doc.** The doc proposed `for select to authenticated using
  (true)`. Its sibling on the other axis uses `app.has_any_role([...])` plus an
  `admin_write` policy. Canonical `core` data should read the way its sibling
  reads; the permissive form belongs to the `plm` vendor mirror, which does use it.
- **`property_character_source_chk`** was added (non-blank `source`). Not in the
  doc; a one-line integrity guard on a free-text provenance column.

---

## 4. The three overlapping property↔character tables — required reading

The coordinator flagged that a property↔character junction **already exists** and
that this would be the third. Both pre-existing tables were read before writing
any DDL. They model **different things**, and the design doc's §5.5 concern about
duplication is real but narrower than it looks.

### `dflow.property_character_associations` — legacy, app-local, and NOT a peer

Created in `20260710135950_reconcile_dflow_baseline.sql`.
PK `(property_id, character_id, licensor_id)`, integer keys.

The decisive fact: **both FKs point at the SAME table**,
`dflow.properties_and_characters` — one table holding rows typed `PROPERTY` and
rows typed `CHARACTER`, with a self-referential edge table between them. And per
`docs/style-guides-characters-and-royalties.md` §5 (and README §3.1), the rows
typed `PROPERTY` **are style guides**; the column name lies.

> So despite its name, `dflow.property_character_associations` is a
> **style-guide↔character edge inside the DesignFlow application's own schema.**
> It is a **migration SOURCE**, not a peer: its 9,622 edges are destined for
> `core.style_guide_character`. Nothing reads it as canonical. This work does not
> touch it.

`core.properties_and_characters` (10,122) and
`core.property_character_associations` (9,622) mirror the same legacy shapes.
Same reading applies. **Do not re-open the retracted lineage argument** (README
"A retracted claim you must NOT re-derive").

### `core.style_guide_character` — axis 2, STYLE

Created in `20260727230000_core_style_guide_axis.sql`. PK `(style_guide_id,
character_id)`, uuid keys. Answers **"which art files show this character."**
M:N by owner ruling 2026-07-23.

### `core.property_character` — axis 1, OWNERSHIP (built here)

Answers **"which licensed property does Disney approve this character under."**
Left endpoint `core.property`.

### How the three stay reconciled instead of drifting apart

The design doc's §5.5 warns that for the 178 style guides that are 1:1 with 178
OPA property nodes, the two `core` tables would assert the same ~4,967 facts
under two different left-hand keys, and would drift the first time one is updated.

**The contract that prevents it, and it is now enforced in the test suite:**

> **`core.style_guide.property_id` is the SINGLE bridge between the two axes.**
> A style guide belongs to exactly one property. Therefore every
> `core.style_guide_character` edge implies **at most one** property, and
> `core.property_character` is a **superset projection** of it — never an
> independent second opinion. Formally:
>
> ```
> every (style_guide.property_id, character_id) pair implied by
> core.style_guide_character MUST exist in core.property_character
> ```

Neither table is trigger-derived from the other — that would be the tempting fix
and it is the wrong one, because a derived table hides the moment the two
disagree instead of surfacing it. The invariant is **checkable at any time** and
is asserted in `opa_property_character_landing_contracts.sql` §5.

Because `core.character` holds **0 rows**, both tables are empty today and the
invariant holds trivially. **It must be re-asserted before either is first
populated** — that is the moment the risk becomes real, not now.

### Why it was built rather than questioned further

Albert ruled on 2026-08-07 to build it, because **Laura, the licensing manager,
confirmed a character can appear in multiple properties.** That is a business
fact from the domain authority. The design doc argues against the junction on
measurement grounds (~6 genuine multi-property cases out of 9,613); that argument
has been **heard and overruled** and is not re-argued here.

Having read all three tables, the ruling is **not** contradicted by what is in the
database: the third table is a genuinely different axis from
`core.style_guide_character`, and the `dflow` one is a legacy app-local
style-guide edge that is not a peer at all. **No push-back was warranted**, so
none is raised. The cost is not the build — `core.character` is empty, so it is
nearly free — **it is owning two overlapping contracts forever**, which the
invariant above is designed to make cheap.

---

## 5. The natural key: the ID pair, never the name pair

`plm.opa_property_character` is keyed on
**`(licensed_property_id, character_id)`** — Disney's **IDs**.

Measured on the 2026-08-06 extract (corrected in PR #495; an older copy of the
README asserting the name pair is **stale**):

| Key | Distinct values over 10,262 rows |
| --- | ---: |
| `(licensedPropertyID, characterID)` — **used** | **10,262** — unique |
| `(property, character)` display names — **rejected** | 10,240 — **22 collisions** |

Keying on names would have **silently dropped 22 rows**. Two distinct
`licensedPropertyID`s share one property display name (`Davy Crockett` is both
`216` and `425` — two genuinely distinct Disney properties).

ID-keying also handles, without any special case, the **21 OPA character names
that carry multiple `characterID`s** (e.g. `Beagle Boys` has `510`, `512`,
`518031315` — an apparent Disney system migration that left two ID generations
live). **Do not dedupe those without asking Disney.**

This is guarded in three places, on purpose:

1. the PK itself;
2. the importer (`G7`) aborts on a duplicate ID pair inside one snapshot rather
   than letting last-write-wins pick a winner at random;
3. the runner rejects the same thing before any network call.

And it is **regression-tested from both ends**: the landing test inserts two rows
with an *identical* name pair under different IDs and asserts **both** land; the
importer test does the same through the loader; and the landing test asserts no
`UNIQUE` index exists on `(property_name, character_name)`.

---

## 6. The privilege guard, and how it is actually proved

§7.4 of the design doc contains the **null-permissive shape**:

```sql
if not ( current_user = 'postgres' or auth.role() = 'service_role' ) then raise ...
```

Inside a migration `auth.role()` is **NULL**. `NULL = 'service_role'` is `NULL`;
`false or NULL` is `NULL`; `if not NULL then` **never runs the body**. The guard
reads as strict and behaves as wide open, admitting everyone forever. This has
already fired in this repo.

Three deliberate choices:

1. **The guard is a FUNCTION, `plm.opa_loader_privilege_ok(text, text)`, not a
   `do $$ … $$` block.** An anonymous block **never lands in `pg_proc`**, so a
   test cannot see it, call it, or prove it rejects anything — a defect already
   caught in this repo, where a test queried `pg_proc.prosrc` for a `DO` block
   and therefore asserted nothing. This predicate is directly callable, so the
   test asserts the NULL case is **REJECTED** rather than asserting that some
   text exists somewhere.
2. **It takes `session_user`, not `current_user`.** `SECURITY DEFINER` rewrites
   `current_user` to the function **owner**, so a `current_user` check inside a
   definer function always passes and guards nothing. `session_user` is the real
   login role and is unaffected. *(The design doc's corrected shape still used
   `current_user`; this is a third departure from it.)*
3. **It requires a non-null, non-empty, positively-matched identity.** Every
   other input, including NULL on both arguments, returns `false`.

**Neutralise-and-observe** is implemented as a real construction, not a claim
(`opa_property_character_importer_contracts.sql` §3): the test builds the
forbidden `not ( … or … )` shape as a `pg_temp` function inside the transaction,
calls it with `(null, null)`, and asserts that it **ADMITS** while the real guard
**REJECTS**. If the two ever agree, the test fails loudly with a message saying
either the guard regressed or the test can no longer detect the regression. A
negative test that passes with the bug present is a false safety signal; this one
demonstrates it can see the bug.

A second class of the same defect was found and fixed **in the test file itself**
during this build: every importer guard raises `P0001`, and an early draft raised
its own "was ACCEPTED" failure *inside* a block trapping `sqlstate 'P0001'` — so
the failure would have been swallowed by the very handler meant to absorb the
guard, and those ten negative tests would have passed no matter what. They now
set a flag inside the block and assert **outside** it.

---

## 7. Other things the build refuses to do, and why

- **Resolves nothing.** `property_id` lands `NULL`, `resolution_status` lands
  `'unresolved'` on every row, and the five resolution columns are **absent from
  both the insert list and the update `SET` list** of the importer's upsert — so
  a re-import can never wipe a human's decision. Tested.
- **Deletes nothing.** Rows held but absent from a snapshot are counted as
  `rows_missing` and **left alone**. "Presence adds and corrects; **absence never
  removes**."
- **Populates no `core.character` row**, and writes nothing to `core.*` at all.

These are not caution for its own sake — **two owner gates are still open** (how
far Disney may overwrite our curated names; whether ColdLion deletions should
propagate). Resolving nothing is exactly what makes this migration safe to ship
**before** those rulings.

The importer also has **no `resolve` or `promote` mode**. `mirror_only` is the
only mode that exists and any other value raises. There is deliberately no code
path for a decision that has not been made.

- **`option_source_id = 1007` stays pinned.** Its meaning is unknown; the pin
  exists so a future extract carrying a different value **fails loudly** rather
  than landing silently under an assumption nobody has verified. If a later
  extract legitimately differs, **widen it in a new migration with a recorded
  reason** — do not drop it.
- **Negative sentinel IDs are accepted.** `Special Projects` carries
  `licensedPropertyID = -9999`, `characterID = -9998`. Any unsigned or
  `text`-with-digit-check typing rejects them. Tested at both the table and the
  loader.
  > **⚠️ SUPERSEDED IN PART — owner ruling, Albert Hazan, 2026-08-07.** "Accepted"
  > is now true only of **parsing and column typing**, not of **loading**. Keep the
  > `bigint` typing and the parser's tolerance of a leading minus — both are still
  > required, so that a sentinel is *counted* rather than fatal, and **do not add a
  > positive check constraint**. But the row is **no longer written to the mirror**:
  > `tools/sync-opa-property-character.mjs` rejects any row with
  > `licensedPropertyID < 0` or `characterID < 0`, reports the count and the row
  > ordinals, and warns if more than one ever appears. The rule is general (`< 0`),
  > not the `-9999`/`-9998` pair; ID `0` is deliberately kept. The loader test that
  > asserted the sentinel **must survive** was replaced by tests asserting it is
  > **dropped**, plus a boundary test for ID `0`.
  > Measured effect: 10,262 → **10,261** rows, 1,445 → **1,444** nodes.
  > Full account and evidence:
  > `docs/verification/opa-preview-load-20260807/README.md` §2.
- **`captured_at` is supplied explicitly and never derived from `now()`.** The
  server runs **`America/New_York`**: a timestamp at UTC midnight reads back
  through `::date` as the **previous day**. The landing test *demonstrates* the
  hazard rather than assuming it, and asserts that midday-UTC pinning reads as
  the same date in both UTC and server-local time.
- **No schedule, no automation.** OPA has no API, no change feed and no webhook;
  a refresh requires Albert to complete MFA in his own browser and re-extract.

---

## 8. Verification — APPLIED TO PREVIEW AND TESTED

**Status: applied to preview `rjyboqwcdzcocqgmsyel` on 2026-08-07 and verified.
One real defect was found by running the tests; it is NOT yet fixed (see §8.5).**

Authorised by the coordinator (session `697b5b87`, marker #491). Production
`qsllyeztdwjgirsysgai` was never contacted.

### 8.1 How preview was reached, and a target-safety finding

`supabase/.temp/project-ref` read `rjyboqwcdzcocqgmsyel` before every push. **But
the CLI link state in the shared checkout is internally inconsistent:**

```
supabase/.temp/project-ref         -> rjyboqwcdzcocqgmsyel                        (PREVIEW)
supabase/.temp/pooler-url          -> ...rjyboqwcdzcocqgmsyel@aws-0-us-east-1...  (PREVIEW)
supabase/.temp/linked-project.json -> {"ref":"qsllyeztdwjgirsysgai","name":"popdam"}  (PRODUCTION)
```

The prescribed check (`cat supabase/.temp/project-ref`) **passes while the same
directory also names production.** Rather than trust which file the CLI would
pick, every operation used an **explicit target with the ref in it** — the pooler
URL for `db push`, and the Management API `/v1/projects/<ref>/database/query`
endpoint for every query. Both carry `rjyboqwcdzcocqgmsyel` literally, so drift is
impossible. **This is a standing hazard for the next agent, not a one-off.**

### 8.2 The apply

```
$ supabase db push --db-url <preview pooler, ref in URL> --dry-run
Connecting to remote database...
Would push these migrations:
 - 20260807170000_opa_property_character_landing.sql
 - 20260807170100_opa_property_character_importer.sql

$ supabase db push --db-url <preview pooler, ref in URL>
Applying migration 20260807170000_opa_property_character_landing.sql...
Applying migration 20260807170100_opa_property_character_importer.sql...
Finished supabase db push.
```

Exactly two migrations pending, both mine. Ledger went **400 → 402**; both
versions present. Server timezone confirmed **`America/New_York`**, so the date
hazard the design guards against is live on this database.

### 8.3 Objects exist — proved against the catalog, not the ledger

`to_regclass`, `to_regprocedure`, `pg_constraint`, `pg_indexes`, `pg_policies`,
`pg_proc.prosecdef`, `pg_class.reloptions`. **Every declared object is present:**

- 4 relations: `plm.opa_property_character`, `core.property_character`,
  `api.opa_property_character`, `api.opa_property_reconciliation`
- 3 functions, all resolvable by signature. `plm.sync_opa_property_character` and
  `public.sync_opa_property_character` are `prosecdef = true`;
  `plm.opa_loader_privilege_ok` is `prosecdef = false` (correct — a pure predicate)
- 11 constraints under the **names actually declared** (`property_character_pkey`,
  `property_character_{property,character}_id_fkey`, `property_character_source_chk`,
  and the 7 on the plm mirror)
- 10 indexes (7 declared on the mirror + both PK indexes + the junction index)
- 3 policies: `opa_property_character_read` (SELECT), `shared_read` (SELECT),
  `admin_write` (ALL)
- **both api views report `security_invoker=true`**

### 8.4 Contract tests — both files run, both pass

Run verbatim against preview; each wraps in `begin; … rollback;` and a rollback
probe confirmed the endpoint honours it.

| File | Result |
| --- | --- |
| `opa_property_character_landing_contracts.sql` | **PASS** |
| `opa_property_character_importer_contracts.sql` | **PASS**, but only with the §8.5 fix applied transiently |

Running them found **two real bugs that static review had missed**:

1. **In the test** — `array_agg(a.attname)` yields `name[]`, compared against
   `text[]`: `operator does not exist: name[] = text[]`. Fixed with explicit
   casts. That assertion (no unique index on the name pair) had never actually
   executed.
2. **In the migration** — see §8.5.

### 8.5 FIXED FORWARD: the importer was not re-entrant within a transaction

**Found by running the suite; fixed by migration `20260807180000`. Both directions
proved. Closed.**

`20260807170100` staged incoming rows as:

```sql
create temporary table _opa_incoming on commit drop as ...
```

**`ON COMMIT DROP` only fires at COMMIT.** A second call to
`plm.sync_opa_property_character` **inside the same transaction** therefore failed:

```
ERROR: 42P07: relation "_opa_incoming" already exists
```

Single-call runner use is unaffected, which is exactly why static review missed
it — but the idempotence test calls the importer twice in one transaction and so
**could never have passed**, and any caller loading two snapshots, or retrying
in-transaction, hit a confusing internal error instead of a guarded failure.

**The fix** (`20260807180000_opa_sync_reentrancy_fix.sql`) is one line —
`drop table if exists _opa_incoming;` immediately before the staging create.
Temp tables are session-local, so it cannot affect a concurrent session. Same
signature, same guards, same field-ownership contract; still resolves nothing,
still deletes nothing, still writes only `plm.opa_property_character`.

**Fixed FORWARD, not by editing `20260807170100`.** That version is applied and
already in `supabase_migrations.schema_migrations`; the CLI will never re-run it,
so editing the file would desynchronise the repo from the ledger while changing
nothing in any database. **Never edit an applied migration.**

**Both directions proved, transiently and rolled back:**

| Variant | Call 1 | Call 2 (same transaction) | Error |
| --- | --- | --- | --- |
| fix **removed** (neutralised) | succeeds | **FAILS** | `relation "_opa_incoming" already exists` |
| fix **present** | succeeds | **succeeds** | — |

So the fix is load-bearing and the regression guard is not vacuous. A dedicated
assertion (`6d`) was added to the importer suite so a reversion names itself
rather than surfacing three assertions later as a confusing failure.

**Applied to preview and both suites re-run in full, unmodified:**

```
$ supabase db push --db-url <preview pooler, ref in URL> --dry-run
Would push these migrations:
 - 20260807180000_opa_sync_reentrancy_fix.sql

$ supabase db push --db-url <preview pooler, ref in URL>
Applying migration 20260807180000_opa_sync_reentrancy_fix.sql...
Finished supabase db push.
```

Ledger **402 → 403**, max version `20260807180000`. `pg_proc.prosrc` confirms the
`drop table if exists` is live in the deployed function. Landing suite **PASS**,
importer suite **PASS** — the importer suite now passes with **no transient
patch**, unlike before. Privilege predicate still rejects `(null, null)`.
`plm.opa_property_character` **0 rows**, `core.property_character` **0 rows**.

### 8.6 Neutralise-and-observe — done for real, per guard

Method: for each guard G protecting against bad input B, prove **both** directions
— with G present B is rejected (the passing suite), and with G **removed** B is
**accepted**. If B were still rejected with G gone, the test would be passing
vacuously. All neutralisations ran inside transactions and rolled back.

**Schema guards** — every one proven load-bearing:

| Guard | Neutralised | Result |
| --- | --- | --- |
| `opa_property_character_option_source_chk` | dropped | `optionSourceID = 1008` **accepted** |
| `opa_property_character_lob_chk` | dropped | `line_of_business = 'Apparel'` **accepted** |
| `opa_property_character_resolution_status_chk` | dropped | bogus status **accepted** |
| `opa_property_character_property_name_chk` | dropped | blank name **accepted** |
| `opa_property_character_character_name_chk` | dropped | blank name **accepted** |
| `opa_property_character_property_id_fkey` | RESTRICT → CASCADE | referenced `core.property` **became deletable** |
| *absence* of a unique index on the name pair | index **added** | the two legitimate collision rows were **rejected** — i.e. 22 real rows would be lost |
| `security_invoker` on `api.opa_property_character` | set false | view **no longer invoker-security** |

**Behavioural guards** — the real test file was run against a deliberately broken
function and **failed with the intended message** each time:

| Guard | Neutralised by | Test failure observed |
| --- | --- | --- |
| privilege predicate | replaced with the forbidden `if not ( … or … )` shape | `GUARD IS NULL-PERMISSIVE: opa_loader_privilege_ok(null, null) returned TRUE` |
| resolution preservation | resolution columns added to the upsert `SET` list | `a re-import WIPED a human resolution (status=unresolved, property_id=<NULL>)` |
| absence-never-removes | a `delete` of rows absent from the snapshot added | `a held row absent from the snapshot was not REPORTED as missing (rows_missing=0)` |

One honest nuance on the last: because the injected `delete` runs *before* the
missing-row count, the suite trips on the count assertion rather than the
"ABSENCE REMOVED A ROW" assertion. It still detects the regression, but via the
adjacent assertion — worth knowing if that message is ever seen for real.

**No guard resisted neutralisation, so none is a formality.**

### 8.7 Preview left clean

`plm.opa_property_character` **0 rows**, `core.property_character` **0 rows**, no
probe table, no leftover index, privilege predicate rejects `(null, null)`, max
version `20260807170100`. Every fixture rolled back. The one `ZZ`-prefixed
licensor present (`DTR - NO LICENSE`, created 2026-06-25) is **real
production-clone data, not a test leftover**.

**No Disney data was loaded, and none exists in this repo.** The tables are empty
by design.

### 8.8 Owner rulings that constrain the FUTURE resolve/promote work

Recorded here so the next agent does not have to rediscover them. **Neither
belongs in these migrations, and neither is implemented:** this work resolves
nothing and deletes nothing, which is what makes it shippable ahead of both.

- **Deletions — RULED, 2026-08-07.** Albert has ruled: **do NOT delete. Mark
  inactive instead.** This binds any future resolve/promote migration and any
  future refresh semantics. Note the consequence: the current importer already
  never deletes, so it is *compatible* with the ruling — but "mark inactive"
  implies a lifecycle column that **does not exist yet** on
  `plm.opa_property_character`. Adding one is a schema change belonging to the
  resolve/promote work, not something to retrofit into an applied migration.
  Until it exists, absence continues to be reported as `rows_missing` and nothing
  more.
- **Name overwrite — STILL OPEN.** How far Disney may overwrite our curated names
  has gone to **Laura at the licensing company** and has not come back. README §8
  Decision 2 (options A–D) is the live question. **No resolution logic may be
  written until it is answered**, which is precisely why `resolution_status`
  defaults to `'unresolved'` on every row and the five resolution columns are
  absent from the importer's upsert.

## 8.9 Independent review round (PR #497) — five fixes in `20260807190000`

Codex gpt-5.6-sol at medium effort, 13 findings, verdict REQUEST CHANGES (2 High).
Three findings were refuted in this work's favour, including a claim that the
privilege predicate was null-permissive — `plm.opa_loader_privilege_ok` is
`language sql` returning strict booleans and cannot return NULL. The
`session_user`-not-`current_user` reasoning, the reentrancy fix and the
`dflow.property_character_associations` analysis were all upheld.

### 8.9.1 ⚠️ THE MOST IMPORTANT THING IN THIS DOCUMENT FOR FUTURE WORK

> ### `LEAST`/`GREATEST` IGNORE NULL — and the obvious fix does not work
>
> The shrink band was written as:
>
> ```sql
> v_seen < v_before * (1 - greatest(0::numeric, least(1::numeric, p_max_shrink_fraction)))
> ```
>
> **Postgres `LEAST`/`GREATEST` ignore NULL arguments.** A NULL fraction collapses
> the expression to `1`, the threshold becomes `v_before * 0`, and `v_seen < 0` can
> never be true. **The truncated-extract guard was silently disabled while still
> reading as a bounded, careful check.** A one-row extract could have overwritten a
> 10,262-row mirror without a word of complaint.
>
> **Measured on this database — not reasoned about:**
>
> ```
> greatest(0::numeric, least(1::numeric, null::numeric))  =>  1
> 1 - that                                                =>  0
> ```
>
> **AND THE OBVIOUS FIX IS WRONG.** Wrapping `coalesce(...)` around the *outside* of
> `greatest(...)` does **not** help — it returns `1`, not NULL, so the guard stays
> disabled while looking corrected:
>
> ```
> coalesce(greatest(0::numeric, least(1::numeric, null::numeric)), 0.10)  =>  1
> ```
>
> **This is this repository's recurring failure mode in one line: a correction that
> reads as safety and behaves as nothing.** It is the same shape as the
> null-permissive `if not ( … or … )` guard, the `BEFORE` trigger reading a
> `GENERATED … STORED` column, and the test assertion that had never executed.
>
> **Validate the PARAMETER, not the expression.** `20260807190000` rejects NULL
> outright and range-checks explicitly. NULL is rejected rather than defaulted
> because it usually means the caller sent `NaN` — `JSON.stringify(NaN)` is
> `null` — and silently defaulting would hide a broken caller.
>
> **I only caught this by measuring it.** Reading the code, the `greatest(0, least(1, x))`
> form looks like a textbook clamp. Whoever writes the next bounds check in this
> repo should measure it too.

### 8.9.2 The five fixes

| # | Severity | Fix |
| --- | --- | --- |
| 1 | **HIGH** | The read policy on `plm.opa_property_character` was `using (true)` — wide open to every `authenticated` principal — under a comment claiming it matched `plm.erp_property`. It did not. Now carries the erp_ predicate. |
| 2 | **HIGH** | The `LEAST`/`GREATEST` NULL hole above. |
| 3 | MEDIUM | The staging temp table was referenced unqualified. `pg_temp` resolves first *when a temp table exists*, but with none present resolution continued through `search_path = plm, core, public, extensions`, and the `SECURITY DEFINER` function runs as owner — so a permanent table of that name could have been dropped. Latent, never live. Now `pg_temp._opa_incoming` throughout. |
| 4 | MEDIUM | `api.opa_property_reconciliation` claimed one row per property node while grouping on the four **per-row** resolution columns, so a partially resolved node split into several rows with its character count divided between them. The **view** was fixed, not the comment — the comment stated the correct intent. |
| 5 | MEDIUM | The row-shape guard embedded the first offending row's full JSON in its error, which reaches terminals, CI logs and the runner. It now reports the row **ordinal** and **which check failed**, never content. The runner also no longer prints the response body at all. |

**On fix 1 — the exposure was real, not theoretical.** Every `authenticated`
account across all four applications, including `vendor` and `viewer`, could read
the whole Disney extract — property names, character names, Disney's own IDs, the
source URL — through `api.opa_property_character`. This repository is **public**
and is recovering from exactly this class of exposure. The same migration had
role-gated `core.property_character` correctly 100 lines later, so it was an
internal inconsistency rather than a deliberate posture.

**On fix 4 — a deliberate column-list change.** `create or replace view` cannot
add, remove or rename columns, so this needed `DROP` + `CREATE`. Per-row
`resolution_reason` and `resolved_by` were dropped as meaningless at node grain
and replaced with per-node aggregates (`matched_core_property_ids`,
`unresolved_character_count`, `last_resolved_at`, and a `resolution_status` that
reports `'mixed'` when a node disagrees with itself). Nothing consumes the view —
it was created hours earlier on an unmerged branch — so no consumer breaks.

### 8.9.3 Proof — both new guards, both directions

**The read policy, proved by EVALUATING RLS as real principals** (`set local role
authenticated` plus a JWT `app_metadata.roles` claim), **not by reading the DDL —
the DDL is what was wrong in the first place:**

| Principal | Rows visible | Required |
| --- | ---: | ---: |
| no app role at all | **0** | 0 |
| `vendor` | **0** | 0 |
| `viewer` | **0** | 0 |
| `designer` | **0** | 0 |
| `administrator` | **1** | 1 |
| `sales` | **1** | 1 |
| `licensing` | **1** | 1 |
| `vendor` via `api.opa_property_character` | **0** | 0 |
| `vendor` via `api.opa_property_reconciliation` | **0** | 0 |
| **NEUTRALISED back to `using (true)`: `vendor`** | **1** | 1 — proves the test detects the leak |

The live predicate was then read back from `pg_policies` on preview, not from the
migration file:

```
(app.has_role('administrator'::app.app_role)
 OR app.has_app_access('plm'::app.app_name)
 OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role]))
```

**The shrink band, both directions**, against 5 held rows and a 1-row snapshot
(an 80% shrink) with a NULL fraction:

| Variant | Result |
| --- | --- |
| **neutralised** (old `LEAST`/`GREATEST` form) | **ACCEPTED** — the guard was off, bug reproduced live |
| **fixed** | **REJECTED** — `p_max_shrink_fraction is NULL. …` |

### 8.9.4 Applied and re-verified

`cat supabase/.temp/project-ref` confirmed `rjyboqwcdzcocqgmsyel` before the push;
explicit ref-in-URL targeting throughout, because `linked-project.json` in that
same directory names **production** (§8.1). Dry run showed exactly one pending
migration. Ledger **403 → 404**, max version `20260807190000`.

Confirmed from `pg_proc.prosrc` on the deployed function, not from the file:
`pg_temp._opa_incoming` present, the NULL rejection present, and the
`left(v_sample, 400)` row-echo **gone**.

**Both suites re-run in full and pass unmodified.** The landing suite now carries
the role-based policy assertions and the node-grain view assertions permanently,
so neither can silently regress. `plm.opa_property_character` **0 rows**,
`core.property_character` **0 rows**.

### 8.9.5 The reviewer's UNRESOLVED item — settled by measurement, premise was wrong

The reviewer could not find a `create policy` on `core.property` in any migration
and left open whether the reconciliation view's LEFT JOINs would silently degrade.
**They do have policies.** Measured on preview:

| table | policy | predicate |
| --- | --- | --- |
| `core.property`, `core.licensor` | `shared_read` (SELECT) | `app.has_any_role([administrator, sales, licensing, designer, viewer, vendor])` |
| both | `admin_write` (ALL) | `app.has_role('administrator')` |

So for ordinary roles there is no degradation: anyone who passes the mirror's
policy also passes `shared_read`. **One real edge case survives** and is now
documented on the view itself: a principal reading via `app.has_app_access('plm')`
while holding **no** `app_role` passes the mirror's policy and **fails**
`core.property`'s, so `core_property_names` and `core_licensor_codes` come back
**empty rather than raising**. Empty name arrays beside a non-null
`matched_core_property_ids` means RLS suppression, **not** an unresolved node.
Quiet wrong is worse than loud wrong, hence the comment.

### 8.9.6 Not fixed here, deliberately

- **The missing write GRANT behind `admin_write`** on `core.property_character`.
  The identical omission exists on its sibling `core.style_guide_character`
  (`20260727230000`), so it is pre-existing and repo-wide. It belongs to a separate
  sweep, not to this PR.
- **Illustrative Disney character names in comments** in the design README. Real,
  but already on `main` from PR #485 — pre-existing, not introduced here.
- **The `supabase/.temp/linked-project.json` inconsistency** (§8.1). A shared-checkout
  change outside this worktree's scope; touching it could disrupt another session.
- **The misleading RLS comment inside `20260807170000`.** That migration is applied;
  editing it — even a comment — would desynchronise the file from the ledger. It is
  corrected in `20260807190000`'s header, in the table's `COMMENT ON`, and here.

## 8.10 Re-review round — `20260807200000`, plus two vacuous tests and a binary file

Re-review verdict was **APPROVE, 0 Critical, 0 High** — all five fixes from §8.9
independently confirmed, and the three earlier migrations confirmed **byte-identical**
to the previous head, so fix-forward discipline held. The items below were caught
anyway, and two of them are the same defect class this workstream has been bitten
by twice: **a test that cannot fail.**

Codex's one Critical — that `create temporary table pg_temp._opa_incoming` is
invalid — was **refuted**: a temporary table may be `pg_temp`-qualified. Proof in
§8.10.4.

### 8.10.1 BLOCKER: the runner was committed as a BINARY file

`tools/sync-opa-property-character.mjs` contained **three literal NUL bytes** —
used as a key separator in template literals:

```
const key = `${rec.licensedPropertyID}<NUL>${rec.characterID}`;
duplicates.push(key.replace("<NUL>", ","));
new Set(snapshot.rows.map((r) => `${r.property}<NUL>${r.character}`));
```

Three bytes were enough. Git classified the whole file as binary:

```
$ git diff --numstat            ->   -   -   tools/sync-opa-property-character.mjs
```

`git diff` emitted only "Binary files differ", GitHub's PR view showed no diff, and
`gh pr view --json files` reported **additions: 0**. **So no one — not either Codex
round, not the reviewing agent, not the coordinator — had ever seen this file's
contents in review, in a PR whose entire purpose was closing a confidential-data
exposure.**

The intent was sound: a NUL cannot occur inside a CSV field, so it is a safe
composite-key separator. The mistake was writing the **byte** instead of the
**escape**. Now `\0` in source — behaviour-identical, and the file is text:

```
$ git diff --numstat origin/main  ->  347  0  tools/sync-opa-property-character.mjs
```

**347 lines that have never been reviewed are now visible and need a real read.**
All 18 runner tests still pass, unchanged.

> **Lesson worth keeping: "the diff looked fine" is not the same as "the diff was
> shown".** A file can be silently excluded from every review surface by three
> bytes. `git diff --numstat` printing `-` `-` for a source file is the tell.

### 8.10.2 Two tests that could not fail

**The reconciliation test (landing §6c) was vacuous.** It used fixtures
`900000001` and `900000002` — two *different* nodes with one character row each.
The old buggy view grouped by `licensed_property_id` **and** the per-row resolution
columns, so it would also have returned 2 rows with `opa_character_count = 1` each.
**Neither assertion could distinguish the two view versions.** The stated rationale
(that the fixtures share a property name) does not hold: different ids land in
different groups under both versions.

Replaced with the only shape that discriminates — **one** node
(`900000010`) with **two** character rows in **different** `resolution_status`:

| View version | Rows returned | `opa_character_count` |
| --- | ---: | --- |
| old (splitting) | **2** | 1 and 1 |
| new (node grain) | **1** | **2**, status `mixed` |

It now also exercises `mixed`, `unresolved_character_count`,
`matched_core_property_count`, `matched_core_property_ids` and
`core_property_names` — none of which anything touched before.

**The two importer fixes from `20260807190000` had NO database test at all.** The
importer suite was **byte-identical** to the previous head (20,162 bytes), so the
NULL-rejecting shrink band and the ordinal-only diagnostic were proved only by a
one-off apply-time check recorded in prose. **A later `create or replace` could have
restored either defect and every committed test would have stayed green.** Added:

- **§5k** — a NULL `p_max_shrink_fraction` must be rejected.
- **§5l** — out-of-range values (`-0.5`, `2.0`) must be rejected.
- **§5m** — the row-shape guard's message must contain the row **ordinal** and the
  **failed check**, and must **not** contain the offending row's content. Asserted
  with a "Leak Canary" name planted in the bad row.

### 8.10.3 `20260807200000` — comment corrections, and the same failure one severity down

**A wrong comment is what produced the HIGH finding in the previous round**:
`20260807170000` claimed its RLS matched `plm.erp_property` while writing
`using (true)`, and *the claim is what stopped anyone looking*. These are the same
failure, milder, and worth a version to kill.

1. **The table comment overstated the restriction.** It said "vendor and viewer are
   excluded" absolutely. `app.has_app_access('plm')` is an **independent allow
   path**, so a profile holding the vendor role **together with** PLM app access
   **does** read the mirror. The predicate was right; the description was wrong.
2. **`array_agg(...) filter (...)` returns NULL, not an empty array.** The view
   comment promised "come back EMPTY" three times. A consumer testing `= '{}'`
   would have misread RLS suppression. **Rather than document the NULL, the view now
   genuinely returns `'{}'`** via `coalesce`, with a stable `ORDER BY` inside each
   aggregate so two identical queries cannot disagree on element order. The comment's
   promise is now true instead of merely explained. Asserted in landing §6c-bis.
3. **`min(captured_at)` is now documented.** `min(property_name)` carried a
   justification; this did not. After a **partial** refresh a node can hold rows from
   two snapshots and the view silently reports the **oldest**. Stated plainly, with a
   pointer to read `plm.opa_property_character` directly when freshness matters.

Column names, types and order are unchanged, so `create or replace view` sufficed
and grants were preserved.

### 8.10.4 Proof

**Applied:** `cat supabase/.temp/project-ref` confirmed `rjyboqwcdzcocqgmsyel`;
explicit ref-in-URL targeting throughout (`linked-project.json` in that same
directory still names **production** — §8.1). Dry run showed exactly one pending
migration. Ledger **404 → 405**, max version `20260807200000`.

**Both suites re-run in full and pass UNMODIFIED.**

**Neutralise-and-observe — all three new assertions proved non-vacuous:**

| Neutralisation | Suite | Observed failure |
| --- | --- | --- |
| old splitting `GROUP BY` restored | landing | `returned 2 rows for ONE partially resolved OPA property node (expected exactly 1)` |
| `LEAST`/`GREATEST` NULL hole restored | importer | `a NULL p_max_shrink_fraction was ACCEPTED…` |
| G6 row echo restored | importer | `THE GUARD LEAKS ROW CONTENT: its error message quoted the offending character name` |

The third failure message literally displays the leak it prevents (invented fixture
data only — no Disney content anywhere in this repository).

**`pg_temp` executes, it does not merely parse.** plpgsql only raw-parses a function
body at creation, so a clean apply proves parseability alone. Executed directly:

```
PG_TEMP PROOF: function returned rows_inserted=1, staging table lives in schema
'pg_temp_47' (must start with pg_temp) and held 1 staged row(s).
The statement EXECUTED, it did not merely parse.
```

Preview left clean: `plm.opa_property_character` **0 rows**,
`core.property_character` **0 rows**.

### 8.10.5 Deferred, recorded, not fixed tonight

- **G6 can still echo a single field value on numeric overflow.** Reaching it needs a
  malformed oversized number; it leaks one field, not a row; and the runner no longer
  prints response bodies at all.
- **Two client-side runner messages still echo field values** (the blank-field and
  non-integer diagnostics). Same class, client side only.

Both are narrower than what was fixed and are recorded in the session handoff.

## 9. Follow-ups

- Run both contract test files against preview and record the result in §8.
- **§8 of the README's two owner decisions are still open** and gate any
  resolution work: how far Disney may overwrite our curated names, and whether
  ColdLion deletions propagate.
- **Serialise this against the ColdLion licensor/property cutover** — both touch
  the property spine (AGENTS.md §4 rule 1).
- Re-assert the axis-1/axis-2 reconciliation invariant (§4) **before**
  `core.property_character` or `core.style_guide_character` is first populated.
  It is trivially true while both are empty.
- Check whether `api.coldlion_*_reconciliation` are definer- or invoker-security
  views (README §7.5). If definer, that is a **pre-existing** finding to raise
  separately — not something to copy.
- Raise the Morbius block (README §5.3 — 30 Disney+ TV characters mis-filed under
  a film **in Disney's own portal**) with Laura or Disney. It is the clearest
  counter-example to "Disney is always right".

---

## Runner hardening, 2026-08-07 (post-#497) — the runner is now safe to invoke

PR #497 landed `tools/sync-opa-property-character.mjs` **unreviewable**: it was
committed with literal NUL bytes, so git classified it as binary, `git diff`
printed only "Binary files differ", and GitHub reported `additions: 0`. Two Codex
rounds and two reviewer passes all ran while the file's contents were invisible.
The merge was allowed **on the explicit condition that this hardening land before
the runner is ever invoked with `--apply`.** This is that work. The runner has
still never been executed against any database.

### What was hardened

| # | Was | Now |
|---|---|---|
| W1 | `SUPABASE_URL` read from the environment, project ref **printed**, then POSTed. Printing is not a gate — nobody may be watching and CI cannot read a warning. One wrong env var loaded the whole confidential extract into the wrong project, and **no database-side guard can catch that** because every one of them runs inside whichever project you reached. | The expected project ref is a **required, explicit input** (`--expect-ref=<ref>` or `OPA_EXPECTED_PROJECT_REF`), compared against the ref parsed from `SUPABASE_URL`. A mismatch **aborts before the first byte is sent** (`resolveSupabaseTarget`, called by `applySnapshot` before it touches `fetch`). No default ref exists, and none is hard-coded. |
| W2 | `SUPABASE_URL` unvalidated — no scheme or host check. A malformed value sent the **service-role key** (in `apikey` and `Authorization`) and the full snapshot to whatever host it named. | https only, no port, no path, no query, no fragment, and the host must be exactly `<project-ref>.supabase.co`. |
| W3 | `buildSnapshot` required only `rows.length >= 2`. The database shrink band only fires when rows are **already** stored (`v_before > 0`, migration `20260807190000`), so the **first** load into an empty mirror would accept a one-row snapshot in silence. | `OPA_MIN_ROWS` — an expected-minimum row count, **mandatory for `--apply`** — enforced client-side before anything is sent. |
| W4 | A comment claimed the database "coalesces the parameter". **It does not — it rejects NULL**, and migration `20260807190000:347-350` warns that wrapping `coalesce()` around the clamp does *not* fix the hole (`coalesce(greatest(0, least(1, null)), 0.10)` returns `1`, because LEAST/GREATEST ignore NULLs). A maintainer trusting that comment would have reintroduced the exact bug the migration removed. | Comment corrected and the trap spelled out. Treated as a defect, not a typo: a comment falsely claiming a safety property is how the wide-open RLS policy survived review earlier the same day. |
| W5 | `parseCsv` accepted malformed quoting silently: text after a closing quote was appended; a bare quote in an unquoted field flipped quote mode and **swallowed the following commas, merging fields** (a name can slide into an ID column); a file ending mid-quoted-field was pushed as a complete row — **a truncated download ends exactly that way**; rows with the wrong field count were accepted; and `readFile(path, "utf8")` silently substituted U+FFFD for invalid bytes. | All five now **fail loudly**. Silent repair of licensor data is how a wrong name reaches a licensing decision. Strict UTF-8 decoding via `decodeUtf8Strict`. |
| low | Any digit string passed through `Number()` — beyond 2^53 two distinct IDs round together. | `Number.isSafeInteger` check. Latent, not active: Disney's largest observed ID is 9 digits. |
| low | Auto-run fired whenever `argv[1]` merely **ended with** the filename, so a neighbouring `test-sync-opa-property-character.mjs` importing the module would have triggered a real run. | Resolved-path comparison against `import.meta.url`. Proven by a test that spawns exactly such a file. |
| low | `OPA_CAPTURED_AT` regex accepted impossible dates (`2026-99-99`). | Real-date validation locally, so it fails before anything is sent rather than at the database. |
| low | A `sourceUrl` carrying a session token would be stored verbatim as provenance on **every row**. | Refused, and the offending value is never echoed. |
| doc | Header listed 2 migrations. | Lists all **five** (`170000`, `170100`, `180000`, `190000`, `200000`). |

### Proof

45 tests (was 18; all 18 originals still pass). **Every** guard was proven to
fire by neutralising it, observing the suite FAIL, restoring it and observing it
PASS — 28 mutants, 28 killed. For W1 specifically, the test injects a `fetch`
that throws on any call and asserts the mismatch error is raised with the fetch
**never reached**, so the abort is proven to happen before the network, not
after. All fixtures are invented; no Disney data appears anywhere.

### Deliberately NOT changed

- Nothing under `supabase/`. All five migrations are applied; editing an applied
  migration changes nothing in the database and desynchronises file from ledger.
- The runner was never executed against any database. All testing is offline unit
  tests against invented fixtures.

### Also closed: the two value-echoing messages (owner-approved follow-up)

Two client-side messages echoed extract field content into terminals and CI logs
for a **public** repository, against this file's own "counts and status only"
rule. They had been deferred on the reasoning that only numeric junk could be
echoed. **That reasoning fails on exactly the failure W5 now detects:** if the
columns SHIFT, a character name lands in a numeric column and gets printed. The
two findings are the same scenario seen from opposite ends. Both now report the
**row ordinal and column name, never the value** — matching what the database
side does after the G6 fix.

| Site | Was | Now |
|---|---|---|
| non-integer id | `row N: <col> is not an integer ("<value>")` | `row N: <col> is not an integer.` plus a note that the value is deliberately withheld |
| duplicate natural key | listed the colliding `<licensedPropertyID>,<characterID>` values | `row 3 repeats the ID pair first seen at row 2` |

Each has a canary test asserting the message does **not** contain the value, and
each was proven by neutralising it back to its old form: 39 tests, baseline
`pass=39 fail=0`, each mutant `pass=38 fail=1`, restored `pass=39 fail=0` (the
counts as they stood at that round; both mutants were re-run and re-killed in
the final 28-mutant set below).

One nearby message was reviewed and left alone: `row N: optionSourceID is <v>,
not 1007` echoes a value that has already passed integer **and** safe-integer
validation, so it cannot carry a name.

### Status

The runner is now safe to invoke with `--apply`, provided the operator sets
`OPA_EXPECTED_PROJECT_REF` (or `--expect-ref=`) and `OPA_MIN_ROWS`. It will
refuse to run without them.

### Review round: one MEDIUM and three LOWs, all in guards this work introduced

Found by independent review of the hardening itself. Worth recording that the
review found a hole in a **security guard added to close a hole** — new code is
not safer than old code merely because it is newer.

**MEDIUM — the credential guard failed OPEN.** `assertSourceUrlIsNotACredential`
parsed with `new URL()` and, when that threw, **returned the string unchecked**.
Measured: `assertSourceUrlIsNotACredential("opa.example/x?session_token=SECRET")`
did not throw. A scheme-less URL is exactly what a hurried operator pastes out of
a browser address bar, and the token would then be stored verbatim as provenance
on **every one of ~10,262 rows**, readable by anyone the mirror's RLS admits. An
unparseable value is now a hard error.

**Contract tightening, deliberate:** the query string and the fragment are now
refused **outright** rather than inspected for suspicious parameter names. Name
matching is a blocklist, and a blocklist guarding a value persisted 10,262 times
is the wrong shape — a parameter called `t`, or a 12-character fragment, went
straight through (the old fragment rule only fired above 40 characters). Also
now refused: userinfo (`user:pass@host`), non-http(s) schemes, and a path segment
that is either named like a credential or shaped like an opaque token. Provenance
needs to say *where* the extract came from, and a bare page URL does that.

> **Operator impact:** if your OPA page URL has a query string or a `#fragment`,
> the runner will refuse it. Pass the plain page URL. This is intentional.

**LOWs.** A bare `\r` not part of a CRLF was still swallowed silently (`a,b\r1,2`
parsed as one row `["a","b1","2"]`, joining two lines) — the last lenient path in
a parser that advertises rejecting silent repair; now rejected. And the expected
project ref is compared case-insensitively, since `new URL` lowercases the
hostname: an uppercase host was already accepted while an uppercase
`OPA_EXPECTED_PROJECT_REF` was rejected as malformed, sending the operator after
the wrong problem.

**Proof for this round.** 45 tests. **28 mutants across the whole branch, 28
killed, 0 survived**, baseline and restored both `pass=45 fail=0`. The
credential fixes carry canary assertions proving the secret does not survive into
the error message.

**Parser behaviour re-measured after the tightening** (25 shapes): 19 realistic
export shapes ACCEPTED — plain LF, CRLF, trailing CRLF, BOM+CRLF, unquoted
fields, embedded commas, embedded newlines, embedded CRLF inside quotes, doubled
quotes, **properly quoted inch marks**, backtick and real apostrophes, blank
lines mid-file, trailing blank lines, negative sentinels, `& / ( )` in names,
accented characters, emoji, and padded numeric fields. 6 genuinely malformed
shapes REJECTED. Nothing legitimate became collateral.

---

## RUNBOOK — read this before the first `--apply`

### 1. A dry run against the real CSV is REQUIRED, not suggested

A dry run parses and validates everything and **contacts no database at all**, so
it carries zero risk. It is also the only way to turn the parser-strictness
question from reasoning into fact.

```
OPA_CSV_PATH=/path/to/licensor-source-data/disney-opa/opa-characters.csv \
OPA_CAPTURED_AT=<YYYY-MM-DD> \
OPA_SOURCE_URL='https://<the plain OPA page URL, no query, no fragment>' \
node tools/sync-opa-property-character.mjs
```

Expect a JSON block of counts and `DRY RUN. No database was contacted.`

**If the dry run REJECTS the file, the bare-quote rule is the first suspect** —
the rule that refuses an unescaped `"` inside an *unquoted* field. The plausible
real-world case is an **inch mark** in a product name that Disney's exporter
emitted without quoting the field. Properly quoted inch marks (`"12"" Figure"`)
pass and were measured passing. Do not weaken the rule reflexively: confirm from
the reported line and field number which case you actually have.

### 2. W1 catches a MISMATCH, not a wrong intention

The wrong-target guard compares `SUPABASE_URL` against the ref you state
explicitly. If an operator puts the **production** ref in *both*, it proceeds —
by design, because promotion to production must be possible, and hard-coding the
production ref would violate this file's own "never hard-code a project ref"
rule. **W1 is not a production interlock.** It catches the mistyped variable and
the copy-paste from the wrong terminal; it cannot catch a deliberate or
mistaken decision to target production.

### 3. The first apply

```
OPA_CSV_PATH=... OPA_CAPTURED_AT=... OPA_SOURCE_URL=... \
OPA_MIN_ROWS=<the minimum row count you expect> \
SUPABASE_URL=https://<project-ref>.supabase.co \
OPA_EXPECTED_PROJECT_REF=<the same ref, stated deliberately> \
SUPABASE_SERVICE_ROLE_KEY=<from 1Password, vault vibe_coding> \
node tools/sync-opa-property-character.mjs --apply
```

`OPA_MIN_ROWS` and the expected ref have **no defaults** and the runner refuses
to start without them. Take `OPA_MIN_ROWS` from the dry-run count, not from
memory.

---

## 10. The required dry run against the REAL extract — done, PASSES

Section 9.1 called a dry run against the genuine CSV **required** before any
`--apply`. It has now been run. **The hardened parser accepts Disney's real
extract unmodified.** Nothing was changed to make it pass, and no database was
contacted (the dry-run path returns before `applySnapshot`).

The CSV was fetched from the PRIVATE repo `u2giants/licensor-source-data` to a
scratch directory **outside this repository**, via the raw API. Note the trap:
`gh api .../contents/...` returns `encoding: "none"` and an **empty body** for
files over 1 MB, and this file is 1,069,881 bytes — without
`Accept: application/vnd.github.raw` you analyse zero rows and do not notice.

```
$ gh api -H "Accept: application/vnd.github.raw" \
    repos/u2giants/licensor-source-data/contents/disney-opa/opa-characters.csv \
    > <scratch>/opa-characters.csv

bytes: 1069881          (matches the recorded size exactly)
lines: 10263            (1 header + 10262 data rows)
sha256: 333a1c04ea2da5a678da3527ee9a28b503cb6c16af94dbd902e10fbe776a5d69
line endings: CRLF on all 10263 lines, consistently — no bare CR
```

### 10.1 The dry run

```
$ OPA_CSV_PATH=<scratch>/opa-characters.csv \
  OPA_CAPTURED_AT=2026-08-06 \
  OPA_SOURCE_URL='https://opa.disney.com/ProdApp/createEditProduct.spring' \
  node tools/sync-opa-property-character.mjs
{
  "rows": 10262,
  "distinct_licensed_property_id": 1445,
  "distinct_character_id": 9613,
  "distinct_name_pairs": 10240,
  "name_pair_collisions": 22,
  "captured_at": "2026-08-06",
  "line_of_business": "Home"
}

DRY RUN. No database was contacted. Re-run with --apply to load.
```

Exit 0. No warnings. Every number the design predicted from the 2026-08-06
measurement is reproduced **exactly**: 10,262 rows, 10,240 distinct name pairs,
**22 name-pair collisions**. Re-run with `OPA_MIN_ROWS=10262` — identical output,
so the row floor is satisfied at the true count.

### 10.2 The ID-pair key holds — the table design is sound

`buildSnapshot` throws on any duplicate `(licensedPropertyID, characterID)`. It
did not throw, which is itself the proof. Cross-checked with a **separately
written, regex-based RFC4180 tokenizer** (not the runner's parser), which agrees
on every figure:

| Measure | Value |
| --- | --- |
| data rows | 10,262 |
| rows with a field count ≠ 6 | **0** |
| distinct `(licensedPropertyID, characterID)` | **10,262 — unique, one per row** |
| distinct `(property, character)` | 10,240 (**22 collisions**) |
| distinct `licensedPropertyID` | 1,445 |
| distinct `characterID` | 9,613 |
| distinct `optionSourceID` values | `1007` only |

Two independent parsers agreeing to the row means the counts are a property of
the file, not of one parser's quirks.

### 10.3 Why the bare-quote rule never fired — and why that is luck, not design

The predicted first suspect was the unescaped `"` inside an *unquoted* field
(the inch-mark case). Measured on the real file:

- The **header line carries zero quote characters** — it is unquoted.
- The **10,262 data lines carry 123,144 quote characters — exactly 10,262 × 12**,
  i.e. every one of the 6 fields on every data row is fully quoted.
- **Zero occurrences of a doubled `""`** anywhere in the file.

So Disney's exporter quotes every data field unconditionally, and this particular
extract contains no embedded quote character at all. An inch mark could not have
tripped the rule here because there is no inch mark, and if one appeared it would
arrive **inside an already-quoted field**, which is the case the runbook records
as measured-passing. The strict rule costs this extract nothing.

**This is a property of the observed export, not a guarantee.** Only the fully
quoted, zero-embedded-quote shape was proven; a future extract that quotes
selectively is untested. That is an argument for repeating this dry run on every
refresh, not for weakening the rule.

### 10.4 `OPA_SOURCE_URL` — the tightened contract REJECTS the natural URL

This is the one contract that does not survive first contact unaided. The page
the extract actually comes from — the URL recorded in the scrape procedure — is
the OPA product page **with its full query string** (`?do=createEdit&lob=200&…`).
Passed verbatim, the run aborts:

```
OPA_SOURCE_URL must not carry a query string. It is stored verbatim as
provenance on every row, and a query string is where portals return session
tokens and other credentials. Strip it and pass the plain page URL.
(The value is deliberately not shown.)
```

Exit 1, before anything else runs. The guard behaves exactly as written, refuses
outright rather than inspecting names, and does not echo the value.

**The operator must strip the query string by hand.** Both of these pass:

- `https://opa.disney.com/ProdApp/createEditProduct.spring` (recommended — names
  the actual page)
- `https://opa.disney.com`

**The cost is real and should be recorded rather than shrugged off.** Those OPA
query parameters are not decoration: `lob=200`, `lobName=Option.Lob.Home`,
`regionName=Option.Region.4`, `templateId`, `workflowId` are what *select the
extract*. Stripping them makes provenance say which page, not which slice — two
different extracts from two different LOBs would store an identical
`source_url`. `line_of_business` is captured separately, so the LOB itself is not
lost; region and template are not captured anywhere.

No session token was present in this URL. The rule is still the right default —
a blocklist on a value persisted 10,262 times is the wrong shape — but the
selecting parameters now have nowhere to live. **A decision for the owner**, not
something to fix by loosening the guard: either accept the loss, or add a
separate structured provenance field for the extract selectors. Do not put them
back in `source_url`.

### 10.5 What this dry run does NOT establish

It parses and validates. It contacted no database and loaded nothing. The
`--apply` path, the wrong-target gate against a live project, the shrink band and
every database-side guard remain proven only against invented fixtures. Loading
the real extract to preview, and any promotion to production, stay owner-gated.
