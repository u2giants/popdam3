-- popdam3#963 / review finding #6082 on PR #6078.
-- 1. A reverted rename still existed between renamed_at and reverted_at, so
--    snapshots in that window show new_path: path_as_of / path_candidates
--    now treat the revert as its own event instead of ignoring the row.
-- 2. A folder is never renamed into its own descendant or ancestor: enforce it,
--    so the candidate walk always terminates (plus a depth cap).
-- 3. path_as_of(NULL time) returns NULL instead of the input path.

alter table dam.folder_rename_log
  add constraint folder_rename_log_not_nested check (
    left(old_path, length(new_path) + 1) <> new_path || '/'
    and left(new_path, length(old_path) + 1) <> old_path || '/'),
  add constraint folder_rename_log_revert_after_rename check (
    reverted_at is null or reverted_at >= renamed_at);

create or replace function dam.path_as_of(p_share text, p_path text, p_at timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v text := p_path;
begin
  if v is null or p_at is null then
    return null;
  end if;
  -- Events after p_at, newest first. A rename moved old->new at renamed_at;
  -- a revert moved new->old at reverted_at. Undo each: map "to" back to "from".
  for r in
    select e.from_path, e.to_path
    from (
      select l.old_path as from_path, l.new_path as to_path, l.renamed_at as at, l.id, 0 as kind
      from dam.folder_rename_log l
      where l.share = p_share and l.renamed_at > p_at
      union all
      select l.new_path, l.old_path, l.reverted_at, l.id, 1
      from dam.folder_rename_log l
      where l.share = p_share and l.reverted_at is not null and l.reverted_at > p_at
    ) e
    order by e.at desc, e.id desc, e.kind desc
  loop
    if v = r.to_path then
      v := r.from_path;
    elsif left(v, length(r.to_path) + 1) = r.to_path || '/' then
      v := r.from_path || substr(v, length(r.to_path) + 1);
    end if;
  end loop;
  return v;
end;
$$;

create or replace function dam.path_candidates(p_share text, p_asset_id uuid)
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
  -- every folder pair that was ever swapped, in either direction (a reverted
  -- rename means the file sat under new_path for a while, then under old_path)
  edges as (
    select l.new_path as to_path, l.old_path as from_path
    from dam.folder_rename_log l where l.share = p_share
    union
    select l.old_path, l.new_path
    from dam.folder_rename_log l where l.share = p_share and l.reverted_at is not null
  ),
  walk(p, depth) as (
    select p, 0 from seeds where p is not null
    union
    select case when w.p = e.to_path then e.from_path
                else e.from_path || substr(w.p, length(e.to_path) + 1) end,
           w.depth + 1
    from walk w
    join edges e on (w.p = e.to_path or left(w.p, length(e.to_path) + 1) = e.to_path || '/')
    where w.depth < 50
  )
  select distinct p from walk;
$$;

revoke all on function dam.path_as_of(text, text, timestamptz) from public, anon, authenticated;
revoke all on function dam.path_candidates(text, uuid) from public, anon, authenticated;
grant execute on function dam.path_as_of(text, text, timestamptz) to service_role;
grant execute on function dam.path_candidates(text, uuid) to service_role;
