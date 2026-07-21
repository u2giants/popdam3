-- Vendor curation pass (part 1 of 2): status seeding + not-a-factory purge.
-- Authored from Albert's 2026-07-20 rulings in docs/vendor-review/*.csv.
--
-- Part 2 (the 6 legacy "directus" factories: Bill, Chloe, Jerome, Lucy, Tom,
-- Wendy Sunway) is INTENTIONALLY DEFERRED. Although flagged "garbage", they are
-- referenced by 33 pim.product rows + 20 plm.style_tracker_item_bridge rows, so
-- deleting them would null real vendor links. That needs a human decision
-- (delete-and-orphan vs reassign vs inactivate) and is not in this migration.
--
-- status is normally app-owned (importers set it on insert only); this is the
-- sanctioned one-time curation seed.

-- 1) Purge the 4 not-a-factory records (freight / retail / photo studio).
--    Verified 2026-07-20 to have ZERO references in pim.product,
--    plm.production_order, plm.style_tracker_item_bridge, plm.rfq_vendor,
--    crm.opportunity, core.vendor_contact. factory_alias + factory_source_ref
--    cascade. Guarded by id AND name so a stale id cannot delete a real vendor.
delete from core.factory
where id in (
  '525673e8-7801-401d-9d01-4d6eb95fa34d',  -- ABF FREIGHT SYSTEM INC
  'f3b5895f-d538-4f0f-a5cb-a4fb8606873e',  -- ANTHONY'S WAREHOUSE & DISTRIBUTION
  '850f7c1d-2a3e-4611-bb3d-95a85b9a8d95',  -- DIGITAL PHOTOGRAPHIC
  'b79a6821-dae2-48ec-ab27-02ecbf905b03'   -- WALMART (a customer, not a vendor)
)
and name in (
  'ABF FREIGHT SYSTEM INC',
  'ANTHONY''S WAREHOUSE & DISTRIBUTION',
  'DIGITAL PHOTOGRAPHIC',
  'WALMART'
);

-- 2) Seed status from the fresh Coldlion active flag for every Coldlion-mapped
--    factory: active if ANY of its vendor codes is active, else inactive.
update core.factory f
set status = case
      when exists (
        select 1 from plm.erp_vendor v
        where v.factory_id = f.id and v.active
      ) then 'active'
      else 'inactive'
    end,
    updated_at = now()
where exists (
  select 1 from core.factory_source_ref r
  where r.factory_id = f.id and r.source_system = 'coldlion'
);

-- 3) Apply Albert's explicit multi-code rulings. These override the any-active
--    default above (notably XIANJU SHAOFENG: one code is active upstream, but
--    Albert ruled the vendor INACTIVE). Guarded by id AND name.
update core.factory set status = 'inactive', updated_at = now()
  where id = '53715b23-4b68-488c-8ea2-b51680b96bfb' and name = 'Action Printing';
update core.factory set status = 'active', updated_at = now()
  where id = 'e2d7423a-a42e-4c3a-8f23-93103b5a29ea' and name = 'MIRAE N CULTURE GROUP CO.,LTD';
update core.factory set status = 'inactive', updated_at = now()
  where id = 'bf7779c9-8591-4ab6-ab4b-194abbfdda1c' and name = 'XIANJU SHAOFENG ARTS & CRAFTS FACTORY';
update core.factory set status = 'active', updated_at = now()
  where id = 'c44548b4-ce83-4685-aade-390374c42b5e' and name = 'XIANJU YINTAI GIFTS FACTORY';
