# Batch B3 — production apply review

- **Reviewed commit SHA:** `9645709a4b52e4848434b3ab3afda90e69505117` (`origin/main` at review time)
- **Reviewer:** Claude Code (Opus 5), sub-agent of shared-db orchestrator session `fcc2a1`, marker #793
- **Date:** 2026-08-11
- **Target database:** production `qsllyeztdwjgirsysgai` (verified via `get_project_url` before every read; all database access was read-only `select`)
- **Batch:** B3, ATOMIC (all-or-nothing, enforced by the guard's `ATOMIC_BATCHES`)

## Verdict

**CONCERNS**

Nothing in this batch destroys, deletes, truncates, soft-deletes, or inactivates a
canonical row, and neither of the two previously raised concerns is a blocker. But
there are two real defects that a production apply will bake in — a set of
null-permissive privilege guards, and a first-of-its-kind TRUNCATE grant to
`service_role` on tables whose entire purpose is append-only immutability.

Neither is exploitable from a browser session, and neither justifies holding the
batch if the owner accepts them as documented, tracked forward fixes. They must not
be applied unnoticed.

## The ten migrations reviewed

All ten read in full or in every non-superseded region:

| Version | File |
|---|---|
| `20260729230000` | `coldlion_licensor_property_recurring_promotion.sql` |
| `20260729234500` | `coldlion_recurring_promotion_collision_rule_fix.sql` |
| `20260729235500` | `coldlion_recurring_promotion_ambiguous_column_fix.sql` |
| `20260730000500` | `coldlion_recurring_promotion_absence_detection_fix.sql` |
| `20260731150000` | `popsg_property_resolution_contracts.sql` |
| `20260731153000` | `popsg_property_alias_redundancy_trigger_fix.sql` |
| `20260731163000` | `coldlion_recurring_promotion_drop_dead_failure_recording.sql` |
| `20260731180000` | `coldlion_recurring_promotion_serialization_lock.sql` |
| `20260731190000` | `coldlion_promotion_crosscheck_provenance_coverage.sql` |
| `20260731200000` | `coldlion_recurring_promotion_fanin_name_tiebreak.sql` |

Live production state confirmed before review: **0 of 10 applied**, ledger at **381
rows**, `TimeZone = America/New_York`, and none of the objects these migrations
create (`core.property_alias`, `dam.popsg_property_resolution`,
`plm.coldlion_promotion_audit`, `plm.promote_coldlion_source_owned`) exist yet.

### What actually survives the batch

Eight of the ten `create or replace` the same function,
`plm.promote_coldlion_source_owned`. Only the **last** body survives:
`20260731200000`. The seven earlier bodies are dead on arrival — they are written,
then overwritten, inside the same atomic transaction. This is intentional (the repo
forbids editing an applied migration) but it means **`20260731200000` is the only
promoter body that will ever run**, and it is the one that had to be reviewed
closely.

Verified that `20260731200000` is a genuine superset of `20260731190000`: the only
non-comment lines removed are exactly the fan-in tie-break rewrite the file
documents (moving `source_name is distinct from canonical_name` out of the
`eligible` CTE and down into the two `UPDATE`s). No fix from an earlier migration is
silently dropped.

Aside from function bodies, the only durable DDL in the whole batch lives in
`20260729230000` (audit/quarantine tables, indexes, RLS, triggers, grants) and
`20260731150000` (`core.property_alias`, `dam.popsg_property_resolution`, the
normalizer, three RPCs, RLS, grants).

---

## The two concerns raised by the previous lane — adjudicated

### 1. `SECURITY DEFINER` function writing into `core.licensor.name` — REAL, but not a blocker

**Real.** `plm.promote_coldlion_source_owned` is `security definer` and does
`update core.licensor set name = e.source_name` (`20260731200000`, ~line 675).

It is nonetheless tightly bounded, and I do not think it should block:

- It writes only rows that are `resolution_status = 'manually_matched'`,
  `present_this_cycle`, and inside the pinned Phase 4 approved link set. The scope
  contract (hash `1230f5a12d0f2a3029f1d3df17fc5b5f`, count `542`,
  `distinct_canonical 271`) is asserted as an exact literal match at 5.2; a caller
  cannot widen it.
- It writes only where the incoming name is **normalized-equivalent** to the name
  already there. Two genuinely different names are a collision and quarantine
  instead. So the write can only ever change casing, spacing, or punctuation — it
  can never re-point a licensor at a different name.
- The multi-arm winner is chosen by an explicit total order (normalized name, raw
  name, typed key, all `collate "C"`), so it does not depend on row order or the
  database locale. Losing arms get an audit row naming the winner.
- Every write produces an append-only audit row.
- 5.3 and 5.10 hash canonical UUIDs, lifecycle status, property parent edges, and
  both row counts before and after, inside the transaction, and raise on any
  change. `name` is deliberately outside those hashes — it is the one field this
  lane owns.

**Severity: informational, by design.** The blast radius is a cosmetic re-spelling
of an already-approved name, fully audited and reversible from the audit trail.

### 2. `create or replace` over the shared taxonomy watchdog — REAL, and safe

**Real.** `20260729230000` replaces `plm.taxonomy_breaker_enforcement_status()`,
which already exists in production (confirmed live) from `20260728134500`.

I diffed the two bodies line by line. The **only** change is two rows added to the
expected-trigger list:

```
+    ('coldlion_promotion_audit_append_only_guard', 'plm.coldlion_promotion_audit'),
+    ('coldlion_promotion_quarantine_append_only_guard', 'plm.coldlion_promotion_quarantine')
```

Nothing is removed, no logic changes. This is a strict widening of watchdog
coverage to include the two new append-only tables the same migration creates.

**Severity: none.** This is the correct thing to do and would have been a defect if
omitted.

---

## Findings

### F1 — Null-permissive privilege guards (MEDIUM)

**File:** `20260731150000_popsg_property_resolution_contracts.sql`, lines **414**,
**478**, **569** — in `public.propose_popsg_property_resolution`,
`public.activate_popsg_property_decision_batch`, and
`public.promote_property_alias_batch`.

```sql
if not (app.has_role('administrator') or auth.role() = 'service_role') then
  raise ...
```

**What it does.** I verified each piece against the live production catalog rather
than assuming:

- `auth.role()` is `coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), …)`. With no JWT it returns **NULL**.
- `app.has_role(...)` is `exists(...) or lower(role) = any(app.jwt_role_names())`. `app.jwt_role_names()` coalesces to `array[]::text[]`, so it never returns NULL; with no JWT `app.has_role` is a clean **false**.

So the expression evaluates `false OR NULL` → **NULL**, `not NULL` → **NULL**, and
`if NULL then` does **not** execute. The guard reads strict and behaves open. This
is exactly the pattern named in the brief, and it is genuinely present here.

**Why it matters, and why it is MEDIUM rather than HIGH.** Execute on all three
RPCs is revoked from `public` and `anon` and granted only to `authenticated` and
`service_role`. Any real PostgREST caller has a non-null `auth.role()`, so a logged
in non-administrator gets `not (false or false)` → `true` → correctly refused. The
open path requires a direct database session with no JWT — which is already a
privileged connection that could write the tables outright. So this is a defective
guard rather than a live escalation.

**Recommended fix (forward migration, not a hold):**

```sql
if not (coalesce(app.has_role('administrator'), false)
        or coalesce(auth.role(), '') = 'service_role') then
```

### F2 — `grant all` hands `service_role` TRUNCATE on append-only tables (MEDIUM)

**Files and lines:**
- `20260729230000`, line **214** — `grant all on plm.coldlion_promotion_audit, plm.coldlion_promotion_quarantine to service_role;`
- `20260731150000`, line **213** — `grant all on core.property_alias to service_role;`
- `20260731150000`, line **377** — `grant all on dam.popsg_property_resolution to service_role;`

**What it does.** `grant all` includes **TRUNCATE**. Three of these four tables carry
append-only guard triggers that are the sole defence of their immutability:
`coldlion_promotion_audit_append_only_guard`,
`coldlion_promotion_quarantine_append_only_guard`, and
`dam.enforce_popsg_resolution_append_only`. **TRUNCATE fires no row-level triggers.**
Every one of those guards is voidable in a single statement by the same role the
ingestion pipeline runs as.

**Why it matters.** This is not a theoretical style objection. I checked the live
production catalog: `service_role` currently holds **TRUNCATE on zero tables across
`core`, `plm`, and `dam`**. This batch would be the first grant of that privilege in
those schemas, and it would land it on the audit trail that the batch's own
protected-invariant story depends on. The `plm.coldlion_promotion_audit` table is
the only durable record of what the promoter changed; a TRUNCATE erases it with no
trigger fired and no error.

**Recommended fix:** replace `grant all` with the explicit set the pipeline actually
needs, e.g. `grant select, insert on … to service_role` for the two append-only
evidence tables and `grant select, insert, update, delete on …` where an update path
is genuinely required. Never `grant all` on a table whose immutability rests on a
row trigger.

### F3 — Audit actor attribution mislabels unknown actors as `service_role` (LOW)

**File:** `20260731150000`, lines **436** and **488**.

```sql
coalesce(auth.uid()::text, 'service_role')
```

A caller whose `auth.uid()` is NULL is recorded in the resolution audit trail as
`service_role`, whether or not it was. Combined with F1, a direct database session
that slips past the guard is also logged under the wrong identity. The audit trail
then asserts something it did not verify.

**Recommended fix:** record `coalesce(auth.uid()::text, 'unknown:' || session_user)`
so an unattributed write is visibly unattributed.

### F4 — Dead audit write on the protected-invariant abort path (LOW)

**File:** `20260731200000`, lines **738–752**.

The protected-invariant guard inserts a `decision = 'refused'` row into
`plm.coldlion_promotion_audit` and then, unconditionally and in the same
transaction, raises. The insert is rolled back. It is a dead write.

This is precisely the pattern `20260731163000` was written to eliminate elsewhere in
this same function, and the final body's own header calls that pattern out — yet
this instance survives. Impact is small: the `raise` message carries every value the
audit row would have held, the error propagates to the caller, and failure recording
is deliberately out-of-band in `tools/promote-coldlion-source-owned.mjs`. But a
reader will reasonably believe an audit row exists for a refused cycle, and it never
will.

**Recommended fix:** delete the insert and rely on the raise, matching what
`20260731163000` did.

### F5 — BEFORE trigger reading a `GENERATED … STORED` column (INFO — present, fixed in-batch)

**Files:** introduced in `20260731150000` (line ~175), fixed by `20260731153000`.

`core.reject_redundant_property_alias()` is a `before insert or update` trigger that
read `new.normalized_alias`, a `generated always as … stored` column. Postgres
populates generated columns *after* before-row triggers, so the value was always
NULL, `NULL IN (...)` evaluated to NULL, and every redundant alias was silently
accepted. `20260731153000` replaces the body to compute the normalized form from
`new.alias` directly.

**No action needed, with one caveat that must be stated:** this is safe **only
because B3 is atomic**. If this batch were ever split, or if `20260731150000` were
applied without `20260731153000`, production would carry a guard that exists, is
attached, raises no error, and enforces nothing. This is a concrete reason the
atomic grouping must not be relaxed.

---

## What I checked and found nothing on

These were examined specifically and are clean. A reader should treat these as
"looked at and safe", not "not looked at".

- **Deletes, truncates, soft-deletes.** Grepped all ten files for `delete from`,
  `truncate`, `deleted_at`, `is_deleted`, soft-delete patterns. **Zero hits.** The
  absence path is handled correctly and explicitly: a linked record missing from a
  ColdLion snapshot produces a `missing_source_record` **quarantine row only**, with
  the in-file detail text *"absence never deletes, inactivates, or unlinks a
  canonical row"*. This matches
  `docs/licensor-source-shape-decisions-20260811.md`. The function comment
  independently states it never creates or deletes a canonical row, never writes
  `status`, and never auto-inactivates an absent row — and the 5.10 hash check
  mechanically enforces all three.
- **Timezone.** Grepped all ten for `::date`, `current_date`, `at time zone`,
  `timezone(`, and midnight-UTC literals (`00:00:00`). **Zero hits.** Every
  timestamp is `now()` into a `timestamptz` column. Production is confirmed
  `America/New_York`; nothing in this batch is exposed to the previous-day
  read-back trap.
- **`create or replace` last-writer-wins across the repo.** Searched the entire
  `supabase/migrations/` directory, not just the batch. No migration outside these
  ten replaces `plm.promote_coldlion_source_owned`,
  `core.reject_redundant_property_alias`, or
  `core.normalize_popsg_property_observation`. `plm.taxonomy_breaker_enforcement_status`
  is touched only by the earlier `20260728134500` (already applied) and by
  `20260729230000` — diffed, additive (see concern 2). Within the batch the ordering
  is correct: in both collision cases (the promoter, and the alias trigger) the
  fixing migration sorts *after* the one it fixes.
- **`current_user` vs `session_user` under `SECURITY DEFINER`.** No guard in this
  batch keys off `current_user`. The promoter uses `session_user` — the correct
  choice — and only for logging and breaker-trip provenance, never as an authorization
  test. No meaningless-guard instance found.
- **`alter default privileges`.** None in any of the ten.
- **RLS.** All four new tables get `enable row level security`, a read-only `select`
  policy for `authenticated` gated on `app.has_any_role`, `revoke all` from
  `public`/`anon`/`authenticated`, then an explicit `grant select`. Revoke precedes
  grant in file order in every case. No write policy is granted to browser roles;
  writes route through the guarded RPCs. Structure is correct.
- **Scope contract enforcement.** The Phase 4 pin (hash, count `542`,
  `distinct_canonical 271`) is checked as exact literals before any read or write, and
  the runner plan is cross-checked against an independent server-side recomputation on
  **both** change paths (promotions and provenance refreshes), with a stale runner
  refused outright. Solid.
- **Serialization.** `pg_try_advisory_xact_lock(720260729)` — transaction-scoped so a
  crash cannot wedge the lane, `try` rather than blocking so a queued run cannot apply
  a stale plan, and the lost race is *recorded* as a `cancelled` sync_run rather than
  silently swallowed. Correctly does not count toward the consecutive-failure breaker.
  No silent-failure violation.
- **Composite-FK parent integrity on `core.property_alias`.** The alias row's
  `licensor_id` is bound to the property's canonical parent by a composite FK against
  a matching composite unique index, with `on update cascade`. This survives a later
  re-parent and holds under concurrency. Correct approach — a CHECK could not have
  done this.
- **Normalizer immutability.** `core.normalize_popsg_property_observation` is declared
  `immutable parallel safe returns null on null input set search_path = pg_catalog`.
  `immutable` is required because generated columns depend on it, and the declaration
  is genuinely sound: the body is pure regex/`lower`/`normalize`/`btrim` with no
  locale- or collation-dependent operation. No mis-declared volatility.

## B4 dependency — CONFIRMED PRESENT

`core.normalize_popsg_property_observation(text)` is created by **`20260731150000`**
(line 48). Read in full. It is `immutable`, which is the property B4 needs:
`20260731210000_core_licensor_alias.sql` uses it inside a
`generated always as (...) stored` column expression (line 133) and inside a CHECK
constraint (line 163), both of which require an immutable function. It is also used
there in four lookup predicates. B4's dependency is satisfied and correctly typed.

Note for whoever applies B4: the function comment warns that changing this body
requires re-freezing the contract and rebaselining every dependent generated column.
B3 creates it; B4 builds a stored column on it. Nothing here breaks that, but the
two must stay ordered.

## Where I could not reach a conclusion

Stated plainly rather than glossed:

1. **I did not execute the test suite.** `supabase/tests/popsg_property_resolution_contracts.sql`
   is said to assert the whole frozen normalizer corpus, and test case F3 is cited as
   what caught the F5 generated-column bug. I read the migrations' claims about those
   tests; I did not run them. If the apply gate wants behavioural proof rather than
   code reading, that run is still outstanding.
2. **I did not verify the PopDAM worker.** The normalizer comment requires
   `normalizePopSGTag` in the PopDAM worker to stay byte-identical to this SQL. That
   is in another repository and outside this review. If they have drifted, PopDAM and
   the database will disagree about which alias matches which property, and nothing
   in this batch would detect it.
3. **I did not validate the Phase 4 contract hash itself.** I confirmed the function
   enforces `1230f5a12d0f2a3029f1d3df17fc5b5f` / `542` / `271` as exact literals. I did
   not recompute that hash against the live approved link set, so I cannot confirm the
   pinned value still describes the set the owner approved.
4. **Preview evidence not re-verified.** Several files assert they were validated
   against preview (`rjyboqwcdzcocqgmsyel`). I did not query preview or re-run those
   validations; per the standing note the preview ledger is unreliable as evidence.

## Recommendation

Apply is defensible. F1 and F2 are real and should be tracked as forward-fix
migrations authored in `shared-db` — F2 first, since it is a privilege grant and is
cheapest to correct before anything depends on it. F3 and F4 are cleanup. F5 needs
no action but is a standing argument against ever splitting this batch.

The apply must remain **atomic**. Splitting it would ship a silently-unenforced alias
guard (F5) and seven dead promoter bodies in an indeterminate order.
