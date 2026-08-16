-- Issue #1049. Every value is invented and Warner-free. The transaction always rolls back.
begin;

insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,started_at)
values ('10490000-0000-4000-8000-000000000001',0,'wb_asset_normalized','loading',date '2099-04-09','synthetic',repeat('a',64),1,'synthetic','https://example.invalid',now());

insert into plm.wb_franchise(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000011','synthetic_franchise','f-1','Invented Franchise','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','f1','2099-01-01','2099-01-10');
insert into plm.wb_property(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000021','warner_product_catalogue','same-id','Invented Product Property','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','p1','2099-01-01','2099-01-10'),
 ('10490000-0000-4000-8000-000000000022','warner_art_assets','same-id','Invented Art Property','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','p2','2099-01-01','2099-01-10');
insert into plm.wb_style_guide_normalized(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash) values
 ('10490000-0000-4000-8000-000000000031','synthetic_style','s-1','Invented Style One','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','s1'),
 ('10490000-0000-4000-8000-000000000032','synthetic_style','s-2','Invented Style Two','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','s2');
insert into plm.wb_character_normalized(id,source_namespace,source_id,label,identity_method,capture_id,source_url,raw,source_hash) values
 ('10490000-0000-4000-8000-000000000041','synthetic_character','c-1','Invented Character One','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','c1'),
 ('10490000-0000-4000-8000-000000000042','synthetic_character','c-2','Invented Character Two','source_id','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','c2');
insert into plm.wb_asset_normalized(id,source_namespace,source_id,file_name,source_path,capture_id,source_url,raw,source_hash) values
 ('10490000-0000-4000-8000-000000000051','synthetic_asset','a-1','invented-1.bin','invented/1','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','a1'),
 ('10490000-0000-4000-8000-000000000052','synthetic_asset','a-2','invented-2.bin','invented/2','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','a2'),
 ('10490000-0000-4000-8000-000000000053','synthetic_asset','a-3','invented-3.bin','invented/3','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','a3');

insert into plm.wb_asset_franchise(asset_id,franchise_id,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000011','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','af1','2099-01-02','2099-01-08'),
 ('10490000-0000-4000-8000-000000000052','10490000-0000-4000-8000-000000000011','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','af2','2099-01-03','2099-01-09'),
 ('10490000-0000-4000-8000-000000000053','10490000-0000-4000-8000-000000000011','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','af3','2099-01-04','2099-01-10');
insert into plm.wb_asset_property(asset_id,property_id,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000021','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ap1','2099-01-01','2099-01-07'),
 ('10490000-0000-4000-8000-000000000052','10490000-0000-4000-8000-000000000021','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ap2','2099-01-02','2099-01-08'),
 ('10490000-0000-4000-8000-000000000053','10490000-0000-4000-8000-000000000022','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ap3','2099-01-02','2099-01-08');
insert into plm.wb_asset_style_guide_normalized(asset_id,style_guide_id,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000031','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','as1','2099-01-05','2099-01-11'),
 ('10490000-0000-4000-8000-000000000052','10490000-0000-4000-8000-000000000031','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','as2','2099-01-06','2099-01-12'),
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000032','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','as3','2099-01-05','2099-01-11');
insert into plm.wb_asset_character_normalized(asset_id,character_id,capture_id,source_url,raw,source_hash,first_seen_at,last_seen_at) values
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000041','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ac1','2099-01-04','2099-01-10'),
 ('10490000-0000-4000-8000-000000000052','10490000-0000-4000-8000-000000000041','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ac2','2099-01-05','2099-01-11'),
 ('10490000-0000-4000-8000-000000000051','10490000-0000-4000-8000-000000000042','10490000-0000-4000-8000-000000000001','https://example.invalid','{}','ac3','2099-01-04','2099-01-10');
insert into plm.wb_property_character_normalized(property_id,character_id,property_source_id,character_source_id,property_label,character_label,identity_fallback,capture_id,source_url,raw,source_hash)
values ('10490000-0000-4000-8000-000000000021','10490000-0000-4000-8000-000000000041','same-id','c-1','Invented Product Property','Invented Character One',false,'10490000-0000-4000-8000-000000000001','https://example.invalid','{}','direct');

do $contracts$
declare names text[]:=array['wb_inferred_franchise_property','wb_inferred_franchise_style_guide','wb_inferred_franchise_character','wb_inferred_style_guide_property','wb_inferred_property_character','wb_inferred_style_guide_character']; n text;
begin
 foreach n in array names loop
  if to_regclass('api.'||n) is null then raise exception 'expected inferred view is absent'; end if;
  if not coalesce((select 'security_invoker=true'=any(reloptions) from pg_class where oid=to_regclass('api.'||n)),false) then raise exception 'inferred view is not security invoker'; end if;
  if has_table_privilege('anon','api.'||n,'select') then raise exception 'anon may read inferred view'; end if;
  if not has_table_privilege('authenticated','api.'||n,'select') or not has_table_privilege('service_role','api.'||n,'select') then raise exception 'Warner API access pattern changed'; end if;
 end loop;
 if exists(select 1 from information_schema.columns where table_schema='api' and table_name=any(names) and column_name in ('raw','file_name','source_path','source_url','label')) then raise exception 'licensed asset or payload field escaped into an inferred view'; end if;
 if (select count(*) from api.wb_inferred_franchise_property where franchise_id='10490000-0000-4000-8000-000000000011')<>2 then raise exception 'many-to-many or namespace isolation was lost'; end if;
 if not exists(select 1 from api.wb_inferred_franchise_property where property_id='10490000-0000-4000-8000-000000000021' and via_asset_count=2 and support_asset_count=3 and support_ratio=0.666667 and evidence_strength='strong') then raise exception 'strong support count or ratio changed'; end if;
 if not exists(select 1 from api.wb_inferred_franchise_property where property_id='10490000-0000-4000-8000-000000000021' and first_seen_at='2099-01-02'::timestamptz and last_seen_at='2099-01-09'::timestamptz) then raise exception 'evidence timestamp semantics changed'; end if;
 if not exists(select 1 from api.wb_inferred_franchise_property where property_id='10490000-0000-4000-8000-000000000022' and property_source_namespace='warner_art_assets' and property_source_id='same-id' and via_asset_count=1 and evidence_strength='weak') then raise exception 'weak evidence or source namespace was lost'; end if;
 if not exists(select 1 from api.wb_inferred_property_character where property_id='10490000-0000-4000-8000-000000000021' and character_id='10490000-0000-4000-8000-000000000041' and via_asset_count=2 and support_ratio=1 and evidence_strength='universal' and evidence_type='inferred_asset_cooccurrence' and not is_direct) then raise exception 'universal inferred evidence changed'; end if;
 if not exists(select 1 from plm.wb_property_character_normalized where property_id='10490000-0000-4000-8000-000000000021' and character_id='10490000-0000-4000-8000-000000000041' and evidence_type='direct_warner_product_catalogue') then raise exception 'direct Warner assertion was not kept separate'; end if;
 if (select count(*) from api.wb_inferred_style_guide_character where style_guide_id='10490000-0000-4000-8000-000000000031')<>2 then raise exception 'multiple right-side relationships were collapsed'; end if;
 if exists(select 1 from api.wb_inferred_property_character where evidence_type<>'inferred_asset_cooccurrence' or is_direct) then raise exception 'inferred contract was misrepresented as direct'; end if;
 if exists(
  select 1 from (
   select first_seen_at,last_seen_at from api.wb_inferred_franchise_property
   union all select first_seen_at,last_seen_at from api.wb_inferred_franchise_style_guide
   union all select first_seen_at,last_seen_at from api.wb_inferred_franchise_character
   union all select first_seen_at,last_seen_at from api.wb_inferred_style_guide_property
   union all select first_seen_at,last_seen_at from api.wb_inferred_property_character
   union all select first_seen_at,last_seen_at from api.wb_inferred_style_guide_character
  ) evidence_windows where first_seen_at>last_seen_at
 ) then raise exception 'an inferred evidence window is inverted'; end if;
end
$contracts$;

-- Aggregate-only operational verification shape. It emits no source identities or licensed values.
select 'api.wb_inferred_franchise_property'::text as view_name,count(*)::bigint as pair_count,sum(via_asset_count)::bigint as total_support from api.wb_inferred_franchise_property
union all select 'api.wb_inferred_franchise_style_guide',count(*),sum(via_asset_count) from api.wb_inferred_franchise_style_guide
union all select 'api.wb_inferred_franchise_character',count(*),sum(via_asset_count) from api.wb_inferred_franchise_character
union all select 'api.wb_inferred_style_guide_property',count(*),sum(via_asset_count) from api.wb_inferred_style_guide_property
union all select 'api.wb_inferred_property_character',count(*),sum(via_asset_count) from api.wb_inferred_property_character
union all select 'api.wb_inferred_style_guide_character',count(*),sum(via_asset_count) from api.wb_inferred_style_guide_character;

rollback;
