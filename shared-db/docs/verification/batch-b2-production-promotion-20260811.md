# Batch B2 production promotion — evidence (2026-08-11)

Issues: #730, #710. Claim: #740. Target: **production `qsllyeztdwjgirsysgai`** (confirmed live via
`get_project_url` → `https://qsllyeztdwjgirsysgai.supabase.co` before every action). Preview
`rjyboqwcdzcocqgmsyel` was never touched.

**STATUS: APPLIED TO PRODUCTION AND VERIFIED. 2026-08-11.** Albert approved run
<https://github.com/u2giants/shared-db/actions/runs/31496978455> (SHA `0365f44`) and it completed
successfully. Ledger **373 → 376**. Every object and behaviour was verified independently of the
ledger — see §9. All three applications PASS the post-batch harness — see §10.

---

## 1. The batch

| Version (exact, 14-digit) | File |
|---|---|
| `20260728171500` | `20260728171500_db_data_admin_tree_plm_division_names.sql` |
| `20260728174500` | `20260728174500_clickup_incremental_task_import_reissue.sql` |
| `20260728181500` | `20260728181500_clickup_incremental_task_import_fixes.sql` |

`20260728181500` is a legal resting point per
`docs/production-promotion-app-tolerance-contract.md` §6. `20260728171500` and `20260728174500`
are both on the never-rest list, so this batch is all-or-nothing.

## 2. Baseline, re-verified live (not copied from any brief)

