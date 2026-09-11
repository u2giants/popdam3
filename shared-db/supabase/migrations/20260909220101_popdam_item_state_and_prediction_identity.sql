-- Issue #2644: move PopDAM dismissal state and category-review identity off the
-- frozen DesignFlow item snapshot before that snapshot can be retired.
-- derived-from: 20260909132734

begin;

create table public.popdam_item_state (
  item_id uuid primary key references plm.item(id) on delete restrict,
  source_system text not null,
  division_code text not null,
  source_id text not null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  constraint popdam_item_state_source_identity_key
    unique (source_system, division_code, source_id),
  constraint popdam_item_state_identity_nonblank_ck check (
    nullif(btrim(source_system), '') is not null
    and nullif(btrim(division_code), '') is not null
    and nullif(btrim(source_id), '') is not null
    and position('|' in source_system) = 0
    and position('|' in division_code) = 0
    and position('|' in source_id) = 0
  )
);

comment on table public.popdam_item_state is
  'PopDAM-owned item workflow state keyed to canonical plm.item identity. Source identity columns are a readable immutable snapshot; source-owned plm.item remains free of application state.';

alter table public.popdam_item_state enable row level security;
revoke all on table public.popdam_item_state from public, anon, authenticated;
grant select, insert, update, delete on table public.popdam_item_state to service_role;

