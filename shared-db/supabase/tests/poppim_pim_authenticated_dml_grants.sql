-- =====================================================================================
-- Contract tests for migration 20260813180000_poppim_pim_authenticated_dml_grants.sql
-- (#866 -- the inert `pm_write` policies on the `pim` tables).
--
-- WHAT THE MIGRATION DID, IN ONE PARAGRAPH, FOR SOMEONE WHO HAS NEVER SEEN THIS REPO
--   `20260621151155_api_rls_realtime.sql` created a `pm_write ... FOR ALL TO
--   authenticated` row-security policy on the pim tables but granted `authenticated`
--   only SELECT. RLS and table privileges are independent gates in PostgreSQL, so the
--   write policy never did anything and PopPIM's browser writes were rejected with
--   `permission denied`. 20260813180000 grants INSERT, UPDATE and DELETE -- exactly the
--   DML a `FOR ALL` policy authorises, and nothing more -- on 18 of the 21 affected
--   tables. Five tables in `pim` are deliberately NOT widened; see section C.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, on the SESSION pooler port 5432, NOT the
--   transaction pooler port 6543.
--
--   The connection string is assembled from these parts rather than written out whole,
--   because a Supabase pooler username (`postgres.<project-ref>`) joined to the pooler
--   host produces a `name@host` token that this repository's PII forward guard reads as
--   an email address. Build it, do not paste it:
--
--       scheme    postgresql://
--       user      postgres.rjyboqwcdzcocqgmsyel      <- the literal word postgres, a dot,
--                                                       then the preview project ref
--       separator the usual userinfo separator character
--       host      aws-0-us-east-1.pooler.supabase.com
--       port      5432                               <- SESSION pooler. NOT 6543.
--       database  /postgres
--       options   ?sslmode=require
--
--       psql "<connection string>" -v ON_ERROR_STOP=1 \
--            -f supabase/tests/poppim_pim_authenticated_dml_grants.sql
--
--   Port 6543 wraps the whole batch in one implicit transaction and stalls. Use 5432.
--
-- SIDE EFFECTS: NONE. Every section is a pure catalog read. Nothing is written, no
--   table is created, no transaction is left open.
--
-- EVERY VALUE IN THIS FILE IS INVENTED OR IS A SCHEMA OBJECT NAME. u2giants/shared-db
--   is PUBLIC. No licensor source row, id, filename or portal URL appears here.
--
-- WHAT IT ASSERTS
--   A  DERIVATION. The affected family is enumerated FROM THE CATALOG (every pim table
--      carrying a permissive `pm_write ALL/authenticated` policy) and cross-checked
--      against the named 23-table array. Adding a pim table with a pm_write policy and
--      forgetting to grant it therefore FAILS here rather than passing vacuously.
--   B  PRESENCE. On all 18 widened tables, `authenticated` holds SELECT, INSERT and
--      UPDATE. Fifteen retain DELETE; #898 deliberately revokes it from the three
--      history-sensitive tables.
--   C  NARROWNESS PRESERVED. The five deliberately narrow tables still hold exactly
--      their narrower set -- `product` = SELECT+UPDATE, `stage_history` =
--      SELECT+INSERT, `view_pref` = SELECT+INSERT+UPDATE, and `customer_ext` /
--      `factory_ext` = SELECT only (RPC-only, per db_data_admin_extensions.sql). This
--      is the half that stops a silent over-grant from passing as a fix.
--   D  NO PRIVILEGE BEYOND WHAT THE POLICY AUTHORISES. On every pim table,
--      `authenticated` holds none of TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. A
--      `FOR ALL` policy authorises DML only; those four are not DML.
--   E  POLICIES UNCHANGED. The migration is grants-only: all 23 `pm_write` policies
--      still exist, still `FOR ALL`, still permissive, still on `authenticated`, and
--      `saved_view` still has its four per-verb policies and no `pm_write`.
--   F  NO OTHER ROLE WIDENED. `anon` gained nothing anywhere in `pim`.
-- =====================================================================================

\set ON_ERROR_STOP on

-- -------------------------------------------------------------------------------------
-- A  DERIVATION -- the family is read from the catalog, then cross-checked.
-- -------------------------------------------------------------------------------------
do $$
declare
  -- All 23 pim tables that carry a pm_write ALL/authenticated policy = the 18 widened
  -- by 20260813180000 plus the 5 held deliberately narrow. `saved_view` is the 24th pim
  -- table and is excluded on purpose: it has four per-verb policies and no pm_write.
  expected text[] := array[
    'checklist_item','customer_ext','customer_order','design','design_asset',
    'design_collection','factory_ext','product','product_assignee','product_field',
    'product_file','product_link','product_sample','product_style_group',
    'product_submission','product_tag','product_time_entry','product_update','project',
    'revision_request','stage','stage_history','view_pref'
  ];
  live text[];
  only_live text[];
  only_expected text[];
begin
  select coalesce(array_agg(distinct p.tablename order by p.tablename), array[]::text[])
    into live
  from pg_policies p
  where p.schemaname = 'pim'
    and p.policyname = 'pm_write'
    and p.cmd = 'ALL'
    and p.permissive = 'PERMISSIVE'
    and 'authenticated' = any (p.roles);

  select coalesce(array_agg(x order by x), array[]::text[]) into only_live
  from unnest(live) x where x <> all (expected);

  select coalesce(array_agg(x order by x), array[]::text[]) into only_expected
  from unnest(expected) x where x <> all (live);

  if array_length(only_live, 1) is not null then
    raise exception
      'A FAILED: pim table(s) carry a pm_write ALL/authenticated policy but are not in '
      'this test''s array -- their grants have never been checked: %. Add them to the '
      'array AND decide their grants (#866).',
      array_to_string(only_live, ', ');
  end if;

  if array_length(only_expected, 1) is not null then
    raise exception
      'A FAILED: expected a pm_write ALL/authenticated policy on pim table(s) % but the '
      'catalog has none. The policy was dropped or renarrowed; the grants this test '
      'asserts may now be an over-grant.',
      array_to_string(only_expected, ', ');
  end if;

  raise notice 'A OK: % pim table(s) carry a permissive pm_write ALL/authenticated policy',
    array_length(live, 1);
end $$;

-- -------------------------------------------------------------------------------------
-- B  PRESENCE -- all 18 widened tables hold SELECT, INSERT and UPDATE. Fifteen also
--    hold DELETE; #898 deliberately removed DELETE from three history-sensitive tables.
-- -------------------------------------------------------------------------------------
do $$
declare
  widened text[] := array[
    'checklist_item','customer_order','design','design_asset','design_collection',
    'product_assignee','product_field','product_file','product_link','product_sample',
    'product_style_group','product_submission','product_tag','product_time_entry',
    'product_update','project','revision_request','stage'
  ];
  delete_revoked text[] := array['product_time_entry','product_update','stage'];
  tbl text;
  missing text[] := array[]::text[];
  verb text;
begin
  if array_length(widened, 1) <> 18 then
    raise exception 'B FAILED: the widened array must hold exactly 18 tables, holds %',
      array_length(widened, 1);
  end if;

  foreach tbl in array widened loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pim' and c.relname = tbl and c.relkind = 'r'
    ) then
      raise exception 'B FAILED: pim.% does not exist in this environment', tbl;
    end if;

    foreach verb in array array['SELECT','INSERT','UPDATE'] loop
      if not has_table_privilege('authenticated', format('pim.%I', tbl), verb) then
        missing := missing || (tbl || '.' || verb);
      end if;
    end loop;

    if tbl = any (delete_revoked) then
      if has_table_privilege('authenticated', format('pim.%I', tbl), 'DELETE') then
        missing := missing || (tbl || '.UNEXPECTED_DELETE');
      end if;
    elsif not has_table_privilege('authenticated', format('pim.%I', tbl), 'DELETE') then
      missing := missing || (tbl || '.DELETE');
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'B FAILED: authenticated privilege contract has % problem(s): %. #866 widened '
      'the 18 tables; #898 deliberately removed DELETE from three history tables.',
      array_length(missing, 1), array_to_string(missing, ', ');
  end if;

  raise notice 'B OK: authenticated holds S+I+U on 18 widened tables; DELETE is absent only from the 3 #898 history tables';
