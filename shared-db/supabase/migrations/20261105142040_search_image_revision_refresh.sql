set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

-- A successful renderer completion is an authoritative new thumbnail revision,
-- including a CDN overwrite at the same URL. Preserve existing render handlers.
create or replace function public.refresh_dam_search_after_render_completion()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_group uuid;
begin
  if new.status='completed' and new.completed_at is not null
     and (old.status is distinct from new.status or old.completed_at is distinct from new.completed_at) then
    perform public.refresh_dam_search_asset_document(new.asset_id);
    select style_group_id into v_group from public.assets where id=new.asset_id;
    if v_group is not null then perform public.refresh_dam_search_style_group_document(v_group); end if;
  end if;
  return new;
end $$;
create trigger trg_dam_search_after_render_completion after update of status,completed_at on public.render_queue
for each row execute function public.refresh_dam_search_after_render_completion();

-- #5609 already covers modified_at/thumbnail changes. Add only its missing
-- size-only source revision case, without replacing another owner's trigger.
create or replace function public.refresh_dam_search_after_source_size_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_group uuid; v_previous text;
begin
  -- Scope legacy invalidation to this genuine source-size revision. Preserve
  -- outer trigger context for nested writes; this marker is never authority.
  v_previous:=current_setting('dam.search_image_size_changed_asset',true);
  perform set_config('dam.search_image_size_changed_asset',new.id::text,true);
  begin
    perform public.refresh_dam_search_asset_document(new.id);
    v_group:=new.style_group_id;
    if v_group is not null then perform public.refresh_dam_search_style_group_document(v_group); end if;
  exception when others then
    perform set_config('dam.search_image_size_changed_asset',coalesce(v_previous,''),true);
    raise;
  end;
  perform set_config('dam.search_image_size_changed_asset',coalesce(v_previous,''),true);
  return new;
end $$;
create trigger trg_dam_search_after_source_size_change after update of file_size on public.assets
for each row when (old.file_size is distinct from new.file_size and old.modified_at is not distinct from new.modified_at
  and old.thumbnail_url is not distinct from new.thumbnail_url)
execute function public.refresh_dam_search_after_source_size_change();
revoke all on function public.refresh_dam_search_after_render_completion() from public,anon,authenticated;
revoke all on function public.refresh_dam_search_after_source_size_change() from public,anon,authenticated;
