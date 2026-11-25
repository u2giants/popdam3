-- Issue #7106 (claim; successor of #7095): DesignFlow assembled item descriptions,
-- popcre/designflow-item-master#194 step 4.2. DATA ONLY, PRODUCTION SCHEMA dflow_prod: the naming
-- convention v1 rows (one current row per division) that the item service's create path reads.
-- Same rows as the sandbox (dflow) seed written by designflow-item-master
-- scripts/assembled-description/seed-convention.js on 2026-11-25. Owner order (Albert,
-- 2026-11-10 11:28 AM EST, Q1): product type (+ "with" embellishment) -> licensor -> property ->
-- artwork -> size; EH001 prints no licensor/property (owner 2026-11-10 1:01 PM EST).
-- No structure change. Nothing reads these rows until ASSEMBLED_DESC_ENABLED is switched on in
-- production (off by default). Idempotent: a division that already has a current row, or version 1,
-- is left untouched. Rollback: delete from dflow_prod.description_convention where version = 1
-- and created_by is null and template->>'name' like 'owner-2026-11-10%'.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regclass('dflow_prod.description_convention') is null then
    raise exception '#7106/20261225130804 self-check: dflow_prod.description_convention is missing — 20261225091507 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
end $$;

insert into dflow_prod.description_convention (division_code, version, template, is_current)
select v.division_code, v.version, v.template, true
  from (values
  ('CW001', 1, '{"name":"owner-2026-11-10","separator":" ","embellishment_prefix":"with","embellishment_joiner":"and","omit_embellishments":["None","Plain"],"max_length":100,"short_names":{"product_type":"never","licensor":"always","property":"always"},"abbreviations":{},"parts":[{"key":"product_type","required":true},{"key":"embellishment"},{"key":"licensor"},{"key":"property"},{"key":"artwork","required":true},{"key":"size","required":true}]}'::jsonb),
  ('SP001', 1, '{"name":"owner-2026-11-10","separator":" ","embellishment_prefix":"with","embellishment_joiner":"and","omit_embellishments":["None","Plain"],"max_length":100,"short_names":{"product_type":"never","licensor":"always","property":"always"},"abbreviations":{},"parts":[{"key":"product_type","required":true},{"key":"embellishment"},{"key":"licensor"},{"key":"property"},{"key":"artwork","required":true},{"key":"size","required":true}]}'::jsonb),
  ('EH001', 1, '{"name":"owner-2026-11-10-non-licensed","separator":" ","embellishment_prefix":"with","embellishment_joiner":"and","omit_embellishments":["None","Plain"],"max_length":100,"short_names":{"product_type":"never","licensor":"always","property":"always"},"abbreviations":{},"parts":[{"key":"product_type","required":true},{"key":"embellishment"},{"key":"artwork","required":true},{"key":"size","required":true}]}'::jsonb)
  ) as v(division_code, version, template)
 where not exists (select 1 from dflow_prod.description_convention c
                    where c.division_code = v.division_code and (c.is_current or c.version = v.version));
