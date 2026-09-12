-- Issue #2753: exact canonical identity for the existing PIM product item FK.
-- The compatibility ID in api.plm_item_list must not be used for this purpose.
-- derived-from: none
begin;

create view api.pim_item_picker
with (security_invoker = true) as
select
  i.id as item_id,
  i.source_system,
  i.source_id,
  i.item_number,
  i.description,
  i.raw ->> 'companyCode' as company_code,
  i.raw ->> 'divisionCode' as division_code
from plm.item i
where i.source_system = 'coldlion';

comment on view api.pim_item_picker is
  'One row per canonical ColdLion item with the true plm.item UUID for pim.product.plm_item_id. '
  'Source, company and division identity are retained; item numbers are not assumed unique. '
  'Invoker security preserves the existing plm.item read policies. No legacy IDs, guessed links or product writes.';

revoke all on api.pim_item_picker from public, anon;
grant select on api.pim_item_picker to authenticated;

commit;
