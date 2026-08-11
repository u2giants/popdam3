# Reconciling "R5" against `SUPABASE-MIGRATION.md`, now that the divergence is measured

**Date:** 2026-08-11 · **Issue:** [#734](https://github.com/u2giants/shared-db/issues/734)
**Status: ANALYSIS AND RECOMMENDATION. Nothing here is decided. The decision is the owner's.**

Companion file: [`docs/owner-ruling-r5-core-is-source-of-truth.md`](owner-ruling-r5-core-is-source-of-truth.md)
— the reconstruction of R5 itself, which is **unconfirmed**.

---

## 0. The headline, before the detail

Three findings, in order of importance:

1. **The two documents conflict far less than the issue assumed.** `SUPABASE-MIGRATION.md` never
   mentions `dflow.*`, never mentions `core.*`, and never says DesignFlow's private copies are
   preserved. It is about **moving a platform**; R5 is about **consolidating master data**. Verified
   by reading the file live on 2026-08-11 (blob `24c9cdc4`, 347 lines, unchanged since commit
   `225bab92`, 2026-07-10). The words "dflow", "core.", "source of truth" and "retire" appear
   **nowhere** in it except two references pointing work back at `u2giants/shared-db` (`:65`, `:267`).
2. **There is one real conflict, and it is only about which move happens first.**
3. **The measured evidence points at doing the platform move first** — and it now costs very little,
   which is new information.

---

## 1. What each document actually says

### Doc A — `SUPABASE-MIGRATION.md` (popcre/designflow-backend)

Self-declared "canonical, workspace-wide operating contract" for all six DesignFlow repos (`:3-7`).
Its core rule (`:25`): *Supabase is initially a database/platform replacement and shared data
foundation, not a replacement for the existing backend business logic.*

Its Migration Order (`:190-204`), condensed:

1. Restore Cloud SQL data into a Supabase sandbox.
2. Validate schema, data, sequences, functions, indexes, and row counts.
3. Point `designflow-backend` sandbox at Supabase first, then item-master, tracking, data-syncing.
4. Keep BFF and frontend behaviour unchanged.
5. *"Only after sandbox validation should production migration be planned."*
6. *"Do not big-bang all services unless explicitly approved."*

Keep Angular. Keep Node/Express. Keep Sequelize (`:21`, `:107`). Change the database config, not the
architecture.

**What it does not say.** It does not say the DesignFlow tables are permanent. It does not address
master-data consolidation at all. Its own Decision Principle (`:344-346`) explicitly hands shared
schema, cross-app views, RPCs and data contracts to the shared DB area — which is exactly R5's
territory. **Doc A defers to shared-db on precisely the question R5 answers.**

### Doc B — R5 (reconstructed, unconfirmed)

`core.*` in Supabase becomes the single source of truth for every application; DesignFlow's private
`dflow.*` copies of that master data are retired, table by table, licensors and properties first.

---

## 2. Where they genuinely conflict

Exactly one place: **the opening move.**

| | Doc A's opening move | R5's opening move |
|---|---|---|
| Step 1 | Copy the whole DesignFlow database from Cloud SQL into Supabase, unchanged | Move one master-data list off the DesignFlow copy onto the shared `core.*` copy, and drop the DesignFlow one |
| What exists afterwards | Two full copies of everything, one of them now on Supabase | One list consolidated; everything else still on Cloud SQL |
| Sequelize models | Untouched | Untouched for everything except the one list |
| Who does the work | DesignFlow app teams, six repos | shared-db plus one DesignFlow screen change per table |
| Risk shape | One large, reversible event | Many small, individually reversible events |

Doing R5 first means changing the master-data plumbing of an application **while it is still
running on the old platform**, then moving the platform later — so each list gets touched twice.
Doing Doc A first means the platform move happens with the application unchanged, and the
consolidation then happens once, on one platform.

**The conflict is about sequence, not about destination.** Both documents end in the same place:
DesignFlow on Supabase, shared master data owned by shared-db. Nothing in Doc A prevents R5 from
happening after it. Nothing in R5 requires it to happen before Doc A. The four citing documents
simply assumed R5 came first, because at the time nobody knew what the platform move would cost.

---

## 3. What the #722 capture changed — in plain business English

On 2026-08-10, for the first time, somebody read inside the DesignFlow production database
(`docs/verification/cloudsql-designflow-capture-2026-08-10/`, 4,006 lines, read-only, no rows read).

**Before:** everyone assumed the two databases had drifted about eighteen migrations apart, so
copying the whole thing across was believed to be a large, uncertain job. That belief is the entire
reason a slow table-by-table route looked safer.

**After:** the structural difference between DesignFlow's production database and its Supabase
counterpart is **three objects** — one uniqueness rule and two performance indexes — once the
Sample Tracking feature is set aside, which the owner already ruled deliberate in #707. There are
**zero tables that exist only on Cloud SQL**. There are **zero triggers and zero database-level
security policies** in the whole production schema, and only two trivial read-only helper
functions. Almost all the logic lives in the application, not the database.

**Re-verified live on 2026-08-11** against production `qsllyeztdwjgirsysgai` (read-only): all three
divergent objects are present on the Supabase side exactly as the capture reports —
`productUserAssignment_item_role_key` on `dflow."productUserAssignment"`,
`idx_dflow_rfqitem_style_number_normalized` on `RFQItem`, `RFQVendor_item_vendor_summary_idx` on
`RFQVendor`.

### So what does the cutover actually require now?

1. **Copy the data across and check it.** The structures already match. This is a restore-and-count
   job, not a rebuild.
2. **Settle one uniqueness question first.** Supabase enforces that a given item can only have one
   person per role; Cloud SQL does not. If production has any duplicate pairs, the copy will refuse
   to complete until they are cleaned up. The capture holds no row data and cannot answer this — it
   needs one small authorised count. **This is the single most likely thing to stop a copy, and it
   is cheap to check in advance.**
3. **Decide what happens to the audit log.** It is roughly 400 MB of a 542 MB database — about
   three-quarters of DesignFlow's production size is history nobody queries day to day. Whether it
   is copied, archived, or moved separately is a real decision that materially changes how long the
   copy takes.
4. **Do not confuse two schemas with the same name.** Cloud SQL's DesignFlow lives in a schema
   called `designflow`. Supabase's DesignFlow lives in `dflow`. Supabase *also* has a schema called
   `designflow`, which is something else. Measured live on 2026-08-11: it holds **7 tables** (plus
   19 indexes and 9 sequences, which is where the capture's "35 relations" figure comes from).
   Nobody has established what it is for. Neither name should be "corrected" to the other.
5. **Fix the office/language columns everywhere, not just on Cloud SQL.** Migration
   `20260810160000` is merged but has reached **neither** production database. #696 is bigger than
   it was written.

---

## 4. What the evidence supports

**The measured evidence supports Doc A's sequence — platform first, consolidation second.**

Reasoning, kept to the facts:

- The stated reason for preferring the slow route no longer holds. A three-object divergence makes
  the copy a small, boring job rather than a large, uncertain one.
- The database contains almost no logic — no triggers, no security policies, two trivial functions —
  so a lift-and-shift has very little that can behave differently after the move.
- **The R5-first plan's chosen first step has already been disproved on its own terms.** The
  age-group-first plan rested on the claim that nothing in the database enforced a link to that
  list. Production says otherwise: `art_piece.age_group_id` carries a real, enforced foreign key —
  and it points at **`merchGroup`, not `age_group`**. The column was never really an age-group
  reference. The plan's stated central justification does not survive contact with production, so
  the R5-first route currently has **no validated first step**, while Doc A's route has a measured
  one.
- Doc A's own Decision Principle already routes shared-schema work to shared-db, so following Doc A
  first concedes nothing about R5's destination.

**The honest counter-argument, stated fairly.** Doing the platform move first means the DesignFlow
master-data copies survive longer, and every day both copies exist is a day they can disagree. The
drift is real and already documented — the DesignFlow property data has not been refreshed since
2026-07-08. But that drift is a *sync* problem, not a *platform* problem, and moving the platform
neither worsens nor fixes it.

### Recommendation

**Sequence them rather than choosing between them: Doc A first, R5 second.** Record that Doc A
governs the *platform move* and R5 governs *master-data ownership afterwards*, so neither document
is overturned and the "which is canonical" question dissolves.

**This is a recommendation, not a decision.** It is the owner's call.

---

## 5. Scope limits on acting on this

- `SUPABASE-MIGRATION.md` lives in `popcre/designflow-backend`, a different organisation. A
  supersession pointer there requires a pull request against that repo's `develop` branch, raised by
  someone with the standing to do it, **never self-merged**. Nothing in this pull request touches it.
- **No document should be rewritten.** If the owner rules, both documents get a short dated pointer
  at the top saying what was decided and where. The originals are the audit trail.
- The four citing documents in §3 of the companion file should get a dated note once R5's status is
  settled, one way or the other.

---

## 6. The question for Albert — plain English, no jargon

> **We need to move DesignFlow off Google's database onto Supabase, and separately we want one
> shared master list of licensors and properties instead of DesignFlow keeping its own copy. Two
> old plans disagree about which of those to do first. We just measured the difference between the
> two databases for the first time and it is tiny — three small items — so copying DesignFlow
> across is now a small job, not a big one.**
>
> **We recommend: copy DesignFlow across first, then clean up the duplicate lists afterwards.**
>
> - **What changes:** DesignFlow keeps working exactly the same. Same screens, same behaviour. Only
>   the database it talks to changes. Nothing about the shared lists changes yet.
> - **What could break:** the copy could stop partway if DesignFlow's live data has a duplicate the
>   new database will not accept. We can check for that in advance, before starting.
> - **What it costs to undo:** almost nothing. The Google database stays untouched and running the
>   whole time, so if the copy misbehaves we point DesignFlow back at it and we are exactly where we
>   started.
>
> **Two things we also need from you:**
>
> 1. **Did you actually make the "R5" ruling** — that the shared `core` lists become the single
>    source of truth and DesignFlow's own copies get retired one at a time? We can find no record of
>    you saying it. Four plans are built on it. If you never said it, we need to know now.
> 2. **DesignFlow's history log is three-quarters of its database size** — 400 MB of the 542 MB.
>    Do you want that history copied across too, or archived and left behind? Copying it is the safe
>    default but makes the move take much longer.
