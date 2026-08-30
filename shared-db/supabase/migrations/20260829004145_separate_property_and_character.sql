-- Issue #1684 final separation: retire the mixed integer entity and restore
-- distinct UUID Property and Character contracts.
--
-- derived-from: 20260823175638, 20260825192610
-- restores-retired-object: core.character dropped-by: 20260823133150
-- maintains-eol-dependency: function api.db_data_admin_licensor_property_tree
-- maintains-eol-dependency: function plm.sync_wb_canonical_relationship_edges
--
-- No row from core.properties_and_characters is copied. The dependent integer
-- edges cannot be mapped to UUID canonical identities without guessing, so they
-- are deliberately retired and remain rebuildable only from normalized source
-- evidence under the governed curated-Master-Data process.

begin;

lock table core.properties_and_characters in access exclusive mode;
lock table core.property_character_associations in access exclusive mode;
lock table plm.item_character_associations in access exclusive mode;
lock table plm.wb_asset_canonical_property_edge in access exclusive mode;
lock table plm.wb_character_canonical_property_edge in access exclusive mode;
lock table plm.wb_style_guide_canonical_property_edge in access exclusive mode;

truncate table
  core.property_character_associations,
  plm.item_character_associations,
  plm.wb_asset_canonical_property_edge,
  plm.wb_character_canonical_property_edge,
  plm.wb_style_guide_canonical_property_edge;

drop table core.property_character_associations restrict;

create table core.character (
  id uuid primary key default gen_random_uuid(),
  licensor_id uuid references core.licensor(id) on delete restrict,
  name text not null,
  code text,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index character_licensor_code_key
  on core.character (licensor_id, code) nulls not distinct
  where code is not null;
create index character_licensor_id_idx on core.character (licensor_id);
create index character_name_idx on core.character (name);
create trigger set_updated_at before update on core.character
  for each row execute function app.set_updated_at();

alter table core.character enable row level security;
create policy shared_read on core.character
  for select to authenticated
  using (app.has_any_role(array[
    'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
  ]::app.app_role[]));
grant select on core.character to authenticated;
grant select on core.character to service_role;
revoke insert, update, delete, truncate on core.character
  from public, anon, authenticated, service_role;

comment on table core.character is
  'Canonical Character identities, distinct from Properties. Empty at creation under issue #1684; populate only from normalized authoritative sources through governed curated Master Data.';

create table core.property_character_associations (
  property_id uuid not null references core.property(id) on update cascade on delete restrict,
  character_id uuid not null references core.character(id) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, character_id)
);
create index property_character_associations_character_id_idx
  on core.property_character_associations (character_id);
create trigger set_updated_at before update on core.property_character_associations
  for each row execute function app.set_updated_at();
alter table core.property_character_associations enable row level security;
create policy shared_read on core.property_character_associations
  for select to authenticated
  using (app.has_any_role(array[
    'administrator', 'sales', 'licensing', 'designer', 'viewer', 'vendor'
  ]::app.app_role[]));
grant select on core.property_character_associations to authenticated;
grant select on core.property_character_associations to service_role;
revoke insert, update, delete, truncate on core.property_character_associations
  from public, anon, authenticated, service_role;
comment on table core.property_character_associations is
  'Explicit many-to-many canonical Property-to-Character membership. Empty at issue #1684 separation; rebuild only from direct normalized source authority.';

alter table plm.item_character_associations
  drop constraint item_character_associations_character_id_fkey;
alter table plm.item_character_associations
  alter column character_id type uuid using null::uuid;
alter table plm.item_character_associations
  add constraint item_character_associations_character_id_fkey
  foreign key (character_id) references core.character(id)
  on update cascade on delete restrict;
comment on table plm.item_character_associations is
  'Item-to-canonical-Character links. Legacy mixed-table links were retired by issue #1684; rebuild only after normalized Character identity resolution.';

alter table plm.wb_asset_canonical_property_edge
  drop constraint wb_asset_canonical_property_edge_canonical_property_id_fkey;
alter table plm.wb_character_canonical_property_edge
  drop constraint wb_character_canonical_property_edge_canonical_property_id_fkey;
alter table plm.wb_style_guide_canonical_property_edge
  drop constraint wb_style_guide_canonical_property_ed_canonical_property_id_fkey;

