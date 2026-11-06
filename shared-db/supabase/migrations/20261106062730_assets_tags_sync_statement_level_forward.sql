-- derived-from: 20260825082910
-- popcre/shared-db#5747 Step 2: stop no-op rewrites of public.assets.tags.
-- Fix-forward of 20261106040512 (preview-only; production refused it because
-- its declared base 20260825010603 is not in the production ledger). Same body,
-- base corrected to 20260825082910, and idempotent where 040512 already ran.
--
-- The old row-level trigger rewrote assets.tags once for EVERY asset_tags row
-- touched. replace_asset_ai_tag_result deletes and re-inserts a result's tags,
-- so one AI result rewrote the same asset 2N times, mostly to an identical or
-- transient array. assets.tags is indexed, so each rewrite was a non-HOT
-- update that bloats public.assets.
--
-- Now: statement-level triggers with transition tables recompute each touched
-- asset once per statement, and only write when the array actually differs.
-- The resulting assets.tags value is identical to before (same aggregate).

-- Same function name (catalog contracts pin it); the old row-level trigger is
-- dropped first because a trigger function body cannot serve both levels.
drop trigger if exists asset_tags_sync_assets_tags on public.asset_tags;

create or replace function public.sync_asset_tags_to_array()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  -- A transition table exists only for the events its trigger declares.
  if tg_op = 'INSERT' then
    select array_agg(distinct asset_id) into v_ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct asset_id) into v_ids from old_rows;
  else
    select array_agg(distinct asset_id) into v_ids
    from (select asset_id from new_rows union select asset_id from old_rows) u;
  end if;

  update public.assets a
  set tags = c.tags
  from (
    select x.id,
           coalesce((select array_agg(t.tag order by lower(t.tag), t.tag)
                     from public.asset_tags t
                     where t.asset_id = x.id and t.status = 'active'), '{}'::text[]) as tags
    from unnest(v_ids) as x(id)
  ) c
  where a.id = c.id
    and a.tags is distinct from c.tags;
  return null;
end
$function$;

revoke all on function public.sync_asset_tags_to_array() from public, anon, authenticated;

drop trigger if exists asset_tags_sync_assets_tags_ins on public.asset_tags;
drop trigger if exists asset_tags_sync_assets_tags_upd on public.asset_tags;
drop trigger if exists asset_tags_sync_assets_tags_del on public.asset_tags;

create trigger asset_tags_sync_assets_tags_ins
  after insert on public.asset_tags
  referencing new table as new_rows
  for each statement execute function public.sync_asset_tags_to_array();

create trigger asset_tags_sync_assets_tags_upd
  after update on public.asset_tags
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.sync_asset_tags_to_array();

create trigger asset_tags_sync_assets_tags_del
  after delete on public.asset_tags
  referencing old table as old_rows
  for each statement execute function public.sync_asset_tags_to_array();