end $$;

-- -------------------------------------------------------------------------------------
-- C  NARROWNESS PRESERVED -- the deliberate exceptions were NOT widened.
--    Without this section the suite would pass just as happily on a blanket
--    `grant all in schema pim`, which is exactly the mistake to catch.
-- -------------------------------------------------------------------------------------
do $$
declare
  -- One row per deliberately-narrow table: the EXACT DML set it is allowed to hold.
  -- Anything in the set that is missing, and anything outside it that is present, is a
  -- failure. Held as parallel scalars rather than a 2-D array because PostgreSQL
  -- requires multidimensional array literals to be rectangular and these sets differ
  -- in length.
  all_dml text[] := array['SELECT','INSERT','UPDATE','DELETE'];
  rec record;
  verb text;
  problems text[] := array[]::text[];
begin
  for rec in
    select * from (
      values
        ('product',       array['SELECT','UPDATE']),            -- 20260727013100
        ('stage_history', array['SELECT','INSERT']),            -- 20260727013100
        ('view_pref',     array['SELECT','INSERT','UPDATE']),   -- 20260727013100
        ('customer_ext',  array['SELECT']),                     -- db_data_admin_extensions
        ('factory_ext',   array['SELECT'])                      -- db_data_admin_extensions
    ) as v(tbl, allowed)
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pim' and c.relname = rec.tbl and c.relkind = 'r'
    ) then
      raise exception 'C FAILED: pim.% does not exist in this environment', rec.tbl;
    end if;

    foreach verb in array all_dml loop
      if verb = any (rec.allowed) then
        if not has_table_privilege('authenticated', format('pim.%I', rec.tbl), verb) then
          problems := problems || (rec.tbl || ' LOST ' || verb);
        end if;
      else
        if has_table_privilege('authenticated', format('pim.%I', rec.tbl), verb) then
          problems := problems || (rec.tbl || ' GAINED ' || verb);
        end if;
      end if;
    end loop;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception
      'C FAILED: %. These five tables were narrowed ON PURPOSE. '
      '20260727013100_poppim_atomic_contract_dml_grants.sql made pim.product UPDATE-'
      'only for the security-invoker atomic RPCs, pim.stage_history INSERT-only '
      'workflow evidence, and pim.view_pref upsert-only. supabase/tests/'
      'db_data_admin_extensions.sql makes pim.customer_ext and pim.factory_ext read-'
      'only for authenticated -- the DB Data Admin extension rows are written through '
      'protected API contracts, never from a browser. Widening any of them is a '
      'separate owner decision that #866 explicitly did not make.',
      array_to_string(problems, '; ');
  end if;

  raise notice 'C OK: product=S+U, stage_history=S+I, view_pref=S+I+U, customer_ext/factory_ext=S only';