drop view api.wb_canonical_relationship_candidates;

alter table plm.wb_asset_canonical_property_edge
  alter column canonical_property_id type uuid using null::uuid;
alter table plm.wb_character_canonical_property_edge
  alter column canonical_property_id type uuid using null::uuid;
alter table plm.wb_style_guide_canonical_property_edge
  alter column canonical_property_id type uuid using null::uuid;

alter table plm.wb_asset_canonical_property_edge
  add constraint wb_asset_canonical_property_edge_canonical_property_id_fkey
  foreign key (canonical_property_id) references core.property(id) on delete restrict;
alter table plm.wb_character_canonical_property_edge
  add constraint wb_character_canonical_property_edge_canonical_property_id_fkey
  foreign key (canonical_property_id) references core.property(id) on delete restrict;
alter table plm.wb_style_guide_canonical_property_edge
  add constraint wb_style_guide_canonical_property_ed_canonical_property_id_fkey
  foreign key (canonical_property_id) references core.property(id) on delete restrict;

create or replace function plm.sync_wb_canonical_relationship_edges(p_edge_kind text, p_rows jsonb)
returns table(rows_seen integer, rows_upserted integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_row jsonb;
  v_source_id uuid;
  v_property_id uuid;
  v_assertion text;
  v_evidence_source text;
  v_evidence_hash text;
  v_source_active boolean;
  v_within_entitlement boolean;
  v_observed_at timestamptz;
begin
  if p_edge_kind not in ('asset', 'style_guide', 'character') then
    raise exception 'Warner canonical edge sync refused: unknown edge kind.' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Warner canonical edge sync refused: rows must be a JSON array.' using errcode = 'P0001';
  end if;

  rows_seen := 0;
  rows_upserted := 0;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    rows_seen := rows_seen + 1;
    if jsonb_typeof(v_row) <> 'object'
       or not (v_row ?& array['source_entity_id','canonical_property_id','assertion_type',
                               'evidence_source','evidence_hash','source_active','within_entitlement']) then
      raise exception 'Warner canonical edge sync refused: incomplete row %.', rows_seen using errcode = 'P0001';
    end if;
    begin
      v_source_id := (v_row ->> 'source_entity_id')::uuid;
      v_property_id := (v_row ->> 'canonical_property_id')::uuid;
      v_source_active := (v_row ->> 'source_active')::boolean;
      v_within_entitlement := (v_row ->> 'within_entitlement')::boolean;
      v_observed_at := coalesce(nullif(v_row ->> 'observed_at', '')::timestamptz, now());
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'Warner canonical edge sync refused: invalid typed value in row %.', rows_seen using errcode = 'P0001';
    end;
    v_assertion := v_row ->> 'assertion_type';
    v_evidence_source := btrim(v_row ->> 'evidence_source');
    v_evidence_hash := btrim(v_row ->> 'evidence_hash');

    if v_source_id is null or v_property_id is null or v_source_active is null
       or v_within_entitlement is null or v_evidence_source = '' or v_evidence_hash = '' then
      raise exception 'Warner canonical edge sync refused: null or blank required value in row %.', rows_seen using errcode = 'P0001';
    end if;
    if not exists (select 1 from core.property p where p.id = v_property_id) then
      raise exception 'Warner canonical edge sync refused: unknown canonical Property in row %.', rows_seen using errcode = 'P0001';
    end if;

    if p_edge_kind = 'asset' then
      if v_assertion <> 'direct_warner_source' then
        raise exception 'Warner canonical edge sync refused: asset evidence must be direct in row %.', rows_seen using errcode = 'P0001';
      end if;
      if not exists (select 1 from plm.wb_asset_normalized where id = v_source_id) then
        raise exception 'Warner canonical edge sync refused: unknown asset endpoint in row %.', rows_seen using errcode = 'P0001';
      end if;
      insert into plm.wb_asset_canonical_property_edge as e
        (source_entity_id, canonical_property_id, assertion_type, evidence_source,
         evidence_hash, source_active, within_entitlement, observed_at)
      values (v_source_id, v_property_id, v_assertion, v_evidence_source,
              v_evidence_hash, v_source_active, v_within_entitlement, v_observed_at)
      on conflict (source_entity_id, canonical_property_id, assertion_type, evidence_source)
      do update set evidence_hash = excluded.evidence_hash,
        source_active = excluded.source_active, within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at, last_seen_at = now(), updated_at = now();
    elsif p_edge_kind = 'style_guide' then
      if v_assertion <> 'inferred_asset_cooccurrence' then
        raise exception 'Warner canonical edge sync refused: style-guide evidence must be inferred in row %.', rows_seen using errcode = 'P0001';
      end if;
      if not exists (select 1 from plm.wb_style_guide_normalized where id = v_source_id) then
        raise exception 'Warner canonical edge sync refused: unknown style-guide endpoint in row %.', rows_seen using errcode = 'P0001';
      end if;
      insert into plm.wb_style_guide_canonical_property_edge as e
        (source_entity_id, canonical_property_id, assertion_type, evidence_source,
         evidence_hash, source_active, within_entitlement, observed_at)
      values (v_source_id, v_property_id, v_assertion, v_evidence_source,
              v_evidence_hash, v_source_active, v_within_entitlement, v_observed_at)
      on conflict (source_entity_id, canonical_property_id, assertion_type, evidence_source)
      do update set evidence_hash = excluded.evidence_hash,
        source_active = excluded.source_active, within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at, last_seen_at = now(), updated_at = now();
    else
      if v_assertion not in ('direct_warner_source', 'inferred_asset_cooccurrence') then
        raise exception 'Warner canonical edge sync refused: invalid character assertion in row %.', rows_seen using errcode = 'P0001';
      end if;
      if not exists (select 1 from plm.wb_character_normalized where id = v_source_id) then
        raise exception 'Warner canonical edge sync refused: unknown character endpoint in row %.', rows_seen using errcode = 'P0001';
      end if;
      insert into plm.wb_character_canonical_property_edge as e
        (source_entity_id, canonical_property_id, assertion_type, evidence_source,
         evidence_hash, source_active, within_entitlement, observed_at)
      values (v_source_id, v_property_id, v_assertion, v_evidence_source,
              v_evidence_hash, v_source_active, v_within_entitlement, v_observed_at)
      on conflict (source_entity_id, canonical_property_id, assertion_type, evidence_source)
      do update set evidence_hash = excluded.evidence_hash,
        source_active = excluded.source_active, within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at, last_seen_at = now(), updated_at = now();
    end if;
    rows_upserted := rows_upserted + 1;
  end loop;
  return next;
end
$function$;

comment on function plm.sync_wb_canonical_relationship_edges(text, jsonb) is
  'Guarded loader for private Warner evidence resolved to core.property UUID identities. Issue #1684 retired every legacy mixed-table edge; rebuild only from normalized source evidence.';

create view api.wb_canonical_relationship_candidates
with (security_invoker = true) as
select 'asset'::text as edge_kind, source_entity_id, canonical_property_id,
       assertion_type, evidence_source, evidence_hash, observed_at
from plm.wb_asset_canonical_property_edge
where source_active and within_entitlement
union all
select 'style_guide', source_entity_id, canonical_property_id,
       assertion_type, evidence_source, evidence_hash, observed_at
from plm.wb_style_guide_canonical_property_edge
where source_active and within_entitlement
union all
select 'character', source_entity_id, canonical_property_id,
       assertion_type, evidence_source, evidence_hash, observed_at
from plm.wb_character_canonical_property_edge
where source_active and within_entitlement;
grant select on api.wb_canonical_relationship_candidates to authenticated, service_role;
revoke all on api.wb_canonical_relationship_candidates from anon;
comment on view api.wb_canonical_relationship_candidates is
  'Promotable Warner reconciliation evidence resolved to core.property UUIDs. Active and within-entitlement evidence only; never automatic canonical promotion.';

create or replace function api.db_data_admin_licensor_property_tree(
  p_search text default null,
  p_include_inactive boolean default false,
  p_cursor text default null,
  p_page_size integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = app, public
as $function$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_cursor_value text;
  v_cursor_id uuid;
  v_snapshot_at timestamptz := clock_timestamp();
  v_total_licensors integer;
  v_active_licensors integer;
  v_total_properties integer;
  v_properties_with_licensor integer;
  v_orphan_count integer;
  v_orphans jsonb;
  v_licensors jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_licensing_manager_access();
  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor' using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  select count(*)::integer,
         count(*) filter (where l.status <> 'inactive')::integer
    into v_total_licensors, v_active_licensors
  from core.licensor l;
  select count(*)::integer,
         count(*) filter (where l.id is not null)::integer,
         count(*) filter (where l.id is null)::integer
    into v_total_properties, v_properties_with_licensor, v_orphan_count
  from core.property p left join core.licensor l on l.id = p.licensor_id;

  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a group by a.property_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id::text, 'name', p.name, 'code', p.code, 'status', p.status,
    'licensor_id', p.licensor_id::text,
    'character_count', coalesce(ac.character_count, 0),
    'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
    'updated_at', p.updated_at
  ) order by lower(btrim(p.name)) collate "C", p.id), '[]'::jsonb)
  into v_orphans
  from core.property p
  left join core.licensor l on l.id = p.licensor_id
  left join association_counts ac on ac.property_id = p.id
  where l.id is null;

  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a group by a.property_id
  ), licensor_rows as (
    select l.id, l.name, l.code, l.status,
      lower(btrim(l.name)) collate "C" as sort_value,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'name', p.name, 'code', p.code, 'status', p.status,
        'licensor_id', p.licensor_id::text,
        'character_count', coalesce(ac.character_count, 0),
        'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
        'updated_at', p.updated_at
      ) order by lower(btrim(p.name)) collate "C", p.id)
      filter (where p.id is not null), '[]'::jsonb) as properties
    from core.licensor l
    left join core.property p on p.licensor_id = l.id and (
      p_search is null or l.name ilike '%' || p_search || '%' or p.name ilike '%' || p_search || '%'
    )
    left join association_counts ac on ac.property_id = p.id
    where (p_include_inactive or l.status <> 'inactive') and (
      p_search is null or l.name ilike '%' || p_search || '%'
      or exists (select 1 from core.property sp where sp.licensor_id = l.id and sp.name ilike '%' || p_search || '%')
    )
    group by l.id, l.name, l.code, l.status
  ), ordered as (
    select lr.* from licensor_rows lr
    where p_cursor is null or (lr.sort_value, lr.id) > (v_cursor_value collate "C", v_cursor_id)
    order by lr.sort_value, lr.id limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.sort_value, o.id) as rn from ordered o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id::text, 'name', n.name, 'code', n.code, 'status', n.status,
      'property_count', jsonb_array_length(n.properties),
      'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
      'properties', n.properties, 'updated_at', null
    ) order by n.rn) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*), max(n.sort_value) filter (where n.rn = v_page_size),
    (array_agg(n.id) filter (where n.rn = v_page_size))[1]
  into v_licensors, v_fetched, v_last_sort, v_last_id from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'), 'base64');
  end if;
  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'snapshot_at', v_snapshot_at, 'store', 'core.licensor / core.property',
      'source_system', 'normalized_authoritative_sources',
      'feeder_last_sync_at', null, 'feeder_last_run_status', null,
      'feeder_days_stale', null, 'feeder_available', false,
      'live_upstream_reconciliation', false,
      'note', 'Canonical normalized Licensor and Property hierarchy. Character totals use explicit canonical associations.'
    ),
    'reconciliation', jsonb_build_object(
      'licensor_count', v_total_licensors, 'active_licensor_count', v_active_licensors,
      'property_count', v_total_properties, 'active_property_count', v_total_properties,
      'properties_with_licensor', v_properties_with_licensor,
      'orphan_property_count', v_orphan_count,
      'expected_orphan_count_is_zero', (v_orphan_count = 0),
      'partition_reconciles', (v_properties_with_licensor + v_orphan_count) = v_total_properties
    ),
    'licensors', v_licensors, 'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor, 'page_size', v_page_size
  );
end
$function$;

comment on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) is
  'Licensing Manager read-only canonical core.licensor/core.property hierarchy. Issue #1684 removed the mixed integer entity and its copied-source presentation.';

drop trigger properties_and_characters_eol_write_guard on core.properties_and_characters;
drop function core.reject_properties_and_characters_write();
drop table core.properties_and_characters restrict;

commit;
