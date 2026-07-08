-- Add a user-visible audit trail for the temporary Master Data style tracker.
do $migration$
begin
if to_regclass('public.style_tracker_rows') is null
  or to_regclass('plm.style_tracker_value_resolution') is null
  or to_regclass('public.profiles') is null then
  raise notice 'Skipping Master Data audit log migration because style tracker objects are absent in this database.';
else
execute $ddl$

create table if not exists public.style_tracker_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('row_added', 'cell_update', 'value_resolution')),
  style_tracker_row_id uuid references public.style_tracker_rows(id) on delete set null,
  source_sheet text,
  source_row_number integer,
  field_key text,
  column_letter text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

create index if not exists idx_style_tracker_audit_log_changed_at
  on public.style_tracker_audit_log (changed_at desc);

create index if not exists idx_style_tracker_audit_log_row
  on public.style_tracker_audit_log (style_tracker_row_id, changed_at desc)
  where style_tracker_row_id is not null;

create index if not exists idx_style_tracker_audit_log_sheet
  on public.style_tracker_audit_log (source_sheet, changed_at desc);

alter table public.style_tracker_audit_log enable row level security;

drop policy if exists "style tracker audit readable by authenticated users"
  on public.style_tracker_audit_log;

create policy "style tracker audit readable by authenticated users"
  on public.style_tracker_audit_log
  for select
  to authenticated
  using (true);

revoke all on table public.style_tracker_audit_log from public;
grant select on table public.style_tracker_audit_log to authenticated;
grant select, insert on table public.style_tracker_audit_log to service_role;

