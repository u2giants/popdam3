-- =====================================================================================
-- #866 -- the `pm_write` RLS policies on the `pim` tables have been INERT since
-- 2026-06-21. This migration grants the table privileges those policies already
-- authorise, so PopPIM's browser writes stop failing at the privilege gate.
--
-- WHAT DEFECT THIS CORRECTS
--   `supabase/migrations/20260621151155_api_rls_realtime.sql` did two things that do
--   not add up:
--     * line 349  created, on every pim table in its array, a policy
--                 `pm_write ... FOR ALL TO authenticated`
--                 USING/WITH CHECK (administrator OR licensing/designer/sales).
--     * line 471  granted `select on all tables in schema pim to authenticated` --
--                 and nothing else.
--   In PostgreSQL, row-level security and table privileges are INDEPENDENT gates. A
--   role must pass BOTH. `authenticated` passes the policy and then fails the GRANT,
--   so every write is rejected with `permission denied for table ...`. The policy has
--   never done anything.
--
--   Verified live against the production catalog on 2026-08-13 with
--   `has_table_privilege('authenticated', ...)` joined to `pg_policies`: 21 of the 24
--   tables in `pim` carry a `pm_write ALL/authenticated` policy and lack INSERT.
--
--   PopPIM (`u2giants/poppim-web`) writes as a browser `authenticated` user -- a single
--   supabase-js client built from the anon key plus Azure OAuth, no service_role key
--   and no server-side proxy -- through direct PostgREST table calls. Eleven call sites
--   are broken today:
--     src/features/board/collab.ts    checklist_item   insert/update/delete/insert
--                                     product_assignee insert/delete
--     src/features/workflow/api.ts    product_submission insert/update
--                                     product_sample     insert/update
--                                     revision_request   insert/update
--
-- OWNER DECISION THIS IMPLEMENTS
--   The owner ruled on 2026-08-13: fix ALL of the mismatched tables, not just the
--   subset PopPIM writes today. Rationale: the policy author's intent in
--   20260621151155 was plainly "PM roles may write these tables"; leaving 12 of them
--   half-wired keeps the same latent bug waiting for the next consumer.
--
--   "ALL" means all the ones where the `pm_write` policy is the LAST word. Three of the
--   21 are governed by a LATER, deliberate, narrower decision, and reversing one of
--   those silently is not what "fix all 21" asked for. Those three are named below and
--   raised in the pull request as distinct owner sub-decisions. 18 are repaired here.
--
-- WHY THIS IS NOT `grant all`
--   This repo has twice set a deliberate verb-surgical precedent
--   (20260727013100_poppim_atomic_contract_dml_grants.sql and
--   20260727213000_poppim_saved_view_crud_grants.sql). Those headers say it directly:
--   "RLS policies already restrict PM writes ... PostgreSQL table privileges are an
--   independent gate: grant only the DML required". So:
--     * The verbs granted here are exactly INSERT, UPDATE, DELETE -- the DML that a
--       `FOR ALL` policy authorises -- and nothing more. No TRUNCATE, no REFERENCES,
--       no TRIGGER, no MAINTAIN. SELECT is already held and is not re-granted.
--     * Nothing here touches a policy. The row-level restriction (administrator or
--       licensing/designer/sales) is unchanged and remains the real gate.
--
-- THE FIVE TABLES THIS MIGRATION DELIBERATELY DOES NOT TOUCH
--   0. `pim.customer_ext` and `pim.factory_ext` -- BOTH IN THE 21, BOTH RPC-ONLY BY AN
--      EXPLICIT LATER CONTRACT. `supabase/tests/db_data_admin_extensions.sql` asserts,
--      for `crm.customer_ext`, `crm.factory_ext`, `pim.customer_ext`, `pim.factory_ext`
--      and `dam.factory_ext`, that `authenticated` can SELECT but holds NO direct
--      INSERT/UPDATE/DELETE -- the DB Data Admin extension rows are written through
--      protected API contracts, not from a browser. That test FAILED when an earlier
--      revision of this migration included them, which is exactly what it is for.
--      They pick up the `pm_write` policy because they live in `pim`, but the policy
--      is not the governing decision for them. Left alone.
--   1. `pim.product` -- IN the 21, and DELIBERATELY LEFT NARROW.
--      It holds UPDATE but not INSERT or DELETE, granted knowingly by
--      20260727013100 for the security-invoker atomic RPCs. Widening it to
--      INSERT/DELETE would silently reverse a later, deliberate decision, so this
--      migration does not. PopPIM only UPDATEs `pim.product` (collab.ts:305,
--      api.ts read paths), so nothing is broken by leaving it as is. Whether
--      product creation and deletion should be possible from a browser session is a
--      DISTINCT OWNER SUB-DECISION, raised in the pull request for #866 and NOT
--      settled here.
--   2. `pim.stage_history` -- INSERT only, from 20260727013100. This is workflow
--      evidence: rows record that a stage transition happened. UPDATE/DELETE were
--      withheld on purpose and stay withheld.
--   3. `pim.view_pref` -- INSERT + UPDATE, no DELETE, from 20260727013100. A
--      preference row is upserted, never deleted. Stays as is.
--   `pim.saved_view` already holds full CRUD under its own four per-verb policies
--   (20260727213000) and carries no `pm_write` policy, so it is out of scope entirely.
--
-- APPEND-ONLY CHECK BEFORE GRANTING DELETE
--   Checked before writing this file: no table in `pim` carries an append-only or
--   immutability trigger (the only non-internal triggers in the schema are
--   `set_updated_at`), and no table comment or prior migration header in this repo
--   declares any pim table append-only. The four append-only evidence tables named by
--   20260812020000 are in `core`/`plm`, not `pim`. DELETE is therefore safe to grant
--   on the 20 tables below. If a pim table is ever made append-only, revoke its DELETE
--   in the same migration that adds the trigger.
--
-- IDEMPOTENT / SAFE TO RE-RUN: `grant` is idempotent. The loop skips a table that is
--   absent rather than failing, and raises a NOTICE naming it, so a partially
--   provisioned environment cannot make this migration lie.
--
-- NOT APPLIED BY THIS PULL REQUEST. Applying to preview or production is a separate,
--   owner-gated step.
--
-- Contract tests: supabase/tests/poppim_pim_authenticated_dml_grants.sql
-- =====================================================================================

