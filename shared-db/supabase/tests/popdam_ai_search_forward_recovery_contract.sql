-- #1471 transaction-rolled-back forward recovery checks.
begin;

do $$
begin
  if to_regclass('public.style_group_tags') is null
     or to_regclass('public.dam_search_documents') is null then
    raise exception 'complete #1427 relation contract is missing';
  end if;

  if to_regprocedure('public.get_effective_asset_metadata(uuid)') is null
     or to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is null
     or to_regprocedure('public.reset_dam_search_embedding_errors(text,uuid[])') is null then
    raise exception 'complete #1427 function contract is missing';
  end if;

  -- The historical complete preview contract remains intact. Prerequisite A
  -- recreated this index and recovery B deliberately retained it so cleanup
  -- could not block final activation under persistent live snapshots. Issue
  -- #1467 (20260827183106) retired it after activation, so it must be ABSENT.
  if to_regclass('public.asset_tags_pending_metadata_normalization_idx') is not null then
    raise exception 'retired normalization accelerator index is still present';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.asset_tags'::regclass
      and tgname = 'asset_tags_sync_assets_tags'
      and not tgisinternal
  ) then
    raise exception 'status-aware compatibility trigger is missing';
  end if;
end $$;

rollback;
