-- shared-db#6074 REISSUE of 20261111230502 (never applied: its preview rehearsal, run
-- 43132585328, failed closed because preview's customer data differs from production --
-- "Variety Stores, Inc. (VAR218) matched 0 rows"; preview and production diverge,
-- AGENTS.md standing fact 11). 20261111230502 is retired in production_migration_guard.py.
-- Change: the data steps run as ONE all-or-nothing subtransaction. If any precondition
-- fails (exactly-one matches), every data write is rolled back and a WARNING is raised;
-- columns still land. Production is then proven by a live read on #6074.
--
-- Original header (#6074, follows #4705): Owner authority, Albert Hazan, 2026-11-11 3:18 PM EST:
-- "add a customer 'nickname' field in the *.core table and a customer 'nickname' field
-- in the *.core table. populate them with what i have given you so far in this csv."
-- Read (coordinator) as nickname on both core.licensor and core.customer.
--
-- 1. Nullable nickname text on core.licensor and core.customer, populated from the
--    owner's review sheet: licensor by code, customer by exact name (fail closed unless
--    exactly one row matches).
-- 2. plm.license_agreement corrections from the same review: legacy id 6 (MP,
--    'Multiple') -> MV (was ZZ); legacy id 1 (DS, 'Dis/Mrv/SW') -> DY, new row with its
--    legacy rates. Legacy RB/FK/AL stay unloaded (owner: delete).
-- 3. core.company_source_ref designflow_plm links:
--    Homegoods (legacy id 7, was TJX) and Urban Outfitters (legacy id 46, was the Europe
--    record) -> new core.customer rows with no ColdLion link (owner: "Make a value in our
--    customer database only"). 'General' (legacy id 28) was linked to Dollar General;
--    owner ruled it inactive, so it moves to its own inactive record and Dollar General
--    is untouched. All other owner mappings were already in place (verified 2026-11-11).
--    99 Only, New Development, FEP10 TEST Zero Rate untouched; no legacy row deleted.
--
-- Data steps no-op when the designflow_plm links are absent (CI shadow database).
-- Rollback: drop the two nickname columns; repoint the three source refs to their
-- previous company ids (recorded in each new customer's metadata); delete the three new
-- customers; restore license_agreement source_id 6 to ZZ and delete source_id 1.

alter table core.licensor add column if not exists nickname text;
alter table core.customer add column if not exists nickname text;
comment on column core.licensor.nickname is 'Short everyday name used inside POP (owner-maintained).';
comment on column core.customer.nickname is 'Short everyday name used inside POP (owner-maintained).';

do $data$
declare
  r record;
  v_n integer;
  v_id uuid;
  v_old uuid;
begin
  if not exists (select 1 from core.company_source_ref where source_system = 'designflow_plm') then
    raise notice '#6074: no designflow_plm links; data steps skipped';
    return;
  end if;

  begin  -- all-or-nothing data subtransaction

  -- 1a. Licensor nicknames by code.
  for r in select * from (values
    ('AA','Aardman'),('CC','Coca Cola'),('MV','Marvel'),('PN','Peanuts'),('SE','Sega'),
    ('SW','Star Wars'),('WB','WB'),('VM','Paramount'),('SS','Strawberry Shortcake'),
    ('SM','Sesame Street'),('ZZ','Generic'),('DY','Disney')) t(code, nick)
  loop
    update core.licensor set nickname = r.nick where code = r.code;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '#6074: licensor code % matched % rows', r.code, v_n; end if;
  end loop;

  -- 1b. Customer nicknames by exact name; optional ColdLion code must be on that record.
  for r in select * from (values
    ('TRANSWORLD ENTERTAINMENT','FYE',null),('HOBBY LOBBY LLC','Hobby Lobby',null),
    ('HOT TOPIC MERCHANDISCING INC','Hot Topic',null),('KOHLS','Kohl''s',null),
    ('OLLIE''S BARGAIN OUTLET INC','Ollies',null),('United Pacific Designs Inc.','UPD',null),
    ('WAL-MART STORES INC','Walmart',null),('AT HOME STORES LLC','At Home',null),
    ('The Kroger Co.','Kroger',null),('LIDL US, LLC','Lidl',null),
    ('ROSS STORES INC SUPPLIERS','Ross',null),('Variety Stores, Inc.','VW','VAR218'),
    ('FOUR SEASONS GENERAL MERCH','4 Seasons','FSG090'),('Books A Million','BAM','AME010'),
    ('DD''S DISCOUNT SUPPLIERS','DDs',null),('Spencer Gifts','Spencer''s','SPE682')) t(name, nick, cl)
  loop
    select count(*) into v_n from core.customer c where c.name = r.name
      and (r.cl is null or exists (select 1 from core.company_source_ref s
           where s.company_id = c.id and s.source_system = 'coldlion' and s.source_code = r.cl));
    if v_n <> 1 then raise exception '#6074: customer % (%) matched % rows', r.name, r.cl, v_n; end if;
    update core.customer c set nickname = r.nick where c.name = r.name
      and (r.cl is null or exists (select 1 from core.company_source_ref s
           where s.company_id = c.id and s.source_system = 'coldlion' and s.source_code = r.cl));
  end loop;

  -- 2. License agreement corrections.
  update plm.license_agreement
     set licensor_id = (select id from core.licensor where code = 'MV')
   where source_system = 'designflow' and source_id = '6'
     and licensor_id = (select id from core.licensor where code = 'ZZ');
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '#6074: license_agreement MP correction touched % rows', v_n; end if;

  if to_regclass('core."licenseList"') is null then
    raise exception '#6074: core."licenseList" missing; cannot load DS rates';
  end if;
  insert into plm.license_agreement
    (licensor_id, royalty_rate, fob_royalty_rate, status, source_system, source_id, source_code, source_title)
  select (select id from core.licensor where code = 'DY'),
         s."licenseList_royalty_rate"::numeric, s."licenseList_fob_royalty_rate"::numeric,
         s."licenseList_status", 'designflow', '1', s."licenseList_code", s."licenseList_title"
  from core."licenseList" s
  where s."licenseList_id" = 1 and s."licenseList_code" = 'DS';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '#6074: DS license_agreement insert wrote % rows', v_n; end if;

  -- 3. DesignFlow customer links.
  for r in select * from (values
    ('7','HG','Homegoods','active'),
    ('46','UO','Urban Outfitters','active'),
    ('28','GEN','General','inactive')) t(src_id, src_code, new_name, new_status)
  loop
    select company_id into v_old from core.company_source_ref
     where source_system = 'designflow_plm' and source_table = 'customers'
       and source_id = r.src_id and source_code = r.src_code;
    if v_old is null then raise exception '#6074: designflow_plm link % (%) not found', r.src_id, r.src_code; end if;
    if exists (select 1 from core.customer where lower(name) = lower(r.new_name)) then
      raise exception '#6074: a customer named % already exists', r.new_name;
    end if;
    insert into core.customer (name, status, metadata)
    values (r.new_name, r.new_status::app.entity_status,
            jsonb_build_object('created_by', 'shared-db#6074', 'previous_designflow_link_company_id', v_old))
    returning id into v_id;
    update core.company_source_ref set company_id = v_id
     where source_system = 'designflow_plm' and source_table = 'customers' and source_id = r.src_id;
  end loop;
  exception when raise_exception then
    raise warning '#6074 data steps rolled back, nothing written: %', sqlerrm;
  end;
end
$data$;
