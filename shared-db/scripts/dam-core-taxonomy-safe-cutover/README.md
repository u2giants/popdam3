# Safe DAM core licensor/property cutover (Stage 0)

This runbook completes the **already-in-flight** PopDAM cutover from legacy
`public.licensors` / `public.properties` FKs to canonical `core.licensor` /
`core.property` **without** replaying migration
`20260723113000_dam_core_licensor_property_cutover.sql` as one long transaction.

## Ownership split (non-negotiable)

| Concern | Owner |
|---|---|
| Schema DDL (drop legacy FKs, residual gate, add/validate core FKs, view, ledger barrier) | Timestamped migrations `20260723112910`–`20260723112940` |
| Residual-scoped DML backfill | `tools/dam-core-taxonomy-safe-cutover.mjs` **only** |
| Unsafe single-file cutover | `20260723113000` — preview-applied; **never edit; never re-run on production** |

The Node tool **must not** execute `ALTER`/`CREATE`/`DROP`/`VALIDATE` schema DDL
(including `ALTER TABLE … DISABLE/ENABLE TRIGGER`). It may only: read-only
preflight, advisory lock, bounded DML batches (with transaction-local
`SET LOCAL session_replication_role = replica` to suppress irrelevant asset
triggers — no DDL fallback — plus TEMP maps), and residual validation. That
session setting must succeed before UPDATE; **preview rehearsal with the same
DB role is the capability proof**.

## Why not re-run `20260723113000`?

Preview applied that migration successfully (~6m48s). Production tried it,
hit the 10-minute statement timeout, **rolled back**, and during the open
transaction PostgREST could not rebuild its schema cache (HTTP 503 / PGRST002).

Production ledger has `20260723112900` but **not** `20260723113000` /
`20260723113100`. Preview has `113000` applied.

## Mapping contract

1. **Licensor:** unique code first (`DS→DY`, `WWE→WW`), else unique normalized
   name. **Abort** on unmapped or **ambiguous** licensors before writes.
2. **Partial resume:** canonical licensor =
   `COALESCE(existing valid core licensor, mapped legacy licensor)`. Same for
   property with code/name resolution. Prevents nulling an already-valid core
   licensor when only the property is still legacy.
3. **Property:** unique code under canonical licensor, else unique normalized
   name. Missing/ambiguous → `NULL`. Durable `property_code` / `property_name`
   never rewritten.
4. Character migration out of scope; `public.dam_character_catalog` is the
   compatibility view.

## Ledger-ordered bridge (between 112900 and 113000)

```
20260723112900  timeout guard          [prod applied]
20260723112910  drop legacy FKs only   [idempotent; no-op if core/absent]
20260723112920  backfill gate          [raises while residuals remain]
20260723112930  finalize core FKs+view [no bulk DML; idempotent]
20260723112940  ledger barrier         [raises until 113000 is in ledger]
20260723113000  UNSAFE mono migration  [preview applied; do not re-run]
20260723113100  reset statement_timeout
```

### Production three-pass `db push` workflow

1. **Pass 1:** `supabase db push` → applies `112910`. Stops at `112920` gate
   (residuals remain).
   **Then:** `node tools/dam-core-taxonomy-safe-cutover.mjs --apply` until
   residuals = 0 (live evidence; reports `updated=` and residual deltas).

2. **Pass 2:** `supabase db push` → applies `112920` + `112930`. Stops at
   `112940` barrier (`113000` not yet in ledger).
   **Then:** run exact final validation (five core FKs, zero residuals, view).
   **Only after** that proof: owner-approved
   `supabase migration repair --status applied 20260723113000`.
   **Forbidden:** repair before end-state exists.

3. **Pass 3:** `supabase db push` → `112940` passes (sees `113000` in ledger),
   then `113100`. Dry-run must not list unsafe `113000` as pending work.

### Preview / `--include-all` out-of-order

Preview already has `113000` applied. Inserting `112910`–`112940` between
applied versions requires out-of-order apply (`supabase db push --include-all`
or equivalent). Each bridge migration is idempotent:

- drop: core FKs left alone
- gate: zero residuals → pass
- finalize: core FKs/view already present → no-op path
- barrier: `113000` in ledger → pass

## Tool usage

```bash
# Unit tests (no database)
node --test tools/dam-core-taxonomy-safe-cutover.test.mjs

# Offline dry-run: prints SQL architecture only — no fake operational counts
node tools/dam-core-taxonomy-safe-cutover.mjs

# Live dry-run: queries real preflight when DATABASE_URL is set (read-only)
# DATABASE_URL=... node tools/dam-core-taxonomy-safe-cutover.mjs

# Apply DML only (after 112910; requires advisory lock)
# DATABASE_URL=... node tools/dam-core-taxonomy-safe-cutover.mjs --apply --batch-size=2000
```

Safety features on apply:

- `pg_try_advisory_lock` — second concurrent operator is refused
- `SET LOCAL lock_timeout` / `statement_timeout` per DML transaction
- asset batches: `SET LOCAL session_replication_role = replica` (fails closed
  if the role cannot set it; never falls back to trigger DDL)
- reports `rows_updated` and residual before/after; **aborts** if nonzero
  residual does not decrease
- hard-fail on unmapped/ambiguous licensors and if legacy FKs still present
- exit status distinguishes `end_state_complete` from
  `dml_complete_schema_incomplete` (residuals clear but five core FKs/view not
  yet present — not full success)

## Failure recovery

| Failure | Safe response |
|---|---|
| Preflight unmapped/ambiguous licensors | **Stop.** Fix `core.licensor` coverage; no DML. |
| Tool refuses because legacy FKs remain | Apply `112910` first. |
| Batch error | That transaction rolls back; re-run tool (residual-scoped). |
| Gate `112920` raises | Finish DML tool; re-push. |
| Barrier `112940` raises | Expected until owner-approved repair **after** verified end-state. |
| PGRST002 | Stop new batches; quiet DB; `notify pgrst` reload; resume tool. |
| Never | Re-run `113000`; edit `113000`; repair before end-state; Node DDL. |

## Files

| Path | Role |
|---|---|
| `supabase/migrations/20260723112910_*.sql` | Drop legacy-targeted FKs |
| `supabase/migrations/20260723112920_*.sql` | Backfill-completion gate |
| `supabase/migrations/20260723112930_*.sql` | Finalize five core FKs + view |
| `supabase/migrations/20260723112940_*.sql` | Ledger barrier before unsafe 113000 |
| `tools/dam-core-taxonomy-safe-cutover.mjs` | DML-only tool + pure helpers |
| `tools/dam-core-taxonomy-safe-cutover.test.mjs` | Unit/contract tests |
| `scripts/dam-core-taxonomy-safe-cutover/sql/*` | Human-readable DML SQL mirrors |

## Out of scope

- Character catalog migration
- Dropping legacy public taxonomy tables
- Consumer app deploys
- Remote DB / commit / push from the Stage 0 coding session boundary
