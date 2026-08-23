-- Issue #1380: bounded Warner reconciliation bridge to surviving Universe B.
--
-- Input contract for plm.sync_wb_canonical_relationship_edges(text,jsonb):
--   p_edge_kind: asset | style_guide | character
--   p_rows: JSON array containing source_entity_id (uuid), canonical_property_id
--   (integer), assertion_type, evidence_source, evidence_hash, source_active,
--   within_entitlement, and optionally observed_at.
--
-- The source_entity_id is always an existing normalized Warner landing identity.
-- The canonical endpoint is always a PROPERTY-typed row in
-- core.properties_and_characters (Universe B). No labels or licensed payloads are
-- accepted or exposed. Asset mappings are direct assertions only; style-guide
-- mappings are inferred only; character mappings may retain either truth class.

create table plm.wb_asset_canonical_property_edge (
  source_entity_id uuid not null references plm.wb_asset_normalized(id) on delete restrict,
  canonical_property_id integer not null references core.properties_and_characters(id) on delete restrict,
  assertion_type text not null check (assertion_type = 'direct_warner_source'),
  evidence_source text not null check (btrim(evidence_source) <> ''),
  evidence_hash text not null check (btrim(evidence_hash) <> ''),
  source_active boolean not null,
  within_entitlement boolean not null,
  observed_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_entity_id, canonical_property_id, assertion_type, evidence_source)
);

create table plm.wb_style_guide_canonical_property_edge (
  source_entity_id uuid not null references plm.wb_style_guide_normalized(id) on delete restrict,
  canonical_property_id integer not null references core.properties_and_characters(id) on delete restrict,
  assertion_type text not null check (assertion_type = 'inferred_asset_cooccurrence'),
  evidence_source text not null check (btrim(evidence_source) <> ''),
  evidence_hash text not null check (btrim(evidence_hash) <> ''),
  source_active boolean not null,
  within_entitlement boolean not null,
  observed_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_entity_id, canonical_property_id, assertion_type, evidence_source)
);

create table plm.wb_character_canonical_property_edge (
  source_entity_id uuid not null references plm.wb_character_normalized(id) on delete restrict,
  canonical_property_id integer not null references core.properties_and_characters(id) on delete restrict,
  assertion_type text not null check (assertion_type in ('direct_warner_source', 'inferred_asset_cooccurrence')),
  evidence_source text not null check (btrim(evidence_source) <> ''),
  evidence_hash text not null check (btrim(evidence_hash) <> ''),
  source_active boolean not null,
  within_entitlement boolean not null,
  observed_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_entity_id, canonical_property_id, assertion_type, evidence_source)
);

alter table plm.wb_asset_canonical_property_edge enable row level security;
alter table plm.wb_style_guide_canonical_property_edge enable row level security;
alter table plm.wb_character_canonical_property_edge enable row level security;

create policy wb_asset_canonical_property_edge_read on plm.wb_asset_canonical_property_edge
  for select to authenticated using (
    app.has_role('administrator') or app.has_app_access('plm')
    or app.has_any_role(array['sales','licensing']::app.app_role[])
  );
create policy wb_style_guide_canonical_property_edge_read on plm.wb_style_guide_canonical_property_edge
  for select to authenticated using (
    app.has_role('administrator') or app.has_app_access('plm')
    or app.has_any_role(array['sales','licensing']::app.app_role[])
  );
create policy wb_character_canonical_property_edge_read on plm.wb_character_canonical_property_edge
  for select to authenticated using (
    app.has_role('administrator') or app.has_app_access('plm')
    or app.has_any_role(array['sales','licensing']::app.app_role[])
  );

grant select on plm.wb_asset_canonical_property_edge,
  plm.wb_style_guide_canonical_property_edge,
  plm.wb_character_canonical_property_edge to authenticated, service_role;
revoke insert, update, delete, truncate on plm.wb_asset_canonical_property_edge,
  plm.wb_style_guide_canonical_property_edge,
  plm.wb_character_canonical_property_edge from public, anon, authenticated, service_role;
revoke all on plm.wb_asset_canonical_property_edge,
  plm.wb_style_guide_canonical_property_edge,
  plm.wb_character_canonical_property_edge from anon;

create function plm.sync_wb_canonical_relationship_edges(p_edge_kind text, p_rows jsonb)
returns table(rows_seen integer, rows_upserted integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_row jsonb;
  v_source_id uuid;
  v_property_id integer;
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
      v_property_id := (v_row ->> 'canonical_property_id')::integer;
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
    if not exists (
      select 1 from core.properties_and_characters p
      where p.id = v_property_id and p.type = 'PROPERTY'
    ) then
      raise exception 'Warner canonical edge sync refused: canonical endpoint is not a Universe B Property in row %.', rows_seen using errcode = 'P0001';
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
        source_active = excluded.source_active,
        within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at,
        last_seen_at = now(), updated_at = now();
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
        source_active = excluded.source_active,
        within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at,
        last_seen_at = now(), updated_at = now();
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
        source_active = excluded.source_active,
        within_entitlement = excluded.within_entitlement,
        observed_at = excluded.observed_at,
        last_seen_at = now(), updated_at = now();
    end if;
    rows_upserted := rows_upserted + 1;
  end loop;
  return next;
end
$function$;

revoke all on function plm.sync_wb_canonical_relationship_edges(text, jsonb)
  from public, anon, authenticated;
grant execute on function plm.sync_wb_canonical_relationship_edges(text, jsonb)
  to service_role;

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

comment on function plm.sync_wb_canonical_relationship_edges(text, jsonb) is
  'Guarded idempotent loader for private Warner reconciliation evidence. It validates normalized Warner endpoints and Universe B PROPERTY targets, preserves direct versus inferred truth, and retains inactive/out-of-entitlement evidence without promoting it.';
comment on view api.wb_canonical_relationship_candidates is
  'Promotable Warner reconciliation evidence only: active and within the signed-contract entitlement. This is evidence for separately governed review, never automatic canonical promotion.';
