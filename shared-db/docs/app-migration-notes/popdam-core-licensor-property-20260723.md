# PopDAM canonical licensor/property cutover — 2026-07-23

PopDAM formerly kept separate `public.licensors` and `public.properties` tables.
The intended end-state moves live DAM foreign keys to shared canonical
`core.licensor` and `core.property` identities.

## Contract

- `public.assets.{licensor_id,property_id}` and
  `public.style_groups.{licensor_id,property_id}` reference `core.*`.
- `public.ai_tag_bakeoff_results.property_id` references `core.property`.
- Canonical matching prefers the record's ERP property code, then a unique
  normalized property name scoped to its canonical licensor. Missing/ambiguous
  properties become `NULL`; durable `property_code`/`property_name` text is
  preserved. Never guess an FK.
- Licensor mapping hard-fails on unmapped **or ambiguous** legacy licensors.
- Partial resume: `COALESCE(existing valid core licensor, mapped legacy licensor)`
  (and the same idea for already-valid core properties).
- `public.licensors` / `public.properties` remain deprecated only because
  PopDAM's character catalog still references legacy properties.
- `public.dam_character_catalog` is the explicit read-only compatibility view.

## Preview verification

Applied to preview `rjyboqwcdzcocqgmsyel` via migration `20260723113000` on
2026-07-22 EDT. Verified:

- zero asset licensor IDs outside `core.licensor`;
- zero asset property IDs outside `core.property`;
- all five replacement FKs target the correct `core` table;
- 85,481 asset licensor links and 42,700 asset property links in preview;
- `public.dam_character_catalog` queryable.

The preview backfill took 6m48s. That single-file migration is **applied on
preview and must not be edited, renamed, or deleted.**

## Production status (verified 2026-07-23)

**Production cutover is NOT applied.** An earlier doc paragraph that described a
successful production promotion is **withdrawn**.

- production ledger contains `20260723112900` only among the taxonomy trio;
- `20260723113000` and `20260723113100` are absent;
- the long-running production attempt timed out at 10 minutes and rolled back;
- PostgREST returned HTTP 503 / PGRST002 for the duration of that transaction.

Do not deploy dependent PopDAM taxonomy app code until the safe path below
succeeds and is verified.

## Production attempt and outage — 2026-07-23

Production migration `20260723113000` was attempted at approximately 14:45 UTC
and **did not apply**. Its transaction ran for 10 minutes, hit the safety
timeout, and rolled back. While open, DDL + asset rewrite prevented PostgREST
from rebuilding its schema cache (PopSG “Style guides could not load,” plus
other Data API 503s). Recovery required:

```sql
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

### Do not retry the production migration unchanged

**Do not** re-run `20260723113000` via `supabase db push`. **Do not** edit that
file. **Do not** mark it applied until the safe path has produced the same
end-state **and** the owner approves a migration-metadata repair.

## Stage 0 safe path (revised — migration DDL + DML-only tool)

### Ownership split

| Concern | Owner |
|---|---|
| Schema DDL + gates | Migrations `20260723112910`–`20260723112940` |
| Residual DML backfill | `tools/dam-core-taxonomy-safe-cutover.mjs` only |
| Unsafe mono cutover | `20260723113000` — preview only; never re-run on prod |

The Node tool **must not** execute schema DDL (`ALTER`/`CREATE`/`DROP`/`VALIDATE`
for FKs/views). AGENTS.md requires all DDL as timestamped shared-db migrations.

### Bridge migration order (between 112900 and 113000)

| Version | Role |
|---|---|
| `20260723112910` | Drop only legacy-targeted five FKs (no-op if core/absent) |
| `20260723112920` | Backfill-completion gate — raises while residuals remain |
| `20260723112930` | Finalize five core FKs + `dam_character_catalog` (no bulk DML) |
| `20260723112940` | Ledger barrier — raises until `113000` is in `schema_migrations` |
| `20260723113000` | Unsafe original (preview applied) |
| `20260723113100` | Reset statement_timeout |

### Production three-pass workflow

1. **Pass 1 `db push`:** applies `112910`; stops at `112920` gate.
   **DML:** `node tools/dam-core-taxonomy-safe-cutover.mjs --apply` until residuals = 0.
2. **Pass 2 `db push`:** applies `112920` + `112930`; stops at `112940` barrier.
   **Verify** five core FKs + zero residuals + view.
   **Only then**, owner-approved:
   `supabase migration repair --status applied 20260723113000`
   (**Forbidden before end-state exists.**)
3. **Pass 3 `db push`:** barrier passes; applies `113100`.

### Preview / `--include-all`

Preview already has `113000` applied. Landing `112910`–`112940` requires
out-of-order apply (`db push --include-all` or equivalent). Each bridge file is
idempotent; barrier passes because `113000` is already recorded.

### Tool behavior

- Offline dry-run: SQL/architecture only; `operationalCounts: null`.
- Live dry-run (`DATABASE_URL`): queries real preflight.
- Apply: advisory lock, per-txn timeouts, residual-scoped batches, reports
  `updated=` + residual deltas, aborts if nonzero residual does not decrease.
- Hard-fail unmapped/ambiguous licensors; refuse DML while legacy FKs remain
  (run `112910` first).

### Files

| Path | Role |
|---|---|
| `supabase/migrations/2026072311291*_*.sql` | Bridge DDL/gates |
| `tools/dam-core-taxonomy-safe-cutover.mjs` | DML-only tool |
| `tools/dam-core-taxonomy-safe-cutover.test.mjs` | Unit/contract tests |
| `scripts/dam-core-taxonomy-safe-cutover/README.md` | Operator runbook |

### Verification gates

| Gate | Pass criteria |
|---|---|
| Unit tests | `node --test tools/dam-core-taxonomy-safe-cutover.test.mjs` |
| SQL static | `scripts/check-sql.sh` |
| Preview bridge | `--include-all` applies 112910–112940; tool noop; five core FKs remain |
| Production DML | residual non-core ids → 0 with progress evidence |
| Production finalize | `core_fk_count=5`, view exists, PopSG 200/206 |
| Ledger | repair **after** end-state only; barrier then pass |

### Remaining owner approval (ledger only)

Safe end-state does **not** insert `20260723113000` into the ledger. After
validation proof:

```bash
# ONLY after verified end-state + owner approval for THIS repair:
supabase migration repair --status applied 20260723113000
supabase db push --dry-run   # must not list 113000 as work to execute
```

Repository Stage 0 does not cheat the ledger from SQL.
