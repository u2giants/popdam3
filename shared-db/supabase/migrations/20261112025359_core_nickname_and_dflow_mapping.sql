-- shared-db#6074 (follows #4705). Third issue of the nickname/mapping change; supersedes
-- the retired 20261111230502 and 20261112011634 (review finding #6104).
-- Owner authority, Albert Hazan, 2026-11-11 3:18 PM EST: "add a customer 'nickname' field
-- in the *.core table and a customer 'nickname' field in the *.core table. populate them
-- with what i have given you so far in this csv." Read (coordinator) as nickname on both
-- core.licensor and core.customer.
--
-- 1. Nullable nickname text on core.licensor and core.customer.
-- 2. Nicknames: licensor by code; customer by exact name (ColdLion code checked where the
--    owner named one).
-- 3. plm.license_agreement corrections: legacy id 6 (MP) -> MV (was ZZ); legacy id 1 (DS)
--    -> DY, new row with its legacy rates. RB/FK/AL stay unloaded (owner: delete).
-- 4. core.company_source_ref designflow_plm links: Homegoods (id 7, was TJX) and Urban
--    Outfitters (id 46, was the Europe record) -> new customer rows with no ColdLion link;
--    'General' (id 28, was Dollar General) -> its own inactive record. Every other owner
--    mapping already matches production (read-only check 2026-11-11 ~9 PM EST).
--
-- Environment gate (owner-configured plm.deployment_environment, migration 20260804120100):
-- on 'production qsllyeztdwjgirsysgai' every data step is STRICT -- any exactly-one check
-- that fails raises and aborts the whole migration (DDL included), so the ledger never
-- advances with partial data. On any other database (preview data diverges from
-- production, AGENTS.md standing fact 11) the data steps are skipped with a NOTICE and only
-- the columns land. Every precondition was verified against production before authoring.
-- Depends on 20261112025353 (plm.license_agreement).
-- Rollback: drop the nickname columns; repoint the three links to the company id recorded
-- in each new customer's metadata; delete those three customers; set license_agreement
-- source_id 6 back to ZZ and delete source_id 1.

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
  v_env text;
begin
  select environment_name into v_env from plm.deployment_environment where singleton;
  if v_env is distinct from 'production qsllyeztdwjgirsysgai' then
    raise notice '#6074: environment % is not production; data steps skipped', coalesce(v_env, '<none>');
    return;
  end if;

  -- Nicknames: licensor by code.
  for r in select * from (values
    ('AA','Aardman'),('CC','Coca Cola'),('MV','Marvel'),('PN','Peanuts'),('SE','Sega'),
    ('SW','Star Wars'),('WB','WB'),('VM','Paramount'),('SS','Strawberry Shortcake'),
    ('SM','Sesame Street'),('ZZ','Generic'),('DY','Disney')) t(code, nick)
  loop
    update core.licensor set nickname = r.nick where code = r.code;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '#6074: licensor code % matched % rows', r.code, v_n; end if;
  end loop;

  -- Nicknames: customer by exact name (+ ColdLion code where given).
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
    update core.customer c set nickname = r.nick where c.name = r.name
      and (r.cl is null or exists (select 1 from core.company_source_ref s
           where s.company_id = c.id and s.source_system = 'coldlion' and s.source_code = r.cl));
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '#6074: customer % (%) matched % rows', r.name, r.cl, v_n; end if;
  end loop;

  -- License agreement corrections.
  update plm.license_agreement
     set licensor_id = (select id from core.licensor where code = 'MV')
   where source_system = 'designflow' and source_id = '6'
     and licensor_id = (select id from core.licensor where code = 'ZZ');
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '#6074: license_agreement MP correction touched % rows', v_n; end if;

  insert into plm.license_agreement
    (licensor_id, royalty_rate, fob_royalty_rate, status, source_system, source_id, source_code, source_title)
  select (select id from core.licensor where code = 'DY'),
         s."licenseList_royalty_rate"::numeric, s."licenseList_fob_royalty_rate"::numeric,
         s."licenseList_status", 'designflow', '1', s."licenseList_code", s."licenseList_title"
  from core."licenseList" s
  where s."licenseList_id" = 1 and s."licenseList_code" = 'DS';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception '#6074: DS license_agreement insert wrote % rows', v_n; end if;

  -- DesignFlow customer links.
  for r in select * from (values
    ('7','HG','Homegoods','active'),
    ('46','UO','Urban Outfitters','active'),
    ('28','GEN','General','inactive')) t(src_id, src_code, new_name, new_status)
  loop
    select count(*), min(company_id::text)::uuid into v_n, v_old from core.company_source_ref
     where source_system = 'designflow_plm' and source_table = 'customers'
       and source_id = r.src_id and source_code = r.src_code;
    if v_n <> 1 then raise exception '#6074: designflow_plm link % (%) matched % rows', r.src_id, r.src_code, v_n; end if;
    if exists (select 1 from core.customer where lower(name) = lower(r.new_name)) then
      raise exception '#6074: a customer named % already exists', r.new_name;
    end if;
    insert into core.customer (name, status, metadata)
    values (r.new_name, r.new_status::app.entity_status,
            jsonb_build_object('created_by', 'shared-db#6074', 'previous_designflow_link_company_id', v_old))
    returning id into v_id;
    update core.company_source_ref set company_id = v_id
     where source_system = 'designflow_plm' and source_table = 'customers'
       and source_id = r.src_id and source_code = r.src_code;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception '#6074: link % repoint touched % rows', r.src_id, v_n; end if;
  end loop;
end
$data$;
