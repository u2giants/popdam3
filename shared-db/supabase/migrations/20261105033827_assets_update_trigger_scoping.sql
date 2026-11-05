-- shared-db#5609: preserve derived asset outcomes while avoiding no-op fan-out.
-- derived-from: 20260713221518
-- Database functions and the image embedding trigger remain unchanged.
-- Search source_updated_at now follows search-relevant changes: catalog readers
-- only assign this field; none compares it with assets.updated_at for staleness.
-- AFTER UPDATE without UPDATE OF also observes BEFORE-trigger rewrites.
-- Cache-writer audit: set_style_group_cover/refresh_style_group_primaries derive
-- thumbnail fields from primary assets; count/reconcile routines derive or clear
-- them. No intentional independent thumbnail override writer was found.
-- No known incident specific to these trigger predicates was found in AGENTS.md.
-- Recovery: a forward migration can restore the definitions captured below.
-- Previous: search AFTER INSERT OR DELETE OR UPDATE OF filename, relative_path,
-- cover_description, ai_description, scene_description, customer, program,
-- licensor_name, property_name, product_category, thumbnail_url, file_type,
-- asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at,
-- modified_at; primary AFTER INSERT OR UPDATE; designer AFTER INSERT OR UPDATE OF
-- designer_name, technical_designer_name, freelancer_name, style_group_id;
-- cover AFTER INSERT OR UPDATE OF cover_description, style_group_id;
-- render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url.

begin;
set local lock_timeout = '5s';

drop trigger if exists trg_dam_search_assets_refresh on public.assets;
create trigger trg_dam_search_assets_refresh_ins_del
  after insert or delete on public.assets for each row
  execute function public.trg_refresh_dam_asset_search_document();
create trigger trg_dam_search_assets_refresh
  after update on public.assets for each row when (
    row(old.id, old.filename, old.relative_path, old.content_type,
        old.cover_description, old.ai_description, old.scene_description,
        old.customer, old.program, old.licensor_name, old.property_name,
        old.product_category, old.product_material, old.product_dimensions,
        old.thumbnail_url, old.file_type, old.asset_type, old.workflow_status,
        old.is_licensed, old.style_group_id, old.is_deleted, old.modified_at)
    is distinct from
    row(new.id, new.filename, new.relative_path, new.content_type,
        new.cover_description, new.ai_description, new.scene_description,
        new.customer, new.program, new.licensor_name, new.property_name,
        new.product_category, new.product_material, new.product_dimensions,
        new.thumbnail_url, new.file_type, new.asset_type, new.workflow_status,
        new.is_licensed, new.style_group_id, new.is_deleted, new.modified_at))
  execute function public.trg_refresh_dam_asset_search_document();

drop trigger if exists trg_sync_primary_on_thumbnail on public.assets;
create trigger trg_sync_primary_on_thumbnail_ins_del
  after insert on public.assets for each row
  execute function public.sync_primary_asset_on_thumbnail();
create trigger trg_sync_primary_on_thumbnail
  after update on public.assets for each row when (
    row(old.id, old.thumbnail_url, old.thumbnail_error, old.style_group_id, old.asset_type)
    is distinct from
    row(new.id, new.thumbnail_url, new.thumbnail_error, new.style_group_id, new.asset_type))
  execute function public.sync_primary_asset_on_thumbnail();

drop trigger if exists trg_sync_designer_to_style_group on public.assets;
create trigger trg_sync_designer_to_style_group_ins_del
  after insert on public.assets for each row
  execute function public.sync_designer_to_style_group();
create trigger trg_sync_designer_to_style_group
  after update on public.assets for each row when (
    row(old.designer_name, old.technical_designer_name, old.freelancer_name,
        old.style_group_id, old.is_deleted)
    is distinct from
    row(new.designer_name, new.technical_designer_name, new.freelancer_name,
        new.style_group_id, new.is_deleted))
  execute function public.sync_designer_to_style_group();

drop trigger if exists trg_sync_cover_description_to_style_group on public.assets;
create trigger trg_sync_cover_description_to_style_group_ins_del
  after insert on public.assets for each row
  execute function public.sync_cover_description_to_style_group();
create trigger trg_sync_cover_description_to_style_group
  after update on public.assets for each row when (
    row(old.cover_description, old.style_group_id, old.is_deleted)
    is distinct from
    row(new.cover_description, new.style_group_id, new.is_deleted))
  execute function public.sync_cover_description_to_style_group();

drop trigger if exists trg_auto_queue_render on public.assets;
create trigger trg_auto_queue_render_ins_del
  after insert on public.assets for each row
  execute function public.auto_queue_render();
create trigger trg_auto_queue_render
  after update on public.assets for each row when (
    row(old.id, old.thumbnail_error, old.thumbnail_url, old.filename)
    is distinct from
    row(new.id, new.thumbnail_error, new.thumbnail_url, new.filename))
  execute function public.auto_queue_render();

-- Replace only stale derived fields, preserving the selected primary asset.
update public.style_groups sg
set primary_thumbnail_url = a.thumbnail_url,
    primary_thumbnail_error = a.thumbnail_error,
    updated_at = now()
from public.assets a
where a.id = sg.primary_asset_id
  and (sg.primary_thumbnail_url is distinct from a.thumbnail_url
       or sg.primary_thumbnail_error is distinct from a.thumbnail_error);

commit;