create or replace function public.log_style_tracker_row_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    insert into public.style_tracker_audit_log (
      event_type,
      style_tracker_row_id,
      source_sheet,
      source_row_number,
      metadata,
      changed_by
    )
    values (
      'row_added',
      new.id,
      new.source_sheet,
      new.source_row_number,
      jsonb_build_object('tracker_type', new.tracker_type),
      auth.uid()
    );

    return new;
  end if;

  for v_key in
    select distinct key
    from (
      select jsonb_object_keys(coalesce(old.row_data, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(new.row_data, '{}'::jsonb)) as key
    ) keys
    where key ~ '^[A-Z]{1,2}$'
    order by key
  loop
    if (old.row_data -> v_key) is distinct from (new.row_data -> v_key) then
      insert into public.style_tracker_audit_log (
        event_type,
        style_tracker_row_id,
        source_sheet,
        source_row_number,
        column_letter,
        old_value,
        new_value,
        metadata,
        changed_by
      )
      values (
        'cell_update',
        new.id,
        new.source_sheet,
        new.source_row_number,
        v_key,
        old.row_data -> v_key,
        new.row_data -> v_key,
        jsonb_build_object('tracker_type', new.tracker_type),
        auth.uid()
      );
    end if;
  end loop;

  return new;
end;
$function$;

drop trigger if exists trg_style_tracker_row_audit on public.style_tracker_rows;

create trigger trg_style_tracker_row_audit
  after insert or update of row_data on public.style_tracker_rows
  for each row
  execute function public.log_style_tracker_row_audit();

create or replace view public.style_tracker_audit_log_with_user as
select
  audit.id,
  audit.event_type,
  audit.style_tracker_row_id,
  audit.source_sheet,
  audit.source_row_number,
  audit.field_key,
  audit.column_letter,
  audit.old_value,
  audit.new_value,
  audit.metadata,
  audit.changed_by,
  audit.changed_at,
  coalesce(nullif(profile.full_name, ''), nullif(profile.email, ''), audit.changed_by::text, 'System') as changed_by_label,
  profile.email as changed_by_email
from public.style_tracker_audit_log audit
left join public.profiles profile on profile.user_id = audit.changed_by;

grant select on public.style_tracker_audit_log_with_user to authenticated;

create or replace function public.upsert_style_tracker_value_resolution(
  p_field_key text,
  p_raw_value text,
  p_resolution_type text,
  p_target_schema text default null,
  p_target_table text default null,
  p_target_id uuid default null,
  p_target_label text default null,
  p_local_value text default null
)
returns plm.style_tracker_value_resolution
language plpgsql
security definer
set search_path = public, plm
as $function$
declare
  v_resolution plm.style_tracker_value_resolution;
  v_previous jsonb;
  v_normalized text;
  v_manual jsonb;
  v_affected_rows integer := 0;
begin
  if p_field_key not in ('sku', 'customer', 'licensor', 'designer', 'factory') then
    raise exception 'Unsupported field_key: %', p_field_key;
  end if;

  if nullif(trim(coalesce(p_raw_value, '')), '') is null then
    raise exception 'raw_value is required';
  end if;

  v_normalized := plm.normalize_style_tracker_value(p_field_key, p_raw_value);

  select to_jsonb(existing)
  into v_previous
  from plm.style_tracker_value_resolution existing
  where existing.field_key = p_field_key
    and existing.normalized_value = v_normalized;

  v_manual := jsonb_strip_nulls(jsonb_build_object(
    'field_key', p_field_key,
    'resolution_type', p_resolution_type,
    'target_schema', p_target_schema,
    'target_table', p_target_table,
    'target_id', p_target_id,
    'target_label', p_target_label,
    'local_value', case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end
  ));

  insert into plm.style_tracker_value_resolution (
    field_key,
    raw_value,
    normalized_value,
    resolution_type,
    target_schema,
    target_table,
    target_id,
    target_label,
    local_value,
    confidence
  )
  values (
    p_field_key,
    trim(p_raw_value),
    v_normalized,
    p_resolution_type,
    p_target_schema,
    p_target_table,
    p_target_id,
    p_target_label,
    case when p_resolution_type = 'master_data' then trim(coalesce(p_local_value, p_raw_value)) else null end,
    'verified'
  )
  on conflict (field_key, normalized_value) do update set
    raw_value = excluded.raw_value,
    resolution_type = excluded.resolution_type,
    target_schema = excluded.target_schema,
    target_table = excluded.target_table,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    local_value = excluded.local_value,
    confidence = excluded.confidence
  returning * into v_resolution;

  update plm.style_tracker_item_bridge b
  set
    creative_designer_id = case
      when p_field_key = 'designer'
        and p_resolution_type = 'canonical'
        and p_target_schema = 'core'
        and p_target_table = 'creative_designer'
        then p_target_id
      when p_field_key = 'designer' then null
      else b.creative_designer_id
    end,
    match_notes = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(b.match_notes, '{}'::jsonb),
          '{manual_resolutions}',
          coalesce(b.match_notes->'manual_resolutions', '{}'::jsonb),
          true
        ),
        array['manual_resolutions', p_field_key],
        v_manual,
        true
      ),
      '{manual_resolution}',
      v_manual,
      true
    ),
    match_status = case
      when p_resolution_type = 'canonical' then
        case when p_field_key = 'designer' and b.match_status = 'unmatched' then 'partial' else 'matched' end
      else 'partial'
    end,
    match_confidence = 'verified',
    last_matched_at = now()
  from public.style_tracker_rows r
  where b.style_tracker_row_id = r.id
    and case p_field_key
      when 'sku' then plm.normalize_style_tracker_value('sku', r.sku)
      when 'customer' then plm.normalize_style_tracker_value('customer', r.customer)
      when 'licensor' then plm.normalize_style_tracker_value('licensor', r.licensor)
      when 'designer' then plm.normalize_style_tracker_value('designer', r.designer)
      when 'factory' then plm.normalize_style_tracker_value('factory', r.default_vendor)
    end = v_normalized;

  get diagnostics v_affected_rows = row_count;

  insert into public.style_tracker_audit_log (
    event_type,
    field_key,
    old_value,
    new_value,
    metadata,
    changed_by
  )
  values (
    'value_resolution',
    p_field_key,
    v_previous,
    to_jsonb(v_resolution),
    jsonb_build_object(
      'raw_value', trim(p_raw_value),
      'normalized_value', v_normalized,
      'resolution_type', p_resolution_type,
      'affected_rows', v_affected_rows
    ),
    auth.uid()
  );

  return v_resolution;
end;
$function$;

revoke all on function public.upsert_style_tracker_value_resolution(text, text, text, text, text, uuid, text, text) from public;
grant execute on function public.upsert_style_tracker_value_resolution(text, text, text, text, text, uuid, text, text) to anon, authenticated, service_role;

comment on table public.style_tracker_audit_log
  is 'User-visible Master Data style tracker audit log for row additions, cell edits, and manual value resolutions.';
$ddl$;
end if;
end
$migration$;
