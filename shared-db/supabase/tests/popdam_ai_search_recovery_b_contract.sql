-- #1479 recovery-B final-state checks. The harness rolls this transaction back.
begin;

do $$
declare v_column text;
begin
  foreach v_column in array array['category','status','evidence','updated_at'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='asset_tags'
        and column_name=v_column and is_nullable='NO'
    ) then raise exception 'asset_tags.% is not final/non-null',v_column; end if;
  end loop;

  if to_regclass('public.style_group_tags') is null
     or to_regclass('public.dam_search_documents') is null
     or to_regclass('public.asset_tags_active_asset_idx') is null then
    raise exception 'PopDAM #1427 final tables/index are incomplete';
  end if;
  if to_regclass('public.asset_tags_forward_asset_id_idx') is null
     or to_regclass('public.asset_tags_pending_metadata_normalization_idx') is null then
    raise exception 'PopDAM deliberate-held compatibility recovery indexes are missing';
  end if;
  if (
    select col_description(a.attrelid,a.attnum)
    from pg_attribute a
    where a.attrelid='public.asset_tags'::regclass and a.attname='category'
  ) <> 'File-specific PopDAM tag category; final #1427 contract active.' then
    raise exception 'PopDAM recovery B did not clear its pending-state marker';
  end if;
  if exists(select 1 from public.asset_tags where category is null or status is null
    or evidence is null or updated_at is null or tag is distinct from btrim(tag)
    or source is distinct from btrim(source)) then
    raise exception 'PopDAM reconciliation left incomplete rows';
  end if;
  if to_regprocedure('public.get_effective_asset_metadata(uuid)') is null
     or to_regprocedure('public.replace_asset_ai_tag_result(uuid,text,text,jsonb)') is null
     or to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is null
     or to_regprocedure('public.get_dam_search_embedding_status()') is null then
    raise exception 'PopDAM #1427 final RPC contract is incomplete';
  end if;
  if (select count(*) from pg_constraint where conrelid='public.asset_tags'::regclass
      and convalidated and conname in ('asset_tags_tag_normalized_check','asset_tags_source_normalized_check',
        'asset_tags_category_check','asset_tags_status_check','asset_tags_confidence_check','asset_tags_rejection_check')) <> 6 then
    raise exception 'PopDAM canonical final validated checks are incomplete';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and (
      (tgrelid='public.asset_tags'::regclass and tgname in ('asset_tags_sync_assets_tags','asset_tags_dam_search_refresh'))
      or (tgrelid='public.style_group_tags'::regclass and tgname='style_group_tags_dam_search_refresh')
      or (tgrelid='public.asset_characters'::regclass and tgname='asset_characters_dam_search_refresh'))) <> 4 then
    raise exception 'PopDAM canonical final trigger wiring is incomplete';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.style_group_tags'::regclass)
     or (select count(*) from pg_policy where polrelid='public.style_group_tags'::regclass
       and polname in ('Authenticated read style_group_tags','Admin manage style_group_tags')) <> 2 then
    raise exception 'PopDAM canonical final RLS contract is incomplete';
  end if;
end $$;

rollback;
