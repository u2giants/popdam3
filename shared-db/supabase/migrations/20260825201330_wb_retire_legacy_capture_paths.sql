-- Issue #1517: fresh-version reissue of the stranded Warner cleanup.
-- Executable SQL is copied from 20260814170749; only this header differs.

do $$
declare
  v_in_flight integer;
  v_legacy_rows bigint;
begin
  -- Serialize cleanup with both capture entry points so no legacy capture can
  -- start between this preflight and the destructive statements below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('plm.wb_capture_import')::bigint
  );

  select count(*) into v_in_flight
  from plm.wb_capture
  where chunk_number = 0
    and status in ('loading', 'validating')
    and target in (
      'wb_franchise_property', 'wb_style_guide', 'wb_character', 'wb_asset',
      'wb_asset_style_guide', 'wb_asset_franchise_property',
      'wb_asset_character', 'wb_property_character'
    );

  if v_in_flight <> 0 then
    raise exception 'Warner legacy cleanup refused: % legacy capture(s) are still in flight.', v_in_flight
      using errcode = 'P0001';
  end if;

  select sum(row_count) into v_legacy_rows
  from (
    select count(*)::bigint as row_count from plm.wb_asset_style_guide
    union all select count(*)::bigint from plm.wb_asset_franchise_property
    union all select count(*)::bigint from plm.wb_asset_character
    union all select count(*)::bigint from plm.wb_property_character
    union all select count(*)::bigint from plm.wb_asset
    union all select count(*)::bigint from plm.wb_style_guide
    union all select count(*)::bigint from plm.wb_character
    union all select count(*)::bigint from plm.wb_franchise_property
  ) legacy_counts;

  if v_legacy_rows <> 0 then
    raise exception 'Warner legacy cleanup refused: % legacy row(s) still require reconciliation.', v_legacy_rows
      using errcode = 'P0001';
  end if;
end $$;

alter table plm.wb_capture drop constraint wb_capture_target_chk;
alter table plm.wb_capture add constraint wb_capture_target_chk check (target in (
  'wb_franchise', 'wb_property', 'wb_character_normalized',
  'wb_style_guide_normalized', 'wb_asset_normalized', 'wb_asset_franchise',
  'wb_asset_property', 'wb_asset_character_normalized',
  'wb_asset_style_guide_normalized', 'wb_property_character_normalized',
  'wb_franchise_property_evidence'
)) not valid;
comment on constraint wb_capture_target_chk on plm.wb_capture is
'New captures must use the normalized Warner targets. NOT VALID deliberately preserves historical completed headers whose target names belonged to the retired first-generation mirrors.';

