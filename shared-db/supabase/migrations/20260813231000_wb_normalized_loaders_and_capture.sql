-- Issue #925: normalized loaders and additive-compatible capture routing.

alter table plm.wb_capture drop constraint wb_capture_target_chk;
alter table plm.wb_capture add constraint wb_capture_target_chk check (target in (
 'wb_franchise_property','wb_style_guide','wb_character','wb_asset','wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character','wb_property_character',
 'wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property',
 'wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence'));

create function plm.wb_validate_normalized_row(p_target text,p_row jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare allowed text[]; k text;
begin
 if jsonb_typeof(p_row)<>'object' then raise exception 'Warner normalized import refused: row is not an object.' using errcode='P0001'; end if;
 allowed:=case p_target
  when 'wb_franchise' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
  when 'wb_property' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
  when 'wb_character_normalized' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
  when 'wb_style_guide_normalized' then array['source_namespace','source_id','fallback_key','label','identity_method','source_url']
  when 'wb_asset_normalized' then array['source_namespace','source_id','warner_asset_id','file_name','source_path','season','file_size_bytes','source_created_at','source_modified_at','source_url']
  when 'wb_asset_franchise' then array['asset_namespace','asset_source_id','franchise_namespace','franchise_source_id','franchise_fallback_key','source_url']
  when 'wb_asset_property' then array['asset_namespace','asset_source_id','property_namespace','property_source_id','property_fallback_key','source_url']
  when 'wb_asset_character_normalized' then array['asset_namespace','asset_source_id','character_namespace','character_source_id','character_fallback_key','source_url']
  when 'wb_asset_style_guide_normalized' then array['asset_namespace','asset_source_id','style_guide_namespace','style_guide_source_id','style_guide_fallback_key','source_url']
  when 'wb_property_character_normalized' then array['property_namespace','property_source_id','property_fallback_key','character_namespace','character_source_id','character_fallback_key','property_label','character_label','identity_fallback','source_url']
  when 'wb_franchise_property_evidence' then array['franchise_namespace','franchise_source_id','franchise_fallback_key','property_namespace','property_source_id','property_fallback_key','evidence_source','source_url'] end;
 foreach k in array array(select jsonb_object_keys(p_row)) loop
  if not k=any(allowed) or k~*'(token|secret|password|cookie|authorization|session)' then raise exception 'Warner normalized import refused: unexpected or forbidden field.' using errcode='P0001'; end if;
 end loop;
 if btrim(coalesce(p_row->>'source_url',''))='' or p_row->>'source_url'~'[?#]' then raise exception 'Warner normalized import refused: source URL must be an origin.' using errcode='P0001'; end if;
 if p_target in('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized') and not (
   btrim(coalesce(p_row->>'source_namespace',''))<>'' and btrim(coalesce(p_row->>'label',''))<>'' and
   ((p_row->>'identity_method'='source_id' and btrim(coalesce(p_row->>'source_id',''))<>'' and nullif(btrim(p_row->>'fallback_key'),'') is null) or
    (p_row->>'identity_method'='natural_key_fallback' and nullif(btrim(p_row->>'source_id'),'') is null and btrim(coalesce(p_row->>'fallback_key',''))<>'')))
 then raise exception 'Warner normalized import refused: identity fields are inconsistent.' using errcode='P0001'; end if;
 if p_target='wb_property' and p_row->>'source_namespace' not in('warner_product_catalogue','warner_art_assets') then raise exception 'Warner normalized import refused: Property namespace is invalid.' using errcode='P0001'; end if;
 if p_target='wb_asset_normalized' then
  if btrim(coalesce(p_row->>'source_namespace',''))='' or btrim(coalesce(p_row->>'source_id',''))='' or btrim(coalesce(p_row->>'file_name',''))='' or btrim(coalesce(p_row->>'source_path',''))='' then raise exception 'Warner normalized import refused: Asset identity is incomplete.' using errcode='P0001'; end if;
  begin
   perform (p_row->>'file_size_bytes')::bigint where p_row ? 'file_size_bytes';
   perform (p_row->>'source_created_at')::timestamptz where p_row ? 'source_created_at';
   perform (p_row->>'source_modified_at')::timestamptz where p_row ? 'source_modified_at';
  exception when others then raise exception 'Warner normalized import refused: an Asset value is invalid.' using errcode='P0001'; end;
 end if;
 if p_target like 'wb_asset_%' and p_target<>'wb_asset_normalized' and (btrim(coalesce(p_row->>'asset_namespace',''))='' or btrim(coalesce(p_row->>'asset_source_id',''))='') then raise exception 'Warner normalized import refused: Asset endpoint is incomplete.' using errcode='P0001'; end if;
 if p_target in('wb_asset_property','wb_property_character_normalized','wb_franchise_property_evidence') and (p_row->>'property_namespace' not in('warner_product_catalogue','warner_art_assets') or ((nullif(btrim(p_row->>'property_source_id'),'') is null)=(nullif(btrim(p_row->>'property_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Property endpoint identity is invalid.' using errcode='P0001'; end if;
 if p_target in('wb_asset_franchise','wb_franchise_property_evidence') and (btrim(coalesce(p_row->>'franchise_namespace',''))='' or ((nullif(btrim(p_row->>'franchise_source_id'),'') is null)=(nullif(btrim(p_row->>'franchise_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Franchise endpoint identity is invalid.' using errcode='P0001'; end if;
 if p_target in('wb_asset_character_normalized','wb_property_character_normalized') and (btrim(coalesce(p_row->>'character_namespace',''))='' or ((nullif(btrim(p_row->>'character_source_id'),'') is null)=(nullif(btrim(p_row->>'character_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Character endpoint identity is invalid.' using errcode='P0001'; end if;
 if p_target='wb_asset_style_guide_normalized' and (btrim(coalesce(p_row->>'style_guide_namespace',''))='' or ((nullif(btrim(p_row->>'style_guide_source_id'),'') is null)=(nullif(btrim(p_row->>'style_guide_fallback_key'),'') is null))) then raise exception 'Warner normalized import refused: Style Guide endpoint identity is invalid.' using errcode='P0001'; end if;
 if p_target='wb_property_character_normalized' and (btrim(coalesce(p_row->>'property_label',''))='' or btrim(coalesce(p_row->>'character_label',''))='') then raise exception 'Warner normalized import refused: direct relationship labels are required.' using errcode='P0001'; end if;
 if p_target='wb_property_character_normalized' and p_row ? 'identity_fallback' then
  begin perform (p_row->>'identity_fallback')::boolean;
  exception when others then raise exception 'Warner normalized import refused: a relationship value is invalid.' using errcode='P0001'; end;
 end if;
 if p_target='wb_franchise_property_evidence' and btrim(coalesce(p_row->>'evidence_source',''))='' then raise exception 'Warner normalized import refused: direct evidence source is required.' using errcode='P0001'; end if;
end $$;

create or replace function plm.sync_wb_normalized_target(p_capture_id uuid,p_target text,p_snapshot jsonb,p_mode text default 'mirror_only',p_max_shrink_fraction numeric default 0.10)
returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text)
language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare x jsonb; cid uuid; n integer:=0; a uuid; b uuid; capdate date; sh text; v_header plm.wb_capture%rowtype; v_bad integer; v_before integer:=0; v_matched integer:=0; v_same integer:=0; v_inserted integer:=0; v_updated integer:=0; v_unchanged integer:=0; v_missing integer:=0;
begin
 if not plm.wb_loader_privilege_ok(auth.role(),session_user) then raise exception 'Warner normalized import refused: caller is not permitted.' using errcode='P0001'; end if;
 if p_mode<>'mirror_only' then raise exception 'Warner normalized import refused: mirror_only is required.' using errcode='P0001'; end if;
 if p_target not in ('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property','wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence') then raise exception 'Warner normalized import refused: unknown target.' using errcode='P0001'; end if;
 if p_max_shrink_fraction is null or p_max_shrink_fraction<0 or p_max_shrink_fraction>1 then raise exception 'Warner normalized import refused: shrink bound is invalid.' using errcode='P0001'; end if;
 if jsonb_typeof(p_snapshot)<>'object' or jsonb_typeof(p_snapshot->'rows')<>'array' or jsonb_array_length(p_snapshot->'rows')=0 then raise exception 'Warner normalized import refused: invalid snapshot shape.' using errcode='P0001'; end if;
 if exists(select 1 from jsonb_object_keys(p_snapshot) k where k not in('captured_at','rows')) then raise exception 'Warner normalized import refused: unexpected snapshot field.' using errcode='P0001'; end if;
 begin capdate:=(p_snapshot->>'captured_at')::date;
 exception when others then raise exception 'Warner normalized import refused: captured date is invalid.' using errcode='P0001'; end;
 sh:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
 select * into v_header from plm.wb_capture where capture_id=p_capture_id and chunk_number=0 for update;
 if v_header.capture_id is null or v_header.status<>'validating' or v_header.target<>p_target then raise exception 'Warner normalized import refused: capture identity or target does not match.' using errcode='P0001'; end if;
 cid:=p_capture_id;
 -- Reject malformed, unexpected, or secret-like input before the first write.
 for x in select value from jsonb_array_elements(p_snapshot->'rows') loop
  perform plm.wb_validate_normalized_row(p_target,x);
 end loop;
 -- Duplicate source identities or endpoint pairs are refused as one atomic preflight.
 select count(*) into v_bad from (
  select case
   when p_target in('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized') then concat_ws('|',value->>'source_namespace',coalesce(nullif(value->>'source_id',''),'fallback:'||(value->>'fallback_key')))
   when p_target='wb_asset_normalized' then concat_ws('|',value->>'source_namespace',value->>'source_id')
   when p_target='wb_asset_franchise' then concat_ws('|',value->>'asset_namespace',value->>'asset_source_id',value->>'franchise_namespace',coalesce(nullif(value->>'franchise_source_id',''),'fallback:'||(value->>'franchise_fallback_key')))
   when p_target='wb_asset_property' then concat_ws('|',value->>'asset_namespace',value->>'asset_source_id',value->>'property_namespace',coalesce(nullif(value->>'property_source_id',''),'fallback:'||(value->>'property_fallback_key')))
   when p_target='wb_asset_character_normalized' then concat_ws('|',value->>'asset_namespace',value->>'asset_source_id',value->>'character_namespace',coalesce(nullif(value->>'character_source_id',''),'fallback:'||(value->>'character_fallback_key')))
   when p_target='wb_asset_style_guide_normalized' then concat_ws('|',value->>'asset_namespace',value->>'asset_source_id',value->>'style_guide_namespace',coalesce(nullif(value->>'style_guide_source_id',''),'fallback:'||(value->>'style_guide_fallback_key')))
   when p_target='wb_property_character_normalized' then concat_ws('|',value->>'property_namespace',coalesce(nullif(value->>'property_source_id',''),'fallback:'||(value->>'property_fallback_key')),value->>'character_namespace',coalesce(nullif(value->>'character_source_id',''),'fallback:'||(value->>'character_fallback_key')))
   else concat_ws('|',value->>'franchise_namespace',coalesce(nullif(value->>'franchise_source_id',''),'fallback:'||(value->>'franchise_fallback_key')),value->>'property_namespace',coalesce(nullif(value->>'property_source_id',''),'fallback:'||(value->>'property_fallback_key')),value->>'evidence_source') end identity_key,
   count(*) from jsonb_array_elements(p_snapshot->'rows') group by 1 having count(*)>1
 ) duplicates;
 if v_bad<>0 then raise exception 'Warner normalized import refused: duplicate identities or links.' using errcode='P0001'; end if;
 n:=jsonb_array_length(p_snapshot->'rows');
 if p_target='wb_franchise' then
  select count(*) into v_before from plm.wb_franchise;
  select count(*),count(*) filter(where t.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_franchise t on t.source_namespace=j.value->>'source_namespace' and ((t.source_id is not null and t.source_id=j.value->>'source_id') or (t.source_id is null and t.fallback_key=j.value->>'fallback_key'));
 elsif p_target='wb_property' then
  select count(*) into v_before from plm.wb_property;
  select count(*),count(*) filter(where t.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_property t on t.source_namespace=j.value->>'source_namespace' and ((t.source_id is not null and t.source_id=j.value->>'source_id') or (t.source_id is null and t.fallback_key=j.value->>'fallback_key'));
 elsif p_target='wb_character_normalized' then
  select count(*) into v_before from plm.wb_character_normalized;
  select count(*),count(*) filter(where t.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_character_normalized t on t.source_namespace=j.value->>'source_namespace' and ((t.source_id is not null and t.source_id=j.value->>'source_id') or (t.source_id is null and t.fallback_key=j.value->>'fallback_key'));
 elsif p_target='wb_style_guide_normalized' then
  select count(*) into v_before from plm.wb_style_guide_normalized;
  select count(*),count(*) filter(where t.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_style_guide_normalized t on t.source_namespace=j.value->>'source_namespace' and ((t.source_id is not null and t.source_id=j.value->>'source_id') or (t.source_id is null and t.fallback_key=j.value->>'fallback_key'));
 elsif p_target='wb_asset_normalized' then
  select count(*) into v_before from plm.wb_asset_normalized;
  select count(*),count(*) filter(where t.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_asset_normalized t on t.source_namespace=j.value->>'source_namespace' and t.source_id=j.value->>'source_id';
 elsif p_target='wb_asset_franchise' then
  select count(*) into v_before from plm.wb_asset_franchise;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_asset_normalized a on a.source_namespace=j.value->>'asset_namespace' and a.source_id=j.value->>'asset_source_id' join plm.wb_franchise b on b.source_namespace=j.value->>'franchise_namespace' and ((b.source_id is not null and b.source_id=j.value->>'franchise_source_id') or (b.source_id is null and b.fallback_key=j.value->>'franchise_fallback_key')) join plm.wb_asset_franchise l on l.asset_id=a.id and l.franchise_id=b.id;
 elsif p_target='wb_asset_property' then
  select count(*) into v_before from plm.wb_asset_property;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_asset_normalized a on a.source_namespace=j.value->>'asset_namespace' and a.source_id=j.value->>'asset_source_id' join plm.wb_property b on b.source_namespace=j.value->>'property_namespace' and ((b.source_id is not null and b.source_id=j.value->>'property_source_id') or (b.source_id is null and b.fallback_key=j.value->>'property_fallback_key')) join plm.wb_asset_property l on l.asset_id=a.id and l.property_id=b.id;
 elsif p_target='wb_asset_character_normalized' then
  select count(*) into v_before from plm.wb_asset_character_normalized;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_asset_normalized a on a.source_namespace=j.value->>'asset_namespace' and a.source_id=j.value->>'asset_source_id' join plm.wb_character_normalized b on b.source_namespace=j.value->>'character_namespace' and ((b.source_id is not null and b.source_id=j.value->>'character_source_id') or (b.source_id is null and b.fallback_key=j.value->>'character_fallback_key')) join plm.wb_asset_character_normalized l on l.asset_id=a.id and l.character_id=b.id;
 elsif p_target='wb_asset_style_guide_normalized' then
  select count(*) into v_before from plm.wb_asset_style_guide_normalized;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_asset_normalized a on a.source_namespace=j.value->>'asset_namespace' and a.source_id=j.value->>'asset_source_id' join plm.wb_style_guide_normalized b on b.source_namespace=j.value->>'style_guide_namespace' and ((b.source_id is not null and b.source_id=j.value->>'style_guide_source_id') or (b.source_id is null and b.fallback_key=j.value->>'style_guide_fallback_key')) join plm.wb_asset_style_guide_normalized l on l.asset_id=a.id and l.style_guide_id=b.id;
 elsif p_target='wb_property_character_normalized' then
  select count(*) into v_before from plm.wb_property_character_normalized;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_property a on a.source_namespace=j.value->>'property_namespace' and ((a.source_id is not null and a.source_id=j.value->>'property_source_id') or (a.source_id is null and a.fallback_key=j.value->>'property_fallback_key')) join plm.wb_character_normalized b on b.source_namespace=j.value->>'character_namespace' and ((b.source_id is not null and b.source_id=j.value->>'character_source_id') or (b.source_id is null and b.fallback_key=j.value->>'character_fallback_key')) join plm.wb_property_character_normalized l on l.property_id=a.id and l.character_id=b.id;
 else
  select count(*) into v_before from plm.wb_franchise_property_evidence;
  select count(*),count(*) filter(where l.source_hash=encode(sha256(convert_to(j.value::text,'UTF8')),'hex')) into v_matched,v_same from jsonb_array_elements(p_snapshot->'rows') j join plm.wb_franchise a on a.source_namespace=j.value->>'franchise_namespace' and ((a.source_id is not null and a.source_id=j.value->>'franchise_source_id') or (a.source_id is null and a.fallback_key=j.value->>'franchise_fallback_key')) join plm.wb_property b on b.source_namespace=j.value->>'property_namespace' and ((b.source_id is not null and b.source_id=j.value->>'property_source_id') or (b.source_id is null and b.fallback_key=j.value->>'property_fallback_key')) join plm.wb_franchise_property_evidence l on l.franchise_id=a.id and l.property_id=b.id and l.evidence_source=j.value->>'evidence_source';
 end if;
 v_inserted:=n-v_matched; v_updated:=v_matched-v_same; v_unchanged:=v_same; v_missing:=greatest(v_before-v_matched,0);
 if v_before>0 and (v_missing::numeric/v_before::numeric)>p_max_shrink_fraction then raise exception 'Warner normalized import refused: missing prior identities exceed the approved shrink bound.' using errcode='P0001'; end if;
 for x in select value from jsonb_array_elements(p_snapshot->'rows') loop
  if p_target='wb_franchise' then
   insert into plm.wb_franchise(source_namespace,source_id,fallback_key,label,identity_method,capture_id,source_url,raw,source_hash)
   values(x->>'source_namespace',nullif(btrim(x->>'source_id'),''),nullif(btrim(x->>'fallback_key'),''),x->>'label',x->>'identity_method',cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict do nothing;
   update plm.wb_franchise set label=x->>'label',source_url=x->>'source_url',capture_id=cid,capture_chunk=0,raw=x,source_hash=encode(sha256(convert_to(x::text,'UTF8')),'hex'),last_seen_at=now(),updated_at=now()
    where source_namespace=x->>'source_namespace' and ((source_id is not null and source_id=x->>'source_id') or (source_id is null and fallback_key=x->>'fallback_key')) and source_hash is distinct from encode(sha256(convert_to(x::text,'UTF8')),'hex');
  elsif p_target='wb_property' then
   insert into plm.wb_property(source_namespace,source_id,fallback_key,label,identity_method,capture_id,source_url,raw,source_hash)
   values(x->>'source_namespace',nullif(btrim(x->>'source_id'),''),nullif(btrim(x->>'fallback_key'),''),x->>'label',x->>'identity_method',cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict do nothing;
   update plm.wb_property set label=x->>'label',source_url=x->>'source_url',capture_id=cid,capture_chunk=0,raw=x,source_hash=encode(sha256(convert_to(x::text,'UTF8')),'hex'),last_seen_at=now(),updated_at=now()
    where source_namespace=x->>'source_namespace' and ((source_id is not null and source_id=x->>'source_id') or (source_id is null and fallback_key=x->>'fallback_key')) and source_hash is distinct from encode(sha256(convert_to(x::text,'UTF8')),'hex');
  elsif p_target='wb_character_normalized' then
   insert into plm.wb_character_normalized(source_namespace,source_id,fallback_key,label,identity_method,capture_id,source_url,raw,source_hash)
   values(x->>'source_namespace',nullif(btrim(x->>'source_id'),''),nullif(btrim(x->>'fallback_key'),''),x->>'label',x->>'identity_method',cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict do nothing;
   update plm.wb_character_normalized set label=x->>'label',source_url=x->>'source_url',capture_id=cid,capture_chunk=0,raw=x,source_hash=encode(sha256(convert_to(x::text,'UTF8')),'hex'),last_seen_at=now(),updated_at=now()
    where source_namespace=x->>'source_namespace' and ((source_id is not null and source_id=x->>'source_id') or (source_id is null and fallback_key=x->>'fallback_key')) and source_hash is distinct from encode(sha256(convert_to(x::text,'UTF8')),'hex');
  elsif p_target='wb_style_guide_normalized' then
   insert into plm.wb_style_guide_normalized(source_namespace,source_id,fallback_key,label,identity_method,capture_id,source_url,raw,source_hash)
   values(x->>'source_namespace',nullif(btrim(x->>'source_id'),''),nullif(btrim(x->>'fallback_key'),''),x->>'label',x->>'identity_method',cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict do nothing;
   update plm.wb_style_guide_normalized set label=x->>'label',source_url=x->>'source_url',capture_id=cid,capture_chunk=0,raw=x,source_hash=encode(sha256(convert_to(x::text,'UTF8')),'hex'),last_seen_at=now(),updated_at=now()
    where source_namespace=x->>'source_namespace' and ((source_id is not null and source_id=x->>'source_id') or (source_id is null and fallback_key=x->>'fallback_key')) and source_hash is distinct from encode(sha256(convert_to(x::text,'UTF8')),'hex');
  elsif p_target='wb_asset_normalized' then
   insert into plm.wb_asset_normalized(source_namespace,source_id,warner_asset_id,file_name,source_path,season,file_size_bytes,source_created_at,source_modified_at,capture_id,source_url,raw,source_hash)
   values(x->>'source_namespace',x->>'source_id',x->>'warner_asset_id',x->>'file_name',x->>'source_path',x->>'season',(x->>'file_size_bytes')::bigint,(x->>'source_created_at')::timestamptz,(x->>'source_modified_at')::timestamptz,cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict(source_namespace,source_id) do update set warner_asset_id=excluded.warner_asset_id,file_name=excluded.file_name,source_path=excluded.source_path,season=excluded.season,file_size_bytes=excluded.file_size_bytes,source_created_at=excluded.source_created_at,source_modified_at=excluded.source_modified_at,capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_asset_normalized.source_hash is distinct from excluded.source_hash;
  elsif p_target='wb_asset_franchise' then
   select id into a from plm.wb_asset_normalized where source_namespace=x->>'asset_namespace' and source_id=x->>'asset_source_id';
   select id into b from plm.wb_franchise where source_namespace=x->>'franchise_namespace' and ((source_id is not null and source_id=x->>'franchise_source_id') or (source_id is null and fallback_key=x->>'franchise_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_asset_franchise(asset_id,franchise_id,capture_id,capture_chunk,source_url,raw,source_hash) values(a,b,cid,0,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex')) on conflict(asset_id,franchise_id) do update set capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_asset_franchise.source_hash is distinct from excluded.source_hash;
  elsif p_target='wb_asset_property' then
   select id into a from plm.wb_asset_normalized where source_namespace=x->>'asset_namespace' and source_id=x->>'asset_source_id';
   select id into b from plm.wb_property where source_namespace=x->>'property_namespace' and ((source_id is not null and source_id=x->>'property_source_id') or (source_id is null and fallback_key=x->>'property_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_asset_property(asset_id,property_id,capture_id,capture_chunk,source_url,raw,source_hash) values(a,b,cid,0,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex')) on conflict(asset_id,property_id) do update set capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_asset_property.source_hash is distinct from excluded.source_hash;
  elsif p_target='wb_asset_character_normalized' then
   select id into a from plm.wb_asset_normalized where source_namespace=x->>'asset_namespace' and source_id=x->>'asset_source_id';
   select id into b from plm.wb_character_normalized where source_namespace=x->>'character_namespace' and ((source_id is not null and source_id=x->>'character_source_id') or (source_id is null and fallback_key=x->>'character_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_asset_character_normalized(asset_id,character_id,capture_id,capture_chunk,source_url,raw,source_hash) values(a,b,cid,0,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex')) on conflict(asset_id,character_id) do update set capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_asset_character_normalized.source_hash is distinct from excluded.source_hash;
  elsif p_target='wb_asset_style_guide_normalized' then
   select id into a from plm.wb_asset_normalized where source_namespace=x->>'asset_namespace' and source_id=x->>'asset_source_id';
   select id into b from plm.wb_style_guide_normalized where source_namespace=x->>'style_guide_namespace' and ((source_id is not null and source_id=x->>'style_guide_source_id') or (source_id is null and fallback_key=x->>'style_guide_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_asset_style_guide_normalized(asset_id,style_guide_id,capture_id,capture_chunk,source_url,raw,source_hash) values(a,b,cid,0,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex')) on conflict(asset_id,style_guide_id) do update set capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_asset_style_guide_normalized.source_hash is distinct from excluded.source_hash;
  elsif p_target='wb_property_character_normalized' then
   select id into a from plm.wb_property where source_namespace=x->>'property_namespace' and ((source_id is not null and source_id=x->>'property_source_id') or (source_id is null and fallback_key=x->>'property_fallback_key'));
   select id into b from plm.wb_character_normalized where source_namespace=x->>'character_namespace' and ((source_id is not null and source_id=x->>'character_source_id') or (source_id is null and fallback_key=x->>'character_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_property_character_normalized(property_id,character_id,property_source_id,character_source_id,property_label,character_label,identity_fallback,capture_id,source_url,raw,source_hash)
   values(a,b,x->>'property_source_id',x->>'character_source_id',x->>'property_label',x->>'character_label',coalesce((x->>'identity_fallback')::boolean,false),cid,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex'))
   on conflict(property_id,character_id) do update set property_source_id=excluded.property_source_id,character_source_id=excluded.character_source_id,property_label=excluded.property_label,character_label=excluded.character_label,identity_fallback=excluded.identity_fallback,capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_property_character_normalized.source_hash is distinct from excluded.source_hash;
  else
   select id into a from plm.wb_franchise where source_namespace=x->>'franchise_namespace' and ((source_id is not null and source_id=x->>'franchise_source_id') or (source_id is null and fallback_key=x->>'franchise_fallback_key'));
   select id into b from plm.wb_property where source_namespace=x->>'property_namespace' and ((source_id is not null and source_id=x->>'property_source_id') or (source_id is null and fallback_key=x->>'property_fallback_key'));
   if a is null or b is null then raise exception 'Warner normalized relationship refused: unresolved endpoint.' using errcode='P0001'; end if;
   insert into plm.wb_franchise_property_evidence(franchise_id,property_id,evidence_type,evidence_source,capture_id,capture_chunk,source_url,raw,source_hash) values(a,b,'direct_warner_source',x->>'evidence_source',cid,0,x->>'source_url',x,encode(sha256(convert_to(x::text,'UTF8')),'hex')) on conflict(franchise_id,property_id,evidence_source) do update set evidence_type=excluded.evidence_type,capture_id=excluded.capture_id,capture_chunk=excluded.capture_chunk,source_url=excluded.source_url,raw=excluded.raw,source_hash=excluded.source_hash,last_seen_at=now(),updated_at=now() where plm.wb_franchise_property_evidence.source_hash is distinct from excluded.source_hash;
  end if;
 end loop;
 return query select 'mirror_only'::text,capdate,n,n,v_inserted,v_updated,v_unchanged,0,v_missing,0,sh;
end $$;

-- The eleven exact loader names are thin, fixed-target wrappers around one audited implementation.
create function plm.sync_wb_franchise(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_franchise',$2,$3,$4)$$;
create function plm.sync_wb_property(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_property',$2,$3,$4)$$;
create function plm.sync_wb_character_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_character_normalized',$2,$3,$4)$$;
create function plm.sync_wb_style_guide_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_style_guide_normalized',$2,$3,$4)$$;
create function plm.sync_wb_asset_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_asset_normalized',$2,$3,$4)$$;
create function plm.sync_wb_asset_franchise(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_asset_franchise',$2,$3,$4)$$;
create function plm.sync_wb_asset_property(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_asset_property',$2,$3,$4)$$;
create function plm.sync_wb_asset_character_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_asset_character_normalized',$2,$3,$4)$$;
create function plm.sync_wb_asset_style_guide_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_asset_style_guide_normalized',$2,$3,$4)$$;
create function plm.sync_wb_property_character_normalized(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_property_character_normalized',$2,$3,$4)$$;
create function plm.sync_wb_franchise_property_evidence(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $$select * from plm.sync_wb_normalized_target($1,'wb_franchise_property_evidence',$2,$3,$4)$$;

-- Keep the shipped implementations intact under private compatibility names.
alter function plm.begin_wb_capture(text,date,text,text,integer,text,text,text) rename to begin_wb_capture_legacy;
alter function plm.finalize_wb_capture(uuid,text,numeric) rename to finalize_wb_capture_legacy;

create function plm.begin_wb_capture(p_target text,p_captured_at date,p_private_source_commit text,p_snapshot_sha256 text,p_expected_row_count integer,p_captured_by text,p_source_url text,p_notes text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare c uuid;
begin
 if p_target in ('wb_franchise_property','wb_style_guide','wb_character','wb_asset','wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character','wb_property_character') then
  return plm.begin_wb_capture_legacy(p_target,p_captured_at,p_private_source_commit,p_snapshot_sha256,p_expected_row_count,p_captured_by,p_source_url,p_notes);
 end if;
 if p_target not in ('wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property','wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence') then raise exception 'Warner capture refused: unknown target.' using errcode='P0001'; end if;
 if not plm.wb_loader_privilege_ok(auth.role(),session_user) then raise exception 'Warner capture refused: caller is not permitted.' using errcode='P0001'; end if;
 if p_captured_at is null or p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[0-9a-f]{64}$' or p_expected_row_count is null or p_expected_row_count<=0 or btrim(coalesce(p_private_source_commit,''))='' or btrim(coalesce(p_captured_by,''))='' or btrim(coalesce(p_source_url,''))='' or p_source_url~'[?#]' then raise exception 'Warner capture refused: invalid manifest metadata.' using errcode='P0001'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('plm.wb_capture_import')::bigint);
 select capture_id into c from plm.wb_capture where chunk_number=0 and status in('loading','validating') and target=p_target and snapshot_sha256=p_snapshot_sha256 and private_source_commit=p_private_source_commit limit 1;
 if c is not null then return c; end if;
 c:=extensions.gen_random_uuid();
 insert into plm.wb_capture(capture_id,chunk_number,target,status,captured_at,private_source_commit,snapshot_sha256,expected_row_count,captured_by,source_url,notes,started_at) values(c,0,p_target,'loading',p_captured_at,p_private_source_commit,p_snapshot_sha256,p_expected_row_count,p_captured_by,p_source_url,p_notes,now());
 return c;
end $$;

create function plm.finalize_wb_capture(p_capture_id uuid,p_snapshot_sha256 text,p_max_shrink_fraction numeric default 0.10)
returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text)
language plpgsql security definer set search_path=pg_catalog,extensions as $$
declare h plm.wb_capture%rowtype; chunks integer; maxchunk integer; total integer; chain text; snap jsonb; report jsonb; r record;
begin
 select * into h from plm.wb_capture where capture_id=p_capture_id and chunk_number=0 for update;
 if h.target in ('wb_franchise_property','wb_style_guide','wb_character','wb_asset','wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character','wb_property_character') then return query select * from plm.finalize_wb_capture_legacy(p_capture_id,p_snapshot_sha256,p_max_shrink_fraction); return; end if;
 if not plm.wb_loader_privilege_ok(auth.role(),session_user) or h.capture_id is null or h.status not in('loading','validating') or p_snapshot_sha256 is distinct from h.snapshot_sha256 then raise exception 'Warner finalize refused: invalid capture state.' using errcode='P0001'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('plm.wb_capture_import')::bigint);
 update plm.wb_capture set status='validating' where capture_id=p_capture_id and chunk_number=0;
 select count(*),coalesce(max(chunk_number),0),coalesce(sum(payload_row_count),0) into chunks,maxchunk,total from plm.wb_capture where capture_id=p_capture_id and chunk_number>=1;
 if chunks=0 or maxchunk<>chunks or total<>h.expected_row_count then raise exception 'Warner finalize refused: incomplete chunk set.' using errcode='P0001'; end if;
 select encode(sha256(convert_to(string_agg(chunk_sha256,E'\n' order by chunk_number),'UTF8')),'hex') into chain from plm.wb_capture where capture_id=p_capture_id and chunk_number>=1;
 if chain is distinct from h.snapshot_sha256 then raise exception 'Warner finalize refused: manifest digest mismatch.' using errcode='P0001'; end if;
 select jsonb_build_object('captured_at',to_char(h.captured_at,'YYYY-MM-DD'),'rows',jsonb_agg(e.value order by c.chunk_number,e.ord)) into snap from plm.wb_capture c cross join lateral jsonb_array_elements(c.payload) with ordinality e(value,ord) where c.capture_id=p_capture_id and c.chunk_number>=1;
 select * into r from plm.sync_wb_normalized_target(p_capture_id,h.target,snap,'mirror_only',p_max_shrink_fraction); report:=to_jsonb(r);
 update plm.wb_capture set status='complete',completed_at=now(),loader_report=report,failure_message=null where capture_id=p_capture_id and chunk_number=0;
 update plm.wb_capture set payload=null,payload_cleared_at=now() where capture_id=p_capture_id and chunk_number>=1;
 return query select (report->>'mode')::text,(report->>'snapshot_captured_at')::date,(report->>'rows_seen')::integer,(report->>'rows_landed')::integer,(report->>'rows_inserted')::integer,(report->>'rows_updated')::integer,(report->>'rows_unchanged')::integer,(report->>'rows_collapsed')::integer,(report->>'rows_missing')::integer,(report->>'rows_orphan_identity')::integer,(report->>'snapshot_hash')::text;
end $$;

revoke all on function plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric) to service_role;
revoke all on function plm.wb_validate_normalized_row(text,jsonb) from public,anon,authenticated;
grant execute on function plm.wb_validate_normalized_row(text,jsonb) to service_role;
revoke all on function plm.begin_wb_capture(text,date,text,text,integer,text,text,text),plm.finalize_wb_capture(uuid,text,numeric) from public,anon,authenticated;
grant execute on function plm.begin_wb_capture(text,date,text,text,integer,text,text,text),plm.finalize_wb_capture(uuid,text,numeric) to service_role;
-- Public normalized wrappers intentionally expose the same controlled service-role-only contract.
do $$ declare n text; begin foreach n in array array['wb_franchise','wb_property','wb_character_normalized','wb_style_guide_normalized','wb_asset_normalized','wb_asset_franchise','wb_asset_property','wb_asset_character_normalized','wb_asset_style_guide_normalized','wb_property_character_normalized','wb_franchise_property_evidence'] loop execute format('create function public.sync_%1$s(uuid,jsonb,text,numeric) returns table(mode text,snapshot_captured_at date,rows_seen integer,rows_landed integer,rows_inserted integer,rows_updated integer,rows_unchanged integer,rows_collapsed integer,rows_missing integer,rows_orphan_identity integer,snapshot_hash text) language sql security definer set search_path=pg_catalog as $f$select * from plm.sync_%1$s($1,$2,$3,$4)$f$; revoke all on function public.sync_%1$s(uuid,jsonb,text,numeric) from public,anon,authenticated; grant execute on function public.sync_%1$s(uuid,jsonb,text,numeric) to service_role; revoke all on function plm.sync_%1$s(uuid,jsonb,text,numeric) from public,anon,authenticated; grant execute on function plm.sync_%1$s(uuid,jsonb,text,numeric) to service_role',n); end loop; end $$;
