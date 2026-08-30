-- Issue #1881: durable Warner entity lifecycle. No source rows are included.

alter table plm.wb_asset_normalized
  add column status text not null default 'active',
  add column withdrawn_at timestamptz,
  add column first_withdrawn_at timestamptz,
  add column change_signal text generated always as (source_hash) stored,
  add constraint wb_asset_normalized_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint wb_asset_normalized_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null));

alter table plm.wb_character_normalized
  add column status text not null default 'active',
  add column withdrawn_at timestamptz,
  add column first_withdrawn_at timestamptz,
  add column change_signal text generated always as (source_hash) stored,
  add constraint wb_character_normalized_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint wb_character_normalized_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null));

alter table plm.wb_property
  add column status text not null default 'active',
  add column withdrawn_at timestamptz,
  add column first_withdrawn_at timestamptz,
  add column change_signal text generated always as (source_hash) stored,
  add constraint wb_property_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint wb_property_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null));

alter table plm.wb_style_guide_normalized
  add column status text not null default 'active',
  add column withdrawn_at timestamptz,
  add column first_withdrawn_at timestamptz,
  add column change_signal text generated always as (source_hash) stored,
  add constraint wb_style_guide_normalized_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  add constraint wb_style_guide_normalized_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null));

alter table plm.wb_franchise
  add column status text not null default 'active',
  add column withdrawn_at timestamptz,
  add column first_withdrawn_at timestamptz,
  add column change_signal text generated always as (source_hash) stored,
  add constraint wb_franchise_lifecycle_status_chk check (status in ('active', 'withdrawn')),
  add constraint wb_franchise_withdrawn_at_chk check ((status = 'withdrawn') = (withdrawn_at is not null));

create function plm.enforce_wb_entity_lifecycle()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and old.first_withdrawn_at is not null
     and new.first_withdrawn_at is distinct from old.first_withdrawn_at then
    raise exception 'Warner first withdrawal history is immutable.' using errcode = 'P0001';
  end if;
  if new.status = 'withdrawn' and new.first_withdrawn_at is null then
    new.first_withdrawn_at := new.withdrawn_at;
  end if;
  if new.first_withdrawn_at is not null and new.withdrawn_at is not null
     and new.first_withdrawn_at > new.withdrawn_at then
    raise exception 'Warner first withdrawal cannot follow current withdrawal.' using errcode = '23514';
  end if;
  return new;
end $$;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array['wb_asset_normalized','wb_character_normalized','wb_property','wb_style_guide_normalized','wb_franchise'] loop
    execute format('create trigger %I before insert or update of status, withdrawn_at, first_withdrawn_at on plm.%I for each row execute function plm.enforce_wb_entity_lifecycle()', 'trg_' || v_table || '_lifecycle', v_table);
    execute format('create index %I on plm.%I(status, last_seen_at)', 'idx_' || v_table || '_lifecycle_status', v_table);
  end loop;
end
$triggers$;

-- Preserve the existing function identity: installed SQL wrappers depend on this
-- function's OID.  Amend its body in place rather than renaming or wrapping it.
do $loader_patch$
declare
  v_definition text := pg_get_functiondef(
    'plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)'::regprocedure
  );
  v_original text := v_definition;
  v_table text;
