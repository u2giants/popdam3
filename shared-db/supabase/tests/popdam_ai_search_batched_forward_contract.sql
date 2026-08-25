-- #1474 prerequisite-A checks. The surrounding harness rolls this transaction back.
begin;

do $$
declare
  v_column text;
  v_contract_complete boolean :=
    to_regclass('public.style_group_tags') is not null
    and to_regclass('public.dam_search_documents') is not null
    and to_regprocedure('public.get_effective_asset_metadata(uuid)') is not null;
begin
  foreach v_column in array array[
    'category', 'status', 'confidence', 'model', 'evidence',
    'rejected_at', 'rejected_by', 'updated_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'asset_tags'
        and column_name = v_column
        and (v_contract_complete or is_nullable = 'YES')
    ) then
      raise exception 'asset_tags.% must exist and remain nullable in prerequisite-only state', v_column;
    end if;
  end loop;

  if to_regclass('public.asset_tags_active_asset_idx') is null then
    raise exception 'final active asset tag index is missing';
  end if;
  if not v_contract_complete and (
       to_regclass('public.asset_tags_forward_asset_id_idx') is null
       or to_regclass('public.asset_tags_pending_metadata_normalization_idx') is null
     ) then
    raise exception 'prerequisite-A supporting indexes are incomplete';
  end if;
  if v_contract_complete and (
       to_regclass('public.asset_tags_forward_asset_id_idx') is null
       or to_regclass('public.asset_tags_pending_metadata_normalization_idx') is null
     ) then
    raise exception 'deliberate-held compatibility recovery indexes are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.asset_tags'::regclass
      and tgname in ('trg_sync_asset_tags', 'asset_tags_sync_assets_tags')
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'asset_tags compatibility maintenance is disabled in pending state';
  end if;

end $$;

rollback;
