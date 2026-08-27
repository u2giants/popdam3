set default_transaction_read_only = on;
set statement_timeout = '60s';

select 'target_project_ref', 'qsllyeztdwjgirsysgai';
select 'non_deleted_assets', count(*) from public.assets where is_deleted = false;
select 'thumbnail_backed_assets', count(*) from public.assets where is_deleted = false and thumbnail_url is not null and btrim(thumbnail_url) <> '';
select 'untagged_assets', count(*) from public.assets where is_deleted = false and ai_tagged_at is null;
select 'style_groups', count(*) from public.style_groups;
select 'group_size_0', count(*) from public.style_groups where coalesce(asset_count, 0) = 0;
select 'group_size_1', count(*) from public.style_groups where asset_count = 1;
select 'group_size_2_5', count(*) from public.style_groups where asset_count between 2 and 5;
select 'group_size_6_20', count(*) from public.style_groups where asset_count between 6 and 20;
select 'group_size_21_plus', count(*) from public.style_groups where asset_count >= 21;
select 'ai_tag_rows', count(*) from public.asset_tags where source = 'ai';
select 'manual_tag_rows', count(*) from public.asset_tags where source = 'manual';

with file_phrases(tag) as (
  values
    ('professional photography'), ('straight view'), ('3/4 view'), ('close-up view'),
    ('lifestyle / in-use image'), ('person holding item / size scale image'),
    ('embellishment placement design'), ('tech pack'), ('mockup'),
    ('front view'), ('back view'), ('side view')
), leaked as (
  select a.style_group_id, lower(at.tag) as tag
  from public.asset_tags at
  join public.assets a on a.id = at.asset_id
  join file_phrases fp on lower(at.tag) = fp.tag
  where a.is_deleted = false and a.style_group_id is not null
  group by a.style_group_id, lower(at.tag)
  having count(distinct a.id) > 1
)
select 'file_phrase_group_tag_pairs_on_multiple_siblings', count(*) from leaked;

select 'assets_with_manual_only_compatibility_values', count(*)
from public.assets a
where a.is_deleted = false
  and exists (
    select 1
    from unnest(coalesce(a.tags, '{}'::text[])) raw(tag)
    where not exists (
      select 1 from public.asset_tags at
      where at.asset_id = a.id and at.tag = btrim(raw.tag)
    )
  );