do $$
declare
  -- The 18 tables that carry an inert `pm_write ALL/authenticated` policy AND are
  -- not subject to a later, deliberate narrowing. This is the live-derived set of 21
  -- minus `pim.product`, `pim.customer_ext` and `pim.factory_ext` (see header).
  target_tables text[] := array[
    'checklist_item',
    'customer_order',
    'design',
    'design_asset',
    'design_collection',
    'product_assignee',
    'product_field',
    'product_file',
    'product_link',
    'product_sample',
    'product_style_group',
    'product_submission',
    'product_tag',
    'product_time_entry',
    'product_update',
    'project',
    'revision_request',
    'stage'
  ];
  tbl text;
  granted_count int := 0;
  missing_tables text[] := array[]::text[];
  no_policy_tables text[] := array[]::text[];
begin
  foreach tbl in array target_tables loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pim' and c.relname = tbl and c.relkind = 'r'
    ) then
      missing_tables := missing_tables || tbl;
      continue;
    end if;

    -- Refuse to widen a table whose write policy is not what this migration believes.
    -- A grant is only justified by an existing permissive `pm_write FOR ALL` policy;
    -- if that policy was dropped or renarrowed since 2026-06-21, granting DML here
    -- would be an over-grant rather than a repair. Record it and skip.
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'pim'
        and p.tablename = tbl
        and p.policyname = 'pm_write'
        and p.cmd = 'ALL'
        and p.permissive = 'PERMISSIVE'
        and 'authenticated' = any (p.roles)
    ) then
      no_policy_tables := no_policy_tables || tbl;
      continue;
    end if;

    execute format('grant insert, update, delete on pim.%I to authenticated', tbl);
    granted_count := granted_count + 1;
  end loop;

  if array_length(missing_tables, 1) is not null then
    raise notice
      'pim DML grants: % table(s) absent in this environment and SKIPPED: %',
      array_length(missing_tables, 1), array_to_string(missing_tables, ', ');
  end if;

  if array_length(no_policy_tables, 1) is not null then
    raise warning
      'pim DML grants: % table(s) SKIPPED because they no longer carry a permissive '
      'pm_write ALL/authenticated policy: %. A grant without that policy would be an '
      'over-grant. Investigate before re-running.',
      array_length(no_policy_tables, 1), array_to_string(no_policy_tables, ', ');
  end if;

  raise notice 'pim DML grants: insert, update, delete granted to authenticated on % table(s)',
    granted_count;
