-- #5747 Step 2 / #5824: asset_tags changes keep assets.tags exact while
-- rewriting each asset at most once per statement, and not at all when the
-- active tag list is unchanged. Ephemeral database only; synthetic rows roll back.
-- ctid (not xmin) distinguishes rewrites inside one transaction.
begin;
do $$
declare
  a uuid := gen_random_uuid();
  suffix text := txid_current()::text;
  t_before tid;
begin
  -- Shape is asserted unconditionally.
  if (select count(*) from pg_trigger where tgrelid = 'public.asset_tags'::regclass and not tgisinternal
      and tgname in ('asset_tags_sync_assets_tags_ins','asset_tags_sync_assets_tags_upd','asset_tags_sync_assets_tags_del')
      and tgtype & 1 = 0) <> 3 then
    raise exception 'tags sync must be three statement-level triggers';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.asset_tags'::regclass and tgname = 'asset_tags_sync_assets_tags') then
    raise exception 'row-level tags sync trigger must be gone';
  end if;

  insert into public.assets(id, filename, relative_path, file_type, quick_hash, modified_at)
  values (a, 'zz5747-a.ai', 'ZZ5747/a-'||suffix||'.ai', 'ai', 'zz5747-'||suffix, now());

  insert into public.asset_tags(asset_id, tag, category, source, status)
  values (a, 'zz contract a', 'other', 'contract_test', 'active'),
         (a, 'zz contract b', 'other', 'contract_test', 'active');
  if (select coalesce(tags, '{}'::text[]) from public.assets where id = a)
     is distinct from array['zz contract a','zz contract b'] then
    raise exception 'insert did not sync assets.tags';
  end if;

  -- Unchanged active list: the asset row must not be rewritten.
  select ctid into t_before from public.assets where id = a;
  update public.asset_tags set confidence = 0.5 where asset_id = a and source = 'contract_test';
  if (select ctid from public.assets where id = a) is distinct from t_before then
    raise exception 'unchanged tag list rewrote the asset row';
  end if;

  -- A real change is written.
  update public.asset_tags set status = 'candidate' where asset_id = a and tag = 'zz contract b';
  if (select coalesce(tags, '{}'::text[]) from public.assets where id = a) is distinct from array['zz contract a'] then
    raise exception 'update did not sync assets.tags';
  end if;

  delete from public.asset_tags where asset_id = a;
  if (select tags from public.assets where id = a) is distinct from '{}'::text[] then
    raise exception 'delete did not sync assets.tags';
  end if;
end $$;
rollback;
