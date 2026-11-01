-- derived-from: none
-- Reissue of merged, never-applied 20261101120856 (PR 5310), which had no closing link.
-- Issue popcre/shared-db#5336 (claim #5338): DAM search refresh once per statement.
--
-- The four tag/character tables refreshed the asset AND its style-group search
-- documents once PER ROW. A single replace_asset_ai_tag_result call for one asset
-- with 35 tags took 25 s (authenticator timeout is 8 s) because the same group
-- document was rebuilt ~70 times. These statement-level triggers collect the
-- distinct assets and groups from the transition tables and refresh each once.
-- The per-row function public.trg_refresh_dam_tag_or_character is left in place
-- (unused here) so nothing that references it breaks.

create or replace function public.trg_refresh_dam_tag_or_character_stmt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_assets uuid[] := '{}'; v_groups uuid[] := '{}';
begin
  if tg_table_name = 'style_group_tags' then
    if tg_op in ('INSERT', 'UPDATE') then
      select v_groups || coalesce(array_agg(distinct style_group_id), '{}') into v_groups from new_rows;
    end if;
    if tg_op in ('DELETE', 'UPDATE') then
      select v_groups || coalesce(array_agg(distinct style_group_id), '{}') into v_groups from old_rows;
    end if;
  else
    if tg_op in ('INSERT', 'UPDATE') then
      select v_assets || coalesce(array_agg(distinct asset_id), '{}') into v_assets from new_rows;
    end if;
    if tg_op in ('DELETE', 'UPDATE') then
      select v_assets || coalesce(array_agg(distinct asset_id), '{}') into v_assets from old_rows;
    end if;
    select coalesce(array_agg(distinct a.id), '{}'),
           coalesce(array_agg(distinct a.style_group_id) filter (where a.style_group_id is not null), '{}')
      into v_assets, v_groups
      from public.assets a where a.id = any(v_assets);
  end if;
  if cardinality(v_assets) > 0 or cardinality(v_groups) > 0 then
    perform public.refresh_dam_search_documents_batch(v_assets, v_groups, cardinality(v_assets) + cardinality(v_groups));
  end if;
  return null;
end $function$;

revoke all on function public.trg_refresh_dam_tag_or_character_stmt() from public, anon, authenticated;

drop trigger if exists asset_tags_dam_search_refresh on public.asset_tags;
drop trigger if exists asset_tags_dam_search_refresh_ins on public.asset_tags;
create trigger asset_tags_dam_search_refresh_ins after insert on public.asset_tags
  referencing new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_tags_dam_search_refresh_upd on public.asset_tags;
create trigger asset_tags_dam_search_refresh_upd after update on public.asset_tags
  referencing old table as old_rows new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_tags_dam_search_refresh_del on public.asset_tags;
create trigger asset_tags_dam_search_refresh_del after delete on public.asset_tags
  referencing old table as old_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();

drop trigger if exists style_group_tags_dam_search_refresh on public.style_group_tags;
drop trigger if exists style_group_tags_dam_search_refresh_ins on public.style_group_tags;
create trigger style_group_tags_dam_search_refresh_ins after insert on public.style_group_tags
  referencing new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists style_group_tags_dam_search_refresh_upd on public.style_group_tags;
create trigger style_group_tags_dam_search_refresh_upd after update on public.style_group_tags
  referencing old table as old_rows new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists style_group_tags_dam_search_refresh_del on public.style_group_tags;
create trigger style_group_tags_dam_search_refresh_del after delete on public.style_group_tags
  referencing old table as old_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();

drop trigger if exists asset_characters_dam_search_refresh on public.asset_characters;
drop trigger if exists asset_characters_dam_search_refresh_ins on public.asset_characters;
create trigger asset_characters_dam_search_refresh_ins after insert on public.asset_characters
  referencing new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_characters_dam_search_refresh_upd on public.asset_characters;
create trigger asset_characters_dam_search_refresh_upd after update on public.asset_characters
  referencing old table as old_rows new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_characters_dam_search_refresh_del on public.asset_characters;
create trigger asset_characters_dam_search_refresh_del after delete on public.asset_characters
  referencing old table as old_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();

drop trigger if exists asset_licensor_characters_dam_search_refresh on public.asset_licensor_characters;
drop trigger if exists asset_licensor_characters_dam_search_refresh_ins on public.asset_licensor_characters;
create trigger asset_licensor_characters_dam_search_refresh_ins after insert on public.asset_licensor_characters
  referencing new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_licensor_characters_dam_search_refresh_upd on public.asset_licensor_characters;
create trigger asset_licensor_characters_dam_search_refresh_upd after update on public.asset_licensor_characters
  referencing old table as old_rows new table as new_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();
drop trigger if exists asset_licensor_characters_dam_search_refresh_del on public.asset_licensor_characters;
create trigger asset_licensor_characters_dam_search_refresh_del after delete on public.asset_licensor_characters
  referencing old table as old_rows for each statement execute function public.trg_refresh_dam_tag_or_character_stmt();