begin
  foreach v_table in array array[
    'wb_franchise', 'wb_property', 'wb_character_normalized',
    'wb_style_guide_normalized', 'wb_asset_normalized'
  ] loop
    v_definition := replace(
      v_definition,
      'select count(*) into v_before from plm.' || v_table || ';',
      'select count(*) into v_before from plm.' || v_table || ' where status=''active'';'
    );
  end loop;

  v_definition := replace(v_definition,
    E',last_seen_at=now(),updated_at=now()\n    where source_namespace=',
    E',status=''active'',withdrawn_at=null,last_seen_at=now(),updated_at=now()\n    where source_namespace=');
  v_definition := replace(v_definition,
    ') and source_hash is distinct from encode(sha256(convert_to(x::text,''UTF8'')),''hex'');',
    ');');
  v_definition := replace(v_definition,
    ',last_seen_at=now(),updated_at=now() where plm.wb_asset_normalized.source_hash is distinct from excluded.source_hash;',
    ',status=''active'',withdrawn_at=null,last_seen_at=now(),updated_at=now();');

  v_definition := replace(v_definition, E' end loop;\n return query', E' end loop;\n'
    || E' if p_target=''wb_franchise'' then\n'
    || E'  update plm.wb_franchise t set status=''withdrawn'',withdrawn_at=now(),first_withdrawn_at=coalesce(first_withdrawn_at,now()),updated_at=now() where status=''active'' and not exists(select 1 from jsonb_array_elements(p_snapshot->''rows'') j where t.source_namespace=j.value->>''source_namespace'' and ((t.source_id is not null and t.source_id=j.value->>''source_id'') or (t.source_id is null and t.fallback_key=j.value->>''fallback_key'')));\n'
    || E' elsif p_target=''wb_property'' then\n'
    || E'  update plm.wb_property t set status=''withdrawn'',withdrawn_at=now(),first_withdrawn_at=coalesce(first_withdrawn_at,now()),updated_at=now() where status=''active'' and not exists(select 1 from jsonb_array_elements(p_snapshot->''rows'') j where t.source_namespace=j.value->>''source_namespace'' and ((t.source_id is not null and t.source_id=j.value->>''source_id'') or (t.source_id is null and t.fallback_key=j.value->>''fallback_key'')));\n'
    || E' elsif p_target=''wb_character_normalized'' then\n'
    || E'  update plm.wb_character_normalized t set status=''withdrawn'',withdrawn_at=now(),first_withdrawn_at=coalesce(first_withdrawn_at,now()),updated_at=now() where status=''active'' and not exists(select 1 from jsonb_array_elements(p_snapshot->''rows'') j where t.source_namespace=j.value->>''source_namespace'' and ((t.source_id is not null and t.source_id=j.value->>''source_id'') or (t.source_id is null and t.fallback_key=j.value->>''fallback_key'')));\n'
    || E' elsif p_target=''wb_style_guide_normalized'' then\n'
    || E'  update plm.wb_style_guide_normalized t set status=''withdrawn'',withdrawn_at=now(),first_withdrawn_at=coalesce(first_withdrawn_at,now()),updated_at=now() where status=''active'' and not exists(select 1 from jsonb_array_elements(p_snapshot->''rows'') j where t.source_namespace=j.value->>''source_namespace'' and ((t.source_id is not null and t.source_id=j.value->>''source_id'') or (t.source_id is null and t.fallback_key=j.value->>''fallback_key'')));\n'
    || E' elsif p_target=''wb_asset_normalized'' then\n'
    || E'  update plm.wb_asset_normalized t set status=''withdrawn'',withdrawn_at=now(),first_withdrawn_at=coalesce(first_withdrawn_at,now()),updated_at=now() where status=''active'' and not exists(select 1 from jsonb_array_elements(p_snapshot->''rows'') j where t.source_namespace=j.value->>''source_namespace'' and t.source_id=j.value->>''source_id'');\n'
    || E' end if;\n return query');

  if v_definition = v_original
     or position('first_withdrawn_at=coalesce(first_withdrawn_at,now())' in v_definition) = 0
     or (length(v_definition)-length(replace(v_definition,'status=''active'',withdrawn_at=null',''))) / length('status=''active'',withdrawn_at=null') <> 5 then
    raise exception 'Warner lifecycle patch refused: installed normalized loader body was not recognized.';
  end if;
  execute v_definition;
end
$loader_patch$;

-- Derive edge activity from the durable entity record.  Caller-provided activity
-- remains accepted for signature compatibility but can no longer override truth.
do $edge_patch$
declare
  v_definition text := pg_get_functiondef(
    'plm.sync_wb_canonical_relationship_edges(text,jsonb)'::regprocedure
  );
  v_original text := v_definition;
