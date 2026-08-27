-- Marvel ASGARD lossless file-observation identity.
-- Issue #1640; claim #1641. Schema only: no licensed values or source rows.
-- derived-from: 20260826025127
-- The stable source UUID remains the asset/group identity. Every visible file card,
-- including distinct filenames sharing that UUID, is retained as an observation.

alter table plm.marvel_asgard_asset
  alter column exact_filename drop not null;

comment on column plm.marvel_asgard_asset.exact_filename is
  'Deprecated group-level compatibility field. Exact filenames belong to file observations.';

alter table plm.marvel_asgard_node_asset_observation
  add column file_observation_key text,
  add column exact_filename text,
  add column file_extension text,
  add column file_size_bytes bigint,
  add column raw_observation jsonb;

update plm.marvel_asgard_node_asset_observation o
   set file_observation_key='legacy:' || o.asset_id::text,
       exact_filename=a.exact_filename,
       file_extension=a.file_extension,
       file_size_bytes=a.file_size_bytes,
       raw_observation=jsonb_build_object('contract_version','legacy-asset-level')
  from plm.marvel_asgard_asset a
 where a.id=o.asset_id;

alter table plm.marvel_asgard_node_asset_observation
  alter column file_observation_key set not null,
  alter column exact_filename set not null,
  alter column raw_observation set not null,
  add constraint marvel_asgard_file_observation_key_nonblank_chk
    check (btrim(file_observation_key)<>''),
  add constraint marvel_asgard_file_observation_filename_nonblank_chk
    check (btrim(exact_filename)<>''),
  add constraint marvel_asgard_file_observation_size_chk
    check (file_size_bytes is null or file_size_bytes>=0),
  add constraint marvel_asgard_file_observation_raw_object_chk
    check (jsonb_typeof(raw_observation)='object');

alter table plm.marvel_asgard_node_asset_observation
  drop constraint marvel_asgard_node_asset_observation_pkey;

alter table plm.marvel_asgard_node_asset_observation
  add constraint marvel_asgard_node_asset_observation_pkey
    primary key (capture_key,guide_node_id,file_observation_key);

comment on table plm.marvel_asgard_node_asset_observation is
  'Private lossless ASGARD file-card evidence. Source UUIDs group through asset_id; every visible filename observation has a stable file_observation_key and exact replay guard.';

