# Production promotion — the ordering constraints that are still live (#547, backlog B5)

**Verified read-only against production `qsllyeztdwjgirsysgai` on 2026-08-11.** No write of any
kind was made. Ledger at time of writing: **373 applied, highest applied `20260810140000`,
applied out of order.**

Backlog **B5** is an index, not a task, and most of what it carried is now closed. This page
exists so the parts that are **still true** stop being buried in an index nobody re-reads. Issue
#547 asked exactly this: surface the two live constraints B5 still holds.

---

## 1. `20260729120000` must never be promoted before the ClickUp migrations — CONFIRMED LIVE

**Status on 2026-08-11: still pending. Verified — neither version is in the production ledger.**

```sql
select version, name from supabase_migrations.schema_migrations
where version in ('20260729120000','20260728174500');
-- returns ZERO ROWS on production. Both are unapplied.
```

| Version | File | Applied to production? |
|---|---|---|
| `20260728174500` | `clickup_incremental_task_import_reissue.sql` | ❌ No |
| `20260729120000` | `lock_down_public_security_definer_execute.sql` | ❌ No |

**The rule: promote `20260729120000` WITH or AFTER `20260728174500`. Never before.**

**Why, concretely.** `20260729120000` revokes `EXECUTE` on the `SECURITY DEFINER` functions in the
`public` schema and replaces the blanket grant with a narrow allowlist. Its allowlist names
`public.sync_clickup_tasks(jsonb, text)` — a function the ClickUp re-issue migration creates. Run
the lockdown first and it tries to revoke and re-grant a function that does not exist yet, so the
apply **aborts with `undefined_function`** and takes the rest of the batch with it.

**What that failure looks like when you hit it, so you do not misdiagnose it.** It presents as a
migration fault in the lockdown migration. It is not. It is an ordering fault, and the lockdown
migration is correct. Do not "fix" `20260729120000` — check whether `20260728174500` went first.

> ⚠️ **The production ledger is applied OUT OF ORDER.** 373 rows, highest `20260810140000`. You
> therefore **cannot** infer "`20260728174500` must already be in, it is older" from the highest
> applied version. Query for both versions explicitly, every time, using the SQL above.

## 2. Characters / style guides — Phase 0 is blocked, Phase 1 is not

- **Phase 0 is blocked on an owner decision.** Nobody can dispatch it; a session can only ask.
- **Phase 1 is read-only and can start now.** It is not gated on Phase 0, and treating it as
  gated has already cost time.

## 3. What B5 carried that is NO LONGER true — do not act on it

**B5's PSG-5 bullet — "eight licensor aliases remain a blocking owner gate" — is STALE. That gate
is closed.** It is recorded here only so that a session finding the bullet in `HANDOFF.md` can see
it has been checked and retired, rather than re-opening it.

---

## How to re-verify this page

Everything above is checkable read-only in two queries and takes under a minute. If you are about
to promote anything to production, run them rather than trusting this page's date:

```sql
-- 1. Is the ordering constraint still live?
select version from supabase_migrations.schema_migrations
where version in ('20260729120000','20260728174500');

-- 2. Ledger shape (do not infer ordering from the maximum).
select count(*) applied, max(version) highest from supabase_migrations.schema_migrations;
```

If query 1 returns both versions, constraint 1 is discharged and this section can be retired.
