-- #1597 transaction-rolled-back compatibility checks for the legacy propagation RPC.
-- All fixture values are synthetic and carry the ZZ1597 prefix.
begin;

do $$
declare
  v_cursor uuid := 'ffffffff-1597-4000-8000-000000000000';
  v_group uuid := 'ffffffff-1597-4000-8000-000000000010';
  v_other_group uuid := 'ffffffff-1597-4000-8000-000000000020';
  v_source uuid := gen_random_uuid();
  v_sibling uuid := gen_random_uuid();
  v_other_asset uuid := gen_random_uuid();
  v_new_tag text := 'zz1597_new_' || txid_current();
  v_manual_tag text := 'zz1597_manual_' || txid_current();
  v_rejected_tag text := 'zz1597_rejected_' || txid_current();
  v_other_tag text := 'zz1597_other_' || txid_current();
  v_manual_before jsonb;
  v_rejected_before jsonb;
  v_other_before jsonb;
begin
  insert into public.style_groups(id, sku, folder_path)
  values
    (v_group, 'ZZ1597-A-' || txid_current(), 'ZZ1597/A'),
    (v_other_group, 'ZZ1597-B-' || txid_current(), 'ZZ1597/B');

  insert into public.assets(
    id, filename, relative_path, file_type, quick_hash, modified_at,
    style_group_id, is_deleted, ai_tagged_at, primary_sort_tier
  ) values
    (v_source, 'zz1597-source.ai', 'ZZ1597/A/source.ai', 'ai',
      'zz1597-source-' || txid_current(), now(), v_group, false, now(), 1),
    (v_sibling, 'zz1597-sibling.ai', 'ZZ1597/A/sibling.ai', 'ai',
      'zz1597-sibling-' || txid_current(), now(), v_group, false, null, 2),
    (v_other_asset, 'zz1597-other.ai', 'ZZ1597/B/other.ai', 'ai',
      'zz1597-other-' || txid_current(), now(), v_other_group, false, null, 1);

  insert into public.asset_tags(asset_id, tag, source, category, status, rejected_at)
  values
    (v_source, v_new_tag, 'ai', 'legacy_unscoped', 'active', null),
    (v_source, v_manual_tag, 'ai', 'legacy_unscoped', 'active', null),
    (v_source, v_rejected_tag, 'ai', 'legacy_unscoped', 'active', null),
    (v_sibling, v_manual_tag, 'manual', 'other', 'active', null),
    (v_sibling, v_rejected_tag, 'ai', 'legacy_unscoped', 'rejected', now()),
    (v_other_asset, v_other_tag, 'manual', 'other', 'active', null);

  select to_jsonb(t) into v_manual_before
  from public.asset_tags t where t.asset_id = v_sibling and t.tag = v_manual_tag;
  select to_jsonb(t) into v_rejected_before
  from public.asset_tags t where t.asset_id = v_sibling and t.tag = v_rejected_tag;
  select to_jsonb(t) into v_other_before
  from public.asset_tags t where t.asset_id = v_other_asset and t.tag = v_other_tag;

  perform * from public.propagate_group_tags_batch(v_cursor, 2);

  if not exists (
    select 1 from public.asset_tags
    where asset_id = v_sibling and tag = v_new_tag and source = 'ai'
      and category = 'legacy_unscoped' and status = 'active'
  ) then
    raise exception 'new propagated tag did not receive the required legacy category/status';
  end if;

  if (select to_jsonb(t) from public.asset_tags t
      where t.asset_id = v_sibling and t.tag = v_manual_tag) is distinct from v_manual_before then
    raise exception 'manual collision was changed';
  end if;
  if (select to_jsonb(t) from public.asset_tags t
      where t.asset_id = v_sibling and t.tag = v_rejected_tag) is distinct from v_rejected_before then
    raise exception 'rejected tombstone collision was changed';
  end if;
  if (select to_jsonb(t) from public.asset_tags t
      where t.asset_id = v_other_asset and t.tag = v_other_tag) is distinct from v_other_before then
    raise exception 'unrelated group was changed';
  end if;
  if exists (
    select 1 from public.asset_tags
    where asset_id = v_other_asset and tag in (v_new_tag, v_manual_tag, v_rejected_tag)
  ) then
    raise exception 'tag propagation crossed into an unrelated group';
  end if;

  perform * from public.propagate_group_tags_batch(v_cursor, 2);
  if (select count(*) from public.asset_tags
      where asset_id = v_sibling and tag = v_new_tag) <> 1 then
    raise exception 'propagation rerun was not idempotent';
  end if;
  if (select to_jsonb(t) from public.asset_tags t
      where t.asset_id = v_sibling and t.tag = v_manual_tag) is distinct from v_manual_before
     or (select to_jsonb(t) from public.asset_tags t
      where t.asset_id = v_sibling and t.tag = v_rejected_tag) is distinct from v_rejected_before then
    raise exception 'rerun changed manual or rejected collision rows';
  end if;
end;
$$;

rollback;
