-- #1645 transaction-rolled-back effective list/facet contracts.
begin;

do $$
declare
  v_group uuid := gen_random_uuid();
  v_other_group uuid := gen_random_uuid();
  v_grouped_a uuid := gen_random_uuid();
  v_grouped_b uuid := gen_random_uuid();
  v_ungrouped uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_licensor uuid := gen_random_uuid();
  v_property uuid := gen_random_uuid();
  v_other_licensor uuid := gen_random_uuid();
  v_other_property uuid := gen_random_uuid();
  v_group_tag text := 'zz1645_group_' || txid_current();
  v_file_tag text := 'zz1645_file_' || txid_current();
  v_candidate text := 'zz1645_candidate_' || txid_current();
  v_rejected text := 'zz1645_rejected_' || txid_current();
  v_delete_tag text := 'zz1645_delete_' || txid_current();
  v_counts jsonb;
begin
  -- DAM identity foreign keys were cut over from the retired public mirrors to
  -- the canonical core taxonomy in 20260723113000. Keep this synthetic fixture
  -- on the same authority boundary that assets and style_groups enforce.
  insert into core.licensor (id, name, code, status)
  values (v_licensor, 'ZZ1645 Licensor', 'ZZ1645L-' || txid_current(), 'active'),
         (v_other_licensor, 'ZZ1645 Other Licensor', 'ZZ1645OL-' || txid_current(), 'active');

  insert into core.property (id, licensor_id, name, code, status)
  values (v_property, v_licensor, 'ZZ1645 Property', 'ZZ1645P-' || txid_current(), 'active'),
         (v_other_property, v_other_licensor, 'ZZ1645 Other Property', 'ZZ1645OP-' || txid_current(), 'active');

  insert into public.style_groups
    (id, sku, folder_path, licensor_id, property_id, licensor_name, property_name)
  values
    (v_group, 'ZZ1645-A-' || txid_current(), 'ZZ1645/A', v_licensor, v_property,
      'ZZ1645 Licensor', 'ZZ1645 Property'),
    (v_other_group, 'ZZ1645-B-' || txid_current(), 'ZZ1645/B', v_other_licensor, v_other_property,
      'ZZ1645 Other Licensor', 'ZZ1645 Other Property');

  insert into public.assets
    (id, filename, relative_path, file_type, quick_hash, modified_at, style_group_id,
     licensor_id, property_id, is_deleted)
  values
    (v_grouped_a, 'zz1645-a.ai', 'ZZ1645/A/a.ai', 'ai', 'zz1645-a-' || txid_current(), now(),
      v_group, null, null, false),
    (v_grouped_b, 'zz1645-b.ai', 'ZZ1645/A/b.ai', 'ai', 'zz1645-b-' || txid_current(), now(),
      v_group, v_other_licensor, v_other_property, false),
    (v_ungrouped, 'zz1645-u.ai', 'ZZ1645/U/u.ai', 'ai', 'zz1645-u-' || txid_current(), now(),
      null, v_licensor, v_property, false),
    (v_deleted, 'zz1645-d.ai', 'ZZ1645/A/d.ai', 'ai', 'zz1645-d-' || txid_current(), now(),
      v_group, null, null, true);

  insert into public.style_group_tags (style_group_id, tag, category, source, status, rejected_at)
  values (v_group, v_group_tag, 'theme', 'manual', 'active', null),
         (v_group, v_candidate, 'theme', 'ai', 'candidate', null),
         (v_group, v_rejected, 'theme', 'ai', 'rejected', now());

  insert into public.asset_tags (asset_id, tag, category, source, status)
  values (v_grouped_a, v_file_tag, 'other', 'manual', 'active'),
         (v_grouped_b, v_candidate, 'other', 'ai', 'candidate');

  if (select count(*) from public.asset_effective_tags where tag = v_group_tag) <> 2 then
    raise exception 'active group tag did not project to exactly its two visible members';
  end if;
  if exists (select 1 from public.asset_effective_tags where tag in (v_candidate, v_rejected)) then
    raise exception 'candidate or rejected tag entered the active projection';
  end if;
  if (select count(*) from public.filter_effective_assets(jsonb_build_object('tagFilter', v_group_tag))) <> 2 then
    raise exception 'group-only tag list filter did not return both members';
  end if;
  if (select count(*) from public.filter_effective_assets(jsonb_build_object('tagFilter', v_file_tag))) <> 1
     or not exists (
       select 1 from public.filter_effective_assets(jsonb_build_object('tagFilter', v_file_tag))
       where id = v_grouped_a
     ) then
    raise exception 'file-only tag leaked to a sibling or missed its file';
  end if;
  if exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('tagFilter', v_candidate))
  ) or exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('tagFilter', v_rejected))
  ) then
    raise exception 'candidate or rejected tag caused a list match';
  end if;

  if (select count(*) from public.filter_effective_assets(jsonb_build_object('licensorId', v_licensor))) <> 3
     or (select count(*) from public.filter_effective_assets(jsonb_build_object('propertyId', v_property))) <> 3 then
    raise exception 'group-winning or ungrouped-own identity filter failed';
  end if;
  if exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('licensorId', v_other_licensor))
    where id = v_grouped_b
  ) then
    raise exception 'grouped asset identity incorrectly came from the asset row';
  end if;

  v_counts := public.get_effective_filter_counts(jsonb_build_object('tagFilter', v_group_tag));
  if (v_counts ->> 'total')::int <> 2
     or (v_counts -> 'fileType' ->> 'ai')::int <> 2
     or (v_counts ->> 'total')::int <>
        (select count(*) from public.filter_effective_assets(jsonb_build_object('tagFilter', v_group_tag))) then
    raise exception 'effective facet/list parity failed: %', v_counts;
  end if;
  if public.get_filter_counts(jsonb_build_object('tagFilter', v_group_tag)) ->> 'total' <> '2' then
    raise exception 'legacy count entry point did not delegate an effective filter';
  end if;
  if public.get_filter_counts('{}'::jsonb) ? 'total' then
    raise exception 'covering-index fast path was replaced instead of preserved';
  end if;

  update public.assets set style_group_id = v_other_group where id = v_grouped_a;
  if exists (
    select 1 from public.asset_effective_tags
    where asset_id = v_grouped_a and tag = v_group_tag and scope = 'style_group'
  ) then
    raise exception 'old group tag survived asset regrouping';
  end if;
  if not exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('propertyId', v_other_property))
    where id = v_grouped_a
  ) then
    raise exception 'new group identity did not take effect after regrouping';
  end if;

  update public.assets set is_deleted = true where id = v_grouped_b;
  if exists (select 1 from public.asset_effective_tags where asset_id = v_grouped_b)
     or exists (
       select 1 from public.filter_effective_assets(jsonb_build_object('tagFilter', v_group_tag))
       where id = v_grouped_b
     ) then
    raise exception 'soft-deleted asset remained in projection or list';
  end if;

  update public.style_group_tags set status = 'candidate'
  where style_group_id = v_group and tag = v_group_tag;
  if exists (select 1 from public.asset_effective_tags where tag = v_group_tag) then
    raise exception 'active-to-candidate transition did not remove projection rows';
  end if;

  -- F6 (#1664 review): group deletion converges only because the assets
  -- style_group_id FK is ON DELETE SET NULL and the column-list trigger fires
  -- on that update. That path had no coverage.
  insert into public.style_group_tags (style_group_id, tag, category, source, status)
  values (v_other_group, v_delete_tag, 'theme', 'manual', 'active');
  if not exists (
    select 1 from public.asset_effective_tags
    where asset_id = v_grouped_a and tag = v_delete_tag and scope = 'style_group'
  ) then
    raise exception 'group tag did not project onto the regrouped member';
  end if;

  delete from public.style_groups where id = v_other_group;
  if exists (select 1 from public.asset_effective_tags where tag = v_delete_tag) then
    raise exception 'group deletion left orphaned style_group projection rows';
  end if;
  if (select style_group_id from public.assets where id = v_grouped_a) is not null then
    raise exception 'group deletion did not null the member style_group_id';
  end if;

  -- F1 (#1664 review): the effective path must apply the same THUMBNAIL_MIN_DATE
  -- incident gate the legacy count base applies, or counts and lists diverge.
  update public.assets
     set modified_at = '1999-01-01'::timestamptz,
         file_created_at = '1999-01-01'::timestamptz,
         thumbnail_url = null
   where id = v_ungrouped;
  if exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('licensorId', v_licensor))
    where id = v_ungrouped
  ) then
    raise exception 'effective list ignored the THUMBNAIL_MIN_DATE incident gate';
  end if;
  update public.assets set thumbnail_url = 'https://example.invalid/zz1645.png'
   where id = v_ungrouped;
  if not exists (
    select 1 from public.filter_effective_assets(jsonb_build_object('licensorId', v_licensor))
    where id = v_ungrouped
  ) then
    raise exception 'a thumbnail did not restore an otherwise gated-out asset';
  end if;

  if not has_function_privilege('authenticated', 'public.assets_thumbnail_min_date()', 'EXECUTE')
     or has_function_privilege('anon', 'public.assets_thumbnail_min_date()', 'EXECUTE') then
    raise exception 'thumbnail min-date accessor privileges are incorrect';
  end if;

  if to_regclass('public.asset_effective_tags_tag_asset_idx') is null
     or to_regclass('public.asset_effective_tags_asset_tag_scope_uidx') is null then
    raise exception 'effective projection access paths are missing';
  end if;
  if not has_function_privilege('authenticated', 'public.filter_effective_assets(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_effective_filter_counts(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.filter_effective_assets(jsonb)', 'EXECUTE') then
    raise exception 'effective filter RPC privileges are incorrect';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  if exists (
    select 1
    from public.asset_effective_tags e
    left join public.assets a on a.id = e.asset_id
    where a.id is null or a.is_deleted
  ) then
    raise exception 'authenticated projection enumerated an asset hidden by assets RLS';
  end if;
end;
$$;

rollback;
