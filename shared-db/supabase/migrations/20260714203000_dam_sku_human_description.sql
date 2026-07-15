-- Durable, deduplicated human-authored SKU descriptions for DAM consumers.

create table dam.sku_human_description (
  sku text primary key,
  description text not null,
  tracker_type text not null,
  source_row_id uuid not null,
  source_updated_at timestamptz,
  refreshed_at timestamptz not null default now()
);

comment on table dam.sku_human_description is
  'Latest non-empty human-authored Master Data description per SKU, isolated from the temporary style tracker table.';

create or replace function public.refresh_sku_human_description()
returns bigint
language plpgsql
security definer
set search_path = public, dam
as $$
declare
  v_row_count bigint;
begin
  truncate table dam.sku_human_description;

  insert into dam.sku_human_description (
    sku,
    description,
    tracker_type,
    source_row_id,
    source_updated_at,
    refreshed_at
  )
  select distinct on (trim(r.sku))
    trim(r.sku),
    trim(r.description),
    r.tracker_type,
    r.id,
    r.updated_at,
    now()
  from public.style_tracker_rows r
  where r.sku is not null
    and length(trim(r.sku)) > 0
    and r.description is not null
    and length(trim(r.description)) > 0
  order by trim(r.sku), r.updated_at desc nulls last;

  get diagnostics v_row_count = row_count;
  return v_row_count;
end;
$$;

select public.refresh_sku_human_description();

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'refresh-sku-human-description';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'refresh-sku-human-description',
    '30 4 * * *',
    $cron$ select public.refresh_sku_human_description() $cron$
  );
end;
$$;

grant usage on schema dam to authenticated, service_role;
grant select on dam.sku_human_description to authenticated, service_role;
revoke execute on function public.refresh_sku_human_description() from public, anon, authenticated;
grant execute on function public.refresh_sku_human_description() to service_role;
