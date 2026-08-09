# A1 — Classification of the migration-ledger orphans on production

**Plan item:** `plan_orchestrator-workflow-gaps.md` § A1
**Measured:** 2026-08-09, read-only, by a dispatched sub-agent of orchestrator session `5e1ab3af` (marker issue #601).
**Nothing was written to any database.** Every statement below is a `select`.

---

## 1. Target confirmed before any measurement

`AGENTS.md` §12 standing fact 6 requires the Supabase MCP target to be confirmed first,
because the server takes no project parameter.

```
mcp__supabase__get_project_url  ->  https://qsllyeztdwjgirsysgai.supabase.co
```

**Production ref: `qsllyeztdwjgirsysgai`.** (Preview is `rjyboqwcdzcocqgmsyel` and was not touched.)

## 2. Counts, re-derived — they match the plan exactly

The plan's figures were measured on 2026-08-07 and this repo's standing rule is that no
document wins by date, so every number was re-derived. **All five agree with the plan.**

| Measure | Plan (2026-08-07) | Measured (2026-08-09) | Agree? |
|---|---|---|---|
| Production ledger rows | 361 | **361** | yes |
| Ledger head | `20260802194100` | **`20260802194100`** | yes |
| Migration files on `main` | 405 | **405** | yes |
| Pending (sort newer than head) | 11 | **11** | yes |
| Orphans (sort older than head, never recorded) | 33 | **33** | yes |
| Ledger rows with no file on `main` | — | **0** | (new: none) |

`origin/main` tip at measurement: `81252fb4453f68c9380b35f249b5dc9165e91fd9`.

Re-derive:

```sql
select count(*) as rows, min(version) as lo, max(version) as head
from supabase_migrations.schema_migrations;
-- 361 | 20260220125350 | 20260802194100

select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;
```

```bash
git ls-tree -r --name-only origin/main supabase/migrations | sed 's#.*/##' | cut -c1-14 | sort > files.txt
# ledger versions, one per line, sorted -> ledger.txt
comm -23 files.txt ledger.txt | awk '$1<="20260802194100"'   # -> the 33 orphans
comm -23 files.txt ledger.txt | awk '$1>"20260802194100"'    # -> the 11 pending
comm -13 files.txt ledger.txt                                # -> empty
```

## 3. Headline result

**All 33 orphans were NEVER APPLIED to production. Zero fall into bucket (a).**

| Bucket | Count |
|---|---|
| (a) APPLIED OUT-OF-BAND — record in ledger, never re-run | **0** |
| (b) NEVER APPLIED, NO LONGER WANTED | **1** |
| (c) NEVER APPLIED, STILL WANTED | **30** |
| UNKNOWN (never applied; *wantedness* undecided) | **2** |

**Nothing may be inserted into the ledger as a result of this exercise.** Every one of the 33
must reach production by being applied normally, in version order, or be deliberately retired.

## 4. Method, and why it is stronger than object existence

Object existence alone was rejected (correctly) as the method. The checks below are
per-statement and were chosen so that each class of blind spot has a positive test.

| Blind spot | How it is covered here |
|---|---|
| A `DROP` whose success looks like absence | Every `drop` in the set targets an object that the same set creates, and none of those objects exist. Traced explicitly in §6 for `20260726030000`. |
| DML / grants / revokes that create no object | Positive DML probes: `core.licensor` FR status + `metadata->'owner_ruling'`, `ingest.sync_run.source_name`, `core.licensor_alias` rows. ACL probes: `pg_default_acl`, `has_function_privilege`. |
| `create or replace` drift — object exists, but from another migration | **Bit-exact body attribution.** `md5(pg_proc.prosrc)` compared against the md5 of the dollar-quoted body in each candidate file. This is what separated `20260729120000` from `20260729180000`. |
| Partial application | Every orphan creates or writes at least one object/row that is provably absent. Nothing in the set shows a half-state. |

### Known blind spots of THIS method — read before trusting it

1. **`prosrc` on this database is stored with CRLF line endings.** A naive md5 of the file
   body (LF) mismatches every function and looks like drift. All md5s quoted below are
   computed after `\n` -> `\r\n` normalization. Anyone re-deriving with LF will get false
   "not applied" results for functions that *are* applied.
2. **"Still wanted" is not measurable read-only.** It is a repo/owner judgement. Bucket
   (c) here means only: *not applied, and not superseded by anything that is applied or
   newer.* No owner has ruled on any of these 30.
3. **Applied-then-overwritten** would be invisible if a later migration replaced a body and
   removed every marker. Checked explicitly for the only three affected functions (§6,
   rows `20260728171500`, `20260802170000`, `20260729120000`) by confirming no migration
   between the orphan and the ledger head redefines them.
4. **Only 1 of the 33 files carries its own `begin;`/`commit;`** (`20260729120000`). The
   rest rely on the Supabase CLI wrapping each file in a transaction. That makes partial
   application unlikely but not structurally impossible; the evidence rather than the
   wrapping is what rules it out here.
5. A statement whose only effect is on a role/setting outside these catalogs (none found in
   this set) would not be seen.

## 5. The five queries the whole table rests on

**Q1 — object battery** (12 tables, 10 indexes, 14 triggers, 1 event trigger, 1 column):

```sql
select 'table' k, n.nspname||'.'||c.relname o
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and n.nspname||'.'||c.relname in (
   'plm.taxonomy_parallel_observation','plm.taxonomy_sync_alert','plm.taxonomy_circuit_breaker',
   'plm.taxonomy_circuit_breaker_event','core.style_guide','core.style_guide_character',
   'plm.coldlion_promotion_audit','plm.coldlion_promotion_quarantine','core.property_alias',
   'dam.popsg_property_resolution','core.licensor_alias','core.taxonomy_owner_ruling')
union all select 'index', c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='i' and c.relname in ('style_guide_licensor_code_key','pim_product_clickup_task_id_uidx',
   'property_alias_licensor_norm_key','licensor_alias_norm_key','licensor_alias_trgm_idx',
   'popsg_property_resolution_active_tuple_key','plm_coldlion_promotion_audit_entity_idx',
   'plm_taxonomy_sync_alert_open_idx','pim_product_clickup_list_updated_idx','taxonomy_owner_ruling_entity_idx')
union all select 'trigger', t.tgname from pg_trigger t where not t.tgisinternal and t.tgname in (
   'coldlion_source_ref_breaker_guard','coldlion_erp_licensor_breaker_guard','coldlion_erp_property_breaker_guard',
   'coldlion_autotrip_on_critical_alert','coldlion_autotrip_on_failed_observation',
   'coldlion_source_ref_delete_breaker_guard','coldlion_erp_licensor_insert_breaker_guard',
   'coldlion_erp_property_insert_breaker_guard','coldlion_breaker_state_guard',
   'coldlion_promotion_audit_append_only_guard','coldlion_promotion_quarantine_append_only_guard',
   'reject_redundant_property_alias','enforce_popsg_resolution_append_only','reject_shadowing_licensor_alias')
union all select 'evtrigger', evtname from pg_event_trigger where evtname='lock_down_new_public_function_execute_trg'
union all select 'column', 'pim.product.clickup_list_id' from information_schema.columns
 where table_schema='pim' and table_name='product' and column_name='clickup_list_id'
order by 1,2;
```

**Result: exactly one row — `evtrigger | lock_down_new_public_function_execute_trg`.**
All 12 tables, all 10 indexes, all 14 triggers and the column are **absent**.

**Q1c — control, proving Q1 is not silently matching nothing:**

```sql
select (select count(*) from pg_namespace where nspname in ('plm','core','dam','pim','api','ingest')) schemas,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='core') core_tables,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='plm') plm_tables,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='core' and c.relname='taxonomy_source_ref') ctl_source_ref,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='plm' and c.relname='erp_licensor') ctl_erp_licensor,
       (select count(*) from pg_trigger where not tgisinternal) trig_total,
       (select count(*) from pg_event_trigger) evt_total;
-- 6 | 41 | 101 | 1 | 1 | 131 | 8
```

The database is fully populated, both trigger targets (`core.taxonomy_source_ref`,
`plm.erp_licensor`) exist, and 131 other triggers are visible to the same predicate.
Q1's emptiness is a real absence, not a broken query.

**Q2 — function battery.** All 47 distinct function names created or replaced anywhere in
the 33 files:

```sql
select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig,
       md5(p.prosrc) src_md5, length(p.prosrc) len
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.proname in ('sync_coldlion_licensors_properties','coldlion_licensor_property_run_list',
  'link_coldlion_licensors_properties_core','link_coldlion_licensors_properties_approved',
  'compute_taxonomy_immutability_snapshot','record_taxonomy_sync_alert','record_taxonomy_parallel_observation',
  'check_taxonomy_sync_health','coldlion_parallel_observation_list','taxonomy_sync_alert_list',
  'taxonomy_circuit_breaker_is_open','taxonomy_circuit_breaker_state','trip_taxonomy_circuit_breaker',
  'reset_taxonomy_circuit_breaker','guard_coldlion_source_ref_breaker','guard_coldlion_mirror_link_breaker',
  'verify_coldlion_approved_mapping_identity','record_taxonomy_circuit_breaker_blocked_attempt',
  'autotrip_taxonomy_breaker_on_critical_alert','autotrip_taxonomy_breaker_on_failed_observation',
  'guard_coldlion_source_ref_delete_breaker','guard_coldlion_mirror_link_insert_breaker',
  'guard_taxonomy_circuit_breaker_state','taxonomy_breaker_enforcement_status',
  'db_data_admin_licensor_property_tree','sync_clickup_tasks','clickup_task_sync_run_list',
  'lock_down_new_public_function_execute','coldlion_normalize_name',
  'guard_coldlion_promotion_evidence_append_only','promote_coldlion_source_owned',
  'coldlion_promotion_audit_list','coldlion_promotion_quarantine_list',
  'normalize_popsg_property_observation','reject_redundant_property_alias',
  'enforce_popsg_resolution_append_only','propose_popsg_property_resolution',
  'activate_popsg_property_decision_batch','promote_property_alias_batch',
  'reject_shadowing_licensor_alias','resolve_licensor_alias','list_licensor_aliases',
  'approve_licensor_alias','assert_taxonomy_alert_ack_authority','taxonomy_alert_actor_looks_automated',
  'acknowledge_taxonomy_sync_alert','import_master_data')
order by 1;
```

**Result — exactly 3 rows out of ~47 names:**

| sig | `md5(prosrc)` | len |
|---|---|---|
| `api.db_data_admin_licensor_property_tree(p_search text, p_include_inactive boolean, p_cursor text, p_page_size integer)` | `c68fd2a6991b0420502bd02a1dabcf65` | 13463 |
| `plm.import_master_data(licensors_payload jsonb, customers_payload jsonb)` | `e7a5c85bf2f5221a37404bd9df907807` | 18497 |
| `public.lock_down_new_public_function_execute()` | `735985606362e0321231dc77a5863ec4` | 750 |

All three are **pre-existing** functions that an orphan would have *replaced*. §6 attributes
each live body, bit-exactly, to a migration that is already in the ledger.

**Q3 — marker / ACL / policy probes:**

```sql
select
 (select position('division_name' in prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='api' and p.proname='db_data_admin_licensor_property_tree') tree_division_name_pos,
 (select position('CHANGED 2026-08-02 (tranche 2)' in prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='plm' and p.proname='import_master_data') import_tranche2_marker_pos,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('acknowledge_taxonomy_sync_alert','sync_clickup_tasks','promote_coldlion_source_owned',
                     'resolve_licensor_alias','propose_popsg_property_resolution')) public_orphan_fns,
 (select count(*) from information_schema.columns where table_schema='pim' and table_name='product'
   and column_name in ('clickup_list_id','clickup_task_id')) pim_clickup_cols,
 (select string_agg(array_to_string(d.defaclacl,' | '), ' ;; ') from pg_default_acl d
   join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and d.defaclobjtype='f') public_fn_defacl;
```

Result:

```
tree_division_name_pos     = 0
import_tranche2_marker_pos = 0
public_orphan_fns          = 0
pim_clickup_cols           = 1     (clickup_task_id only; clickup_list_id absent)
public_fn_defacl           = postgres=X/supabase_admin | anon=X/supabase_admin | authenticated=X/supabase_admin | service_role=X/supabase_admin
                         ;; postgres=X/postgres | service_role=X/postgres
```

**Q4 — DML probes:**

```sql
select
 (select count(*)   from core.licensor where code='FR' and name='FRIENDS TV') fr_rows,
 (select status::text from core.licensor where code='FR' and name='FRIENDS TV') fr_status,
 (select metadata->'owner_ruling'->>'migration' from core.licensor where code='FR' and name='FRIENDS TV') fr_ruling_migration,
 (select count(*)   from core.property where code='FK' and name='FRIDA KAHLO') fk_rows,
 (select count(*)   from ingest.sync_run where source_name='clickup_external_id_trim_repair') clickup_trim_repair_runs,
 (select count(*)   from core.licensor where status='inactive') licensors_inactive;
-- 1 | active | NULL | 1 | 0 | 0
```

**Q5 — policy disambiguation.** Q1's policy variant returned 9 rows for `dam_read`; all 9 are
on *other, pre-existing* `dam` tables, none on `dam.popsg_property_resolution`:

```sql
select schemaname||'.'||tablename||' :: '||policyname from pg_policies
 where policyname in ('plm_taxonomy_parallel_observation_admin_select','plm_taxonomy_sync_alert_admin_select',
  'plm_taxonomy_circuit_breaker_admin_select','plm_taxonomy_circuit_breaker_event_admin_select',
  'plm_coldlion_promotion_audit_admin_select','plm_coldlion_promotion_quarantine_admin_select','dam_read');
-- dam.asset, dam.asset_character, dam.asset_path_history, dam.asset_tag, dam.customer_ext,
-- dam.factory_ext, dam.sku_style_guide_source, dam.style_group, dam.style_guide_file  (9 rows)
-- ZERO rows for any of the six plm_* policy names.
```

**Body-md5 helper** (`scripts/verify/migration_body_md5.py`, added by this PR — read-only,
touches no database):

```bash
python scripts/verify/migration_body_md5.py supabase/migrations/<file>.sql
# prints: <version> <md5 of each dollar-quoted body, CRLF-normalized> <length>
```

---

## 6. The three rows where an object DID exist — resolved bit-exactly

These are the only three places where object existence could have been misread as
"applied". Each is resolved by matching `md5(prosrc)` to a *different*, already-recorded
migration, and by confirming nothing between the orphan and the head could have overwritten it.

| Orphan | Live object | Live `md5(prosrc)` | Belongs to | In ledger? | Orphan's own body md5 | Verdict |
|---|---|---|---|---|---|---|
| `20260729120000` | `public.lock_down_new_public_function_execute()` + event trigger | `735985606362e0321231dc77a5863ec4` (750) | **`20260729180000`** | **yes** | `fdbf72e787af65ac139c40b1fed4f6d2` (722) | orphan NOT applied |
| `20260802170000` | `plm.import_master_data(jsonb,jsonb)` | `e7a5c85bf2f5221a37404bd9df907807` (18497) | **`20260723140000`** | **yes** | `442011f1b42f2c7da07d7c3e7bb4fc5d` (19543) | orphan NOT applied |
| `20260728171500` | `api.db_data_admin_licensor_property_tree(...)` | `c68fd2a6991b0420502bd02a1dabcf65` (13463) | **`20260727154500`** | **yes** | n/a (patches via `execute pg_get_functiondef(...)`) | orphan NOT applied |

Corroboration, not just the hash:

- The live event-trigger body reads `command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')`
  and `revoke execute on routine`. `20260729120000` writes `command_tag = 'CREATE FUNCTION'`
  and `revoke execute on function`. The live text is `20260729180000`'s, verbatim.
- `20260728171500` refuses to run twice (`if position('division_name' in v_definition) > 0
  then raise exception`) and its whole purpose is to inject `division_name`.
  `tree_division_name_pos = 0` on production, so it has not run.
- `20260802170000` removes two `status = 'active'` assignments and stamps
  `CHANGED 2026-08-02 (tranche 2)` into the body. `import_tranche2_marker_pos = 0`.
- **Overwrite check:** `grep` over `supabase/migrations` shows the last migration to define
  `api.db_data_admin_licensor_property_tree` before the head is `20260727154500`, and the
  last to define `plm.import_master_data` before the head is `20260723140000`. There is no
  candidate that could have applied the orphan and then reverted it.

### The `20260729120000` decision — the one bucket-(b) row

Its root-cause statement is:

```sql
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
```

Production's `pg_default_acl` for `postgres` in `public` is
`postgres=X/postgres | service_role=X/postgres` — `anon` and `authenticated` are gone, so
**that end state IS present on production.** It would be easy, and wrong, to read this as
"applied".

It was produced by **`20260729130000_production_safe_public_execute_lockdown.sql`**, which
carries the identical `alter default privileges` statement and **is in the ledger**.
`20260729130000` is the production-safe re-issue of `20260729120000`; the earlier file's
remaining statements target `public.sync_clickup_tasks(jsonb,text)` and
`pim.sync_clickup_tasks(jsonb,text)`, neither of which exists on production (Q2), so it
could not run today even if someone tried.

**Bucket (b): never applied, no longer wanted — superseded by `20260729130000`, applied.**
It must be retired deliberately (or recorded as superseded), **not** applied and **not**
back-filled into the ledger.

---

## 7. The table — one row per orphan

`Applied?` is the safety-critical column and is **NO for every row**. `Bucket` carries the
wanted/unwanted judgement. `Conf.` is confidence in the *Applied?* verdict.

| # | Version | File | Applied? | Bucket | Per-statement evidence (query -> result) | Conf. |
|---|---|---|---|---|---|---|
| 1 | 20260724060000 | `_coldlion_licensor_property_phase2a_mirror_importer.sql` | **NO** | **UNKNOWN** (wantedness) | Creates 3 fns (`plm.`/`public.sync_coldlion_licensors_properties(jsonb,text)`, `api.coldlion_licensor_property_run_list(int)`) + 4 revoke/grant + 2 comments on them. **Q2: none of the 3 exist** -> every statement's target is absent; the revokes/grants/comments could not have run. | High |
| 2 | 20260724061000 | `_coldlion_licensor_property_phase2a_guard_corrections.sql` | **NO** | **UNKNOWN** (wantedness) | Same 3 fns re-issued + same 4 revoke/grant + 2 comments. **Q2: none exist.** | High |
| 3 | 20260726030000 | `_coldlion_licensor_property_phase4_link_approved.sql` | **NO** | (c) | Creates `plm.link_coldlion_licensors_properties_core/_approved`, re-creates `sync_coldlion_licensors_properties` at (jsonb,text,jsonb), 8 revoke/grant, 5 comments. **Q2: all absent.** *DROP blind spot closed:* its two `drop function if exists ...(jsonb,text)` target the pair created by #1/#2, which Q2 shows never existed — so absence here is "never created", not "successfully dropped". | High |
| 4 | 20260726031000 | `_coldlion_licensor_property_phase4_null_shape_guard.sql` | **NO** | (c) | Replaces `plm.link_coldlion_licensors_properties_core(jsonb,jsonb)` + 2 revokes on it. **Q2: fn absent.** | High |
| 5 | 20260726032000 | `_coldlion_licensor_property_phase4_browser_execute_revoke.sql` | **NO** | (c) | **Revoke/grant only** — 4 revokes + 3 grants on `plm.link_..._core/_approved`, `plm./public.sync_coldlion_licensors_properties(jsonb,text,jsonb)`. **Q2: all 4 functions absent**, so every statement would raise `undefined_function`. The file cannot have been applied. | High |
| 6 | 20260726180000 | `_coldlion_licensor_property_phase6_parallel_run.sql` | **NO** | (c) | 2 tables, 7 indexes, 2 `enable row level security`, 2 policies, 2 table grants, 10 fns, ~20 revoke/grant. **Q1: `plm.taxonomy_parallel_observation` + `plm.taxonomy_sync_alert` absent; `plm_taxonomy_sync_alert_open_idx` absent. Q5: both `plm_taxonomy_*_admin_select` policies absent. Q2: all 10 fns absent.** | High |
| 7 | 20260727221500 | `_coldlion_licensor_property_readiness_and_breaker.sql` | **NO** | (c) | 2 tables, 1 index, RLS, 2 policies, grants, 13 fns, **3 triggers** on `core.taxonomy_source_ref` / `plm.erp_licensor` / `plm.erp_property`. **Q1: both breaker tables absent; all 3 triggers absent** — and Q1c proves those 3 trigger *targets* exist, so the trigger check is meaningful. **Q2: all 13 fns absent.** | High |
| 8 | 20260727223000 | `_coldlion_breaker_blocked_attempt_logging_fix.sql` | **NO** | (c) | 2 new fns (`plm./public.record_taxonomy_circuit_breaker_blocked_attempt`) + 2 trigger fns replaced + 6 revoke/grant. **Q2: all 4 fns absent.** | High |
| 9 | 20260727224500 | `_coldlion_identity_verifier_reason_cast_fix.sql` | **NO** | (c) | Single statement: replace `plm.verify_coldlion_approved_mapping_identity(jsonb,jsonb,int)`. **Q2: absent.** | High |
| 10 | 20260727230000 | `_core_style_guide_axis.sql` | **NO** | (c) | 2 tables, 6 indexes, RLS x2, 4 policies, 4 grants, 4 comments. **Q1: `core.style_guide`, `core.style_guide_character`, `style_guide_licensor_code_key` all absent. Q3-variant: 0 policies on `core.style_guide*`.** | High |
| 11 | 20260728134500 | `_coldlion_breaker_autotrip_and_gap_closure.sql` | **NO** | (c) | 7 fns + **6 triggers** (`coldlion_autotrip_on_critical_alert`, `..._on_failed_observation`, `coldlion_source_ref_delete_breaker_guard`, 2 insert guards, `coldlion_breaker_state_guard`) + 5 revoke/grant. **Q1: all 6 triggers absent. Q2: all 7 fns absent.** | High |
| 12 | 20260728171500 | `_db_data_admin_tree_plm_division_names.sql` | **NO** | (c) | One `do $$` that injects `division_name` into `api.db_data_admin_licensor_property_tree`, plus one `comment on function`. **Q3: `position('division_name' in prosrc) = 0`.** Live body md5 `c68fd2a6...` traced to ledger migration `20260727154500` (§6); no later definer exists before the head. The block also self-aborts if already applied, so a silent re-run is impossible. | High |
| 13 | 20260728174500 | `_clickup_incremental_task_import_reissue.sql` | **NO** | (c) | `alter table pim.product add clickup_list_id`, 1 comment, 1 index, a `do $backfill$`, 3 fns, 6 revoke/grant, 3 comments. **Q3: `clickup_list_id` absent** (only `clickup_task_id`, `clickup_status`, `clickup_parent_id` exist). **Q1: `pim_product_clickup_list_updated_idx` absent. Q2: `pim./public.sync_clickup_tasks`, `api.clickup_task_sync_run_list` absent.** | High |
| 14 | 20260728181500 | `_clickup_incremental_task_import_fixes.sql` | **NO** | (c) | `do $repair$` (**DML on the pre-existing `pim.product`**), `do $guard_pre$`, unique index, index comment, `do $guard_post$`, 2 fns, 4 revoke/grant. **Q1: `pim_product_clickup_task_id_uidx` absent — and `$guard_post$` raises if that index is missing, so the file cannot have completed. Q4: `ingest.sync_run` rows with `source_name='clickup_external_id_trim_repair'` = 0**, the repair block's own audit record. **Q2: both `sync_clickup_tasks` absent.** | High |
| 15 | 20260729120000 | `_lock_down_public_security_definer_execute.sql` | **NO** | **(b)** | See §6. Its `alter default privileges` end state IS on production but came from ledger migration **`20260729130000`**. Live event-trigger body md5 `735985606362e0321231dc77a5863ec4` = **`20260729180000`**'s body, not this file's (`fdbf72e7...`). Its `revoke/grant` statements target `public./pim.sync_clickup_tasks`, **absent** (Q2). | High |
| 16 | 20260729230000 | `_coldlion_licensor_property_recurring_promotion.sql` | **NO** | (c) | 2 tables, 7 indexes, RLS x2, 2 policies, 2 grants, **2 triggers**, 8 fns, ~12 revoke/grant, 8 comments. **Q1: `plm.coldlion_promotion_audit`, `plm.coldlion_promotion_quarantine`, `plm_coldlion_promotion_audit_entity_idx`, both `*_append_only_guard` triggers absent. Q5: both `plm_coldlion_promotion_*_admin_select` policies absent. Q2: all 8 fns absent.** | High |
| 17 | 20260729234500 | `_coldlion_recurring_promotion_collision_rule_fix.sql` | **NO** | (c) | Single `create or replace function plm.promote_coldlion_source_owned(jsonb,jsonb,boolean)`. **Q2: absent.** | High |
| 18 | 20260729235500 | `_coldlion_recurring_promotion_ambiguous_column_fix.sql` | **NO** | (c) | Same single function replaced. **Q2: absent.** | High |
| 19 | 20260730000500 | `_coldlion_recurring_promotion_absence_detection_fix.sql` | **NO** | (c) | Same single function replaced. **Q2: absent.** | High |
| 20 | 20260731150000 | `_popsg_property_resolution_contracts.sql` | **NO** | (c) | `core.normalize_popsg_property_observation`, `core.property_alias` (+4 indexes, RLS, policy, 3 grants, trigger `reject_redundant_property_alias`), `dam.popsg_property_resolution` (+4 indexes, RLS, policy, grants, trigger `enforce_popsg_resolution_append_only`), 5 more fns, ~10 revoke/grant. **Q1: both tables, `property_alias_licensor_norm_key`, `popsg_property_resolution_active_tuple_key`, both triggers absent. Q5: the `dam_read` policy exists only on 9 other pre-existing `dam` tables, none on `dam.popsg_property_resolution`. Q3: `public.propose_popsg_property_resolution` absent.** | High |
| 21 | 20260731153000 | `_popsg_property_alias_redundancy_trigger_fix.sql` | **NO** | (c) | Replace `core.reject_redundant_property_alias()`, 1 comment, 1 revoke. **Q2: fn absent; Q1: its trigger absent.** | High |
| 22 | 20260731163000 | `_coldlion_recurring_promotion_drop_dead_failure_recording.sql` | **NO** | (c) | Single function replaced. **Q2: `plm.promote_coldlion_source_owned` absent.** | High |
| 23 | 20260731180000 | `_coldlion_recurring_promotion_serialization_lock.sql` | **NO** | (c) | Same function + 1 comment. **Q2: absent.** | High |
| 24 | 20260731190000 | `_coldlion_promotion_crosscheck_provenance_coverage.sql` | **NO** | (c) | Same function + 1 comment. **Q2: absent.** | High |
| 25 | 20260731200000 | `_coldlion_recurring_promotion_fanin_name_tiebreak.sql` | **NO** | (c) | Same function + 1 comment. **Q2: absent.** | High |
| 26 | 20260731210000 | `_core_licensor_alias.sql` | **NO** | (c) | `core.licensor_alias` + 4 indexes (incl. `licensor_alias_trgm_idx`), trigger `reject_shadowing_licensor_alias`, RLS, policy, 4 grants, 5 comments, 4 fns, 6 revoke/grant, **3 `do $$` seeding blocks (DML)**. **Q1: table, `licensor_alias_norm_key`, `licensor_alias_trgm_idx`, trigger all absent. Q3: `public.resolve_licensor_alias` absent.** The DML blocks write only into the absent table. | High |
| 27 | 20260731220000 | `_licensor_alias_owner_approval_remaining_five.sql` | **NO** | (c) | **DML only** — one `do $$` approving five aliases in `core.licensor_alias`. **Q1: `core.licensor_alias` does not exist**, so the block would raise `undefined_table`. | High |
| 28 | 20260802140000 | `_acknowledge_taxonomy_sync_alert_rpc.sql` | **NO** | (c) | 4 fns (`plm.assert_taxonomy_alert_ack_authority`, `plm.taxonomy_alert_actor_looks_automated`, `plm./public.acknowledge_taxonomy_sync_alert`), 10 revoke/grant, 2 comments. **Q2/Q3: all 4 absent** (`public_orphan_fns = 0`). Also depends on `plm.taxonomy_sync_alert`, absent (Q1). | High |
| 29 | 20260802141000 | `_taxonomy_alert_ack_comment_correction.sql` | **NO** | (c) | **Comment-only** — 2 `comment on function ...acknowledge_taxonomy_sync_alert(uuid,jsonb)`. **Q2: neither function exists**, so both statements would raise. Cannot have been applied. | High |
| 30 | 20260802150000 | `_taxonomy_alert_actor_heuristic_word_anchors.sql` | **NO** | (c) | Replaces `plm.taxonomy_alert_actor_looks_automated` + `plm.acknowledge_taxonomy_sync_alert`, 2 comments, 4 revoke/grant. **Q2: both absent.** | High |
| 31 | 20260802160000 | `_taxonomy_alert_ack_effective_role_is_current_user.sql` | **NO** | (c) | Replaces `plm.assert_taxonomy_alert_ack_authority()`, 1 comment, 1 revoke, 1 grant. **Q2: absent.** | High |
| 32 | 20260802170000 | `_plm_import_preserve_curated_licensor_property_status.sql` | **NO** | (c) | Replaces `plm.import_master_data(jsonb,jsonb)`, 1 comment, 1 revoke, 1 grant. Function **exists** but live md5 `e7a5c85b...` (18497) = ledger migration **`20260723140000`**; this file's body is `442011f1...` (19543). **Q3: `position('CHANGED 2026-08-02 (tranche 2)' in prosrc) = 0`.** No later definer before the head (§6). | High |
| 33 | 20260802171000 | `_owner_ruling_friends_tv_frida_kahlo.sql` | **NO** | (c) | `core.taxonomy_owner_ruling` + 2 indexes, RLS, policy, 3 grants, 4 comments, and a `do $ruling$` with **2 inserts + an `update core.licensor` on a pre-existing table**. **Q1: table + `taxonomy_owner_ruling_entity_idx` absent. Q4 (the DML probe): `core.licensor` FR "FRIENDS TV" is still `status='active'`, `metadata->'owner_ruling'->>'migration'` is NULL, and `count(*) where status='inactive'` = 0.** Both target rows (FR licensor, FK property) DO exist, so the block's own guards would have passed — it simply never ran. | High |

### Why rows 1 and 2 are UNKNOWN

Their *applied* verdict is not in doubt: neither ran. The **wantedness** is genuinely
undecided. Everything `20260724060000` and `20260724061000` produce is explicitly
`drop function if exists`-ed and re-created with a different signature by
`20260726030000` (row 3). Their net contribution to the end state is nil, so a reasonable
person could call them superseded and retire them — exactly the argument that makes
`20260729120000` bucket (b). The difference is that `20260729120000`'s replacement is
**already applied to production**, while rows 1–2's replacement is itself an unapplied
orphan. **This is an owner/orchestrator call, not a measurement.** Until it is made:

- **They must NOT be recorded in the ledger** (they were never applied), and
- if the 33 are applied as a sequence, **they must be applied in order like the rest** —
  skipping them is a `--include-all`-shaped decision that nobody has approved.

## 8. What this means for the rest of plan item A

1. **No ledger back-fill is warranted. Zero rows in bucket (a).** The premise that some of
   the 33 might already be on production is now disproved; do not insert anything into
   `supabase_migrations.schema_migrations`.
2. **The 33 are a real, unapplied backlog**, not a bookkeeping artefact. Production is
   genuinely missing 33 migrations *below* the head plus the 11 above it — 44 in total.
3. **A2's allowlist must be reconsidered.** The plan sets `production_allowlist` to the 11
   pending only. Applying just those leaves 33 unapplied migrations underneath, and several
   of the 11 build on objects the 33 create. **This is a drift finding for A2/A3 and is
   flagged, not decided, here.**
4. `20260729120000` should be retired as superseded rather than queued for apply.
5. Rows 1–2 need an explicit ruling before any apply sequence is assembled.

## 9. What was NOT done

- Nothing was written to any database — no apply, no DDL, no DML, no ledger insert, no
  `--include-all`, no `--create`.
- Preview (`rjyboqwcdzcocqgmsyel`) was not queried or modified.
- `supabase/migrations/`, `AGENTS.md`, `HANDOFF.md`, `HANDOFF.d/**` and
  `plan_orchestrator-workflow-gaps.md` were not touched.
- No PR was merged.
- No decision was made about *whether* to apply anything.
