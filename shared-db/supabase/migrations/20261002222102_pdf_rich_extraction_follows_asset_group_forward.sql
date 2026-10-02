-- #3911: forward replacement for 20261002204050 (PR #3913).
--
-- 20261002204050 merged and was applied to preview, but its production risk
-- sign-off review returned a durable refusal on that merged head, so it can
-- never be promoted; scripts/production_migration_guard.py retires it. This
-- migration carries the same design, made re-runnable so it applies both where
-- 20261002204050 already ran (preview: OR REPLACE / DROP IF EXISTS) and where
-- it never will (production), and answers the review findings.
--
-- What it does: dam.pdf_rich_extraction.style_group_id follows its asset to the
-- asset's current style group, and each affected group's rich metadata and
-- search document are recomputed once per statement with the existing
-- public.refresh_style_group_rich_metadata / refresh_dam_search_style_group_document.
--
--   * Row trigger, AFTER UPDATE OF style_group_id WHEN the value changes: one
--     primary-key probe of dam.pdf_rich_extraction (~250 rows in production,
--     at most 13 per group on 2026-10-02). Only when it re-points a row does it
--     record the old and new group ids in a transaction-local temp table.
--   * Statement trigger, AFTER UPDATE OF style_group_id: drains that table and
--     rolls each DISTINCT recorded group up once (DISTINCT, so a same-named
--     session temp relation without the primary key cannot cause a repeated
--     rollup). When nothing was recorded it costs one to_regclass lookup.
--   * Rollup cost: refresh_style_group_rich_metadata reads the group's
--     extraction rows and rewrites product_material / product_dimensions only
--     on member assets whose values differ (IS DISTINCT FROM); those writes run
--     the existing per-row and per-statement asset triggers, as the worker's
--     extraction rollup already does today. They do not set style_group_id, so
--     neither trigger here re-fires.
--   * Covers both regroup write shapes: a plain UPDATE and the nightly
--     rebuild's UPDATE inside a data-modifying CTE (tested).
--
-- Privilege boundary: the control is RLS on public.assets (enabled; the only
-- UPDATE policy is "Admins can update assets"); service_role also updates.
-- Both functions are SECURITY DEFINER (the caller has no grant on
-- dam.pdf_rich_extraction) with a pinned search_path, take no caller-supplied
-- values, and only copy the asset's own new group id and recompute from stored
-- extraction data. EXECUTE is revoked from public, anon and authenticated; the
-- live proof asserts prosecdef and the pinned search_path of both.
--
-- Rollback (not executed here):
--   drop trigger if exists trg_assets_rollup_pdf_rich_extraction_groups on public.assets;
--   drop trigger if exists trg_assets_sync_pdf_rich_extraction_group on public.assets;
--   drop function if exists dam.rollup_moved_pdf_rich_extraction_groups();
--   drop function if exists dam.sync_pdf_rich_extraction_style_group();
-- No row data is changed by this migration itself.

create or replace function dam.sync_pdf_rich_extraction_style_group()
returns trigger
language plpgsql
security definer
set search_path = public, dam, pg_temp
as $$
begin
  update dam.pdf_rich_extraction e
  set style_group_id = new.style_group_id
  where e.asset_id = new.id
    and e.style_group_id is distinct from new.style_group_id;

  if found then
    create temporary table if not exists pg_temp.pdf_rich_extraction_moved_groups (
      style_group_id uuid primary key
    ) on commit drop;
    insert into pg_temp.pdf_rich_extraction_moved_groups (style_group_id)
    select g from unnest(array[old.style_group_id, new.style_group_id]) g
    where g is not null
    on conflict do nothing;
  end if;

  return null;
end;
$$;

create or replace function dam.rollup_moved_pdf_rich_extraction_groups()
returns trigger
language plpgsql
security definer
set search_path = public, dam, pg_temp
as $$
declare
  v_gids uuid[];
  v_gid uuid;
begin
  if pg_catalog.to_regclass('pg_temp.pdf_rich_extraction_moved_groups') is null then
    return null;
  end if;

  with drained as (
    delete from pg_temp.pdf_rich_extraction_moved_groups returning style_group_id
  )
  select array_agg(distinct style_group_id) into v_gids from drained
  where style_group_id is not null;

  foreach v_gid in array coalesce(v_gids, '{}'::uuid[]) loop
    perform public.refresh_style_group_rich_metadata(v_gid);
    perform public.refresh_dam_search_style_group_document(v_gid);
  end loop;

  return null;
end;
$$;

comment on function dam.sync_pdf_rich_extraction_style_group() is
  '#3911: row trigger on public.assets (UPDATE OF style_group_id, value changed); re-points the asset''s dam.pdf_rich_extraction row and records the affected groups for the statement rollup.';
comment on function dam.rollup_moved_pdf_rich_extraction_groups() is
  '#3911: statement trigger on public.assets (UPDATE OF style_group_id); rolls each group recorded by dam.sync_pdf_rich_extraction_style_group up once.';

revoke all on function dam.sync_pdf_rich_extraction_style_group() from public, anon, authenticated;
revoke all on function dam.rollup_moved_pdf_rich_extraction_groups() from public, anon, authenticated;

drop trigger if exists trg_assets_sync_pdf_rich_extraction_group on public.assets;
create trigger trg_assets_sync_pdf_rich_extraction_group
  after update of style_group_id on public.assets
  for each row
  when (old.style_group_id is distinct from new.style_group_id)
  execute function dam.sync_pdf_rich_extraction_style_group();

drop trigger if exists trg_assets_rollup_pdf_rich_extraction_groups on public.assets;
create trigger trg_assets_rollup_pdf_rich_extraction_groups
  after update of style_group_id on public.assets
  for each statement
  execute function dam.rollup_moved_pdf_rich_extraction_groups();