create or replace function plm.load_marvel_asgard_chunk(
  p_capture_key uuid,
  p_expected_source_system text,
  p_chunk_key text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = plm, pg_temp
as $$
declare v_cap plm.marvel_asgard_capture%rowtype; v_result jsonb := '{}'::jsonb;
begin
  if p_expected_source_system is distinct from 'marvel_asgard' then raise exception 'load_marvel_asgard_chunk: expected source must be marvel_asgard'; end if;
  if p_chunk_key is null or btrim(p_chunk_key) = '' then raise exception 'load_marvel_asgard_chunk: chunk_key is required'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'load_marvel_asgard_chunk: payload must be an object'; end if;
  select * into v_cap from plm.marvel_asgard_capture where capture_key=p_capture_key for update;
  if not found or v_cap.source_system <> p_expected_source_system then raise exception 'load_marvel_asgard_chunk: capture/source mismatch'; end if;
  if v_cap.status <> 'loading' then raise exception 'load_marvel_asgard_chunk: capture % is not loading', p_capture_key; end if;
  -- Reject payload fields that could retain media access or user identity. Source URL is
  -- capture-level evidence and is deliberately not accepted inside a chunk.
  if jsonb_path_exists(p_payload, 'lax $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(preview(_?url)?|download(_?url)?|signed_?url|thumbnail_?url|url|href|token|access_?token|refresh_?token|account_?id|user_?id|email)$" flag "i")') then
    raise exception 'load_marvel_asgard_chunk: forbidden media-access or account-identity field';
  end if;

  insert into plm.marvel_asgard_guide_category(source_identity_key,source_category_key,exact_label,display_order,observed_meaning,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_category_key,x.exact_label,x.display_order,x.observed_meaning,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'categories','[]')) as x(source_identity_key text,source_category_key text,exact_label text,display_order integer,observed_meaning text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_label=excluded.exact_label,display_order=excluded.display_order,observed_meaning=excluded.observed_meaning,raw_source=excluded.raw_source
  where plm.marvel_asgard_guide_category.source_category_key is not distinct from excluded.source_category_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'categories','[]')) x(source_identity_key text,source_category_key text) join plm.marvel_asgard_guide_category t using(source_identity_key) where t.source_category_key is distinct from x.source_category_key) then raise exception 'load_marvel_asgard_chunk: category identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]'))
      x(category_identity_key text)
    left join plm.marvel_asgard_guide_category c
      on c.source_identity_key=x.category_identity_key
    where c.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved style-guide category key'; end if;

  insert into plm.marvel_asgard_style_guide(source_identity_key,source_guide_key,category_id,exact_label,display_order,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_guide_key,c.id,x.exact_label,x.display_order,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]')) x(source_identity_key text,source_guide_key text,category_identity_key text,exact_label text,display_order integer,raw_source jsonb)
  join plm.marvel_asgard_guide_category c on c.source_identity_key=x.category_identity_key
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,category_id=excluded.category_id,exact_label=excluded.exact_label,display_order=excluded.display_order,raw_source=excluded.raw_source
  where plm.marvel_asgard_style_guide.source_guide_key is not distinct from excluded.source_guide_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]')) x(source_identity_key text,source_guide_key text) join plm.marvel_asgard_style_guide t using(source_identity_key) where t.source_guide_key is distinct from x.source_guide_key) then raise exception 'load_marvel_asgard_chunk: guide identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(style_guide_identity_key text)
    left join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    where g.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved node style-guide key'; end if;

  -- Pass 1 creates every node identity without guessing a missing parent to be a root.
  -- Pass 2 below links parents after same-chunk parent rows are visible.
  insert into plm.marvel_asgard_guide_node(source_identity_key,source_node_key,style_guide_id,parent_node_id,depth,exact_label,display_order,materialized_source_path,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_node_key,g.id,null,x.depth,x.exact_label,x.display_order,x.materialized_source_path,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]')) x(source_identity_key text,source_node_key text,style_guide_identity_key text,parent_node_identity_key text,depth smallint,exact_label text,display_order integer,materialized_source_path text,raw_source jsonb)
  join plm.marvel_asgard_style_guide g on g.source_identity_key=x.style_guide_identity_key
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,depth=excluded.depth,exact_label=excluded.exact_label,display_order=excluded.display_order,materialized_source_path=excluded.materialized_source_path,raw_source=excluded.raw_source
  where plm.marvel_asgard_guide_node.source_node_key is not distinct from excluded.source_node_key and plm.marvel_asgard_guide_node.style_guide_id=excluded.style_guide_id;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(source_identity_key text,source_node_key text,style_guide_identity_key text)
    join plm.marvel_asgard_guide_node t using(source_identity_key)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    where t.source_node_key is distinct from x.source_node_key
       or t.style_guide_id<>g.id
  ) then raise exception 'load_marvel_asgard_chunk: node identifier conflict'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(style_guide_identity_key text,parent_node_identity_key text)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node p
      on p.source_identity_key=x.parent_node_identity_key
     and p.style_guide_id=g.id
    where x.parent_node_identity_key is not null and p.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved or cross-guide parent node key'; end if;
  with incoming as (
    select x.source_identity_key,p.id parent_node_id
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(source_identity_key text,style_guide_identity_key text,parent_node_identity_key text)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node p
      on p.source_identity_key=x.parent_node_identity_key
     and p.style_guide_id=g.id
  )
  update plm.marvel_asgard_guide_node n
     set parent_node_id=incoming.parent_node_id
    from incoming
   where n.source_identity_key=incoming.source_identity_key;

  insert into plm.marvel_asgard_asset(source_identity_key,style_guide_asset_id,asset_id,original_file_id,exact_filename,file_extension,file_size_bytes,display_order,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.style_guide_asset_id,x.asset_id,x.original_file_id,x.exact_filename,x.file_extension,x.file_size_bytes,x.display_order,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'assets','[]')) x(source_identity_key text,style_guide_asset_id text,asset_id text,original_file_id text,exact_filename text,file_extension text,file_size_bytes bigint,display_order integer,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,display_order=excluded.display_order,raw_source=excluded.raw_source
  where plm.marvel_asgard_asset.style_guide_asset_id is not distinct from excluded.style_guide_asset_id and plm.marvel_asgard_asset.asset_id is not distinct from excluded.asset_id and plm.marvel_asgard_asset.original_file_id is not distinct from excluded.original_file_id;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'assets','[]')) x(source_identity_key text,style_guide_asset_id text,asset_id text,original_file_id text) join plm.marvel_asgard_asset t using(source_identity_key) where t.style_guide_asset_id is distinct from x.style_guide_asset_id or t.asset_id is distinct from x.asset_id or t.original_file_id is distinct from x.original_file_id) then raise exception 'load_marvel_asgard_chunk: asset identifier conflict'; end if;

  insert into plm.marvel_asgard_character(source_identity_key,source_character_key,exact_label,normalized_search_label,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_character_key,x.exact_label,x.normalized_search_label,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'characters','[]')) x(source_identity_key text,source_character_key text,exact_label text,normalized_search_label text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_label=excluded.exact_label,normalized_search_label=excluded.normalized_search_label,raw_source=excluded.raw_source
  where plm.marvel_asgard_character.source_character_key is not distinct from excluded.source_character_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'characters','[]')) x(source_identity_key text,source_character_key text) join plm.marvel_asgard_character t using(source_identity_key) where t.source_character_key is distinct from x.source_character_key) then raise exception 'load_marvel_asgard_chunk: character identifier conflict'; end if;

  insert into plm.marvel_asgard_term(source_identity_key,term_kind,source_term_key,exact_value,normalized_search_value,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.term_kind,x.source_term_key,x.exact_value,x.normalized_search_value,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'terms','[]')) x(source_identity_key text,term_kind text,source_term_key text,exact_value text,normalized_search_value text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_value=excluded.exact_value,normalized_search_value=excluded.normalized_search_value,raw_source=excluded.raw_source
  where plm.marvel_asgard_term.term_kind=excluded.term_kind and plm.marvel_asgard_term.source_term_key is not distinct from excluded.source_term_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'terms','[]')) x(source_identity_key text,term_kind text,source_term_key text) join plm.marvel_asgard_term t using(source_identity_key) where t.term_kind<>x.term_kind or t.source_term_key is distinct from x.source_term_key) then raise exception 'load_marvel_asgard_chunk: term identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'checkpoints','[]'))
      x(style_guide_identity_key text,guide_node_identity_key text)
    left join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node n
      on n.source_identity_key=x.guide_node_identity_key
     and n.style_guide_id=g.id
    where g.id is null or n.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved checkpoint guide or node key'; end if;

  insert into plm.marvel_asgard_capture_checkpoint(capture_key,style_guide_id,guide_node_id,page_number,page_size,expected_page_count,expected_asset_count,observed_asset_count,request_sha256,result_sha256,status,first_attempted_at,last_attempted_at,error_class)
  select p_capture_key,g.id,n.id,x.page_number,x.page_size,x.expected_page_count,x.expected_asset_count,x.observed_asset_count,x.request_sha256,x.result_sha256,x.status,coalesce(x.first_attempted_at,now()),coalesce(x.last_attempted_at,now()),x.error_class
  from jsonb_to_recordset(coalesce(p_payload->'checkpoints','[]')) x(style_guide_identity_key text,guide_node_identity_key text,page_number integer,page_size integer,expected_page_count integer,expected_asset_count integer,observed_asset_count integer,request_sha256 text,result_sha256 text,status text,first_attempted_at timestamptz,last_attempted_at timestamptz,error_class text)
  join plm.marvel_asgard_style_guide g on g.source_identity_key=x.style_guide_identity_key
  join plm.marvel_asgard_guide_node n on n.source_identity_key=x.guide_node_identity_key and n.style_guide_id=g.id
  on conflict(capture_key,guide_node_id,page_number) do update set page_size=excluded.page_size,expected_page_count=excluded.expected_page_count,expected_asset_count=excluded.expected_asset_count,observed_asset_count=excluded.observed_asset_count,request_sha256=excluded.request_sha256,result_sha256=excluded.result_sha256,status=excluded.status,last_attempted_at=excluded.last_attempted_at,error_class=excluded.error_class;

  insert into plm.marvel_asgard_capture_gap(capture_key,object_class,source_key_or_path,gap_reason,is_blocking,first_observed_at,last_observed_at,resolved_at)
  select p_capture_key,x.object_class,x.source_key_or_path,x.gap_reason,coalesce(x.is_blocking,true),coalesce(x.first_observed_at,now()),coalesce(x.last_observed_at,now()),x.resolved_at
  from jsonb_to_recordset(coalesce(p_payload->'gaps','[]')) x(object_class text,source_key_or_path text,gap_reason text,is_blocking boolean,first_observed_at timestamptz,last_observed_at timestamptz,resolved_at timestamptz)
  on conflict(capture_key,object_class,source_key_or_path,gap_reason) do update set is_blocking=excluded.is_blocking,last_observed_at=excluded.last_observed_at,resolved_at=excluded.resolved_at;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]'))
      x(guide_node_identity_key text,page_number integer,asset_identity_key text,
        file_observation_key text,exact_filename text,file_extension text,
        file_size_bytes bigint,source_display_order integer,
        raw_observation_sha256 text,raw_observation jsonb)
    left join plm.marvel_asgard_guide_node n
      on n.source_identity_key=x.guide_node_identity_key
    left join plm.marvel_asgard_asset a
      on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_capture_checkpoint c
      on c.capture_key=p_capture_key and c.guide_node_id=n.id
     and c.page_number=x.page_number
    where n.id is null or a.id is null or c.capture_key is null
       or x.file_observation_key is null or btrim(x.file_observation_key)=''
       or x.exact_filename is null or btrim(x.exact_filename)=''
       or x.raw_observation_sha256 is null
       or x.raw_observation_sha256 !~ '^[0-9a-f]{64}$'
       or x.file_size_bytes < 0
       or x.raw_observation is null
       or jsonb_typeof(x.raw_observation)<>'object'
  ) then raise exception 'load_marvel_asgard_chunk: invalid or unresolved file observation'; end if;

  insert into plm.marvel_asgard_node_asset_observation(
    capture_key,guide_node_id,page_number,asset_id,file_observation_key,
    exact_filename,file_extension,file_size_bytes,source_display_order,
    raw_observation_sha256,raw_observation)
  select p_capture_key,n.id,x.page_number,a.id,x.file_observation_key,
         x.exact_filename,x.file_extension,x.file_size_bytes,x.source_display_order,
         x.raw_observation_sha256,x.raw_observation
  from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]'))
    x(guide_node_identity_key text,page_number integer,asset_identity_key text,
      file_observation_key text,exact_filename text,file_extension text,
      file_size_bytes bigint,source_display_order integer,
      raw_observation_sha256 text,raw_observation jsonb)
  join plm.marvel_asgard_guide_node n
    on n.source_identity_key=x.guide_node_identity_key
  join plm.marvel_asgard_asset a
    on a.source_identity_key=x.asset_identity_key
  on conflict(capture_key,guide_node_id,file_observation_key) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]'))
      x(guide_node_identity_key text,page_number integer,asset_identity_key text,
        file_observation_key text,exact_filename text,file_extension text,
        file_size_bytes bigint,source_display_order integer,
        raw_observation_sha256 text,raw_observation jsonb)
    join plm.marvel_asgard_guide_node n
      on n.source_identity_key=x.guide_node_identity_key
    join plm.marvel_asgard_asset a
      on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_node_asset_observation o
      on o.capture_key=p_capture_key
     and o.guide_node_id=n.id
     and o.file_observation_key=x.file_observation_key
    where o.page_number is distinct from x.page_number
       or o.asset_id is distinct from a.id
       or o.exact_filename is distinct from x.exact_filename
       or o.file_extension is distinct from x.file_extension
       or o.file_size_bytes is distinct from x.file_size_bytes
       or o.source_display_order is distinct from x.source_display_order
       or o.raw_observation_sha256 is distinct from x.raw_observation_sha256
       or o.raw_observation is distinct from x.raw_observation
  ) then raise exception 'load_marvel_asgard_chunk: file-observation replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]'))
      x(asset_identity_key text,character_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
    where a.id is null or c.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-character key'; end if;

  insert into plm.marvel_asgard_asset_character_observation(capture_key,asset_id,character_id,raw_observation)
  select p_capture_key,a.id,c.id,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]')) x(asset_identity_key text,character_identity_key text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
  on conflict(capture_key,asset_id,character_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]'))
      x(asset_identity_key text,character_identity_key text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
    join plm.marvel_asgard_asset_character_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id and o.character_id=c.id
    where o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-character replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]'))
      x(asset_identity_key text,term_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
    where a.id is null or t.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-term key'; end if;

  insert into plm.marvel_asgard_asset_term_observation(capture_key,asset_id,term_id,term_kind,raw_combined_value,raw_observation)
  select p_capture_key,a.id,t.id,t.term_kind,x.raw_combined_value,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]')) x(asset_identity_key text,term_identity_key text,raw_combined_value text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
  on conflict(capture_key,asset_id,term_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]'))
      x(asset_identity_key text,term_identity_key text,raw_combined_value text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
    join plm.marvel_asgard_asset_term_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id and o.term_id=t.id
    where o.raw_combined_value is distinct from x.raw_combined_value
       or o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-term replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]'))
      x(asset_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    where a.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-likeness key'; end if;

  insert into plm.marvel_asgard_asset_likeness_observation(capture_key,asset_id,source_value,likeness_state,raw_observation)
  select p_capture_key,a.id,x.source_value,x.likeness_state,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]')) x(asset_identity_key text,source_value text,likeness_state text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  on conflict(capture_key,asset_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]'))
      x(asset_identity_key text,source_value text,likeness_state text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_asset_likeness_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id
    where o.source_value is distinct from x.source_value
       or o.likeness_state is distinct from x.likeness_state
       or o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-likeness replay conflict'; end if;

  v_result := jsonb_build_object('capture_key',p_capture_key,'chunk_key',p_chunk_key,'accepted',true);
  return v_result;
end $$;

comment on function plm.load_marvel_asgard_chunk(uuid,text,text,jsonb) is
  'Loads private ASGARD chunks. node_assets are file observations requiring file_observation_key, exact_filename, raw_observation_sha256, and raw_observation; replay conflicts fail closed.';

comment on function plm.finalize_marvel_asgard_capture(uuid,text) is
  'Finalizes ASGARD captures and reconciles node_assets as lossless file-observation rows, not distinct source UUID groups.';
