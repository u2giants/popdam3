-- Issue #2611: implement the prepack exclusion that existed only as prose.
-- derived-from: none
--
-- Owner ruling, docs/business-rules/product-items-and-identifiers.md:
--   "Prepacks must be excluded from any population being assessed for missing
--    Licensor or Property, not chased for attribution." (Albert Hazan, 2026-09-06)
--
-- Two objects, both new:
--   plm.prepack_role            the single authoritative assortment test
--   plm.item_missing_attribution the population that applies it
--
-- WHY THE SOURCE IS COLDLION AND NOT public.erp_items_current.
-- Issue #2611 states that public.erp_items_current.prepack_code marks HEADS.
-- Re-derived against production on 2026-09-11, that is wrong: erp_items_current
-- is a frozen DesignFlow snapshot (last synced 2026-05-21) and of its 1,454
-- prepack rows, 1,437 are live prepack MEMBERS and exactly 1 is a live head.
-- Building the filter on that column would exclude the wrong items and miss
-- almost every real head. ColdLion outranks DesignFlow (ruling 2026-09-08), and
-- erp_items_current is being retired by #2482, so it is not referenced here.
--
-- THE HEAD TEST. coldlion.prod_history_component.prepack_item_no is a
-- transaction-attested flag meaning "this ordered item is a prepack head".
-- Rows carrying a head are self-referencing (sub_item_no = prepack_item_no);
-- the table does NOT enumerate members, so it must never be read as a
-- head -> member explosion.
--
-- THE MEMBER TEST. coldlion.item_detail.pre_pack_code marks the member items.
-- Head codes and member codes are disjoint.
--
-- Both roles are excluded. The ruling names heads explicitly, but within the
-- licensed divisions the members are where the false defects actually are.
--
-- The ColdLion landing is closed to application roles, so both objects read it
-- through a definer boundary and expose only the projection below.

create or replace function plm.prepack_role(
  p_item_no text,
  p_company_code text,
  p_division_code text
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  -- 'head' wins over 'member': the two sets are disjoint in practice, but a
  -- head that also carried a member code is still an orderable carton.
  select case
    when exists (
      select 1
      from coldlion.prod_history_component component
      where btrim(component.prepack_item_no) = btrim(p_item_no)
        and nullif(btrim(component.prepack_item_no), '') is not null
    ) then 'head'
    when exists (
      select 1
      from coldlion.item_detail detail
      where detail.company_code = p_company_code
        and detail.division_code = p_division_code
        and btrim(detail.item_no) = btrim(p_item_no)
        and nullif(btrim(detail.pre_pack_code), '') is not null
    ) then 'member'
    else null
  end;
$$;

comment on function plm.prepack_role(text, text, text) is
  'Issue #2611. The single authoritative assortment test: returns head, member, or null. '
  'Source is ColdLion. Swapping the source is a one-line change inside this function; '
  'never re-implement the test at a call site.';

revoke all on function plm.prepack_role(text, text, text) from public, anon;
grant execute on function plm.prepack_role(text, text, text) to authenticated, service_role;

-- The missing-Licensor / missing-Property population, with the documented
-- exclusions applied so the ruling holds without anyone remembering it.
--
-- NON-LICENSED DIVISIONS. Owner ruling 2026-09-06 (recorded in
-- docs/business-rules/merchandise-and-product-taxonomy.md): "EH001 and EP001
-- have no licensed product." A missing Licensor there is not a data gap. There
-- is no licensed flag anywhere in the ColdLion division master, so this list is
-- the ruling itself, carried here deliberately rather than inferred from a
-- source that does not record it.

create or replace view plm.item_missing_attribution
with (security_invoker = false, security_barrier = true) as
select
  item.id,
  item.item_number,
  item.raw ->> 'companyCode' as company_code,
  item.raw ->> 'divisionCode' as division_code,
  item.licensor_id,
  item.property_id
from plm.item item
where (item.licensor_id is null or item.property_id is null)
  and coalesce(item.raw ->> 'divisionCode', '') not in ('EH001', 'EP001')
  and plm.prepack_role(
        item.item_number,
        item.raw ->> 'companyCode',
        item.raw ->> 'divisionCode'
      ) is null;

comment on view plm.item_missing_attribution is
  'Issue #2611. Items genuinely missing a Licensor or Property: non-licensed '
  'divisions and prepack heads/members are already excluded. Count this view '
  'rather than filtering plm.item by hand.';

revoke all on plm.item_missing_attribution from public, anon;
grant select on plm.item_missing_attribution to authenticated, service_role;
