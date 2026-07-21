-- Vendor curation pass (part 2 of 2): reassign the 6 legacy "directus" factories
-- to their real vendors, then merge duplicate factory rows. All via
-- core.merge_factory(loser, survivor, keep_alias) which repoints every FK
-- (pim.product, plm.style_tracker_item_bridge, rfq_vendor, production_order,
-- crm.opportunity, vendor_contact, source refs, aliases) then deletes the loser.
--
-- Directus reassignments use keep_alias=false (the junk names Bill/Chloe/... are
-- not worth preserving). Dedup merges use keep_alias=true so the absorbed real
-- name stays searchable on the survivor.
--
-- Targets confirmed by Albert 2026-07-21. Each merge is GUARDED (only runs if
-- both rows still exist) so the migration is idempotent and safe against the
-- data-less preview branch.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- Part A: directus reassignment (loser = directus junk, no alias)
      ('af277380-fde8-4d01-b2bb-121dde92fb95'::uuid, '71e182bd-d60c-4c7a-962f-4019d995905c'::uuid, false), -- Tom    -> Jinhua CTR Arts (CNTMZ)
      ('e4e999d6-ab61-4e20-a86f-4989011f6395',       '676b39ca-5237-49a3-8963-f8b42167bd69',       false), -- Chloe  -> China Zhejiang (CNJAM)
      ('a415d79c-b412-4439-9954-286f4ac3cca1',       '08f4b3ed-7b54-4f50-bb06-d6b2be87b5a5',       false), -- Bill   -> Xiamen Tengfei (CNBCH)
      ('1aef58d6-5b37-45be-909c-caf9ba5ee0dd',       'afab7411-3b7c-476b-873c-2a7d69d04c6d',       false), -- Jerome -> Ningbo Home Decor (CNHDL)
      ('7acecd43-f6fc-475d-b07c-d46f79e53602',       'c51ca2ca-658c-4360-b880-086d288fd036',       false), -- Lucy   -> Yiwu TaoYe (CNNTY)
      ('90a7970d-7cc9-4adb-bc43-16f5febb819f',       'b53aabdc-63a9-49e7-b010-449fd5aa2f4f',       false), -- Wendy  -> Xianju Sunway (CNDWG)
      -- Part B: duplicate-factory dedup (loser = dup row, keep the real name as alias)
      ('663425d9-396a-4c1d-b707-6b14ec1dc6ac',       'b53aabdc-63a9-49e7-b010-449fd5aa2f4f',       true),  -- Xianju Sunway CNHUS -> CNDWG
      ('e594e662-f254-410c-8d4c-714b296c5833',       'b53aabdc-63a9-49e7-b010-449fd5aa2f4f',       true),  -- Xianju Sunway 476   -> CNDWG
      ('e936032b-7804-45cf-a1b5-477f67916adb',       '3dc9a54a-9c72-412e-ba3f-1149f193c629',       true),  -- Ali Racking 469     -> ALI
      ('f6bec720-7926-435e-b861-e3f9371fc1ad',       'af774b9f-528d-4f03-b701-2eb646c9a225',       true),  -- Dong-A Printing 99  -> SKPHL
      ('bc2f6953-bd45-4ee7-93ac-dde3f151ddeb',       'afab7411-3b7c-476b-873c-2a7d69d04c6d',       true),  -- Ningbo Home Decor 403 -> CNHDL
      ('13b9bd84-eb4b-4c08-8097-ddc39c823dae',       '39132060-3953-4a1e-b725-fbf1a2dbe6c2',       true),  -- Pharos Artcraft 244 -> CNRPH
      ('72a38c2a-7e85-4c25-a73d-10dd0806b0e7',       '946b6b03-37cf-4780-96d4-6da465f6b244',       true),  -- Taizhou Meihua CNTMWA -> CNMHA
      ('40cbef29-83fb-45a8-a1f3-ea19f94d9756',       'c51ca2ca-658c-4360-b880-086d288fd036',       true),  -- Yiwu TaoYe CNTTY    -> CNNTY
      ('ee5f2f50-4a65-4098-ba96-0a3bef14ce3d',       '676b39ca-5237-49a3-8963-f8b42167bd69',       true)   -- China Zhejiang 415  -> CNJAM
    ) as t(loser, survivor, keep_alias)
  loop
    if exists (select 1 from core.factory where id = r.loser)
       and exists (select 1 from core.factory where id = r.survivor) then
      perform core.merge_factory(r.loser, r.survivor, r.keep_alias);
    end if;
  end loop;

  -- Record the current company name (China Zhejiang renamed to Hangzhou Fun
  -- Goods Trading) as the survivor's display_name.
  update core.factory
     set display_name = 'HANGZHOU FUN GOODS TRADING CO.,LTD.', updated_at = now()
   where id = '676b39ca-5237-49a3-8963-f8b42167bd69'
     and display_name is distinct from 'HANGZHOU FUN GOODS TRADING CO.,LTD.';
end $$;