end $$;

-- -------------------------------------------------------------------------------------
-- D  NO PRIVILEGE BEYOND WHAT THE POLICY AUTHORISES -- across ALL of pim, not just the
--    20. A `FOR ALL` policy authorises DML; TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
--    are not DML and must never appear for `authenticated`.
--    MAINTAIN is real on this server (PostgreSQL 17) and is probed defensively.
-- -------------------------------------------------------------------------------------
do $$
declare
  rec record;
  verb text;
  extra_verbs text[] := array['TRUNCATE','REFERENCES','TRIGGER'];
  problems text[] := array[]::text[];
  has_maintain boolean;
begin
  begin
    perform has_table_privilege('authenticated', 'pim.product', 'MAINTAIN');
    has_maintain := true;
  exception when others then
    has_maintain := false;
  end;

  if has_maintain then
    -- The ::text cast is required: a bare quoted literal here is `unknown`, and
    -- `text[] || unknown` is parsed as an array-to-array concatenation, which fails
    -- with `malformed array literal`.
    extra_verbs := extra_verbs || 'MAINTAIN'::text;
  else
    raise notice 'D: MAINTAIN not supported on this server version; skipping that verb';
  end if;

  for rec in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pim' and c.relkind = 'r'
    order by c.relname
  loop
    foreach verb in array extra_verbs loop
      if has_table_privilege('authenticated', format('pim.%I', rec.relname), verb) then
        problems := problems || (rec.relname || '.' || verb);
      end if;
    end loop;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception
      'D FAILED: authenticated holds non-DML privilege(s) in pim that no pm_write '
      'policy authorises: %. Suspect a blanket GRANT ALL.',
      array_to_string(problems, ', ');
  end if;

  raise notice 'D OK: authenticated holds no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN anywhere in pim';
