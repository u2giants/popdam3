-- shared-db#6150 — plan_mg06_licensor_site_path.md step 6: populate core.property_site_path.
-- Source: owner's corrected ColdLion MG06 list ("ColdLion changes for Jamielynn - 2026-11-12 - FINAL",
-- tab "Property values"; actions Keep / Keep (already exists) / Keep + fix name / Reactivate = 128 codes).
-- Each code maps to core.property by core.property.code and to the scraped licensor-site vocabulary
-- by that site's own id. No licensed names in this file: names are read from the plm.* scrape at apply time.
-- Owner rulings (HANDOFF 2026-11-12T2100Z §4): MICKEY MOUSE -> OPA "Mickey Mouse Family" > character
-- "Mickey Mouse"; Mickey + anyone = MG06 "Standard Characters" -> OPA "Standard Characters"
-- (its core.property row now exists, created by #2541 migration 20261112225250).
-- 117 codes get one row. 11 codes have no supported licensor site (licensors without a scraped
-- submission site, or no core.property row) and get none here.
-- Owner ruling 2026-11-13 9:49 AM EST (#6150 comment 6856411242): Standard Characters is its own
-- property for all Mickey Group art. Its row exists (code MM); this also sets the nickname
-- "Mickey Group" (#6178 ruling) that 20261112205231 skipped because the row did not exist then.
-- Idempotent (on conflict do nothing). Inserts into core.property_site_path; sets one core.property nickname.
-- Rollback: delete from core.property_site_path where source_evidence like 'shared-db#6150 step 6%'.

do $mg06_site_path_populate$
declare v_n integer; v_expected constant integer := 117;
begin
  if to_regclass('core.property_site_path') is null then
    raise exception '#6150: core.property_site_path missing';
  end if;

  with m(code, site, site_key, char_id) as (values
    ('1D','disney_opa','92',null),('A1','disney_opa','103',null),('AC','disney_opa','101',null),
    ('AW','disney_opa','99',null),('BL','disney_opa','176',null),('BMB','disney_opa','104',null),
    ('CAR','disney_opa','177',null),('DUM','disney_opa','120',null),('DYP','disney_opa','1159106622',null),
    ('F2','disney_opa','1159075393',null),('F3','disney_opa','1159369426',null),('FZ','disney_opa','777',null),
    ('HM','disney_opa','397',null),('HSM','disney_opa','398',null),('LS','disney_opa','137',null),
    ('LSL','disney_opa','1159151809',null),('LTA','disney_opa','134',null),('MCG','disney_opa','401',null),
    ('MM','disney_opa','361','563'),('MMF','disney_opa','373','558'),('MU','disney_opa','333',null),
    ('NX','disney_opa','268',null),('PN','disney_opa','52',null),('RT','disney_opa','181',null),
    ('TS','disney_opa','1059',null),('UP','disney_opa','499',null),('WC','disney_opa','497',null),
    ('WP','disney_opa','494',null),('AD1','disney_opa','1159142494',null),('AV','disney_opa','709',null),
    ('DP','disney_opa','1108',null),('GM','disney_opa','1094',null),('MG','disney_opa','629',null),
    ('MSC','disney_opa','1159152015',null),('MV','disney_opa','634',null),('NF1','disney_opa','1159115273',null),
    ('NF2','disney_opa','1159115289',null),('SP','disney_opa','635',null),('SX','disney_opa','1159114229',null),
    ('VN','disney_opa','637',null),('WR','disney_opa','639',null),('B8','disney_opa','1159082095',null),
    ('BN','disney_opa','1159121470',null),('CB','disney_opa','908',null),('E9','disney_opa','1159082095',null),
    ('EM','disney_opa','917',null),('MD','disney_opa','1159089281',null),('PH','disney_opa','951',null),
    ('R1','disney_opa','1055',null),('RJ','disney_opa','913',null),('SW','disney_opa','908',null),
    ('VS','disney_opa','916',null),
    ('BTF','nbcu','3463',null),('CK','nbcu','3464',null),('ET','nbcu','1211',null),('FC','nbcu','2084',null),
    ('FF','nbcu','1345',null),('GD','nbcu','4818',null),('HD','nbcu','3422',null),('HN','nbcu','1829',null),
    ('JD','nbcu','1837',null),('JR','nbcu','3460',null),('JW','nbcu','1217',null),('MN','nbcu','2576',null),
    ('SF','nbcu','1088',null),('SH','nbcu','3475',null),('W1','nbcu','5128',null),('W2','nbcu','6367',null),
    ('WA','nbcu','3799',null),
    ('SC','sega','126',null),('SR','sega','127',null),
    ('AT','pmt_trackerplus','bd03eb784c85de3be8d7179166656d6ef01452f3965852af2cd457ba6a1aae24',null),
    ('CHR','pmt_trackerplus','a78f44f4c76c5854d276f4aeac88b5d5a04d499d4a3b2bde95728ce4523a905d',null),
    ('GE1','pmt_trackerplus','7eb07dab6bae24395858f445f9d02ce0d789167f9e57cc3e57dac3dbdd22d873',null),
    ('GH','pmt_trackerplus','5810d66ac44b8f2380962269fdc1829466753186aa086fec7482e012396babb9',null),
    ('NT','pmt_trackerplus','b0e25444e346e2a0d69c32cf74bd9745f8848fc29164a87bf7dda03fb58b7147',null),
    ('SB','pmt_trackerplus','bb6d2425b630031d0904b2a9b76e344aa1f101c0b7d6c1085f92818deabe5eb2',null),
    ('TU','pmt_trackerplus','5dbe1eb9778bad2f0c9bb0632e07292287d9e4d0e51047f0fb961154f5070900',null),
    ('PS','wb','65efa063-7947-422b-9d68-6cc8bd983bcc',null),('A4','wb','09f2c46b-964c-433b-a13f-c55fee770494',null),
    ('BA','wb','582035ee-5850-4df7-aa59-1f858212f025',null),('BG','wb','d34589c0-3a64-4f1a-9937-a79a1490e7d4',null),
    ('BM','wb','d34589c0-3a64-4f1a-9937-a79a1490e7d4',null),('C3','wb','79c6d511-c7e4-4f32-9958-c9e05b933b82',null),
    ('CS','wb','62381740-679e-4f18-8dda-d37123ac794e',null),('DH','wb','65efa063-7947-422b-9d68-6cc8bd983bcc',null),
    ('DK1','wb','b87f25be-728f-4c44-9142-a0830a1526c1',null),('DK2','wb','e905b4c6-6937-417b-916b-b422f4ee5fb4',null),
    ('EF','wb','d9ce0e26-f9c8-4919-a190-876124d654c6',null),('EX','wb','67830330-59a0-4d42-8765-c88e10814332',null),
    ('FJ','wb','47b51c4c-7932-49fb-9841-3688ec1c1750',null),('FM','wb','a81bbbdb-4c1d-407c-af82-0f8486196d0f',null),
    ('FN','wb','1f8bfaa9-24bc-4234-9340-df435aed6759',null),('FS','wb','a96c2415-05f6-43be-96d1-a2a723d69596',null),
    ('FT','wb','cd620d1a-57a0-43c5-961d-a267017b0e45',null),('GGS','wb','da499469-a4d3-42a7-9916-77a9bb6f06bd',null),
    ('GS','wb','80c13597-3a4e-40c3-a3f0-6383c0e2103d',null),('GT','wb','90b93c4e-93c7-46ab-a127-99cf146f87ab',null),
    ('H1','wb','fec78022-d386-4129-b817-205c57e20fdf',null),('H2','wb','eedf2e9e-3557-43a8-b7fd-7b9eade2f724',null),
    ('H3','wb','c9cd6357-afc8-4ae0-9046-75eccf5625a5',null),('H4','wb','b27e1d9e-6c78-48f2-aaea-17db29521142',null),
    ('H8','wb','4f9ff209-95f6-494b-a646-ee75b8829d80',null),('JG','wb','acead133-c8da-4d20-8762-f7b0ee5a9b2f',null),
    ('L1','wb','f9958913-3e87-427c-9676-6e907725f9bc',null),('LB','wb','cc51835c-d14c-4193-a32c-059a3cb1ab02',null),
    ('LR','wb','37f3b962-aa5d-40d5-b6fd-5471875e64ce',null),('MB','wb','e620b231-1d1c-4196-b0d1-47d51c013be4',null),
    ('NE','wb','f40337ea-c052-4185-96a7-29e1d6f0ac2c',null),('PW','wb','1775f9b3-94c0-4013-a7bc-7cfce115ed09',null),
    ('RK','wb','ff8802e7-88b4-4719-b1a7-255e87aa643f',null),('SM','wb','8bc77ac3-ffe7-4884-984e-7becf71a4775',null),
    ('SN','wb','a2770883-f58b-4735-a41e-b816ad17b914',null),('T7','wb','570527c9-c093-4ef9-8dff-89a2bfd43d82',null),
    ('T9','wb','11dac8ce-e6dd-4ed1-a8e4-672bb98f3517',null),('WD','wb','dfd25b62-95d4-48e8-bfe0-b9adcb74501a',null),
    ('WZ','wb','99afa4da-ee2f-49b0-bb0a-9c0b88b70d5e',null)),
  r as (
    select p.id as property_id, m.site, m.code, m.char_id,
      case m.site when 'pmt_trackerplus' then null else m.site_key end as site_property_id,
      case m.site
        when 'disney_opa' then (select o.property_name from plm.opa_property o where o.licensed_property_id::text = m.site_key)
        when 'nbcu' then (select min(n.property_label) from plm.nbcu_property n where n.property_source_id::text = m.site_key)
        when 'sega' then (select min(s.property_label) from plm.sega_submission_property s where s.property_source_id::text = m.site_key)
        when 'pmt_trackerplus' then (select min(t.exact_label) from plm.pmt_trackerplus_submission_property t where t.property_local_key = m.site_key)
        when 'wb' then (select min(w.label) from plm.wb_property w where w.source_id::text = m.site_key)
      end as site_property_name,
      case when m.char_id is null then null else
        (select min(c.character_name) from plm.opa_property_character c
          where c.licensed_property_id::text = m.site_key and c.character_id::text = m.char_id) end as site_character_name
    from m join core.property p on p.code = m.code)
  insert into core.property_site_path
    (property_id, licensor_site, site_property_name, site_property_id, site_character_name, site_character_id, source_evidence)
  select property_id, site, site_property_name, site_property_id, site_character_name, char_id,
         'shared-db#6150 step 6: ColdLion MG06 ' || code || ' list 2026-11-12 FINAL; site vocab plm scrape id '
           || coalesce(site_property_id, 'local-key') || coalesce(' / character ' || char_id, '')
  from r
  where site_property_name is not null and (char_id is null or site_character_name is not null)
  on conflict do nothing;

  update core.property set nickname = 'Mickey Group'
   where code = 'MM' and name = 'Standard Characters' and nickname is null;

  select count(distinct property_id) into v_n from core.property_site_path
   where is_current and source_evidence like 'shared-db#6150 step 6%';
  if v_n = v_expected then
    raise notice '#6150: % MG06 properties have a site path', v_n;
  else
    -- Preview may lack parts of the licensor scrape; production proof is the done-when.
    raise notice '#6150: only % of % MG06 properties resolved (scrape or property rows missing here)', v_n, v_expected;
  end if;
end
$mg06_site_path_populate$;