create or replace function public.set_popdam_item_dismissed(
  item_keys text[],
  dismissed boolean
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, plm, auth
as $$
declare
  v_key text;
  v_parts text[];
  v_item_id uuid;
  v_match_count integer;
  v_actor text;
  v_updated integer := 0;
begin
  if not coalesce(
    (select auth.role()) = 'service_role'
    or public.has_role(auth.uid(), 'admin'::public.app_role),
    false
  ) then
    raise exception 'administrator or service_role required' using errcode = '42501';
  end if;

  if item_keys is null or cardinality(item_keys) = 0 then
    raise exception 'item_keys must be a non-empty array' using errcode = '22023';
  end if;
  if cardinality(item_keys) > 5000 then
    raise exception 'item_keys may contain at most 5000 identities' using errcode = '22023';
  end if;
  if dismissed is null then
    raise exception 'dismissed must be true or false' using errcode = '22023';
  end if;
  if cardinality(item_keys) <> (
    select count(distinct key_value)
    from unnest(item_keys) as supplied(key_value)
    where key_value is not null
  ) then
    raise exception 'item_keys must not contain null or duplicate identities' using errcode = '22023';
  end if;

  v_actor := coalesce(auth.uid()::text, nullif((select auth.role()), ''));

  foreach v_key in array item_keys loop
    v_parts := string_to_array(v_key, '|');
    if cardinality(v_parts) <> 3
       or nullif(btrim(v_parts[1]), '') is null
       or nullif(btrim(v_parts[2]), '') is null
       or nullif(btrim(v_parts[3]), '') is null then
      raise exception 'invalid canonical item identity: %', v_key using errcode = '22023';
    end if;

    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.item item
    where item.source_system = v_parts[1]
      and coalesce(item.raw ->> 'divisionCode', '') = v_parts[2]
      and item.item_number = v_parts[3];

    if v_match_count <> 1 then
      raise exception 'canonical item identity must resolve exactly once: % (matches=%)',
        v_key, v_match_count using errcode = 'P0001';
    end if;

    insert into public.popdam_item_state (
      item_id, source_system, division_code, source_id, dismissed,
      created_by, updated_by
    ) values (
      v_item_id, v_parts[1], v_parts[2], v_parts[3], dismissed,
      v_actor, v_actor
    )
    on conflict (item_id) do update
      set dismissed = excluded.dismissed,
          updated_at = now(),
          updated_by = excluded.updated_by
    where public.popdam_item_state.dismissed is distinct from excluded.dismissed;

    v_updated := v_updated + 1;
  end loop;

  return v_updated;
end;
$$;

comment on function public.set_popdam_item_dismissed(text[], boolean) is
  'Atomically sets or clears PopDAM item dismissal state for exact source_system|division_code|source_id identities. Every key must resolve exactly once. Browser access remains administrator-only; service_role supports authenticated server handlers.';

revoke all on function public.set_popdam_item_dismissed(text[], boolean) from public, anon;
grant execute on function public.set_popdam_item_dismissed(text[], boolean) to authenticated, service_role;

-- Migrate every positive legacy decision before the serving view changes. A
-- missing or ambiguous canonical match aborts the entire migration.
do $$
declare
  v_unresolved integer;
begin
  with dismissed_matches as (
    select legacy.id,
           count(item.id) as match_count
    from public.erp_items_current legacy
    left join plm.item item
      on item.source_system = 'coldlion'
     and item.item_number = legacy.external_id
     and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
    where legacy.dismissed is true
    group by legacy.id
  )
  select count(*) into v_unresolved
  from dismissed_matches
  where match_count <> 1;

  if v_unresolved <> 0 then
    raise exception
      '#2644 refuses to switch dismissal state: % legacy dismissed rows do not resolve exactly once',
      v_unresolved;
  end if;
end;
$$;

insert into public.popdam_item_state (
  item_id, source_system, division_code, source_id, dismissed,
  created_by, updated_by
)
select item.id,
       item.source_system,
       item.raw ->> 'divisionCode',
       item.item_number,
       true,
       'migration:20260909220101',
       'migration:20260909220101'
from public.erp_items_current legacy
join plm.item item
  on item.source_system = 'coldlion'
 and item.item_number = legacy.external_id
 and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
where legacy.dismissed is true;

create or replace view api.plm_item_list
with (security_invoker = false, security_barrier = true) as
with canonical_items as (
  select
    item.*,
    legacy.id as legacy_id,
    row_number() over (
      partition by item.item_number
      order by
        case
          when legacy.division_code is not null
           and legacy.division_code = item.raw ->> 'divisionCode' then 0
          else 1
        end,
        item.source_id,
        item.id
    ) as legacy_rank
  from plm.item item
  left join public.erp_items_current legacy
    on legacy.external_id = item.item_number
  where item.source_system = 'coldlion'
)
select
  case when i.legacy_id is not null and i.legacy_rank = 1
    then i.legacy_id else i.id end                        as id,
  i.item_number                                           as source_id,
  i.item_number                                           as style_number,
  i.description                                           as item_description,
  i.raw ->> 'mGCategory'                                  as mg_category,
  i.raw ->> 'merchGroup01'                                as mg01_code,
  i.raw ->> 'merchGroup02'                                as mg02_code,
  i.raw ->> 'merchGroup03'                                as mg03_code,
  i.raw ->> 'merchGroup04'                                as mg04_code,
  i.raw ->> 'merchGroup05'                                as mg05_code,
  i.raw ->> 'merchGroup06'                                as mg06_code,
  i.raw ->> 'sizeRangeCode'                               as size_code,
  licensor.code                                           as licensor_code,
  property.code                                           as property_code,
  i.raw ->> 'divisionCode'                                as division_code,
  prepacks.prepack_code,
  prepacks.prepack_codes,
  coalesce(state.dismissed, false)                        as dismissed,
  nullif(i.raw ->> 'modTime', '')::timestamptz            as erp_updated_at,
  i.updated_at                                            as synced_at,
  i.source_system
from canonical_items i
left join core.licensor licensor on licensor.id = i.licensor_id
left join core.property property on property.id = i.property_id
left join public.popdam_item_state state on state.item_id = i.id
left join lateral (
  select
    min(btrim(detail.pre_pack_code)) as prepack_code,
    to_jsonb(
      array_agg(distinct btrim(detail.pre_pack_code) order by btrim(detail.pre_pack_code))
    ) as prepack_codes
  from coldlion.item_detail detail
  where detail.company_code = i.raw ->> 'companyCode'
    and detail.division_code = i.raw ->> 'divisionCode'
    and detail.item_no = i.item_number
    and nullif(btrim(detail.pre_pack_code), '') is not null
) prepacks on true;

comment on view api.plm_item_list is
  'Canonical ColdLion-backed 21-column item list. PopDAM dismissal now comes only from public.popdam_item_state; no raw source payload is exposed. Legacy UUID compatibility remains until the style-tracker bridge is repointed.';

grant select on api.plm_item_list to authenticated;

alter table public.product_category_predictions
  add column plm_item_id uuid,
  add column item_identity_status text not null default 'unresolved'
    check (item_identity_status in ('resolved', 'unresolved'));

alter table public.product_category_predictions
  drop constraint if exists product_category_predictions_erp_item_id_fkey;

alter table public.product_category_predictions
  add constraint product_category_predictions_plm_item_id_fkey
  foreign key (plm_item_id) references plm.item(id) on delete set null;

create index idx_product_category_predictions_plm_item_id
  on public.product_category_predictions (plm_item_id)
  where plm_item_id is not null;

with candidate_ids as (
  select distinct prediction.id as prediction_id, item.id as item_id
  from public.product_category_predictions prediction
  join plm.item item
    on item.source_system = split_part(prediction.external_id, '|', 1)
   and coalesce(item.raw ->> 'divisionCode', '') = split_part(prediction.external_id, '|', 2)
   and item.item_number = split_part(prediction.external_id, '|', 3)
  where length(prediction.external_id) - length(replace(prediction.external_id, '|', '')) = 2

  union

  select distinct prediction.id, item.id
  from public.product_category_predictions prediction
  join public.erp_items_current legacy on legacy.id = prediction.erp_item_id
  join plm.item item
    on item.source_system = 'coldlion'
   and item.item_number = legacy.external_id
   and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
), exact_matches as (
  select prediction_id, (array_agg(item_id order by item_id))[1] as item_id
  from candidate_ids
  group by prediction_id
  having count(*) = 1
)
update public.product_category_predictions prediction
set plm_item_id = exact_matches.item_id,
    item_identity_status = 'resolved'
from exact_matches
where prediction.id = exact_matches.prediction_id;

create or replace function public.resolve_product_category_prediction_item_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, plm
as $$
declare
  v_match_count integer;
  v_item_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.plm_item_id is not null
     and new.plm_item_id is null
     and new.external_id is not distinct from old.external_id
     and new.erp_item_id is not distinct from old.erp_item_id then
    new.item_identity_status := 'unresolved';
    return new;
  end if;

  if new.plm_item_id is not null then
    if not exists (
      select 1
      from plm.item item
      where item.id = new.plm_item_id
        and (
          length(new.external_id) - length(replace(new.external_id, '|', '')) <> 2
          or (
            item.source_system = split_part(new.external_id, '|', 1)
            and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
            and item.item_number = split_part(new.external_id, '|', 3)
          )
        )
    ) then
      raise exception 'plm_item_id does not identify a canonical item' using errcode = '23503';
    end if;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if length(new.external_id) - length(replace(new.external_id, '|', '')) = 2 then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from plm.item item
    where item.source_system = split_part(new.external_id, '|', 1)
      and coalesce(item.raw ->> 'divisionCode', '') = split_part(new.external_id, '|', 2)
      and item.item_number = split_part(new.external_id, '|', 3);

    if v_match_count <> 1 then
      raise exception 'canonical prediction identity must resolve exactly once: % (matches=%)',
        new.external_id, v_match_count using errcode = 'P0001';
    end if;

    new.plm_item_id := v_item_id;
    new.item_identity_status := 'resolved';
    return new;
  end if;

  if new.erp_item_id is not null then
    select count(*), (array_agg(item.id order by item.id))[1]
      into v_match_count, v_item_id
    from public.erp_items_current legacy
    join plm.item item
      on item.source_system = 'coldlion'
     and item.item_number = legacy.external_id
     and coalesce(item.raw ->> 'divisionCode', '') = coalesce(legacy.division_code, '')
    where legacy.id = new.erp_item_id;

    if v_match_count = 1 then
      new.plm_item_id := v_item_id;
      new.item_identity_status := 'resolved';
    else
      new.item_identity_status := 'unresolved';
    end if;
  else
    new.item_identity_status := 'unresolved';
  end if;

  return new;
end;
$$;

comment on function public.resolve_product_category_prediction_item_identity() is
  'Preserves legacy prediction rows while binding new three-part canonical identities to plm.item. Canonical missing/ambiguous identities refuse; legacy ambiguity remains visible as unresolved history.';

revoke all on function public.resolve_product_category_prediction_item_identity() from public, anon, authenticated;

create trigger product_category_predictions_resolve_item_identity
before insert or update of external_id, erp_item_id, plm_item_id
on public.product_category_predictions
for each row execute function public.resolve_product_category_prediction_item_identity();

comment on column public.product_category_predictions.plm_item_id is
  'Canonical item relationship. Nullable so historical ambiguous or missing matches remain visible rather than being deleted or guessed.';
comment on column public.product_category_predictions.item_identity_status is
  'resolved when plm_item_id is exact; unresolved preserves history whose canonical identity cannot be proven.';
comment on column public.product_category_predictions.erp_item_id is
  'Retained as historical DesignFlow identity only. Its cascading foreign key was removed by #2644 so retiring the frozen ERP table cannot delete review history.';

commit;