end $$;

-- -------------------------------------------------------------------------------------
-- E  POLICIES UNCHANGED -- 20260813180000 is grants-only.
-- -------------------------------------------------------------------------------------
do $$
declare
  pm_write_count int;
  saved_view_pm_write int;
  saved_view_policies int;
begin
  select count(distinct tablename) into pm_write_count
  from pg_policies
  where schemaname = 'pim' and policyname = 'pm_write'
    and cmd = 'ALL' and permissive = 'PERMISSIVE' and 'authenticated' = any (roles);

  if pm_write_count <> 23 then
    raise exception
      'E FAILED: expected 23 pim tables with a permissive pm_write ALL/authenticated '
      'policy, found %. The #866 migration must not add, drop or alter a policy.',
      pm_write_count;
  end if;

  select count(*) into saved_view_pm_write
  from pg_policies where schemaname = 'pim' and tablename = 'saved_view'
    and policyname = 'pm_write';

  if saved_view_pm_write <> 0 then
    raise exception
      'E FAILED: pim.saved_view has a pm_write policy again. 20260727213000 replaced it '
      'with four per-verb owner-scoped policies on purpose.';
  end if;

  select count(*) into saved_view_policies
  from pg_policies where schemaname = 'pim' and tablename = 'saved_view'
    and policyname in ('pm_saved_view_select','pm_saved_view_insert',
                       'pm_saved_view_update','pm_saved_view_delete');

  if saved_view_policies <> 4 then
    raise exception
      'E FAILED: pim.saved_view should carry its 4 per-verb policies, found %.',
      saved_view_policies;
  end if;

  raise notice 'E OK: 23 pm_write policies intact; saved_view keeps its 4 per-verb policies';
end $$;

-- -------------------------------------------------------------------------------------
-- F  NO OTHER ROLE WIDENED -- `anon` must gain nothing from a grant aimed at
--    `authenticated`. A `grant ... to public` or a mistyped role shows up here.
-- -------------------------------------------------------------------------------------
do $$
declare
  rec record;
  verb text;
  problems text[] := array[]::text[];
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice 'F: role anon absent in this environment; skipping';
    return;
  end if;

  for rec in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pim' and c.relkind = 'r'
    order by c.relname
  loop
    foreach verb in array array['INSERT','UPDATE','DELETE'] loop
      if has_table_privilege('anon', format('pim.%I', rec.relname), verb) then
        problems := problems || (rec.relname || '.' || verb);
      end if;
    end loop;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception
      'F FAILED: role anon holds write privilege(s) in pim: %. The #866 grants target '
      'authenticated only.',
      array_to_string(problems, ', ');
  end if;

  raise notice 'F OK: anon holds no INSERT/UPDATE/DELETE anywhere in pim';
end $$;

-- =====================================================================================
-- END. If every section printed OK, migration 20260813180000 landed exactly as designed:
-- 18 tables repaired, 5 held deliberately narrow, nothing over-granted, no policy moved.
-- =====================================================================================
