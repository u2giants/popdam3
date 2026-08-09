# Issue #597 Phase 1 — preview evidence (Product Size / Product Depth)

**Environment: PREVIEW `rjyboqwcdzcocqgmsyel` ONLY. Nothing in this change set has been
applied to production `qsllyeztdwjgirsysgai`, and the sub-agent that produced it was
explicitly withheld production authority by the owner.** Issue #597's "Workflow gates"
section asks for production apply-and-verify; that half is **not done** and must be
carried out separately, after this PR merges, by whoever holds that authority.

Captured 2026-08-09.

## Target proof

Every statement below ran against a connection proven immediately beforehand:

```text
supabase/.temp/project-ref     rjyboqwcdzcocqgmsyel      (read before the dry-run and before the push)
psql/node-pg connection user   postgres.rjyboqwcdzcocqgmsyel
server                         PostgreSQL 17.6, database `postgres`
```

The two refs, for comparison against characters rather than against "looks like preview":

```text
Production: qsllyeztdwjgirsysgai      <- NEVER touched by this work
Preview:    rjyboqwcdzcocqgmsyel      <- everything below
```

## Migrations applied

Six, in order, all new versions above the previous repo maximum `20260807200000`:

| Version | File |
|---|---|
| `20260809170000` | `core_product_size_and_depth_foundation.sql` |
| `20260809170100` | `core_product_depth_seed_from_designflow.sql` |
| `20260809170200` | `core_product_size_seed_from_legacy_mg04.sql` |
| `20260809170300` | `coldlion_product_size_guarded_importer.sql` |
| `20260809170400` | `api_product_size_and_depth_pickers.sql` |
| `20260809170500` | `db_data_admin_product_depth_mutations.sql` |

`supabase db push --dry-run` listed exactly these six and nothing else — no other
workstream's pending migration was carried along. The apply printed the seed guards' own
assertions:

```text
NOTICE: core.product_depth seeded: 121 legacy-backed rows (121 total), 121 source refs.
NOTICE: core.product_size seeded: 538 identities (530 active, 8 inactive), 652 legacy source refs.
```

## The arithmetic, independently derived on preview

Measured from `dflow."merchGroup"` where `mgTypeCode = '04'`:

| Division | Legacy rows | Distinct codes | Meaning of MG04 |
|---|---:|---:|---|
| CW001 | 202 | 190 | Size |
| EH001 | 263 | 161 | Size |
| SP001 | 187 | 187 | Size |
| EP001 | 9 | 9 | **Pages — excluded** |
| **Total** | **661** | **547** | |

538 Size identities − 8 historical retired = **530**, exactly the direct ColdLion feed
count in the 2026-08-07 comparison evidence (SP001 187, EH001 156, CW001 187). This is
why the seed could be done deterministically from the mirror with no network call.

> **Note on the 2026-08-07 evidence.** That document says "the 17 direct-feed gaps" while
> also recording 661 legacy rows against 530 fed rows. Both are correct and they are not
> in conflict: 661 vs 530 compares ROWS to identities, whereas the 17 gaps are on DISTINCT
> CODE identity (547 − 530). The legacy mirror holds several rows per code. Anyone
> re-checking this should compare distinct codes, not row counts.

## Verification result

`supabase/tests/product_size_depth_phase1_contracts.sql`, run against preview:

```text
=== RESULT: 38 passed, 0 failed ===
=== SUPPLEMENTARY RESULT: 3 passed, 0 failed ===
```

Highlights, all asserted against the OBJECT or the BEHAVIOUR — never against
`supabase_migrations.schema_migrations`:

**Objects** — 6 tables confirmed via `to_regclass` with their oids, 8 functions via
`pg_proc`, 2 `set_updated_at` triggers via `pg_trigger`, and both `plm.item` link columns
via `pg_attribute`.

**Counts**