begin
  v_definition := replace(v_definition,'v_source_active boolean;','v_source_active boolean; v_entity_active boolean;');
  v_definition := replace(v_definition,
    'if not exists (select 1 from plm.wb_asset_normalized where id = v_source_id) then',
    'select status = ''active'' into v_entity_active from plm.wb_asset_normalized where id = v_source_id; if v_entity_active is null then');
  v_definition := replace(v_definition,
    'if not exists (select 1 from plm.wb_style_guide_normalized where id = v_source_id) then',
    'select status = ''active'' into v_entity_active from plm.wb_style_guide_normalized where id = v_source_id; if v_entity_active is null then');
  v_definition := replace(v_definition,
    'if not exists (select 1 from plm.wb_character_normalized where id = v_source_id) then',
    'select status = ''active'' into v_entity_active from plm.wb_character_normalized where id = v_source_id; if v_entity_active is null then');
  v_definition := replace(v_definition,
    'insert into plm.wb_asset_canonical_property_edge as e',
    'v_source_active := v_source_active and v_entity_active; insert into plm.wb_asset_canonical_property_edge as e');
  v_definition := replace(v_definition,
    'insert into plm.wb_style_guide_canonical_property_edge as e',
    'v_source_active := v_source_active and v_entity_active; insert into plm.wb_style_guide_canonical_property_edge as e');
  v_definition := replace(v_definition,
    'insert into plm.wb_character_canonical_property_edge as e',
    'v_source_active := v_source_active and v_entity_active; insert into plm.wb_character_canonical_property_edge as e');
  if v_definition = v_original
     or (length(v_definition)-length(replace(v_definition,'select status = ''active'' into v_entity_active',''))) / length('select status = ''active'' into v_entity_active') <> 3
     or (length(v_definition)-length(replace(v_definition,'v_source_active := v_source_active and v_entity_active',''))) / length('v_source_active := v_source_active and v_entity_active') <> 3 then
    raise exception 'Warner lifecycle patch refused: installed canonical-edge writer body was not recognized.';
  end if;
  execute v_definition;
end
$edge_patch$;

-- Keep historical relationship rows while exposing only active endpoints.
do $views$
declare
  v_view text;
  v_left_table text;
  v_left_column text;
  v_right_table text;
  v_right_column text;
  v_definition text;
begin
  for v_view, v_left_table, v_left_column, v_right_table, v_right_column in
    values
      ('wb_inferred_franchise_property','wb_franchise','franchise_id','wb_property','property_id'),
      ('wb_inferred_franchise_style_guide','wb_franchise','franchise_id','wb_style_guide_normalized','style_guide_id'),
      ('wb_inferred_franchise_character','wb_franchise','franchise_id','wb_character_normalized','character_id'),
      ('wb_inferred_style_guide_property','wb_style_guide_normalized','style_guide_id','wb_property','property_id'),
      ('wb_inferred_property_character','wb_property','property_id','wb_character_normalized','character_id'),
      ('wb_inferred_style_guide_character','wb_style_guide_normalized','style_guide_id','wb_character_normalized','character_id')
  loop
    select rtrim(pg_get_viewdef(format('api.%I',v_view)::regclass,false), E' \t\r\n;') into v_definition;
    execute format(
      'create or replace view api.%1$I with (security_invoker=true) as select q.* from (%2$s) q join plm.%3$I l on l.id=q.%4$I join plm.%5$I r on r.id=q.%6$I where l.status=''active'' and r.status=''active''',
      v_view,v_definition,v_left_table,v_left_column,v_right_table,v_right_column
    );
  end loop;
end
$views$;

create or replace view api.wb_canonical_relationship_candidates
with (security_invoker = true) as
select 'asset'::text as edge_kind, e.source_entity_id, e.canonical_property_id,
       e.assertion_type, e.evidence_source, e.evidence_hash, e.observed_at
from plm.wb_asset_canonical_property_edge e
join plm.wb_asset_normalized s on s.id=e.source_entity_id
where e.source_active and e.within_entitlement and s.status='active'
union all
select 'style_guide', e.source_entity_id, e.canonical_property_id,
       e.assertion_type, e.evidence_source, e.evidence_hash, e.observed_at
from plm.wb_style_guide_canonical_property_edge e
join plm.wb_style_guide_normalized s on s.id=e.source_entity_id
where e.source_active and e.within_entitlement and s.status='active'
union all
select 'character', e.source_entity_id, e.canonical_property_id,
       e.assertion_type, e.evidence_source, e.evidence_hash, e.observed_at