end $$;

-- Post-condition. This migration must not be able to report success while leaving the
-- defect in place, and must not be able to silently widen a table it promised to leave
-- narrow. Both directions are asserted here, on the live catalog, in the same
-- transaction as the grants.
do $$
declare
  widened text[] := array[
    'checklist_item','customer_order','design','design_asset','design_collection',
    'product_assignee','product_field','product_file','product_link','product_sample',
    'product_style_group','product_submission','product_tag','product_time_entry',
    'product_update','project','revision_request','stage'
  ];
  tbl text;
  bad text[] := array[]::text[];
begin
  foreach tbl in array widened loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pim' and c.relname = tbl and c.relkind = 'r'
    ) then
      continue;
    end if;
    if not (
      has_table_privilege('authenticated', format('pim.%I', tbl), 'SELECT')
      and has_table_privilege('authenticated', format('pim.%I', tbl), 'INSERT')
      and has_table_privilege('authenticated', format('pim.%I', tbl), 'UPDATE')
      and has_table_privilege('authenticated', format('pim.%I', tbl), 'DELETE')
    ) then
      bad := bad || tbl;
    end if;
    -- Nothing beyond DML may have been picked up.
    if has_table_privilege('authenticated', format('pim.%I', tbl), 'TRUNCATE')
      or has_table_privilege('authenticated', format('pim.%I', tbl), 'REFERENCES')
      or has_table_privilege('authenticated', format('pim.%I', tbl), 'TRIGGER')
    then
      bad := bad || (tbl || ' (over-granted beyond DML)');
    end if;
  end loop;

  if array_length(bad, 1) is not null then
    raise exception
      'pim DML grants POST-CONDITION FAILED on: %',
      array_to_string(bad, ', ');
  end if;

  -- The three deliberately narrow tables must be untouched by this migration.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'pim' and c.relname = 'product' and c.relkind = 'r')
     and (has_table_privilege('authenticated', 'pim.product', 'INSERT')
          or has_table_privilege('authenticated', 'pim.product', 'DELETE')) then
    raise exception
      'pim.product gained INSERT or DELETE. 20260727013100 granted UPDATE only, on '
      'purpose; widening it is an unmade owner decision (#866).';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'pim' and c.relname = 'stage_history' and c.relkind = 'r')
     and (has_table_privilege('authenticated', 'pim.stage_history', 'UPDATE')
          or has_table_privilege('authenticated', 'pim.stage_history', 'DELETE')) then
    raise exception
      'pim.stage_history gained UPDATE or DELETE. It is INSERT-only workflow evidence '
      'by the deliberate decision in 20260727013100.';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'pim' and c.relname = 'view_pref' and c.relkind = 'r')
     and has_table_privilege('authenticated', 'pim.view_pref', 'DELETE') then
    raise exception
      'pim.view_pref gained DELETE. 20260727013100 granted INSERT + UPDATE only.';
  end if;

  -- The two DB Data Admin extension tables are RPC-only for authenticated.
  foreach tbl in array array['customer_ext','factory_ext'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'pim' and c.relname = tbl and c.relkind = 'r')
       and (has_table_privilege('authenticated', format('pim.%I', tbl), 'INSERT')
            or has_table_privilege('authenticated', format('pim.%I', tbl), 'UPDATE')
            or has_table_privilege('authenticated', format('pim.%I', tbl), 'DELETE')) then
      raise exception
        'pim.% gained direct DML. The DB Data Admin extension tables are written '
        'through protected API contracts only; supabase/tests/db_data_admin_extensions.sql '
        'asserts authenticated holds SELECT and nothing else on them.', tbl;
    end if;
  end loop;

  raise notice 'pim DML grants: post-condition OK (18 widened, 5 held narrow)';
end $$;
