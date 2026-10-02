-- derived-from: 20260714203100
-- Issue #3900: PopDAM library cover cards read a very short AI display
-- description derived from the ColdLion Item Master description.
--
-- 1. style_groups gains the short-description columns. The full description
--    stays in item_description; item_short_description_input records the exact
--    full text the short text was derived from, so a changed description is
--    detected as stale. Source 'manual' marks a human-entered short text that
--    the PopDAM worker must never overwrite.
-- 2. refresh_sku_human_description() (pg_cron job 10, 04:30 UTC) now sources
--    item_description from plm.item (source label 'coldlion'), falling back to
--    the Google Sheet import (style_tracker_rows, 'master_data') only for SKUs
--    with no Item Master description. Descriptions from any other source
--    (human-entered) are never overwritten. When short descriptions are stale
--    it enqueues the PopDAM worker operation 'shorten-item-descriptions'.

-- Fail the apply, not a 04:30 cron run, if anything the new body depends on is
-- missing or has an unexpected shape: every column it reads or writes (with type),
-- the relation kinds, admin_config's primary key (ON CONFLICT (key)), and the
-- function being replaced.
do $verify$
declare
  v_missing text;
begin
  select string_agg(format('%s.%s.%s %s', t.s, t.r, t.c, t.ty), ', ') into v_missing
  from (values
    ('plm', 'item', 'id', 'uuid'), ('plm', 'item', 'item_number', 'text'),
    ('plm', 'item', 'description', 'text'), ('plm', 'item', 'updated_at', 'timestamp with time zone'),
    ('public', 'style_tracker_rows', 'id', 'uuid'), ('public', 'style_tracker_rows', 'sku', 'text'),
    ('public', 'style_tracker_rows', 'description', 'text'), ('public', 'style_tracker_rows', 'tracker_type', 'text'),
    ('public', 'style_tracker_rows', 'updated_at', 'timestamp with time zone'),
    ('public', 'admin_config', 'key', 'text'), ('public', 'admin_config', 'value', 'jsonb'),
    ('public', 'admin_config', 'updated_at', 'timestamp with time zone'),
    ('dam', 'sku_human_description', 'sku', 'text'), ('dam', 'sku_human_description', 'description', 'text'),
    ('dam', 'sku_human_description', 'tracker_type', 'text'), ('dam', 'sku_human_description', 'source_row_id', 'uuid'),
    ('dam', 'sku_human_description', 'source_updated_at', 'timestamp with time zone'),
    ('dam', 'sku_human_description', 'refreshed_at', 'timestamp with time zone'),
    ('public', 'style_groups', 'sku', 'text'), ('public', 'style_groups', 'item_description', 'text'),
    ('public', 'style_groups', 'item_description_source', 'text')
  ) as t(s, r, c, ty)
  where not exists (
    select 1
    from pg_attribute att
    join pg_class cls on cls.oid = att.attrelid and cls.relkind in ('r', 'p')
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = t.s and cls.relname = t.r and att.attname = t.c
      and not att.attisdropped and format_type(att.atttypid, att.atttypmod) = t.ty
  );
  if v_missing is not null then
    raise exception '#3900: required column(s) missing or of another type: %', v_missing;
  end if;
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.admin_config'::regclass and i.indisunique
      and i.indpred is null and i.indnkeyatts = 1
      and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.admin_config'::regclass and attname = 'key')
  ) then
    raise exception '#3900: public.admin_config(key) has no unique index for ON CONFLICT (key)';
  end if;
  if to_regprocedure('public.refresh_sku_human_description()') is null
     or not exists (
       select 1 from pg_proc p
       where p.oid = to_regprocedure('public.refresh_sku_human_description()')
         and p.prorettype = 'bigint'::regtype and p.prokind = 'f' and p.prosecdef
     ) then
    raise exception '#3900: public.refresh_sku_human_description() returning bigint is not the function being replaced';
  end if;
end
$verify$;

alter table public.style_groups
  add column if not exists item_short_description text,
  add column if not exists item_short_description_source text,
  add column if not exists item_short_description_input text,
  add column if not exists item_short_description_model text,
  add column if not exists item_short_description_at timestamptz;

alter table public.style_groups
  drop constraint if exists style_groups_item_short_description_source_check;
alter table public.style_groups
  add constraint style_groups_item_short_description_source_check
  check (item_short_description_source is null or item_short_description_source in ('ai', 'manual'));

