-- shared-db#6177. Customer dilution and logistics load on core.customer, backfilled from
-- DesignFlow's legacy dflow.customers (customers_dilution, customers_logistic_load; varchar).
-- Modeled on 20261112025359_core_nickname_and_dflow_mapping (#6107).
--
-- 1. Nullable numeric(9,4) columns (additive).
-- 2. Backfill through core.company_source_ref designflow_plm/customers links, only where
--    core.customer.dilution is null; blank or non-numeric legacy values are skipped.
--    No-op (NOTICE) on any database without dflow.customers (shared production has no dflow
--    schema). PL/pgSQL plans the update only when reached, so it is safe where dflow is absent.
-- Rollback: alter table core.customer drop column dilution, drop column logistic_load.

alter table core.customer
  add column if not exists dilution numeric(9,4),
  add column if not exists logistic_load numeric(9,4);

comment on column core.customer.dilution is
  'Customer dilution, a percent value used by DesignFlow RFQ pricing (e.g. 3 = 3%).';
comment on column core.customer.logistic_load is
  'Customer logistics load, a percent value used by DesignFlow RFQ pricing (e.g. 6 = 6%).';

do $backfill$
declare
  v_n integer;
begin
  if to_regclass('dflow.customers') is null then
    raise notice '#6177: dflow.customers absent; backfill skipped';
    return;
  end if;

    with src as (
      select r.company_id,
             case when btrim(d.customers_dilution::text) ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then btrim(d.customers_dilution::text)::numeric end as dilution,
             case when btrim(d.customers_logistic_load::text) ~ '^-?[0-9]+(\.[0-9]+)?$'
                  then btrim(d.customers_logistic_load::text)::numeric end as logistic_load
      from dflow.customers d
      join core.company_source_ref r
        on r.source_system = 'designflow_plm' and r.source_table = 'customers'
       and r.source_id = d.customers_id::text
    ), one as (
      -- one value per customer: if several legacy rows link to one company, take the max
      select company_id, max(dilution) as dilution, max(logistic_load) as logistic_load
      from src group by company_id
    )
    update core.customer c
       set dilution = one.dilution,
           logistic_load = coalesce(c.logistic_load, one.logistic_load)
      from one
     where one.company_id = c.id
       and c.dilution is null
       and (one.dilution is not null or one.logistic_load is not null);
  get diagnostics v_n = row_count;
  raise notice '#6177: backfilled % core.customer rows', v_n;
end
$backfill$;
