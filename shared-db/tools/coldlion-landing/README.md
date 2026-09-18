# ColdLion landing loaders

Fills the existing ColdLion master, item, sales-history, production-history and
production-detail landing tables from the ColdLion ERP API.

`sync-masters.mjs` takes a complete current-state snapshot and upserts it. It
does not use history windows or the window ledger. It fetches seasons per
division, excludes EP001, and reconciles cleared item merchandise-group slots
without truncating any item table.

`sync-prod-details.mjs` fills `coldlion.prod_detail` from `GET /proddetails`,
one keyed request per production order. It harvests the complete approved
`prodOrderNo` population from the landed production history
(`coldlion.prod_history_line`), skips every order a SUCCEEDED `/proddetails`
`sync_run` already proves fetched, and lands each order in one transaction with
both proven identities asserted (`pkey` as the upsert key,
`(prod_order_no, prod_line_seq)` left to the table's unique constraint so a
re-keyed vendor row fails visibly instead of merging). Backfill walks
oldest-first (`--mode backfill`); the scheduled refresh catches new orders and
re-reads recently-observed ones (`--mode refresh`). The response is a bare
array; there is no page envelope. Unknown or omitted FIELDS abort the whole
run — a changed feed shape would fail every key the same way. Per-key data
failures (a row for another order, a blank identity field, either identity
twice in one response) are REFUSED for that key only: recorded as a FAILED
`sync_run` carrying `refused: identity-collision`, counted in every run's
reconciliation, never re-selected while the structural question is open, and
still failing the run non-zero so the refusal stays loud. Live on 2026-09-17
the feed falsified the `(prod_order_no, prod_line_seq)` uniqueness that #2863
asserted — one order returned two rows with distinct `pkey`s sharing a
`prodLineSeq` — which is exactly the visible collision that constraint exists
to catch, and the reason refusals exist instead of either collapsing the rows
or blocking the whole population.

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
repository's Actions secrets before any of them can start:

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

Prepack detail — enumerated, not paged (issue #3179). Every run harvests the
complete `prepackCode` population from the tables this loader family has already
landed (`coldlion.item_detail`, `coldlion.prod_history_line`,
`coldlion.order_history_line`, plus `coldlion.inventory` and
`coldlion.prod_detail` once their own loaders exist), then asks
`/prepackDetail?companyCode=..&prepackCode=..` once per code:

```bash
node tools/coldlion-landing/sync-prepack-detail.mjs --limit 150   # bounded, resumable backfill
node tools/coldlion-landing/sync-prepack-detail.mjs               # full refresh (the scheduled mode)
node tools/coldlion-landing/sync-prepack-detail.mjs --reconcile   # read-only reconciliation report
```

Resumability lives in `coldlion.sync_run.request_params`: each successful run
records the cumulative covered key set, so an interrupted backfill continues
exactly where the evidence stops — re-dispatch until the run prints
`pending 0`. A zero-row response for a harvested code is expected and is
counted, named on the run and alerted; it is never silently skipped. A removed
recipe sequence is deleted (with change_log evidence) only for codes the run
actually asked, so the landing table tracks the vendor's current state without
ever touching codes it did not question.

Backfill — resumable from the ledger, so re-running after an interruption
continues where the evidence stops:

```bash
node tools/coldlion-landing/backfill-history.mjs --from 2019-01-01 --limit 50
```

Production detail — catch up every order the evidence does not already prove
fetched, oldest first, bounded and resumable:

```bash
node tools/coldlion-landing/sync-prod-details.mjs --mode backfill --limit 1000
```

Production detail — ongoing refresh (new orders first, then recently-observed
ones re-read):

```bash
node tools/coldlion-landing/sync-prod-details.mjs --mode refresh --limit 2000
```

Production detail — re-fetch named orders regardless of prior evidence, the
smallest possible live smoke:

```bash
node tools/coldlion-landing/sync-prod-details.mjs --mode keys --keys 20000
```

Add `--dry-run` to any of these to see the outstanding work without fetching or
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

`tools/coldlion-landing-prepack.test.mjs` covers the eighteen-field
`/prepackDetail` projection, the duplicate-cased price pair, sentinel
normalisation, duplicate and blank-key refusal, the request-identity guard,
zero-row and malformed responses, bounded resumability, the shape of the load
transaction, and both workflows' target and secret guards.

`tools/coldlion-landing-prod-details.test.mjs` covers the /proddetails
projection, replay determinism, duplicate refusal on both identities, empty
responses, resumable key selection, the reconciliation read, and the two
workflows this feed rides on: their triggers, the declared target beside every
credential, and the offline tests running before any write.

No real ColdLion values appear in this directory. The fixtures are synthetic and
the loaders print counts, scopes and window dates only — this repository is
public.