from plm.wb_character_canonical_property_edge e
join plm.wb_character_normalized s on s.id=e.source_entity_id
where e.source_active and e.within_entitlement and s.status='active';

create view api.wb_durable_entity_lifecycle_verification
with (security_invoker = true) as
select (
  not exists (
    select 1
    from unnest(array['wb_asset_normalized','wb_character_normalized','wb_franchise','wb_property','wb_style_guide_normalized']::text[]) n(name)
    where (select count(*) from information_schema.columns c
           where c.table_schema='plm' and c.table_name=n.name
             and c.column_name in ('status','withdrawn_at','first_withdrawn_at','change_signal')) <> 4
       or to_regclass(format('plm.idx_%s_lifecycle_status',n.name)) is null
       or not exists (select 1 from pg_trigger t
                      where t.tgrelid=format('plm.%I',n.name)::regclass
                        and t.tgname='trg_'||n.name||'_lifecycle' and not t.tgisinternal)
  )
  and (length(pg_get_functiondef('plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)'::regprocedure))
       - length(replace(pg_get_functiondef('plm.sync_wb_normalized_target(uuid,text,jsonb,text,numeric)'::regprocedure),'status=''active'',withdrawn_at=null','')))
      / length('status=''active'',withdrawn_at=null') = 5
  and (length(pg_get_functiondef('plm.sync_wb_canonical_relationship_edges(text,jsonb)'::regprocedure))
       - length(replace(pg_get_functiondef('plm.sync_wb_canonical_relationship_edges(text,jsonb)'::regprocedure),'select status = ''active'' into v_entity_active','')))
      / length('select status = ''active'' into v_entity_active') = 3
  and not exists (
    select 1
    from unnest(array['wb_inferred_franchise_property','wb_inferred_franchise_style_guide','wb_inferred_franchise_character','wb_inferred_style_guide_property','wb_inferred_property_character','wb_inferred_style_guide_character','wb_canonical_relationship_candidates']::text[]) n(name)
    where position('status = ''active''' in pg_get_viewdef(format('api.%I',n.name)::regclass,false)) = 0
  )
) as contract_ok;

revoke all on api.wb_durable_entity_lifecycle_verification from public, anon, authenticated;
grant select on api.wb_durable_entity_lifecycle_verification to service_role;

comment on column plm.wb_asset_normalized.change_signal is
  'Opaque deterministic equality signal generated from the retained source hash.';
comment on column plm.wb_character_normalized.change_signal is
  'Opaque deterministic equality signal generated from the retained source hash.';
comment on column plm.wb_property.change_signal is
  'Opaque deterministic equality signal generated from the retained source hash.';
comment on column plm.wb_style_guide_normalized.change_signal is
  'Opaque deterministic equality signal generated from the retained source hash.';
comment on column plm.wb_franchise.change_signal is
  'Opaque deterministic equality signal generated from the retained source hash.';

do $verify$
declare
  v_table text;
  v_columns integer;
  v_checks integer;
begin
  foreach v_table in array array[
    'wb_asset_normalized',
    'wb_character_normalized',
    'wb_property',
    'wb_style_guide_normalized',
    'wb_franchise'
  ] loop
    select count(*) into v_columns
    from pg_catalog.pg_attribute
    where attrelid = format('plm.%I', v_table)::regclass
      and attname in ('status', 'withdrawn_at', 'first_withdrawn_at', 'change_signal')
      and not attisdropped;

    if v_columns <> 4 then
      raise exception 'verify: %.% lifecycle columns are incomplete', 'plm', v_table;
    end if;

    select count(*) into v_checks
    from pg_catalog.pg_constraint
    where conrelid = format('plm.%I', v_table)::regclass
      and contype = 'c'
      and convalidated
      and conname in (
        v_table || '_lifecycle_status_chk',
        v_table || '_withdrawn_at_chk'
      );

    if v_checks <> 2 then
      raise exception 'verify: %.% lifecycle constraints are incomplete', 'plm', v_table;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = format('plm.%I', v_table)::regclass
        and attname = 'change_signal'
        and attgenerated = 's'
    ) then
      raise exception 'verify: %.% change_signal is not generated', 'plm', v_table;
    end if;
  end loop;
end
$verify$;