| Assertion | Expected | Actual |
|---|---:|---:|
| Depth legacy-backed rows | 121 | 121 |
| Size ACTIVE (current) | 530 | 530 |
| Size INACTIVE (historical) | 8 | 8 |
| Size EP001 (Pages) rows | 0 | 0 |
| Depth labels/codes altered in transit | 0 | 0 |

All eight named historical identities are present and inactive: CW001 `5B`/`8H`/`TT`,
EH001 `5B`/`8T`/`ET`/`M8`/`TT`.

**Timezone.** `retired_at` was pinned to midday UTC and reads back as
`2026-08-09 08:00:00-04` in the server's `America/New_York` zone — the same calendar date
in both UTC and server-local time. A midnight-UTC value would have read back as
2026-08-08 through `::date`.

**Permissions — including the NULL-role case, which is the point.** On this connection
`auth.role()` is `<NULL>` and there is no profile. That is precisely the condition under
which a guard shaped `if not (... or auth.role() = 'service_role')` never fires and
admits the call. Every privileged entry point REFUSED:

```text
auth.role() on this connection = <NULL>
PASS NULL-role: Depth access gate REFUSED (insufficient_privilege)
PASS NULL-role: upsert RPC REFUSED (insufficient_privilege)
PASS NULL-role: set_status RPC REFUSED (insufficient_privilege)
PASS importer authority as postgres resolved role = postgres
PASS refused calls wrote nothing: probe rows = 0
PASS refused calls wrote no audit rows = 0
PASS write grants to anon/authenticated on core Size+Depth = 0
PASS any grant to anon/authenticated on ingest landing/run = 0
```

**Picker rule — inactive only when already selected**

```text
size picker, nothing selected                 = 530   (no inactive leaks)
size picker WITH one inactive id selected     = 531
that row is marked selectable = false
size picker filtered to CW001                 = 187
depth picker, nothing selected                = 121
```

**Importer guards, each proven to fire**

| Guard | Proof |
|---|---|
| Count band | 12-row feed refused |
| Division coverage | 4-division feed refused |
| EP001 payload | 2 EP001 rows refused with exactly 3 divisions present, so the coverage guard could not fire first |
| Retirement cap | a 490-row feed omitting 40 identities refused above the cap of 10 |
| Dry-run isolation | a clean 530-row dry run produced a plan and wrote nothing to `core.*` |
| Idempotency | a finished run replayed with `idempotent_replay = true` |
| Apply/mode separation | `p_apply = true` refused on a run created as `dry_run` |

After the refused apply, `core.product_size` still held 530 active rows — the refusal
changed nothing.

## Offline tests

```text
node --test tools/import-coldlion-product-size.test.mjs     19 passed, 0 failed
npx vitest run src/lib/product-depth.test.ts                 7 passed, 0 failed
tsc --noEmit -p tsconfig.app.json                            clean
eslint (new files)                                           clean
scripts/check-sql.sh                                         passed
```

## Deliberately NOT done

- **No production apply, no production dry-run, no `--include-all`, no `--create` flag.**
- **`api.plm_item_list` was not modified.** It reads `public.erp_items_current`, not
  `plm.item`, so exposing Size/Depth there would mean inventing a join into a view that
  four style-tracker views depend on. The additive link lives on `plm.item` instead.
- **No backfill of `plm.item.product_size_id` / `product_depth_id`.** Both stay NULL;
  the legacy compatibility text remains the reader of record until parity and rollback
  checks pass, exactly as issue #597 requires.
- **No DB Data Admin grid screen.** The protected RPCs and a typed, tested client layer
  are delivered; wiring a screen is app work, not database scope.

## Outstanding provisioning step

Granting the shared **Designer** role is not sufficient on its own. A Designer also needs
an explicit, non-revoked **`admin` app_access** row, or every Product Depth mutation RPC
raises `insufficient_privilege`. That is deliberate — a role alone must not open an admin
tool — but the cutover is not finished in any environment until that row exists for
Carlos Corral.
