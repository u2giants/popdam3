-- shared-db#6150 step 6 fix-forward for 20261113145255 (review finding #6248).
-- Re-versioned from 20261115021817 (PR #6316), which exhausted its automatic attempts:
-- its fixed 117 shortfall check failed on preview, whose core.property holds fewer rows.
-- The check requires every path this database CAN resolve, exactly, and all 117 where the
-- full catalog is present (review finding #6484).
-- 1. Top-level INSERT ... SELECT so post-apply catalog verification sees the seeded table
--    (the earlier DO block was invisible to it).
-- 2. Each property is resolved by (licensor code, property code), never by code alone.
-- 3. A shortfall raises an exception whenever the licensor-site scrape is present.
-- Same 117 paths and owner rulings as 20261113145255 (MICKEY MOUSE -> OPA Mickey Mouse Family >
-- Mickey Mouse; Standard Characters -> OPA Standard Characters, nickname Mickey Group).
-- Site names are read from the plm.* scrape at apply time; no licensed names in this file.
-- Idempotent with 20261113145255 (on conflict do nothing).
-- Rollback: delete from core.property_site_path where source_evidence like 'shared-db#6150 step 6%'.

drop view if exists mg06_step6_paths;
drop view if exists mg06_step6_all;
create temp view mg06_step6_all as
select * from (
  select p.id as property_id, m.lcode, m.code, m.site, m.char_id,
    case m.site when 'pmt_trackerplus' then null else m.site_key end as site_property_id,
    case m.site
      when 'disney_opa' then (select min(o.property_name) from plm.opa_property o where o.licensed_property_id::text = m.site_key)
      when 'nbcu' then (select min(n.property_label) from plm.nbcu_property n where n.property_source_id::text = m.site_key)
      when 'sega' then (select min(s.property_label) from plm.sega_submission_property s where s.property_source_id::text = m.site_key)
      when 'pmt_trackerplus' then (select min(t.exact_label) from plm.pmt_trackerplus_submission_property t where t.property_local_key = m.site_key)
      when 'wb' then (select min(w.label) from plm.wb_property w where w.source_id::text = m.site_key)
    end as site_property_name,
    case when m.char_id is null then null else
      (select min(c.character_name) from plm.opa_property_character c
        where c.licensed_property_id::text = m.site_key and c.character_id::text = m.char_id) end as site_character_name
  from (values
  ('DY','1D','disney_opa','92',null),
  ('DY','A1','disney_opa','103',null),
  ('DY','AC','disney_opa','101',null),
  ('DY','AW','disney_opa','99',null),
  ('DY','BL','disney_opa','176',null),
  ('DY','BMB','disney_opa','104',null),
  ('DY','CAR','disney_opa','177',null),
  ('DY','DUM','disney_opa','120',null),
  ('DY','DYP','disney_opa','1159106622',null),
  ('DY','F2','disney_opa','1159075393',null),
  ('DY','F3','disney_opa','1159369426',null),
  ('DY','FZ','disney_opa','777',null),
  ('DY','HM','disney_opa','397',null),
  ('DY','HSM','disney_opa','398',null),
  ('DY','LS','disney_opa','137',null),
  ('DY','LSL','disney_opa','1159151809',null),
  ('DY','LTA','disney_opa','134',null),
  ('DY','MCG','disney_opa','401',null),
  ('DY','MM','disney_opa','361','563'),
  ('DY','MMF','disney_opa','373','558'),
  ('DY','MU','disney_opa','333',null),
  ('DY','NX','disney_opa','268',null),
  ('DY','PN','disney_opa','52',null),
  ('DY','RT','disney_opa','181',null),
  ('DY','TS','disney_opa','1059',null),
  ('DY','UP','disney_opa','499',null),
  ('DY','WC','disney_opa','497',null),
  ('DY','WP','disney_opa','494',null),
  ('MV','AD1','disney_opa','1159142494',null),
  ('MV','AV','disney_opa','709',null),
  ('MV','DP','disney_opa','1108',null),
  ('MV','GM','disney_opa','1094',null),
  ('MV','MG','disney_opa','629',null),
  ('MV','MSC','disney_opa','1159152015',null),
  ('MV','MV','disney_opa','634',null),
  ('MV','NF1','disney_opa','1159115273',null),
  ('MV','NF2','disney_opa','1159115289',null),
  ('MV','SP','disney_opa','635',null),
  ('MV','SX','disney_opa','1159114229',null),
  ('MV','VN','disney_opa','637',null),
  ('MV','WR','disney_opa','639',null),
  ('SW','B8','disney_opa','1159082095',null),
  ('SW','BN','disney_opa','1159121470',null),
  ('SW','CB','disney_opa','908',null),
  ('SW','E9','disney_opa','1159082095',null),
  ('SW','EM','disney_opa','917',null),
  ('SW','MD','disney_opa','1159089281',null),
  ('SW','PH','disney_opa','951',null),
  ('SW','R1','disney_opa','1055',null),
  ('SW','RJ','disney_opa','913',null),
  ('SW','SW','disney_opa','908',null),
  ('SW','VS','disney_opa','916',null),
  ('NB','BTF','nbcu','3463',null),
  ('NB','CK','nbcu','3464',null),
  ('NB','ET','nbcu','1211',null),
  ('NB','FC','nbcu','2084',null),
  ('NB','FF','nbcu','1345',null),
  ('NB','GD','nbcu','4818',null),
  ('NB','HD','nbcu','3422',null),
  ('NB','HN','nbcu','1829',null),
  ('NB','JD','nbcu','1837',null),
  ('NB','JR','nbcu','3460',null),
  ('NB','JW','nbcu','1217',null),
  ('NB','MN','nbcu','2576',null),
  ('NB','SF','nbcu','1088',null),
  ('NB','SH','nbcu','3475',null),
  ('NB','W1','nbcu','5128',null),
  ('NB','W2','nbcu','6367',null),
  ('NB','WA','nbcu','3799',null),
  ('SE','SC','sega','126',null),
  ('SE','SR','sega','127',null),
  ('VM','AT','pmt_trackerplus','bd03eb784c85de3be8d7179166656d6ef01452f3965852af2cd457ba6a1aae24',null),
  ('VM','CHR','pmt_trackerplus','a78f44f4c76c5854d276f4aeac88b5d5a04d499d4a3b2bde95728ce4523a905d',null),
  ('VM','GE1','pmt_trackerplus','7eb07dab6bae24395858f445f9d02ce0d789167f9e57cc3e57dac3dbdd22d873',null),
  ('VM','GH','pmt_trackerplus','5810d66ac44b8f2380962269fdc1829466753186aa086fec7482e012396babb9',null),
  ('VM','NT','pmt_trackerplus','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147',null),
  ('VM','SB','pmt_trackerplus','bb6d2425b630031d0904b2a9b76e344aa1f101c0b7d6c1085f92818deabe5eb2',null),
  ('VM','TU','pmt_trackerplus','5dbe1eb9778bad2f0c9bb0632e07292287d9e4d0e51047f0fb961154f5070900',null),
  ('DY','PS','wb','65efa063-7947-422b-9d68-6cc8bd983bcc',null),
  ('WB','A4','wb','09f2c46b-964c-433b-a13f-c55fee770494',null),
  ('WB','BA','wb','582035ee-5850-4df7-aa59-1f858212f025',null),
  ('WB','BG','wb','d34589c0-3a64-4f1a-9937-a79a1490e7d4',null),
  ('WB','BM','wb','d34589c0-3a64-4f1a-9937-a79a1490e7d4',null),
  ('WB','C3','wb','79c6d511-c7e4-4f32-9958-c9e05b933b82',null),
  ('WB','CS','wb','62381740-679e-4f18-8dda-d37123ac794e',null),
  ('WB','DH','wb','65efa063-7947-422b-9d68-6cc8bd983bcc',null),
  ('WB','DK1','wb','b87f25be-728f-4c44-9142-a0830a1526c1',null),
  ('WB','DK2','wb','e905b4c6-6937-417b-916b-b422f4ee5fb4',null),
  ('WB','EF','wb','d9ce0e26-f9c8-4919-a190-876124d654c6',null),
  ('WB','EX','wb','67830330-59a0-4d42-8765-c88e10814332',null),
  ('WB','FJ','wb','47b51c4c-7932-49fb-9841-3688ec1c1750',null),
  ('WB','FM','wb','a81bbbdb-4c1d-407c-af82-0f8486196d0f',null),
  ('WB','FN','wb','1f8bfaa9-24bc-4234-9340-df435aed6759',null),
  ('WB','FS','wb','a96c2415-05f6-43be-96d1-a2a723d69596',null),
  ('WB','FT','wb','cd620d1a-57a0-43c5-961d-a267017b0e45',null),
  ('WB','GGS','wb','da499469-a4d3-42a7-9916-77a9bb6f06bd',null),
  ('WB','GS','wb','80c13597-3a4e-40c3-a3f0-6383c0e2103d',null),
  ('WB','GT','wb','90b93c4e-93c7-46ab-a127-99cf146f87ab',null),
  ('WB','H1','wb','fec78022-d386-4129-b817-205c57e20fdf',null),
  ('WB','H2','wb','eedf2e9e-3557-43a8-b7fd-7b9eade2f724',null),
  ('WB','H3','wb','c9cd6357-afc8-4ae0-9046-75eccf5625a5',null),
  ('WB','H4','wb','b27e1d9e-6c78-48f2-aaea-17db29521142',null),
  ('WB','H8','wb','4f9ff209-95f6-494b-a646-ee75b8829d80',null),
  ('WB','JG','wb','acead133-c8da-4d20-8762-f7b0ee5a9b2f',null),
  ('WB','L1','wb','f9958913-3e87-427c-9676-6e907725f9bc',null),
  ('WB','LB','wb','cc51835c-d14c-4193-a32c-059a3cb1ab02',null),
  ('WB','LR','wb','37f3b962-aa5d-40d5-b6fd-5471875e64ce',null),
  ('WB','MB','wb','e620b231-1d1c-4196-b0d1-47d51c013be4',null),
  ('WB','NE','wb','f40337ea-c052-4185-96a7-29e1d6f0ac2c',null),
  ('WB','PW','wb','1775f9b3-94c0-4013-a7bc-7cfce115ed09',null),
  ('WB','RK','wb','ff8802e7-88b4-4719-b1a7-255e87aa643f',null),
  ('WB','SM','wb','8bc77ac3-ffe7-4884-984e-7becf71a4775',null),
  ('WB','SN','wb','a2770883-f58b-4735-a41e-b816ad17b914',null),
  ('WB','T7','wb','570527c9-c093-4ef9-8dff-89a2bfd43d82',null),
  ('WB','T9','wb','11dac8ce-e6dd-4ed1-a8e4-672bb98f3517',null),
  ('WB','WD','wb','dfd25b62-95d4-48e8-bfe0-b9adcb74501a',null),
  ('WB','WZ','wb','99afa4da-ee2f-49b0-bb0a-9c0b88b70d5e',null)
  ) as m(lcode, code, site, site_key, char_id)
  join core.licensor l on l.code = m.lcode
  join core.property p on p.licensor_id = l.id and p.code = m.code
) r;

create temp view mg06_step6_paths as
select * from mg06_step6_all r
where r.site_property_name is not null and (r.char_id is null or r.site_character_name is not null);

insert into core.property_site_path
  (property_id, licensor_site, site_property_name, site_property_id, site_character_name, site_character_id, source_evidence)
select r.property_id, r.site, r.site_property_name, r.site_property_id, r.site_character_name, r.char_id,
       'shared-db#6150 step 6: ColdLion MG06 ' || r.lcode || '/' || r.code || ' list 2026-11-12 FINAL; site vocab plm scrape id '
         || coalesce(r.site_property_id, 'local-key') || coalesce(' / character ' || r.char_id, '')
from mg06_step6_paths r
on conflict do nothing;

update core.property p set nickname = 'Mickey Group'
  from core.licensor l
 where l.id = p.licensor_id and l.code = 'DY' and p.code = 'MM'
   and p.name = 'Standard Characters' and p.nickname is null;

do $mg06_site_path_check$
declare v_n integer; v_bad integer; v_expected integer; v_catalog integer; v_props integer;
begin
  select count(*) into v_bad from core.property_site_path s join core.property p on p.id = s.property_id
   join core.licensor l on l.id = p.licensor_id
   where s.source_evidence like 'shared-db#6150 step 6%'
     and s.source_evidence not like '%MG06 ' || l.code || '/' || p.code || ' %'
     and s.source_evidence not like '%MG06 ' || p.code || ' list%';
  if v_bad > 0 then raise exception '#6150: % step-6 rows point at an unexpected property', v_bad; end if;
  -- Exact check: each resolvable step-6 path must exist as a current row for the same
  -- property, site, site property id and character (not merely any current row).
  select count(*) into v_expected from mg06_step6_paths;
  select count(*) into v_n from mg06_step6_paths q
   where exists (select 1 from core.property_site_path s
                  where s.property_id = q.property_id and s.is_current
                    and s.licensor_site = q.site
                    and s.site_property_id is not distinct from q.site_property_id
                    and s.site_character_id is not distinct from q.char_id);
  if v_n < v_expected then
    raise exception '#6150: % of % resolvable MG06 site paths are current', v_n, v_expected;
  end if;
  -- Where the full MG06 catalog is present (production: 117 properties), every one must
  -- resolve against the scrape; a smaller catalog (preview) checks only what it holds.
  select count(distinct property_id) into v_catalog from mg06_step6_all;
  select count(distinct property_id) into v_props from mg06_step6_paths;
  if v_catalog >= 117 and v_props < v_catalog then
    raise exception '#6150: only % of % MG06 properties resolve to a site path', v_props, v_catalog;
  end if;
  raise notice '#6150: % of % resolvable MG06 site paths are current (% of % properties)', v_n, v_expected, v_props, v_catalog;
end
$mg06_site_path_check$;

drop view if exists mg06_step6_paths;
drop view if exists mg06_step6_all;
