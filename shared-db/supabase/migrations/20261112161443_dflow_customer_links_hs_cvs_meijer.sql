-- shared-db#6142 (claim #6143; follows #6074 / PR #6107).
-- Adds the three missing DesignFlow customer links in core.company_source_ref
-- (source_system 'designflow_plm', source_table 'customers'):
--   56 HomeSense (HS) -> TJX
--   57 CVS       (CV) -> CVS
--   58 Meijer    (ME) -> Meijer
-- Owner mapping: Albert Hazan's approved customer sheet (relayed 2026-11-12).
-- Verified read-only on production 2026-11-12 ~11:20 AM EST: dflow_prod.customers holds
-- ids 56/57/58 with exactly those names and codes; core.customer has exactly one row each
-- named TJX, CVS and Meijer; no designflow_plm link exists for 56/57/58.
--
-- Environment gate (plm.deployment_environment, migration 20260804120100), same as
-- 20261112025359: on 'production qsllyeztdwjgirsysgai' every check is STRICT and raises,
-- aborting the migration so the ledger never advances with partial data. Any other
-- database skips with a NOTICE (the DesignFlow sandbox already carries these links).
-- Rollback: delete the three rows where raw->>'created_by' = 'shared-db#6142'.

do $links$
declare
  r record;
  v_n integer;
  v_cust uuid;
  v_raw jsonb;
  v_env text;
begin
  select environment_name into v_env from plm.deployment_environment where singleton;
  if v_env is distinct from 'production qsllyeztdwjgirsysgai' then
    raise notice '#6142: environment % is not production; links skipped', coalesce(v_env, '<none>');
    return;
  end if;

  for r in select * from (values
    (56, 'HS', 'HomeSense', 'TJX'),
    (57, 'CV', 'CVS',       'CVS'),
    (58, 'ME', 'Meijer',    'Meijer')) t(src_id, src_code, src_name, cust_name)
  loop
    select count(*), min(id::text)::uuid into v_n, v_cust from core.customer where name = r.cust_name;
    if v_n <> 1 then raise exception '#6142: customer % matched % rows', r.cust_name, v_n; end if;

    select count(*), min((to_jsonb(d) - 'customers_passw')::text)::jsonb into v_n, v_raw from dflow_prod.customers d
     where d.customers_id = r.src_id and d.customers_code = r.src_code and d.customers_name = r.src_name;
    if v_n <> 1 then raise exception '#6142: DesignFlow customer % (%) matched % rows', r.src_id, r.src_code, v_n; end if;

    if exists (select 1 from core.company_source_ref
                where source_system = 'designflow_plm' and source_table = 'customers'
                  and source_id = r.src_id::text) then
      raise exception '#6142: designflow_plm link % already exists', r.src_id;
    end if;

    insert into core.company_source_ref
      (company_id, source_system, source_table, source_id, source_code, source_name, confidence, raw)
    values (v_cust, 'designflow_plm', 'customers', r.src_id::text, r.src_code, r.src_name, 'verified',
            v_raw || jsonb_build_object('created_by', 'shared-db#6142'));
  end loop;
end
$links$;
