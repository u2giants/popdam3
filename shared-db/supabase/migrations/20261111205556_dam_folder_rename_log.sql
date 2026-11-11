-- popdam3#963 Phase 1: permanent folder rename record + path-as-of lookup,
-- and keep per-file move history long enough to follow NAS snapshots.
-- Additive. Purge change only lengthens retention (90 -> 400 days).

create table dam.folder_rename_log (
  id          bigint generated always as identity primary key,
  share       text not null default 'mac',
  old_path    text not null,
  new_path    text not null,
  renamed_at  timestamptz not null,
  batch_id    uuid not null,
  rule        text not null,
  reverted_at timestamptz,
  constraint folder_rename_log_unique unique (share, old_path, renamed_at),
  constraint folder_rename_log_paths_differ check (old_path <> new_path),
  constraint folder_rename_log_paths_shape check (
    old_path <> '' and new_path <> ''
    and left(old_path, 1) <> '/' and right(old_path, 1) <> '/'
    and left(new_path, 1) <> '/' and right(new_path, 1) <> '/')
);

comment on table dam.folder_rename_log is
  'Permanent folder-level record of NAS folder renames (popdam3#963). NEVER purge: '
  'it is the only way to find a file''s pre-rename path in NAS snapshots and backups, '
  'which are kept for years. Written only by the service role.';

create index folder_rename_log_new_path_idx on dam.folder_rename_log (share, new_path);

alter table dam.folder_rename_log enable row level security;
revoke all on dam.folder_rename_log from anon, authenticated;
grant select on dam.folder_rename_log to authenticated;
grant all on dam.folder_rename_log to service_role;

create policy folder_rename_log_admin_read on dam.folder_rename_log
  for select to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- Path as it was at p_at: undo every non-reverted rename that happened after
-- p_at, newest first, on whole path segments only (literal compare, no LIKE).
create function dam.path_as_of(p_share text, p_path text, p_at timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v text := p_path;
begin
  if v is null then
    return null;
  end if;
  for r in
    select l.old_path, l.new_path
    from dam.folder_rename_log l
    where l.share = p_share and l.reverted_at is null and l.renamed_at > p_at
    order by l.renamed_at desc, l.id desc
  loop
    if v = r.new_path then
      v := r.old_path;
    elsif left(v, length(r.new_path) + 1) = r.new_path || '/' then
      v := r.old_path || substr(v, length(r.new_path) + 1);
    end if;
  end loop;
  return v;
end;
$$;

-- Every path the asset has had: current, each per-file older path, and each
-- of those passed back through every rename boundary.
create function dam.path_candidates(p_share text, p_asset_id uuid)
returns setof text
language sql
stable
set search_path = ''
as $$
  with recursive seeds as (
    select a.relative_path as p from public.assets a where a.id = p_asset_id
    union
    select h.old_relative_path from public.asset_path_history h where h.asset_id = p_asset_id
    union
    select h.new_relative_path from public.asset_path_history h where h.asset_id = p_asset_id
  ),
  walk(p) as (
    select p from seeds where p is not null
    union
    select case when w.p = l.new_path then l.old_path
                else l.old_path || substr(w.p, length(l.new_path) + 1) end
    from walk w
    join dam.folder_rename_log l
      on l.share = p_share and l.reverted_at is null
     and (w.p = l.new_path or left(w.p, length(l.new_path) + 1) = l.new_path || '/')
  )
  select distinct p from walk;
$$;

revoke all on function dam.path_as_of(text, text, timestamptz) from public, anon, authenticated;
revoke all on function dam.path_candidates(text, uuid) from public, anon, authenticated;
grant execute on function dam.path_as_of(text, text, timestamptz) to service_role;
grant execute on function dam.path_candidates(text, uuid) to service_role;

-- dam is not in PostgREST schemas: service-role wrapper for the admin edge function.
create function public.dam_asset_path_candidates(p_asset_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select dam.path_candidates('mac', p_asset_id);
$$;

revoke all on function public.dam_asset_path_candidates(uuid) from public, anon, authenticated;
grant execute on function public.dam_asset_path_candidates(uuid) to service_role;

-- Keep per-file move history at least as long as NAS snapshots (~12 months) plus margin.
do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'purge-asset-path-history-old-rows'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'purge-asset-path-history-old-rows',
    '30 3 * * *',
    $job$DELETE FROM public.asset_path_history WHERE detected_at < NOW() - INTERVAL '400 days';$job$
  );
end;
$cron$;
