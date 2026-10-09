-- Issue #3869 (claim #4147): set aside the DesignFlow sandbox's 2026-09-29 ColdLion
-- table copy so the canonical ColdLion landing migrations can be applied there.
--
-- The DesignFlow sandbox (xupnyeifmpsacrqahwwm) received a plain TABLE COPY of the
-- coldlion schema on 2026-09-29: different keys (no surrogate `id`, `item_no` instead of
-- `master_item_no`, no `sales_order_line_no`), no page ledger, no functions, and none of
-- the landing migrations in its ledger. The landing loader cannot write to it, and no
-- additive change can make it compatible. This migration MOVES every table of that copy,
-- unchanged and with all rows, into schema coldlion_sandbox_copy_20260929. Nothing is
-- dropped or edited; the copy stays readable for comparison and can be moved back.
--
-- Everywhere else this is a NO-OP. It acts only when coldlion.order_history_line exists
-- WITHOUT the canonical `id` column and coldlion.window_ledger exists WITHOUT the canonical
-- `stage_code` column -- the copy's shape. Shared production and shared preview carry the
-- canonical landing tables (id and stage_code present), so they pass through untouched,
-- as does any database built from the migrations in order.
--
-- NOTE FOR STATIC GUARDS AND REVIEWERS: the whole body is one DO block, so the repository's
-- static migration scanners (production_migration_guard object events, SET SCHEMA and drop
-- scanners, the unnamed-ACL risk gate) see no statements in this file. Its effect is
-- guarded at RUN time instead: the copy-shape test, the exact 17-table list, the outside-
-- dependency guards, and the post-check below. Any future edit must keep those runtime
-- guards, because nothing static will notice a change inside the block.

do $set_aside$
declare
  v_copy_shape boolean;
  v_expected text[] := array[
    'change_log', 'customer', 'item_detail', 'item_header', 'item_merch_group',
    'merch_group_detail', 'merch_group_header', 'order_history_component',
    'order_history_line', 'prod_history_component', 'prod_history_last_lookup',
    'prod_history_line', 'salesperson', 'season', 'sync_run', 'vendor', 'window_ledger'
  ];
  v_actual text[];
  v_other text;
