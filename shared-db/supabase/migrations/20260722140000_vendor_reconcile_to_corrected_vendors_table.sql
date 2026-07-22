-- Vendor reconcile — align core.factory to Coldlion's CORRECTED /vendors table.
--
-- Context: Coldlion fixed /vendors on 2026-07-22 — it now serves 97 factory-only
-- records (all active), down from 539 mixed with service-providers (freight,
-- government, banks, couriers, real estate). core.factory was curated from the
-- old 539-row feed, so it carries 418 stale old-feed non-factory rows. Plan:
-- fix_vendor_reconcile.md.
--
-- This migration:
--   1) Purges the 418 stale rows (coldlion-mapped but NOT in the corrected 97).
--      All are already inactive and have ZERO downstream references (verified
--      2026-07-22): 0 products / style bridges / production orders / RFQs /
--      opportunities / vendor_contacts. Guarded to only touch stale rows.
--   2) Re-adds Anthony's Warehouse & Distribution (ANT001) as an INACTIVE factory
--      (Albert's ruling 2026-07-22: "just inactivate all Anthony's"). It is in the
--      corrected table (active upstream) but is a warehouse/distributor, not a
--      manufacturer, so status is app-owned inactive and survives re-pulls.
--   3) CNWAH (blank, nameless placeholder in the corrected feed) is intentionally
--      NOT added.
--
-- Guarded/idempotent so it is safe on the data-less preview branch and re-runnable.

do $$
declare
  v_correct text[] := array[
    'ANT001','CACAR','CBPHO','CBYJA','CNASW','CNBCH','CNBEL','CNBTO','CNCHC','CNCHF','CNCKA',
    'CNCXC','CNDCF','CNDHE','CNDWG','CNEVR','CNFEN','CNFER','CNFLW','CNFLY','CNFTH','CNFUJ',
    'CNFUZH','CNGCH','CNHAP','CNHDL','CNHFU','CNHQP','CNHUS','CNINT','CNJAM','CNJDF','CNJHC',
    'CNJHY','CNJJA','CNJNC','CNJTS','CNLTL','CNMHA','CNMUC','CNNBH','CNNDC','CNNEW','CNNHX',
    'CNNMP','CNNTY','CNQJM','CNQMS','CNQUE','CNRPH','CNRUC','CNSFN','CNSHAO','CNTFA','CNTMWA',
    'CNTMZ','CNTNG','CNTTY','CNTXC','CNTZS','CNUNQ','CNWAH','CNWAT','CNWEM','CNWJT','CNWLH',
    'CNXFA','CNXJM','CNXJY','CNXKA','CNXYZ','CNYDE','CNYIC','CNYIH','CNYKE','CNYSC','CNZAK',
    'CNZBJ','CNZCH','CNZHO','CNZJNA','CNZTA','COCO','FLGDS','IKN001','INBABU','INDSM','INHDW',
    'INKAN','INRYP','INTUF','INUCF','INVCW','SKPHL','SKPNP','SKSMB','USDEC'
  ];
  v_id uuid;
begin
  -- 1) Purge stale old-feed non-factories.
  delete from core.factory f
  where exists (
          select 1 from core.factory_source_ref r
          where r.factory_id = f.id and r.source_system = 'coldlion'
        )
    and not exists (
          select 1 from core.factory_source_ref r2
          where r2.factory_id = f.id and r2.source_system = 'coldlion'
            and r2.source_code = any (v_correct)
        );

  -- 2) Re-add Anthony's (ANT001) as an inactive factory, if absent.
  if not exists (select 1 from core.factory where code = 'ANT001')
     and not exists (
       select 1 from core.factory_source_ref
       where source_system = 'coldlion' and source_id = 'ANT001'
     ) then
    insert into core.factory (name, code, status, country)
    values ('ANTHONY''S WAREHOUSE & DISTRIBUTION', 'ANT001', 'inactive', 'USA')
    returning id into v_id;

    insert into core.factory_source_ref (factory_id, source_system, source_table, source_id, source_code)
    values (v_id, 'coldlion', 'vendors', 'ANT001', 'ANT001');

    -- Relink the silver mirror row (its factory_id was nulled when the old row was purged).
    update plm.erp_vendor set factory_id = v_id where vendor_code = 'ANT001';
  end if;
end $$;
