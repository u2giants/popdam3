-- Rolled-back structural contracts for issue #2176 unit 6 (consumer-safe promotion
-- contracts). Gate: plan_coldlion_landing_schema_completion.md section 9 Step 8 -
-- application roles cannot query coldlion.*; authorized consumers read reviewed fields
-- only through the plm/pim contract views and functions named in the claim.
begin;

do $$
declare
  v_count integer;
  v_role  text;
  v_priv  text;
  v_view  text;
begin
  -- 1. Every claimed contract object exists.
  if to_regclass('plm.erp_season') is null then
    raise exception 'missing plm.erp_season';
  end if;
  if to_regclass('plm.erp_salesperson') is null then
    raise exception 'missing plm.erp_salesperson';
  end if;
  if to_regprocedure('plm.import_coldlion_seasons()') is null then
    raise exception 'missing plm.import_coldlion_seasons';
  end if;
  if to_regprocedure('plm.import_coldlion_salespersons()') is null then
    raise exception 'missing plm.import_coldlion_salespersons';
  end if;
  if to_regprocedure('plm.coldlion_merch_group_candidates(text,text)') is null then
    raise exception 'missing plm.coldlion_merch_group_candidates';
  end if;
  if to_regclass('plm.import_coldlion_vendors') is not null
     or to_regprocedure('plm.import_coldlion_vendors(jsonb)') is not null then
    raise exception 'plm.import_coldlion_vendors must not exist (dropped by 20260722213000)';
  end if;

  foreach v_view in array array[
    'plm.coldlion_item_header',
    'plm.coldlion_item_detail',
    'plm.coldlion_item_merch_group',
    'plm.coldlion_prod_history',
    'plm.coldlion_prepack_detail',
    'plm.coldlion_prod_detail',
    'plm.coldlion_sales_history',
    'pim.coldlion_item_image_metadata'
  ] loop
    if to_regclass(v_view) is null then
      raise exception 'missing consumer contract view %', v_view;
    end if;
  end loop;

  -- 2. Season / salesperson natural keys.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.erp_season'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, division_code, season_code)'
  ) then
    raise exception 'plm.erp_season grain is not (company_code, division_code, season_code)';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.erp_salesperson'::regclass and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (company_code, salesperson_code)'
  ) then
    raise exception 'plm.erp_salesperson grain is not (company_code, salesperson_code)';
  end if;

  -- 3. Sales history must not claim a source-document type or expose document tokens.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'plm.coldlion_sales_history'::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname in (
      'invoice_no', 'invoice_no_string', 'invoice_date', 'invoice_date_token',
      'pick_ticket_no', 'pick_ticket_no_string', 'document_type', 'source_document_type',
      'fulfilment_status', 'fulfillment_status', 'is_invoiced', 'is_fulfilled'
    );
  if v_count <> 0 then
    raise exception 'coldlion_sales_history exposes a document token or fulfilment claim';
  end if;

  -- 4. Prod detail must not expose the owner-restricted free-text fields.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'plm.coldlion_prod_detail'::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname in ('item_desc', 'merch_group_05_desc');
  if v_count <> 0 then
    raise exception 'coldlion_prod_detail exposes an owner-restricted field';
  end if;

  -- 5. No image bytes anywhere in the image metadata contract.
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = 'pim.coldlion_item_image_metadata'::regclass
    and a.attnum > 0 and not a.attisdropped
    and (a.attname in ('resource_content', 'thumbnail128', 'thumbnail_128')
         or a.atttypid = 'bytea'::regtype);
  if v_count <> 0 then
    raise exception 'coldlion_item_image_metadata contract carries image bytes';
  end if;

  -- 6. Schema coldlion stays closed to application roles.
  for v_role, v_priv in
    select r.rolname, p.perm
    from pg_roles r
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(perm)
    where r.rolname in ('anon', 'authenticated')
  loop
    select count(*) into v_count
    from information_schema.role_table_grants g
    where g.table_schema = 'coldlion'
      and g.grantee = v_role
      and g.privilege_type = v_priv;
    if v_count <> 0 then
      raise exception 'coldlion.* leaked % to %', v_priv, v_role;
    end if;
  end loop;

  select count(*) into v_count
  from information_schema.usage_privileges u
  where u.object_schema = 'coldlion'
    and u.grantee in ('anon', 'authenticated');
  if v_count <> 0 then
    raise exception 'schema coldlion usage leaked to application roles';
  end if;

  -- 7. No application grant on any coldlion landing table (defence in depth).
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'coldlion'
    and c.relkind = 'r'
    and has_table_privilege('authenticated', c.oid, 'SELECT');
  if v_count <> 0 then
    raise exception 'authenticated can select from a coldlion landing table';
  end if;

  raise notice 'VERIFY PASSED: unit 6 consumer contracts present, sales history has no document claim, coldlion schema closed.';
end
$$;

rollback;