create or replace function plm.begin_wb_capture(
  p_target text,
  p_captured_at date,
  p_private_source_commit text,
  p_snapshot_sha256 text,
  p_expected_row_count integer,
  p_captured_by text,
  p_source_url text,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare c uuid;
begin
  if p_target not in (
    'wb_franchise', 'wb_property', 'wb_character_normalized',
    'wb_style_guide_normalized', 'wb_asset_normalized', 'wb_asset_franchise',
    'wb_asset_property', 'wb_asset_character_normalized',
    'wb_asset_style_guide_normalized', 'wb_property_character_normalized',
    'wb_franchise_property_evidence'
  ) then
    raise exception 'Warner capture refused: unknown or retired target.' using errcode='P0001';
  end if;
  if not plm.wb_loader_privilege_ok(auth.role(), session_user) then
    raise exception 'Warner capture refused: caller is not permitted.' using errcode='P0001';
  end if;
  if p_captured_at is null
     or p_snapshot_sha256 is null
     or p_snapshot_sha256 !~ '^[0-9a-f]{64}$'
     or p_expected_row_count is null
     or p_expected_row_count <= 0
     or btrim(coalesce(p_private_source_commit, '')) = ''
     or btrim(coalesce(p_captured_by, '')) = ''
     or btrim(coalesce(p_source_url, '')) = ''
     or p_source_url ~ '[?#]' then
    raise exception 'Warner capture refused: invalid manifest metadata.' using errcode='P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('plm.wb_capture_import')::bigint);
  select capture_id into c
  from plm.wb_capture
  where chunk_number = 0
    and status in ('loading', 'validating')
    and target = p_target
    and snapshot_sha256 = p_snapshot_sha256
    and private_source_commit = p_private_source_commit
  limit 1;
  if c is not null then return c; end if;

  c := extensions.gen_random_uuid();
  insert into plm.wb_capture(
    capture_id, chunk_number, target, status, captured_at, private_source_commit,
    snapshot_sha256, expected_row_count, captured_by, source_url, notes, started_at
  ) values (
    c, 0, p_target, 'loading', p_captured_at, p_private_source_commit,
    p_snapshot_sha256, p_expected_row_count, p_captured_by, p_source_url, p_notes, now()
  );
  return c;
end $$;

create or replace function plm.finalize_wb_capture(
  p_capture_id uuid,
  p_snapshot_sha256 text,
  p_max_shrink_fraction numeric default 0.10
) returns table(
  mode text, snapshot_captured_at date, rows_seen integer, rows_landed integer,
  rows_inserted integer, rows_updated integer, rows_unchanged integer,
  rows_collapsed integer, rows_missing integer, rows_orphan_identity integer,
  snapshot_hash text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  h plm.wb_capture%rowtype;
  chunks integer;
  maxchunk integer;
  total integer;
  chain text;
  snap jsonb;
  report jsonb;
  r record;
begin
  select * into h
  from plm.wb_capture
  where capture_id = p_capture_id and chunk_number = 0
  for update;

  if not plm.wb_loader_privilege_ok(auth.role(), session_user)
     or h.capture_id is null
     or h.status not in ('loading', 'validating')
     or h.target not in (
       'wb_franchise', 'wb_property', 'wb_character_normalized',
       'wb_style_guide_normalized', 'wb_asset_normalized', 'wb_asset_franchise',
       'wb_asset_property', 'wb_asset_character_normalized',
       'wb_asset_style_guide_normalized', 'wb_property_character_normalized',
       'wb_franchise_property_evidence'
     )
     or p_snapshot_sha256 is distinct from h.snapshot_sha256 then
    raise exception 'Warner finalize refused: invalid capture state or retired target.' using errcode='P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('plm.wb_capture_import')::bigint);
  update plm.wb_capture set status='validating'
  where capture_id=p_capture_id and chunk_number=0;

  select count(*), coalesce(max(chunk_number),0), coalesce(sum(payload_row_count),0)
  into chunks, maxchunk, total
  from plm.wb_capture where capture_id=p_capture_id and chunk_number>=1;
  if chunks=0 or maxchunk<>chunks or total<>h.expected_row_count then
    raise exception 'Warner finalize refused: incomplete chunk set.' using errcode='P0001';
  end if;

  select encode(sha256(convert_to(string_agg(chunk_sha256,E'\n' order by chunk_number),'UTF8')),'hex')
  into chain from plm.wb_capture where capture_id=p_capture_id and chunk_number>=1;
  if chain is distinct from h.snapshot_sha256 then
    raise exception 'Warner finalize refused: manifest digest mismatch.' using errcode='P0001';
  end if;

  select jsonb_build_object(
    'captured_at', to_char(h.captured_at,'YYYY-MM-DD'),
    'rows', jsonb_agg(e.value order by c.chunk_number,e.ord)
  ) into snap
  from plm.wb_capture c
  cross join lateral jsonb_array_elements(c.payload) with ordinality e(value,ord)
  where c.capture_id=p_capture_id and c.chunk_number>=1;

  select * into r
  from plm.sync_wb_normalized_target(p_capture_id,h.target,snap,'mirror_only',p_max_shrink_fraction);
  report := to_jsonb(r);
  update plm.wb_capture
  set status='complete', completed_at=now(), loader_report=report, failure_message=null
  where capture_id=p_capture_id and chunk_number=0;
  update plm.wb_capture set payload=null,payload_cleared_at=now()
  where capture_id=p_capture_id and chunk_number>=1;

  return query select
    (report->>'mode')::text, (report->>'snapshot_captured_at')::date,
    (report->>'rows_seen')::integer, (report->>'rows_landed')::integer,
    (report->>'rows_inserted')::integer, (report->>'rows_updated')::integer,
    (report->>'rows_unchanged')::integer, (report->>'rows_collapsed')::integer,
    (report->>'rows_missing')::integer, (report->>'rows_orphan_identity')::integer,
    (report->>'snapshot_hash')::text;
end $$;

-- Exact identifiers must already be canonical before duplicate counting, matching,
-- insertion and update. This turns previously inconsistent implicit trimming into one
-- fail-closed contract and prevents two spellings of one source ID in a capture.
create or replace function plm.wb_validate_normalized_row(p_target text,p_row jsonb) returns void
language plpgsql immutable set search_path=pg_catalog as $$
declare
  allowed text[];
  k text;
  identity_key text;
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
    when 'wb_franchise_property_evidence' then array['franchise_namespace','franchise_source_id','franchise_fallback_key','property_namespace','property_source_id','property_fallback_key','evidence_source','source_url']
  end;
  foreach k in array array(select jsonb_object_keys(p_row)) loop
    if not k=any(allowed) or k~*'(token|secret|password|cookie|authorization|session)' then
      raise exception 'Warner normalized import refused: unexpected or forbidden field.' using errcode='P0001';
    end if;
  end loop;

  foreach identity_key in array array[
    'source_namespace','source_id','fallback_key','asset_namespace','asset_source_id',
    'franchise_namespace','franchise_source_id','franchise_fallback_key',
    'property_namespace','property_source_id','property_fallback_key',
    'character_namespace','character_source_id','character_fallback_key',
    'style_guide_namespace','style_guide_source_id','style_guide_fallback_key','evidence_source'
  ] loop
    if p_row ? identity_key and p_row->>identity_key is distinct from btrim(p_row->>identity_key) then
      raise exception 'Warner normalized import refused: identity fields must be trimmed.' using errcode='P0001';
    end if;
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
  if p_target='wb_property_character_normalized' and p_row->>'property_namespace'<>'warner_product_catalogue' then raise exception 'Warner normalized import refused: direct Property-to-Character evidence must come from the Product catalogue.' using errcode='P0001'; end if;
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

-- Normalized tables are loaded only through guarded functions. Make that explicit for
-- every ordinary role, including service_role.
revoke insert, update, delete, truncate on
  plm.wb_franchise, plm.wb_property, plm.wb_character_normalized,
  plm.wb_style_guide_normalized, plm.wb_asset_normalized,
  plm.wb_asset_franchise, plm.wb_asset_property,
  plm.wb_asset_character_normalized, plm.wb_asset_style_guide_normalized,
  plm.wb_property_character_normalized, plm.wb_franchise_property_evidence
from public, anon, authenticated, service_role;

drop view api.wb_property_character;
drop view api.wb_property_reconciliation;

drop function public.sync_wb_franchise_property(jsonb,text,numeric);
drop function public.sync_wb_style_guide(jsonb,text,numeric);
drop function public.sync_wb_character(jsonb,text,numeric);
drop function public.sync_wb_asset(jsonb,text,numeric);
drop function public.sync_wb_asset_style_guide(jsonb,text,numeric);
drop function public.sync_wb_asset_franchise_property(jsonb,text,numeric);
drop function public.sync_wb_asset_character(jsonb,text,numeric);
drop function public.sync_wb_property_character(jsonb,text,numeric);

drop function plm.sync_wb_franchise_property(jsonb,text,numeric);
drop function plm.sync_wb_style_guide(jsonb,text,numeric);
drop function plm.sync_wb_character(jsonb,text,numeric);
drop function plm.sync_wb_asset(jsonb,text,numeric);
drop function plm.sync_wb_asset_style_guide(jsonb,text,numeric);
drop function plm.sync_wb_asset_franchise_property(jsonb,text,numeric);
drop function plm.sync_wb_asset_character(jsonb,text,numeric);
drop function plm.sync_wb_property_character(jsonb,text,numeric);

drop function plm.begin_wb_capture_legacy(text,date,text,text,integer,text,text,text);
drop function plm.finalize_wb_capture_legacy(uuid,text,numeric);

drop table plm.wb_asset_style_guide;
drop table plm.wb_asset_franchise_property;
drop table plm.wb_asset_character;
drop table plm.wb_property_character;
drop table plm.wb_asset;
drop table plm.wb_style_guide;
drop table plm.wb_character;
drop table plm.wb_franchise_property;
