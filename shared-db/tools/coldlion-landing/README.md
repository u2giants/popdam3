# ColdLion landing loaders

Fills the existing ColdLion master, item, sales-history and production-history
landing tables from the ColdLion ERP API.

`sync-masters.mjs` takes a complete current-state snapshot and upserts it. It
does not use history windows or the window ledger. It fetches seasons per
division, excludes EP001, and reconciles cleared item merchandise-group slots
without truncating any item table.

## What it does

One *window* + one *scope* at a time, atomically:

1. Fetch every page of a fixed 7-day window from the vendor.
2. Prove the pages are complete — contiguous page numbers, and the row count
   agreeing with the vendor's own `totalElements`.
3. Project the rows into parent lines, components and reference rows.
4. Load them in a single transaction that also writes the page evidence, the
   `sync_run` record and the window ledger state.

A window is either fully loaded or not loaded at all. There is no partial state
to reconcile by hand.

## Running it

Both entry points need `DATABASE_URL` (or `SUPABASE_DB_URL`) and the ColdLion
API key — `COLDLION_API_KEY`, or 1Password via the documented reference. They
also need `COLDLION_EXPECTED_PROJECT_REF`: the loader refuses to run unless the
connection string it was handed actually names that project. A database with no
`coldlion` schema is refused as well, but that is a weaker check — an unrelated
Supabase project could also have the schema.

### The two repository secrets

The workflows below are the only sanctioned way to run this against the real
database, and they read exactly two secrets, both of which must exist in this
repository's Actions secrets before either workflow can start:

| Secret | What it must contain |
| --- | --- |
| `SUPABASE_DB_URL_PRODUCTION` | A full Postgres connection string for the production project `qsllyeztdwjgirsysgai`, connecting as a role that owns (or has full write on) the `coldlion` schema. The landing tables are protected by triggers, not by row-level security, so the role must not be `anon` or `authenticated`. |
| `COLDLION_API_KEY` | The ColdLion API key, sent as `X-API-Key`. |

`SUPABASE_DB_URL_PRODUCTION` is a URL, not a password: it is deliberately not
the same secret as `SUPABASE_DB_PASSWORD_PRODUCTION`, which the licensor and
property workflows use with the Supabase CLI. Both workflows refuse to start when
either secret is missing, rather than connecting to nothing and reporting success.

Both secrets exist. `SUPABASE_DB_URL_PRODUCTION` was created on 2026-09-09 and a
read-only dispatch of the sync workflow proved the whole path end to end: the
target check passed and the run reported the three closed windows outstanding.

It holds a POOLER connection, not a direct one, and that is not interchangeable.
A direct `db.<ref>.supabase.co` connection resolves to IPv6 unless the project
buys the IPv4 add-on, and GitHub-hosted runners have no IPv6 route, so a direct
URL would fail from Actions while working from a developer machine. The pooler
endpoint for this project was verified against the Supabase Management API and is
recorded in the 1Password item that holds the password; the password itself is
never written here or anywhere else in this repository.

Ongoing sync — re-reads the most recent windows, skipping any already loaded:

```bash
node tools/coldlion-landing/sync-history.mjs --windows 3
```

Current-state masters — safe to re-run at any time:

```bash
node tools/coldlion-landing/sync-masters.mjs
```

Backfill — resumable from the ledger, so re-running after an interruption
continues where the evidence stops:

```bash
node tools/coldlion-landing/backfill-history.mjs --from 2019-01-01 --limit 50
```

Add `--dry-run` to either to see the outstanding work without fetching or
writing anything.

## The vendor behaviours this is built around

**The page size is silently capped.** Asking for 2000 returns 200 with no error
and no warning. The requested size and the returned size are stored separately,
and completion is proven page by page rather than assumed from one response.

**A refused request lies about its own status.** The wire status is 400 while the
body claims 500. The loader branches on the wire status and stores both. This
matters: treating it as a 500 would mean retrying a permanent input error
forever.

**Production history must be asked for one stage at a time.** A request with no
stage silently returns only ISS, so ISS, INTRAN and REC are three separate
fetches. If a returned row carries a different stage than the one requested, the
window aborts rather than landing mislabelled rows. Sales history has no stage
and the database refuses one.

**Windows are a fixed 7-day grid anchored at 2019-01-01**, because the vendor
refuses a wider span and because a floating window would make two runs
disagree about what "a week" covers. The database enforces the grid.

**Parent totals repeat verbatim on every exploded row.** `lineQty`,
`prepackQty`, `totalPpkQty` and `prodOrderQty` are header values appearing once
per component row. They are stored once on the parent and never summed. The one
quantity that *is* summed is the per-component `ppkDetailQty`, and only to check
it reconciles against the parent total — when it does not, the row is stored
without the assertion rather than being quietly adjusted.

**A changed row is a new version, not an edit.** Identity includes a hash of the
row's own projection, so two differing versions of the same order line are two
rows. Nothing is merged and nothing is overwritten.

## What is deliberately excluded

The EP001 division is not loaded. The exclusion is counted in every run's notes
rather than being silent, so any gap between rows fetched and rows landed has a
stated cause.

## Tests

`tools/coldlion-landing-history.test.mjs` covers the grid, the scopes, both
vendor defects, both projections, the shape of the generated transaction, and
the two workflows themselves: their triggers, the declared target beside every
credential, the missing-secret refusals, the offline tests running before any
write, and the serialisation. It runs offline with no secrets and no database,
as part of the tools offline suite.

`tools/coldlion-landing-masters.test.mjs` covers declared parameters, both
master response shapes, unknown-field refusal, settled projections, five-part
merchandise-group identity, item-slot clearing, re-runnable upserts, and the
workflow target guard.

No real ColdLion values appear in this directory. The fixtures are synthetic and
the loaders print counts, scopes and window dates only — this repository is
public.
