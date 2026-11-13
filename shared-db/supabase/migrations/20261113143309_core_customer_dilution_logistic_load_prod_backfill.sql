-- shared-db#6177, fixes review finding #6183 on 20261112201512 (PR #6179).
-- 20261112201512 read only dflow.customers, which production lacks, so on production the
-- columns landed all NULL. This fix-forward:
--   * reads dflow_prod.customers when it exists (production), else dflow.customers
--     (DesignFlow sandbox); no-op with a NOTICE when neither exists (shared preview);
--   * fills dilution and logistic_load independently, each only where currently NULL;
--   * accepts only plain decimals that fit numeric(9,4) (|x| < 100000; extra fraction
--     digits truncate to 4, so no rounding can overflow); blank, non-numeric or oversized values are skipped and counted.
-- Read-only check 2026-11-13: production dflow_prod.customers has 58 rows, all numeric for
-- both fields, none oversized. Rollback: none needed (fills NULLs only); to undo, set both
-- columns NULL.

do $backfill$
declare
  v_src text;
  v_n integer;
  v_skipped integer;
begin
  if to_regclass('dflow_prod.customers') is not null then
    v_src := 'dflow_prod';
  elsif to_regclass('dflow.customers') is not null then
    v_src := 'dflow';
  else
    raise notice '#6183: neither dflow_prod.customers nor dflow.customers exists; backfill skipped';
    return;
  end if;

  create temporary table tmp_6183_src (company_id uuid, dil text, ll text) on commit drop;

  if v_src = 'dflow_prod' then
    insert into tmp_6183_src
    select r.company_id, d.customers_dilution::text, d.customers_logistic_load::text
    from dflow_prod.customers d
    join core.company_source_ref r
      on r.source_system = 'designflow_plm' and r.source_table = 'customers'
     and r.source_id = d.customers_id::text;
  else
    insert into tmp_6183_src
    select r.company_id, d.customers_dilution::text, d.customers_logistic_load::text
    from dflow.customers d
    join core.company_source_ref r
      on r.source_system = 'designflow_plm' and r.source_table = 'customers'
     and r.source_id = d.customers_id::text;
  end if;

  select count(*) filter (where nullif(btrim(dil), '') is not null
                            and btrim(dil) !~ '^-?[0-9]{1,5}(\.[0-9]+)?$')
       + count(*) filter (where nullif(btrim(ll), '') is not null
                            and btrim(ll) !~ '^-?[0-9]{1,5}(\.[0-9]+)?$')
    into v_skipped from tmp_6183_src;

  with vals as (
    select company_id,
           max(case when btrim(dil) ~ '^-?[0-9]{1,5}(\.[0-9]+)?$'
                    then trunc(btrim(dil)::numeric, 4) end) as dilution,
           max(case when btrim(ll) ~ '^-?[0-9]{1,5}(\.[0-9]+)?$'
                    then trunc(btrim(ll)::numeric, 4) end) as logistic_load
    from tmp_6183_src group by company_id
  )
  update core.customer c
     set dilution = coalesce(c.dilution, v.dilution),
         logistic_load = coalesce(c.logistic_load, v.logistic_load)
    from vals v
   where v.company_id = c.id
     and ((c.dilution is null and v.dilution is not null)
       or (c.logistic_load is null and v.logistic_load is not null));
  get diagnostics v_n = row_count;
  raise notice '#6183: source %, updated % core.customer rows, skipped % unusable values',
    v_src, v_n, v_skipped;
end
$backfill$;
