-- derived-from: none
-- Issue popcre/shared-db#5354 (claim #5355): cure review finding #5312 - every
-- distinct asset and style group is refreshed on large tag/character statements.
--
-- 20261101120856 moved the DAM search refresh to statement-level triggers that
-- collect distinct assets and groups and call refresh_dam_search_documents_batch
-- once with p_limit = cardinality(assets) + cardinality(groups). That batch
-- function clamped p_limit with least(..., 1000) and paid style groups only out
-- of the assets' remaining budget, so a statement touching more than 1000
-- distinct assets never refreshed the ones past the 1000th and refreshed no
-- style-group documents at all. It left stale dam_search_documents rows - the
-- completeness property the #1479 recovery contracts assert.
--
-- The budget is now honoured as the caller requested it, and style groups get
-- their own budget instead of the assets' remainder. Every other caller passes
-- a small explicit limit (1, 2 or 4) and is unchanged. The trigger function
-- public.trg_refresh_dam_tag_or_character_stmt() is therefore complete again
-- without touching it; it stays under exclusive reissue claim #5338.

create or replace function public.refresh_dam_search_documents_batch(p_asset_ids uuid[] default '{}', p_style_group_ids uuid[] default '{}', p_limit int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_a int:=0; v_g int:=0; v_budget int:=greatest(1,coalesce(p_limit,500));
begin
  for v_id in select distinct x from unnest(coalesce(p_asset_ids,'{}')) x order by x limit v_budget loop
    perform public.refresh_dam_search_asset_document(v_id); v_a:=v_a+1;
  end loop;
  for v_id in select distinct x from unnest(coalesce(p_style_group_ids,'{}')) x order by x limit v_budget loop
    perform public.refresh_dam_search_style_group_document(v_id); v_g:=v_g+1;
  end loop;
  return jsonb_build_object('asset_documents',v_a,'style_group_documents',v_g,'bounded_limit',v_budget);
end $$;

revoke all on function public.refresh_dam_search_documents_batch(uuid[],uuid[],int) from public,anon,authenticated;
grant execute on function public.refresh_dam_search_documents_batch(uuid[],uuid[],int) to service_role;
