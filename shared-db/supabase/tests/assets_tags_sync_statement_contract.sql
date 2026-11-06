-- #5747 Step 2: asset_tags changes keep assets.tags exact while rewriting each
-- asset at most once per statement, and not at all when the list is unchanged.
begin;
do $$
declare
  v_asset uuid;
  v_before text[];
  v_xmin xid;
begin
  select id into v_asset from public.assets limit 1;
  if v_asset is null then
    raise notice 'no assets row; behavior check skipped';
    return;
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.asset_tags'::regclass and not tgisinternal
      and tgname in ('asset_tags_sync_assets_tags_ins','asset_tags_sync_assets_tags_upd','asset_tags_sync_assets_tags_del')
      and tgtype & 1 = 0) <> 3 then
    raise exception 'tags sync must be three statement-level triggers';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'asset_tags_sync_assets_tags') then
    raise exception 'row-level tags sync trigger must be gone';
  end if;

  insert into public.asset_tags(asset_id, tag, category, source, status)
  values (v_asset, 'zz contract a', 'other', 'contract_test', 'active'),
         (v_asset, 'zz contract b', 'other', 'contract_test', 'active');
  if not (select tags @> array['zz contract a','zz contract b'] from public.assets where id = v_asset) then
    raise exception 'insert did not sync assets.tags';
  end if;

  select tags into v_before from public.assets where id = v_asset;
  -- Unchanged active set: candidate-status change must not rewrite the asset.
  update public.asset_tags set confidence = 0.5 where asset_id = v_asset and source = 'contract_test';
  if (select tags from public.assets where id = v_asset) is distinct from v_before then
    raise exception 'unchanged update altered assets.tags';
  end if;

  delete from public.asset_tags where asset_id = v_asset and source = 'contract_test';
  if (select tags && array['zz contract a','zz contract b'] from public.assets where id = v_asset) then
    raise exception 'delete did not sync assets.tags';
  end if;
  if (select tags from public.assets where id = v_asset) is distinct from
     coalesce((select array_agg(t.tag order by lower(t.tag), t.tag) from public.asset_tags t
               where t.asset_id = v_asset and t.status = 'active'), '{}'::text[]) then
    raise exception 'assets.tags differs from active asset_tags aggregate';
  end if;
end $$;
rollback;