-- Index assumption (stated, not an oversight): this nightly body joins on
-- upper(trim(...)) expressions, which no existing index serves
-- (idx_style_tracker_rows_sku is upper(sku); plm.item has no item_number index;
-- style_groups/sku_human_description are keyed on raw sku). At ~19.5k Item Master
-- rows, ~11k groups and one run a day, sequential scans + hash joins are cheaper
-- than maintaining new expression indexes on these write-heavy tables. Revisit if
-- this ever runs interactively. The staleness probe is likewise a full scan.
--
-- public.admin_config is written as DATA (the BULK_OPERATIONS row), exactly as the
-- sibling enqueue writers do; no admin_config structure changes.
create or replace function public.refresh_sku_human_description()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'dam'
as $function$
declare
  v_row_count bigint;
  v_current   jsonb;
  v_status    text;
  v_now       timestamptz := now();
  v_can_enqueue boolean;
begin
  -- Ask for the BULK_OPERATIONS advisory lock FIRST and never wait for it.
  -- queue_nightly_rebuild_style_groups holds it while updating style_groups, so
  -- waiting for it after taking our own style_groups row locks would invert lock
  -- order, and waiting for it up front would stall this refresh behind that
  -- reconcile. If it is busy, the refresh still runs and only the enqueue is
  -- skipped; the next night enqueues while short descriptions remain stale.
  v_can_enqueue := pg_try_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  truncate table dam.sku_human_description;

  -- Item Master (ColdLion) first; the Google Sheet import only fills SKUs the
  -- Item Master has no description for.
  insert into dam.sku_human_description (
    sku, description, tracker_type, source_row_id, source_updated_at, refreshed_at
  )
  select distinct on (upper(trim(i.item_number)))
    trim(i.item_number),
    trim(i.description),
    'coldlion',
    i.id,
    i.updated_at,
    v_now
  from plm.item i
  where i.item_number is not null
    and length(trim(i.item_number)) > 0
    and i.description is not null
    and length(trim(i.description)) > 0
  order by upper(trim(i.item_number)), i.updated_at desc nulls last, i.id;

  insert into dam.sku_human_description (
    sku, description, tracker_type, source_row_id, source_updated_at, refreshed_at
  )
  select distinct on (upper(trim(r.sku)))
    trim(r.sku),
    trim(r.description),
    r.tracker_type,
    r.id,
    r.updated_at,
    v_now
  from public.style_tracker_rows r
  where r.sku is not null
    and length(trim(r.sku)) > 0
    and r.description is not null
    and length(trim(r.description)) > 0
    and not exists (
      select 1 from dam.sku_human_description d where upper(d.sku) = upper(trim(r.sku))
    )
  order by upper(trim(r.sku)), r.updated_at desc nulls last, r.id;

  select count(*) into v_row_count from dam.sku_human_description;

  update public.style_groups sg
  set item_description = d.description,
      item_description_source = case when d.tracker_type = 'coldlion' then 'coldlion' else 'master_data' end
  from dam.sku_human_description d
  where upper(trim(sg.sku)) = upper(d.sku)
    and (sg.item_description is null or sg.item_description_source in ('master_data', 'coldlion'))
    and (sg.item_description, sg.item_description_source)
        is distinct from (d.description, case when d.tracker_type = 'coldlion' then 'coldlion' else 'master_data' end);

  -- Hand stale short descriptions to the PopDAM worker.
  if v_can_enqueue and exists (
    select 1 from public.style_groups sg
    where sg.item_description_source = 'coldlion'
      and sg.item_description is not null
      and coalesce(sg.item_short_description_source, '') <> 'manual'
      and sg.item_short_description_input is distinct from sg.item_description
  ) then
    select value into v_current from public.admin_config where key = 'BULK_OPERATIONS';
    v_current := coalesce(v_current, '{}'::jsonb);
    v_status := v_current -> 'shorten-item-descriptions' ->> 'status';
    if coalesce(v_status, '') not in ('queued', 'running') then
      v_current := jsonb_set(
        v_current,
        array['shorten-item-descriptions'],
        jsonb_build_object(
          'status',         'queued',
          'cursor',         0,
          'params',         '{}'::jsonb,
          'started_at',     v_now::text,
          'updated_at',     v_now::text,
          'progress',       '{}'::jsonb,
          'run_id',         gen_random_uuid()::text,
          'queue_position', (extract(epoch from v_now) * 1000)::bigint,
          'requested_by',   'pg_cron'
        ),
        true
      );
      insert into public.admin_config (key, value, updated_at)
      values ('BULK_OPERATIONS', v_current, v_now)
      on conflict (key) do update
        set value = excluded.value, updated_at = excluded.updated_at;
    end if;
  end if;

  return v_row_count;
end;
$function$;