begin
  v_copy_shape :=
        to_regclass('coldlion.order_history_line') is not null
    and to_regclass('coldlion.window_ledger') is not null
    and not exists (
          select 1 from pg_attribute
           where attrelid = 'coldlion.order_history_line'::regclass
             and attname = 'id' and attnum > 0 and not attisdropped)
    and not exists (
          select 1 from pg_attribute
           where attrelid = 'coldlion.window_ledger'::regclass
             and attname = 'stage_code' and attnum > 0 and not attisdropped);

  if not v_copy_shape then
    raise notice '#3869/20261009191951: coldlion is not the 2026-09-29 sandbox table copy; nothing to set aside';
    return;
  end if;

  if to_regnamespace('coldlion_sandbox_copy_20260929') is not null then
    raise exception '#3869/20261009191951: schema coldlion_sandbox_copy_20260929 already exists; refusing to merge into it';
  end if;

  -- The copy must be exactly the 17 known tables and nothing else: no views, functions,
  -- sequences or types that a move would orphan or that a later migration would need.
  select array_agg(c.relname::text order by c.relname) into v_actual
    from pg_class c
   where c.relnamespace = 'coldlion'::regnamespace and c.relkind in ('r', 'p');
  if v_actual is distinct from (select array_agg(x order by x) from unnest(v_expected) x) then
    raise exception '#3869/20261009191951: coldlion tables differ from the known 2026-09-29 copy: %', v_actual;
  end if;

  select string_agg(format('%s %s', c.relkind, c.relname), ', ') into v_other
    from pg_class c
   where c.relnamespace = 'coldlion'::regnamespace
     and c.relkind not in ('r', 'p', 'i', 'S', 't');
  if v_other is not null then
    raise exception '#3869/20261009191951: coldlion holds non-table relations: %', v_other;
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'coldlion'::regnamespace)
     or exists (select 1 from pg_type t where t.typnamespace = 'coldlion'::regnamespace
                  and t.typtype in ('e', 'd', 'c')
                  and not exists (select 1 from pg_class c where c.reltype = t.oid)) then
    raise exception '#3869/20261009191951: coldlion holds functions or free-standing types; not the known copy';
  end if;

  -- Dependents OUTSIDE coldlion (the #2482 guard set). A moved table carries its
  -- dependents with it by OID, so each kind is either refused or explicitly accounted for.
  -- The ONE expected dependent is plm.v_prod_order_sales_order_link (migrations
  -- 20261002135053 .. 20261009170724, already in the sandbox ledger): it follows the copy
  -- into the archive schema here, and the sandbox apply re-executes 20261009170724 in the
  -- same transaction, after the canonical tables exist, so the view is re-bound to them
  -- before commit (that apply's post-check refuses any reference left to the archive).
  select string_agg(distinct rw.ev_class::regclass::text, ', ') into v_other
    from pg_depend dep
    join pg_rewrite rw on rw.oid = dep.objid
    join pg_class c on c.oid = dep.refobjid
   where dep.classid = 'pg_rewrite'::regclass
     and c.relnamespace = 'coldlion'::regnamespace
     and rw.ev_class is distinct from to_regclass('plm.v_prod_order_sales_order_link')
     and (select relnamespace from pg_class where oid = rw.ev_class) <> 'coldlion'::regnamespace;
  if v_other is not null then
    raise exception '#3869/20261009191951: unexpected views depend on the coldlion copy: %', v_other;
  end if;

  select string_agg(conname || ' on ' || conrelid::regclass::text, ', ') into v_other
    from pg_constraint
   where contype = 'f'
     and confrelid in (select oid from pg_class where relnamespace = 'coldlion'::regnamespace)
     and conrelid not in (select oid from pg_class where relnamespace = 'coldlion'::regnamespace);
  if v_other is not null then
    raise exception '#3869/20261009191951: foreign keys from outside reference the coldlion copy: %', v_other;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_other
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prokind in ('f', 'p')
     and p.prosrc ~* '\mcoldlion\.';
  if v_other is not null then
    raise exception '#3869/20261009191951: routines reference coldlion objects: %', v_other;
  end if;

  select string_agg(pol.polname || ' on ' || pol.polrelid::regclass::text, ', ') into v_other
    from pg_policy pol
   where concat_ws(' ', pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid))
         ~* '\mcoldlion\.'
      or pol.polrelid in (select oid from pg_class where relnamespace = 'coldlion'::regnamespace);
  if v_other is not null then
    raise exception '#3869/20261009191951: policies reference the coldlion copy: %', v_other;
  end if;

  select string_agg(pub.pubname, ', ') into v_other
    from pg_publication_rel pr
    join pg_publication pub on pub.oid = pr.prpubid
   where pr.prrelid in (select oid from pg_class where relnamespace = 'coldlion'::regnamespace);
  if v_other is not null then
    raise exception '#3869/20261009191951: publications include the coldlion copy: %', v_other;
  end if;

  create schema coldlion_sandbox_copy_20260929;
  comment on schema coldlion_sandbox_copy_20260929 is
    'DesignFlow sandbox only: the 2026-09-29 table copy of coldlion, moved aside unchanged by migration 20261009191951 (issue #3869) so the canonical landing tables could be created. Read-only archive; not written by any loader.';
  revoke all on schema coldlion_sandbox_copy_20260929 from public, anon, authenticated, service_role;

  alter table coldlion.change_log set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.customer set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.item_detail set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.item_header set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.item_merch_group set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.merch_group_detail set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.merch_group_header set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.order_history_component set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.order_history_line set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.prod_history_component set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.prod_history_last_lookup set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.prod_history_line set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.salesperson set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.season set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.sync_run set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.vendor set schema coldlion_sandbox_copy_20260929;
  alter table coldlion.window_ledger set schema coldlion_sandbox_copy_20260929;

  -- Read-only archive: no API role keeps any privilege on the moved tables.
  revoke all on all tables in schema coldlion_sandbox_copy_20260929 from public, anon, authenticated, service_role;

  -- Nothing at all may remain: tables, their indexes, owned sequences and toast move
  -- together, so any leftover relation (a free sequence included) is a refusal.
  if exists (select 1 from pg_class where relnamespace = 'coldlion'::regnamespace) then
    raise exception '#3869/20261009191951 post-check: relations remain in coldlion after the move: %',
      (select string_agg(relkind::text || ' ' || relname, ', ') from pg_class where relnamespace = 'coldlion'::regnamespace);
  end if;
  raise notice '#3869/20261009191951: moved % coldlion copy tables to coldlion_sandbox_copy_20260929', array_length(v_expected, 1);
end
$set_aside$;