- `origin/main` at dispatch: `d0a832c5c380fe5b997d436786c330ec9ce988de` (PR #742).
- Production ledger immediately before dispatch: **373 rows**, max version `20260810140000`.
- All three B2 versions absent from the ledger (`b2_applied = 0`).
- The ledger is applied out of order; the high max does not imply the range below it is complete.

## 3. Trap 1 — the string-patch anchors, VERIFIED PRESENT IN THE LIVE BODY

`20260728171500` reads the live catalog body of
`api.db_data_admin_licensor_property_tree(text, boolean, text, integer)` via `pg_get_functiondef`,
counts two anchors, string-patches both, and `execute`s the result. It raises if the counts are
wrong. Measured directly against production:

| Anchor | Required | Found in live body |
|---|---|---|
| `'division_code', pi.division_code,` | exactly 2 | **2** |
| `'division_code', li.division_code,` | exactly 1 | **1** |
| `division_name` (must be ABSENT — not already patched) | 0 | **0** (position 0) |

Live function body length: 13,802 characters. The patch will apply as designed; it will neither
raise nor silently patch nothing.

## 4. Trap 2 — `plm."divisionCode"`, VERIFIED PRESENT

The tolerance contract §7.3 flags that this table is created nowhere in the backlog. It **does
exist in production**:

- `to_regclass('plm."divisionCode"')` → `plm."divisionCode"`
- Columns present and correctly typed for the migration's three reads:
  `divCode_id` (integer), `divCode_code`, `division_name`, `company_name_fk`,
  `external_divisoncode`, `is_divcode_active`.

The migration casts `divCode_id::text` to compare against `division_code`, which is consistent
with the integer column type. No blocker.

## 5. Other preconditions checked directly against production before dispatch

| Precondition | Required by | Live result |
|---|---|---|
| `pim.product` duplicate `btrim(clickup_task_id)` | `181500` §2 pre-guard raises on any duplicate | 17,909 rows with a task id, **17,909 distinct** — zero duplicates, guard will pass |
| Untrimmed clickup `external_id` | `181500` §1 trim repair | **0** — repair is a clean no-op, records no audit row |
| `pim.product` rows with `external_source IS NULL` | `174500` §2 backfill | **0** — backfill claims nothing and (by its idempotency guard) writes no `ingest.sync_run` row |
| `external_source` distribution | `181500` defect 6 premise | `directus_product` 17,859 / `clickup` 50 — matches the migration's stated production shape exactly |
| `ingest.raw_record`, `ingest.sync_run` | importer writes | both exist |
| `app.has_role` | `174500` §5 `api.clickup_task_sync_run_list` body | exists as `app.has_role(app.app_role)`; `administrator` is a valid `app.app_role` label, so the unknown literal resolves |
| Target objects already present? | idempotency | `pim.sync_clickup_tasks`, `pim_product_clickup_task_id_uidx`, `pim_product_clickup_list_updated_idx` all **absent** — this is a genuine first application |

## 6. Lane runs

### 6.1 Production dry-run — GREEN
Run <https://github.com/u2giants/shared-db/actions/runs/31450106237> (SHA `383d37c`).

```
BOUNDED OK: 376 migration files on disk, all within remote-ledger | allowlist (3 allowlisted).
Would push these migrations:
 • 20260728171500_db_data_admin_tree_plm_division_names.sql
 • 20260728174500_clickup_incremental_task_import_reissue.sql
 • 20260728181500_clickup_incremental_task_import_fixes.sql
```

376 on disk = 373 already-applied + the 3 allowlisted. Exactly the batch, nothing else.

### 6.2 First apply dispatch — FAILED SAFELY, NOTHING WRITTEN
Run <https://github.com/u2giants/shared-db/actions/runs/31450186206> (SHA `383d37c`).

PR #742 merged at 01:43Z and moved `main` to `d0a832c` roughly one minute before this dispatch.
The `Verify exact main commit` step in `production-apply-review` refused with exit 1. **This is the
guard working correctly** — it fails before any credential is used, before any checkout of the
bounded set, and long before any push. Production was not touched.

Diff `383d37c..d0a832c` was checked before re-dispatch: it touches only
`docs/production-promotion-app-tolerance-contract.md` and `scripts/post_batch_app_verification.py`.
**Zero changes to any migration file and zero changes to
`scripts/production_migration_guard.py`**, so the §6.1 dry-run evidence remains valid for the new
SHA. The ledger was re-read at that moment and was still 373 / `20260810140000` / B2 unapplied.

### 6.3 Second apply dispatch — ALL GUARDS GREEN, AWAITING HUMAN APPROVAL
Run <https://github.com/u2giants/shared-db/actions/runs/31450243224> (SHA `d0a832c`).

- `SQL migration guards` — success
- `Production apply review (advisory model verdict + hard guards)` — **success**
  - `PREFLIGHT OK: 3 migrations, no missing non-deferrable dependency.`
    (Per contract §7.5 a green preflight is not an approval; it is recorded, not relied on.)
- `Production apply (requires Albert's approval)` — **`waiting`** on `environment: production`.
  `pending_deployments` reports the sole eligible reviewer is `u2giants`.

**Albert approved this run, but by the time he clicked, `main` had moved from `d0a832c` to
`0365f44` (five PRs merged in between). `Verify exact main commit` refused. The run FAILED SAFELY:
production was NOT written.** Re-confirmed directly afterwards — ledger still 373 rows, max
`20260810140000`, and the live tree body still 13,802 chars with `division_name` absent.

### 6.4 Re-stage at `0365f44` — full re-verification from scratch

A merge freeze was put in force (PRs #746, #751, #752, #753 held unmerged) so `main` would stop
moving. Work was done in a dedicated worktree cut from a freshly fetched `origin/main`.

Every precondition in §2–§5 above was **re-measured live against production** at the new SHA, and
every number was identical: ledger 373 / `20260810140000`; tree body 13,802 chars with `pi.` = 2,
`li.` = 1, `division_name` absent; `plm."divisionCode"` present with all six columns;
`pim.product` 17,909 rows / 17,909 distinct task ids / 0 untrimmed / 0 null `external_source` /
17,859 `directus_product` + 50 `clickup`; all three target objects still absent.

**Re-staged dry run — GREEN.** Run <https://github.com/u2giants/shared-db/actions/runs/31496831439>
(SHA `0365f44`):

```
BOUNDED OK: 376 migration files on disk, all within remote-ledger | allowlist (3 allowlisted).
Would push these migrations:
 • 20260728171500_db_data_admin_tree_plm_division_names.sql
 • 20260728174500_clickup_incremental_task_import_reissue.sql
 • 20260728181500_clickup_incremental_task_import_fixes.sql
```

**Re-staged apply dispatch.** Run <https://github.com/u2giants/shared-db/actions/runs/31496978455>
(SHA `0365f441b693a445d15049e21c1530fa5ba867c2`):

- `SQL migration guards` — success
- `Production apply review (advisory model verdict + hard guards)` — success
- `Production apply (requires Albert's approval)` — **Albert approved. Job completed SUCCESS.**

`origin/main` was re-derived immediately before the apply dispatch and was still `0365f44`, and the
freeze held until he clicked, so `Verify exact main commit` passed. **This run is the production
write.** Run conclusion: `completed / success`, head SHA
`0365f441b693a445d15049e21c1530fa5ba867c2`, branch `main`, event `workflow_dispatch`.

The lesson from §6.2 and §6.3 is now on the record twice: the SHA pin is not a formality. Two
separate approved runs were refused because `main` moved between dispatch and click. It only
succeeded once merges were frozen. Any future production apply should be dispatched under a freeze.

### 6.5 Atomicity note

`supabase db push` is atomic **per file**, not per batch (AGENTS.md §5.1-A,
`docs/verification/issue-611-db-push-atomicity-20260810.md`). A mid-batch failure would have left
the earlier files applied *and* ledgered. **It did not happen** — all three files applied and the
ledger moved by exactly +3 (§9.1). No partial-application recovery was needed.

**A green workflow is not evidence of anything in the database.** `success` is a statement about
the CLI exit code and the ledger insert, not about what the SQL did. This repo has a worked example
of a migration that installed cleanly while doing nothing — a BEFORE trigger reading a GENERATED
STORED column, which Postgres populates only *after* before-triggers, so the guard read NULL every
time and never fired. Nothing in §9 relies on the run's conclusion.

## 7. Finding — the #709 User-Agent path did NOT execute

The brief expected this run to be the first real production exercise of the User-Agent fix in
`scripts/production_apply_model_review.py` (commit 6578935). **It did not execute.** The advisory
model review step reported:

> **NOT RUN** — `ANTHROPIC_API_KEY` is not configured on this repository, so no model review was
> performed.

The step logged `ANTHROPIC_API_KEY:` empty and exited without calling the Anthropic API, so no
HTTP request was made and the User-Agent header was never sent. **The #709 fix therefore remains
unproven against production.**

This is a correct, loud failure rather than a silent skip — the script states NOT RUN in the job
summary and tells the approver to rely on the deterministic guards instead. But two things follow:

1. The advisory model review is currently a permanent no-op on every production apply. It is
   `continue-on-error: true`, so it will never fail a run; the only signal is that sentence in the
   summary. Anyone assuming a silent review job means "the model found nothing" would be wrong.
2. #709 cannot be closed on the strength of this run.

## 8. Post-apply verification plan — EXECUTED

The plan below was carried out in full. Results in §9 (direct inspection) and §10 (harness).
Every §9 item is **my own direct catalog/behaviour query against production**, run through the
Supabase MCP against `qsllyeztdwjgirsysgai` (ref re-confirmed via `get_project_url` first).
Every §10 item is **harness-derived**. The two are kept apart deliberately so neither is used to
vouch for the other.

## 9. Post-apply verification — DIRECT INSPECTION (my own queries, not the harness)

### 9.1 The ledger

| | Before | After |
|---|---|---|
| Rows in `supabase_migrations.schema_migrations` | **373** | **376** |
| Max version | `20260810140000` | `20260810140000` (unchanged — B2 sorts below it) |

Delta is **exactly +3**, and the three present versions are exactly
`20260728171500`, `20260728174500`, `20260728181500` (verified by selecting them back by name,
not by counting). The full 376-row ledger was dumped and diffed against the 429 migration files on
disk: **zero orphans** (no applied version lacks a file). No unintended migration rode along.

This section is recorded for completeness only. **A ledger row is not evidence that SQL did
anything** — that is the whole premise of issue #611 — so everything below stands on its own.

### 9.2 `20260728171500` — the string-patch. THE PATCH LANDED.

This was the documented trap: the migration reads the live catalog body of
`api.db_data_admin_licensor_property_tree(text, boolean, text, integer)` via `pg_get_functiondef`,
string-patches it, and re-executes it. A silent no-op would have applied and ledgered cleanly.

`pg_get_functiondef` re-read after the apply:

| Measure | Before | After |
|---|---|---|
| Body length | 13,802 chars | **14,888 chars** (+1,086) |
| `division_name` occurrences | **0** | **6** |
| `division_external_code` occurrences | 0 | **3** |
| `divisionCode` references | 0 | **6** |
| `'division_code', pi.division_code,` | 2 | 2 (preserved, each now followed by the new subqueries) |

The function still resolves at its exact four-argument signature, so the app's call path is intact.

The installed text was read back directly. Verbatim excerpt from the live body:

```
'division_code', pi.division_code,
 'division_name', (
   select d.division_name from plm."divisionCode" d
   where d."divCode_id"::text = pi.division_code
 ),
 'division_external_code', (
   select d.external_divisoncode from plm."divisionCode" d
   where d."divCo...
```

**Behavioural proof, not just textual.** The MCP role is not granted EXECUTE on the RPC, so the
function could not be called directly. Instead the exact correlated subquery the migration
installed was executed against live production data:

| `division_code` | resolved `division_name` | resolved `division_external_code` |
|---|---|---|
| `8` | **Spruce Lic** | **SP001** |

It returns a real division NAME, not a numeric code and not NULL. That is the behaviour the batch
existed to produce. The remaining half — that the name *renders* in the UI — is a human eyeball
test and is still open; see §11.

### 9.3 `20260728174500` and `20260728181500` — the clickup incremental import

Object existence, by `to_regprocedure` / `to_regclass`:

| Object | Result |
|---|---|
| `pim.sync_clickup_tasks(jsonb,text)` | present |
| `public.sync_clickup_tasks(jsonb,text)` | present |
| `api.clickup_task_sync_run_list(integer)` | present |
| `pim.pim_product_clickup_task_id_uidx` | present |
| `pim.pim_product_clickup_list_updated_idx` | present |

**The unique index is real and usable**, from `pg_index` + `pg_get_indexdef`:

```
CREATE UNIQUE INDEX pim_product_clickup_task_id_uidx ON pim.product
  USING btree (btrim(clickup_task_id))
  WHERE ((clickup_task_id IS NOT NULL) AND (btrim(clickup_task_id) <> ''::text))
```

`indisunique = true`, `indisvalid = true`, `indisready = true`, `indislive = true`. Not an INVALID
leftover from a failed build — it built cleanly, exactly as the 17,909-distinct pre-check predicted.

**The `181500` body won, not the `174500` body.** Both migrations `create or replace` the same
function, so the later one must be the survivor. `pg_get_functiondef` on the live
`pim.sync_clickup_tasks` (20,190 chars) contains all three `181500`-only markers:
`watermark_advanced`, `fetch_started_at`, and resolve-by `btrim(clickup_task_id)`.

`pim.product` now carries **14** `clickup*` columns.

**Privileges are correct and not over-granted** (`pg_proc.proacl`):

- `pim.sync_clickup_tasks` -> `{postgres=X/postgres, service_role=X/postgres}`
- `public.sync_clickup_tasks` -> `{postgres=X/postgres, service_role=X/postgres}`
- `api.clickup_task_sync_run_list` -> `{postgres, authenticated, service_role}`

Neither `sync_clickup_tasks` grants EXECUTE to `PUBLIC` or to `anon`.

### 9.4 The two data-repair blocks were the clean no-ops predicted

| Check | Before | After |
|---|---|---|
| `pim.product` rows | 17,909 | **17,909** |
| distinct `clickup_task_id` | 17,909 | **17,909** |
| untrimmed clickup `external_id` | 0 | **0** |
| `external_source IS NULL` | 0 | **0** |
| `external_source` split | 17,859 / 50 | **17,859 `directus_product` / 50 `clickup`** |
| `ingest.sync_run` rows | 26 (latest `2026-07-22 19:10:49`) | **26 (latest `2026-07-22 19:10:49`)** |

No product row was re-keyed, duplicated or lost, and **no audit row was written** — confirming both
repair blocks claimed nothing, exactly as the pre-check said they would.

## 10. Post-batch application verification — HARNESS-DERIVED

`scripts/post_batch_app_verification.py --versions 20260728171500,20260728174500,20260728181500
--project-ref qsllyeztdwjgirsysgai`. Exit code **0**.

This harness is now trustworthy: issue #721 proved its assertions were already correct and only
comment strings changed (PR #742), and PR #741 made its 141 offline tests actually execute in CI.

| Application | Verdict | Failures |
|---|---|---|
| PopCRM | **PASS** | 0 |
| PopDAM | **PASS** | 0 |
| PopPIM | **PASS** | 0 |

All eight batch-specific checks PASS, including the two that matter most for B2:

- `db_data_admin_tree_function_still_resolves` — PASS. The contract calls this the
  highest-probability abort in the whole backlog.
- `db_data_admin_tree_reads_division_names_not_codes` — PASS. The patched body reaches
  `plm."divisionCode"`; an unpatched body would not mention it at all.

Also PASS: `division_code_table_exists`, `canary_table_exists`, `canary_holds_exactly_one_row`,
`canary_has_rls_on_and_no_policies`, `coldlion_sync_is_three_arg`,
`coldlion_sync_two_arg_is_gone`. Environment check PASS.

The run reports **13 recorded gaps / not-yet-due objects**. None is B2 damage; all are pre-existing
and were already on record from 2026-08-10 (the PopPIM `authenticated` privilege gaps = issue #720,
still open; `core.product_size` absent until B8; the `dam` schema not exposed through PostgREST).
They are listed unsuppressed in the harness output and are unchanged by this batch.

## 11. Still required by hand

The harness states plainly what it did **not** prove: it did not open the applications, did not
read the PopCRM worker journal, did not evaluate RLS semantics, did not compare function argument
names or return shapes, and did not exercise DesignFlow non-production.

- [ ] **Open the DB Data Admin licensor -> property tree and confirm DIVISION NAMES appear instead
  of numeric codes.** §9.2 proves the patched function reaches `plm."divisionCode"` and that the
  lookup returns "Spruce Lic" for code `8`. Only a human can see what actually rendered.
- [ ] Contract §7.1's five-minute smoke test, which applies after every batch.

## 12. Position after B2, and what remains

- Production ledger: **376 applied**, max version `20260810140000`. The ledger remains applied out
  of order; the high max does not mean the range below it is complete.
- Migration files in the repo at `0365f44`: **429**.
- **Total unapplied: 53.**
- Three of those 53 belong to **no batch** in the nine-batch plan and will therefore never be
  promoted by B3..B9:
  - `20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql`
  - `20260810190000_dcp_vault_source_landing.sql`
  - `20260810190100_dcp_vault_chunked_loader.sql`

  The orchestrator has ruled these get a new **B10**, with `20260810180000` FIRST inside it.
- **Unapplied within B3..B9: 50.** Stated both ways so nobody later mistakes 53 for 50.

## 13. Scope

Batch B2 only. Albert's approval covered these three migrations and nothing else. No DROP, no data
deletion, no rename, no new migrations authored, and preview `rjyboqwcdzcocqgmsyel` was never
touched. Issues #730 and #710 and claim #740 are left open for the orchestrator to close.

Issue **#709 stays open** — see §7; the advisory model review did not run, so nothing about it was
proven by this batch.
