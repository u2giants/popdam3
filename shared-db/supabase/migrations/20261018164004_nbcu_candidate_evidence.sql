-- derived-from: 20261013130102
-- Preserve native NBCU co-tag observations without treating Cartesian tag pairs as direct support.
-- Derived source_term provenance is metadata only; capture rows and canonical source terms remain unchanged.
-- This live proof validates only the installed guard contract, not capture authority or business acceptance.
begin;
do $precondition$
declare current_prosrc text;
begin
 select p.prosrc into current_prosrc
 from pg_catalog.pg_proc p
 where p.oid=pg_catalog.to_regprocedure('plm.licensing_consolidation_capture_snapshot(text,uuid)');
 if current_prosrc is null or pg_catalog.md5(current_prosrc)<>'3c60cbc197bc3919056e765d3e9dbc12' then
  raise exception 'NBCU candidate-evidence forward migration requires the exact expected installed snapshot function body';
 end if;
end $precondition$;

create or replace function plm.licensing_consolidation_capture_snapshot(p_source_system text,p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $snapshot$
declare v_root jsonb; v_entities jsonb:='[]';v_edges jsonb:='[]';v_candidates jsonb;v_snapshot jsonb;v_rows jsonb;v_row jsonb;v_rec record;v_coverage jsonb;v_latest uuid;v_scope text;v_native text;v_e jsonb;v_count bigint;v_expected numeric;v_hash text;v_properties bigint;v_characters bigint;v_relationships bigint;v_memberships bigint;v_cross_scope bigint;entity_rows jsonb[]:=array[]::jsonb[];edge_rows jsonb[]:=array[]::jsonb[];candidate_rows jsonb[]:=array[]::jsonb[];
begin
 if p_source_system='nbcu' then
  select to_jsonb(c) into v_root from plm.nbcu_capture c where id=p_capture_id and status='complete';
  select id into v_latest from plm.nbcu_capture where status='complete' order by source_captured_at desc,load_completed_at desc,id desc limit 1;
  if v_root is null or v_latest<>p_capture_id then raise exception 'NBCU requires latest complete immutable capture';end if;
  if v_root->>'load_completed_at' is null or coalesce((v_root->>'media_downloaded')::bigint,-1)<>0 or v_root->'error_summary' is distinct from '[]'::jsonb
    or not exists(select 1 from plm.nbcu_scope where capture_id=p_capture_id)
    or exists(select 1 from plm.nbcu_scope where capture_id=p_capture_id and (terminal is distinct from true or cardinality(missing_offsets) is distinct from 0)) then raise exception 'NBCU complete portal scope or terminal evidence absent';end if;
  for v_rec in select * from (values ('assets','nbcu_asset'),('properties','nbcu_property'),('characters','nbcu_character'),('style_guides','nbcu_style_guide'),('scopes','nbcu_scope'),('ip_family_property','nbcu_ip_family_property'),('property_character','nbcu_property_character'),('asset_property','nbcu_asset_property'),('asset_character','nbcu_asset_character'),('asset_style_guide','nbcu_asset_style_guide'),('style_guide_property','nbcu_style_guide_property'),('asset_ip_family','nbcu_asset_ip_family')) q(count_key,table_name) loop
   if jsonb_typeof(v_root->'expected_counts'->v_rec.count_key) is distinct from 'number' then raise exception 'NBCU expected count missing or nonnumeric: %',v_rec.count_key;end if;
   v_expected:=(v_root->'expected_counts'->>v_rec.count_key)::numeric;
   if v_expected<0 or v_expected<>trunc(v_expected) or v_expected>9223372036854775807 then raise exception 'NBCU expected count invalid: %',v_rec.count_key;end if;
   execute format('select count(*) from plm.%I where capture_id=$1',v_rec.table_name) into v_count using p_capture_id;
   if v_count<>v_expected or (v_root->'observed_counts'->>v_rec.count_key)::numeric is distinct from v_expected then raise exception 'NBCU actual portal count disagrees: %',v_rec.count_key;end if;
  end loop;
  if exists(select 1 from plm.nbcu_asset a where capture_id=p_capture_id and not exists(select 1 from plm.nbcu_asset_metadata_value m where m.capture_id=a.capture_id and m.asset_source_key=a.asset_source_key)) then raise exception 'NBCU asset metadata absent';end if;
  if v_root->'expected_counts' ? 'excluded_unlicensed_assets' then
   if jsonb_typeof(v_root->'expected_counts'->'excluded_unlicensed_assets') is distinct from 'number' then raise exception 'NBCU expected exclusion count nonnumeric';end if;
   v_expected:=(v_root->'expected_counts'->>'excluded_unlicensed_assets')::numeric;
   if v_expected<0 or v_expected<>trunc(v_expected) or v_expected>2147483647 or v_expected is distinct from (v_root->>'excluded_unlicensed_assets')::numeric then raise exception 'NBCU exclusion count disagrees';end if;
  end if;
  if v_root->'expected_counts' ? 'failures' then
   if jsonb_typeof(v_root->'expected_counts'->'failures') is distinct from 'number' then raise exception 'NBCU expected failures nonnumeric';end if;
   if (v_root->'expected_counts'->>'failures')::numeric<>0 then raise exception 'NBCU complete capture has expected failures';end if;
  end if;
  select count(*) into v_count from plm.nbcu_asset_metadata_value where capture_id=p_capture_id;
  if (v_root->'observed_counts'->>'asset_metadata_values')::bigint is distinct from v_count then raise exception 'NBCU observed asset metadata count disagrees';end if;
  select count(*) into v_count from plm.nbcu_asset_scope where capture_id=p_capture_id;
  if (v_root->'observed_counts'->>'asset_scopes')::bigint is distinct from v_count then raise exception 'NBCU observed asset scope count disagrees';end if;
  if exists(select 1 from plm.nbcu_asset_property e left join plm.nbcu_property p on p.capture_id=e.capture_id and p.property_key=e.property_key where e.capture_id=p_capture_id and (p.property_label is null or p.property_label is distinct from e.property_label))
   or exists(select 1 from plm.nbcu_asset_ip_family e left join plm.nbcu_ip_family f on f.capture_id=e.capture_id and f.ip_family_key=e.ip_family_key where e.capture_id=p_capture_id and (f.ip_family_label is null or f.ip_family_label is distinct from e.ip_family_label)) then raise exception 'NBCU exact native endpoint label disagrees';end if;
  select jsonb_build_object('scopes',coalesce((select jsonb_agg(to_jsonb(s) order by scope_key) from plm.nbcu_scope s where capture_id=p_capture_id),'[]'),'asset_metadata_values',coalesce((select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) from plm.nbcu_asset_metadata_value m where capture_id=p_capture_id),'[]')) into v_coverage;
 elsif p_source_system='paramount' then
  select to_jsonb(c) into v_root from plm.pmt_capture c where capture_id=p_capture_id and status='complete' and capture_kind='full';
  select capture_id into v_latest from plm.pmt_capture where status='complete' and capture_kind='full' order by completed_at desc,started_at desc,capture_id desc limit 1;
  if v_root is null or v_latest<>p_capture_id or v_root->>'source_system' is distinct from 'paramount_creative_library' then raise exception 'Paramount requires latest complete full native capture';end if;
  if not exists(select 1 from plm.pmt_authorized_title where capture_id=p_capture_id) or exists(select 1 from plm.pmt_authorized_title where capture_id=p_capture_id and capture_status not in ('captured','licensed_but_not_present_in_current_portal_view')) then raise exception 'Paramount authorized-title roster incomplete';end if;
  select jsonb_build_object('titles',coalesce((select jsonb_agg(to_jsonb(t) order by authorized_title_key) from plm.pmt_authorized_title t where capture_id=p_capture_id),'[]'),'mapping',coalesce((select jsonb_agg(to_jsonb(t) order by authorized_title_key,property_source_id) from plm.pmt_authorized_title_property t where capture_id=p_capture_id),'[]'),'expectations',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from plm.pmt_capture_expectation t where capture_id=p_capture_id),'[]')) into v_coverage;
 elsif p_source_system='disney_opa' then
  select to_jsonb(c) into v_root from plm.opa_capture c where id=p_capture_id and status='complete';
  select id into v_latest from plm.opa_capture where status='complete' order by source_captured_at desc,load_completed_at desc,id desc limit 1;
  if v_root is null or v_latest<>p_capture_id then raise exception 'OPA requires latest coherent complete capture';end if;
  if (select count(*) from plm.opa_capture_scope where capture_id=p_capture_id)<>2
   or not exists(select 1 from plm.opa_capture_scope where capture_id=p_capture_id and (scope_key,region,branch,lob,submission_type,template_id,workflow_id)=('disney_home_standard','North America','Disney','200','Standard','21','49'))
   or not exists(select 1 from plm.opa_capture_scope where capture_id=p_capture_id and (scope_key,region,branch,lob,submission_type,template_id,workflow_id)=('lucas_home_standard','North America','Lucas','200','Standard','462','50'))
   or exists(select 1 from plm.opa_capture_scope where capture_id=p_capture_id and (status is distinct from 'complete' or authentication_evidence_sha256 is null or authenticated_at is null or finished_at is null or failure is not null or expected_duplicate_pair_count<>0 or observed_duplicate_pair_count is distinct from 0)) then raise exception 'OPA approved authenticated two-route coverage incomplete';end if;
  for v_rec in select * from plm.opa_capture_scope where capture_id=p_capture_id order by scope_key loop
   select count(distinct licensed_property_id),count(distinct character_id),count(*) filter(where character_id is not null),
    encode(extensions.digest(decode(string_agg(encode(convert_to(licensed_property_id::text,'UTF8')||decode('00','hex')||convert_to(property_name,'UTF8')||decode('00','hex')||convert_to(option_source_id::text,'UTF8')||decode('00','hex')||convert_to(character_id::text,'UTF8')||decode('00','hex')||convert_to(character_name,'UTF8')||decode('00','hex')||convert_to(brand_property_id::text,'UTF8'),'hex'),'0a' order by concat(licensed_property_id::text,chr(1),property_name,chr(1),option_source_id::text,chr(1),character_id::text,chr(1),character_name,chr(1),brand_property_id::text)) filter(where character_id is not null),'hex'),'sha256'),'hex')
    into v_properties,v_characters,v_relationships,v_hash from plm.opa_property_character_capture where capture_id=p_capture_id and scope_key=v_rec.scope_key;
   if v_properties is distinct from v_rec.expected_property_count or v_properties is distinct from v_rec.observed_property_count or v_characters is distinct from v_rec.expected_character_count or v_characters is distinct from v_rec.observed_character_count or v_relationships is distinct from v_rec.expected_relationship_count or v_relationships is distinct from v_rec.observed_relationship_count or v_hash is distinct from v_rec.expected_relationship_sha256 or v_hash is distinct from v_rec.observed_relationship_sha256 then raise exception 'OPA scoped actual counts or relationship hash disagree: %',v_rec.scope_key;end if;
  end loop;
  select count(distinct licensed_property_id),count(distinct character_id),count(*) filter(where character_id is not null),encode(extensions.digest(convert_to(string_agg(source_row_sha256,e'\n' order by source_row_sha256) filter(where character_id is not null),'UTF8'),'sha256'),'hex') into v_properties,v_characters,v_relationships,v_hash from plm.opa_property_character_capture where capture_id=p_capture_id;
  select coalesce(sum(n),0),count(*) filter(where n=2) into v_memberships,v_cross_scope from (select count(distinct scope_key)n from plm.opa_property_character_capture where capture_id=p_capture_id group by licensed_property_id) q;
  if v_root->>'load_completed_at' is null or v_root->'errors' is distinct from '[]'::jsonb or (v_root->>'expected_scope_count')::integer is distinct from 2 or (v_root->>'expected_duplicate_pair_count')::bigint is distinct from 0 or (v_root->>'observed_duplicate_pair_count')::bigint is distinct from 0
   or v_properties is distinct from (v_root->>'expected_unique_property_count')::bigint or v_properties is distinct from (v_root->>'observed_unique_property_count')::bigint
   or v_characters is distinct from (v_root->>'expected_unique_character_count')::bigint or v_characters is distinct from (v_root->>'observed_unique_character_count')::bigint
   or v_relationships is distinct from (v_root->>'expected_relationship_count')::bigint or v_relationships is distinct from (v_root->>'observed_relationship_count')::bigint
   or v_memberships is distinct from (v_root->>'expected_scope_membership_count')::bigint or v_memberships is distinct from (v_root->>'observed_scope_membership_count')::bigint
   or v_cross_scope is distinct from (v_root->>'expected_cross_scope_property_count')::bigint or v_cross_scope is distinct from (v_root->>'observed_cross_scope_property_count')::bigint
   or v_hash is distinct from v_root->>'observed_relationship_sha256' then raise exception 'OPA actual full capture counts or manifest disagree';end if;
  select jsonb_agg(to_jsonb(s) order by scope_key) into v_coverage from plm.opa_capture_scope s where capture_id=p_capture_id;
 else raise exception 'immutable comparable capture unsupported for source %',p_source_system;end if;
 for v_rec in select * from (values
 ('nbcu','property','plm.nbcu_property','property_key','property_label'),('nbcu','character','plm.nbcu_character','character_key','character_label'),('nbcu','style_guide','plm.nbcu_style_guide','style_guide_key','style_guide_label'),('nbcu','franchise','plm.nbcu_ip_family','ip_family_key','ip_family_label'),('nbcu','asset','plm.nbcu_asset','asset_source_key','file_name'),
 ('paramount','property','plm.pmt_property','property_source_id','property_name'),('paramount','character','plm.pmt_character','character_source_id','character_name'),('paramount','style_guide','plm.pmt_collection','collection_source_id','collection_name'),('paramount','franchise','plm.pmt_franchise','franchise_source_id','franchise_name'),('paramount','asset','plm.pmt_asset','asset_id','asset_name')
 ) m(source,kind,source_table,key_column,name_column) where source=p_source_system loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)-array[''core_property_id'',''core_character_id'',''core_style_guide_id'',''core_franchise_id'',''dam_asset_id'',''resolution_status'',''resolution_reason'',''resolved_at'',''resolved_by''] order by t.%I::text),''[]''::jsonb) from %s t where capture_id=$1',v_rec.key_column,v_rec.source_table) into v_rows using p_capture_id;
  for v_row in select value from jsonb_array_elements(v_rows) loop
   v_native:=v_row->>v_rec.key_column;
   if v_native is null or btrim(v_native)='' then raise exception 'native source identity absent';end if;
   -- Preserve the observed NBCU source term only in derived provenance; never rewrite capture rows.
   if p_source_system='nbcu' and v_rec.kind='franchise' and v_rec.source_table='plm.nbcu_ip_family' then
    if v_row ? 'source_term' and v_row->>'source_term' is distinct from 'IP Family' then raise exception 'NBCU IP Family source_term conflicts with derived provenance';end if;
    v_row:=v_row||jsonb_build_object('source_term','IP Family');
   end if;
   -- Bare durable resolution IDs retain their established namespace. The engine-owned
   -- provenance tuple is separate and never rewrites those human decisions.
   v_e:=jsonb_build_object('kind',v_rec.kind,'source_table',v_rec.source_table,'native_id',v_native,'resolution_source_id',v_native,'source_id',jsonb_build_array(p_source_system,v_rec.source_table,v_rec.kind,v_native)::text,'name',v_row->>v_rec.name_column,'native',v_row);
   if p_source_system='nbcu' and v_rec.kind='franchise' and v_rec.source_table='plm.nbcu_ip_family' then v_e:=v_e||jsonb_build_object('source_term','IP Family');end if;
   if p_source_system='paramount' and v_rec.kind='property' and not coalesce((v_row->>'is_licensed_selection')::boolean,false) then continue;end if;
   if p_source_system='nbcu' and v_rec.kind='property' and v_row->>'source_kind' not in ('property','franchise_asset') then continue;end if;
   entity_rows:=array_append(entity_rows,v_e);
  end loop;
 end loop;
 if p_source_system='disney_opa' then
  for v_row in select to_jsonb(t) from plm.opa_property_character_capture t where capture_id=p_capture_id order by scope_key,licensed_property_id,character_id nulls first loop
   v_scope:=v_row->>'scope_key';
   entity_rows:=array_append(entity_rows,jsonb_build_object('kind','property','source_table','plm.opa_property_character_capture','native_id',v_row->>'licensed_property_id','resolution_source_id',v_row->>'licensed_property_id','scope',v_scope,'source_id',jsonb_build_array(p_source_system,'plm.opa_property_character_capture','property',v_scope,v_row->>'licensed_property_id')::text,'name',v_row->>'property_name','native',v_row));
   if v_row->>'character_id' is not null then
    entity_rows:=array_append(entity_rows,jsonb_build_object('kind','character','source_table','plm.opa_property_character_capture','native_id',v_row->>'character_id','resolution_source_id',v_row->>'character_id','scope',v_scope,'source_id',jsonb_build_array(p_source_system,'plm.opa_property_character_capture','character',v_scope,v_row->>'character_id')::text,'name',v_row->>'character_name','native',v_row));
    edge_rows:=array_append(edge_rows,jsonb_build_object('kind','property_character','source_table','plm.opa_property_character_capture','left_kind','property','right_kind','character','left_native_id',v_row->>'licensed_property_id','right_native_id',v_row->>'character_id','scope',v_scope,'native',v_row));
   end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_entities) e group by e->>'kind',e->>'native_id' having count(distinct e->>'scope')>1 or count(distinct e->>'name')>1) then raise exception 'OPA bare durable source identity ambiguously spans scoped routes';end if;
 end if;
 for v_rec in select * from (values
 ('nbcu','property_character','plm.nbcu_property_character','property','character','property_key','character_key'),('nbcu','property_style_guide','plm.nbcu_style_guide_property','property','style_guide','property_key','style_guide_key'),('nbcu','property_franchise','plm.nbcu_ip_family_property','property','franchise','property_key','ip_family_key'),('nbcu','asset_property','plm.nbcu_asset_property','asset','property','asset_source_key','property_key'),('nbcu','asset_character','plm.nbcu_asset_character','asset','character','asset_source_key','character_key'),('nbcu','asset_style_guide','plm.nbcu_asset_style_guide','asset','style_guide','asset_source_key','style_guide_key'),('nbcu','asset_franchise','plm.nbcu_asset_ip_family','asset','franchise','asset_source_key','ip_family_key'),
 ('paramount','property_character','plm.pmt_property_character','property','character','property_source_id','character_source_id'),('paramount','property_style_guide','plm.pmt_property_collection','property','style_guide','property_source_id','collection_source_id'),('paramount','asset_property','plm.pmt_asset_property','asset','property','asset_id','property_source_id'),('paramount','asset_character','plm.pmt_asset_character','asset','character','asset_id','character_source_id'),('paramount','asset_style_guide','plm.pmt_asset_collection','asset','style_guide','asset_id','collection_source_id'),('paramount','asset_franchise','plm.pmt_asset_franchise','asset','franchise','asset_id','franchise_source_id')
 ) m(source,kind,source_table,left_kind,right_kind,left_column,right_column) where source=p_source_system loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.%I::text,t.%I::text),''[]''::jsonb) from %s t where capture_id=$1',v_rec.left_column,v_rec.right_column,v_rec.source_table) into v_rows using p_capture_id;
  for v_row in select value from jsonb_array_elements(v_rows) loop
   if coalesce(v_row->>'evidence_type',v_row->>'source_evidence','')='' then raise exception 'direct native relationship evidence absent in %',v_rec.source_table;end if;
   if p_source_system='paramount' and v_row->>'source_evidence' is distinct from (case when v_rec.kind in ('property_character','property_style_guide') then 'explicit_cascading_pair' else 'full_asset_metadata' end) then raise exception 'Paramount native evidence is not the closed direct source kind';end if;
   if p_source_system='nbcu' and (v_row->>'evidence_type' ~* '(inferred|co.?occurrence)' or nullif(btrim(v_row->>'evidence_value'),'') is null) then raise exception 'NBCU inferred or missing evidence is not direct source authority';end if;
   v_e:=jsonb_build_object('kind',v_rec.kind,'source_table',v_rec.source_table,'left_kind',v_rec.left_kind,'right_kind',v_rec.right_kind,'left_native_id',v_row->>v_rec.left_column,'right_native_id',v_row->>v_rec.right_column,'native',v_row);
   -- Cartesian co-tag observations remain preserved candidates, never direct edges.
   if p_source_system='nbcu' and lower(v_row->>'evidence_type')='observed_asset_co_tag' then
    candidate_rows:=array_append(candidate_rows,v_e||jsonb_build_object('candidate_reason','observed_asset_co_tag'));
    continue;
   end if;
   edge_rows:=array_append(edge_rows,v_e);
  end loop;
 end loop;
 select coalesce(jsonb_agg(v order by ordinal),'[]') into v_entities from unnest(entity_rows) with ordinality q(v,ordinal);
 select coalesce(jsonb_agg(v order by ordinal),'[]') into v_edges from unnest(edge_rows) with ordinality q(v,ordinal);
 select coalesce(jsonb_agg(e order by e->>'source_id'),'[]') into v_entities from (select (jsonb_agg(x order by x::text)->0)||jsonb_build_object('native',jsonb_agg(x->'native' order by x::text)) as e from jsonb_array_elements(v_entities) x group by x->>'source_id') q;
 select coalesce(jsonb_agg(e order by e::text),'[]') into v_edges from (select distinct e from jsonb_array_elements(v_edges) e) q;
 if p_source_system='nbcu' then
 select jsonb_build_object('scopes',coalesce((select jsonb_agg(jsonb_build_array(scope_key,scope_href,scope_label) order by scope_key) from plm.nbcu_scope where capture_id=p_capture_id),'[]')) into v_scope;
 elsif p_source_system='paramount' then select jsonb_agg(jsonb_build_array(authorized_title_key,authorized_title_name) order by authorized_title_key)::text into v_scope from plm.pmt_authorized_title where capture_id=p_capture_id;
 else select jsonb_agg(jsonb_build_array(scope_key,region,branch,lob,submission_type,template_id,workflow_id) order by scope_key)::text into v_scope from plm.opa_capture_scope where capture_id=p_capture_id;end if;
 v_snapshot:=jsonb_build_object('schema_version',2,'source_system',p_source_system,'capture_id',p_capture_id,'root',v_root,'coverage',v_coverage,'scope_namespace',v_scope::jsonb,'entities',v_entities,'edges',v_edges,'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by entity_kind,source_id) from plm.source_resolution d where source_system=p_source_system),'[]'),'relationship_decisions',coalesce((select jsonb_agg(to_jsonb(d) order by licensor_id,relationship_kind,source_left_id,source_right_id) from plm.licensing_relationship_resolution d where source_system=p_source_system),'[]'),'source_authority',coalesce((select jsonb_agg(to_jsonb(d) order by licensor_id,source_purpose,scope_axis,permitted_kind) from plm.licensing_source_scope d where source_system=p_source_system),'[]'));
 if p_source_system='nbcu' then
  select coalesce(jsonb_agg(e order by e::text),'[]'::jsonb) into v_candidates from (select distinct e from unnest(candidate_rows) q(e)) q;
  return v_snapshot||jsonb_build_object('candidate_edges',v_candidates,'nbcu_adapter_contract_version',1);
 end if;
 return v_snapshot;
end $snapshot$;
revoke all on function plm.licensing_consolidation_capture_snapshot(text,uuid) from public,anon,authenticated;
grant execute on function plm.licensing_consolidation_capture_snapshot(text,uuid) to service_role;
commit;
