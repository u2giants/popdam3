# The first time supabase/tests/ and the post-batch harness ever ran

Date: 2026-08-11. Issues #695 and #731. Branch `ci/731-run-the-test-suites`, PR #741.

This records measured results, not intentions. Everything below came out of a CI run.

## What was wrong

Two test suites were merged and neither had ever executed.

- **`supabase/tests/` (40 files).** No workflow referenced the directory. Every contract
  test in it was run by hand, against preview, by whoever remembered. (#695)
- **`scripts/test_post_batch_app_verification.py` (141 tests).** The `validate` job of
  `shared-supabase-migrations.yml` named its Python test files one by one, and nobody
  added a line for this one when PR #719 merged. (#731)

A green pull-request check was therefore not evidence that either suite passed.

## What now runs

- `validate` runs a **glob** over `scripts/test_*.py` instead of a list. 297 tests,
  141 of them for the first time. All pass.
- A new workflow, **Database Contract Tests**, executes every `supabase/tests/*.sql`
  by glob, on every pull request and every push to main, with no `paths:` filter.

Both use globs on purpose. An explicit list is what failed: it shrinks silently the
moment somebody forgets to extend it, and nothing goes red to say so.

## Where the SQL tests run

Against a **from-empty ephemeral Supabase database** created inside the runner and
destroyed with it. It never touches preview or production; the job carries no secret,
names no shared project ref, and a static self-check of the workflow file fails the run
if a future edit adds one.

The database is started empty and the migrations are then replayed by `psql` one file
at a time, recording failures and continuing. `supabase db start` stops dead on the
first failing migration, which would have reported one broken file per CI run and
nothing at all about the tests.

## Measured results

### Migration replay, from empty

| | |
| --- | ---: |
| migration files | 429 |
| applied | 363 |
| **did not replay** | **66** |

Causes, clustered from the logs:

| cause | count |
| --- | ---: |
| a relation the migration needs does not exist | 55 |
| a seed or owner-ruling migration correctly refused because the real reference row is absent | 6 |
| `extensions.vector` type not present in the local stack | 2 |
| a function or type from outside the migration history | 3 |

**The migration history is not self-contained.** shared-db was adopted on top of an
already-populated database. Objects such as `public.assets`, the legacy popdam tables and
the `dflow.*` mirrors exist in preview and production without any migration in this
repository having created them, so a from-empty rebuild cannot reach the end. The first
casualty is `20260702220336_ai_sentinel_stats_exact_match.sql` (`relation "assets" does
not exist`).

This is a finding about the repository, not about the workflow. It has a real consequence
for the production promotion: **the repository cannot currently rebuild its own schema
from its own history**, so "the migrations are correct" is not a claim CI can check end to
end. Closing it needs a captured pre-adoption baseline migration. That is not in this PR's
scope and is not attempted here.

### Contract tests

| | |
| --- | ---: |
| files executed | 40 |
| passed and enforced | 14 |
| quarantined (executed, output published, result not failing the job) | 26 |

The 26 are listed with a reason each in `supabase/tests/ci-quarantine.txt`, in three
groups: downstream of a migration that cannot replay; needs seeded reference data
(authenticated profiles, Customers, Vendors, real Licensor rows); or asserts a property of
one specific deployed environment. None was quarantined for finding a defect.

**Read the quarantine honestly: those 26 have not passed.** They still have to be run
against preview by hand before a production promotion. This lane proves the subset of the
contract that is provable from the repository alone.

## The defect this found

`supabase/tests/dcp_vault_landing_contracts.sql` — the Disney DCP Vault suite from
PR #726, named in #731 as never having run — **was broken and could never have passed.**

Its section E3 created the "frozen gap" fixture row *after* completing the crawl, under a
comment saying "the triggers are BEFORE UPDATE OR DELETE and deliberately do not police
inserts". That stopped being true when the INSERT branch was added. The same file asserts
in two other places that INSERT *is* refused on a completed crawl: a structural
`pg_trigger.tgtype` check, and section E6, which the file itself calls THE HIGH FINDING.
So the file asserted twice that the INSERT is refused and then depended on it succeeding.
The very first execution died on it:

> `ERROR: DCP Vault crawl … is COMPLETE and its evidence is immutable; INSERT on
> plm.dcp_crawl_gap is refused.`

Fixed by moving the fixture INSERT to before the crawl is completed. Nothing is weakened:
E3b still UPDATEs that row and still requires the UPDATE to be refused, which is the
assertion E3 exists to make. Sections A through H now all pass.

That is the whole argument of #695 in one file. The suite read as thorough, and it was —
its assertions are good ones. It simply had never been run, and an unrun test is
indistinguishable from a passing one until the day it matters.

## Deliberately not done

- **`scripts/post_batch_app_verification.py` is NOT wired into the migrations workflow**
  as an automatic post-apply step (#731 item 3). Its author recommended it and correctly
  flagged it. It should not be automated until the harness is trusted, and the first
  evidence that its own tests pass is a few hours old. A check nobody can trust is not
  worth running automatically.
- No migration was added, changed or removed. No schema change. Nothing was applied to
  preview or production.

## Confirmed again on the final head SHA

The run above was `95d1a83`. After a quarantine-rot guard was added and the branch was
brought up to date with `main`, everything was re-verified on the PR's final head SHA
`8db55150de724efc7a8c09dd83994b4ccc0d13ee` — a head_sha check, not a badge colour:

| lane | run | result |
| --- | --- | --- |
| `supabase/tests` ephemeral | [31495136624](https://github.com/u2giants/shared-db/actions/runs/31495136624) | 40 files executed, 14 passed, 0 failed, 26 quarantined-failing |
| Python suites | [31495136691](https://github.com/u2giants/shared-db/actions/runs/31495136691) | `Ran 297 tests … OK` across all 3 files |

`dcp_vault_landing_contracts.sql` passes sections A through H on both runs.

### The quarantine list is now policed too

The list was the last place in this workflow where something could rot unnoticed: a line
naming a renamed or deleted test file matched nothing forever, and a quarantined test that
started passing stayed ignored. Both are the green-but-inert failure this issue exists to
kill, so a stale line now FAILS the job and a quarantined-but-passing file is warned about
and named in the summary.
