-- #3911: spec-sheet extractions follow their asset to its current style group.
--
-- dam.pdf_rich_extraction.style_group_id is stamped only when a PDF is
-- extracted. When an asset changes group (regroup, or a public.style_groups
-- delete, whose FK on public.assets.style_group_id is ON DELETE SET NULL,
-- followed by re-assignment to a recreated group) the extraction row kept the
-- old id. public.refresh_style_group_rich_metadata rolls up by that column, so
-- the group's spec-sheet data vanished and nothing healed it (2026-10-02: 233
-- rows / 227 groups orphaned).
--
-- Design and cost (review of PR #3913):
--   * Row trigger, AFTER UPDATE OF style_group_id, WHEN the value actually
--     changes. It never fires for any other assets UPDATE. Per changed asset it
--     does one primary-key probe of dam.pdf_rich_extraction (~250 rows in
--     production, at most 13 per group on 2026-10-02). Only when that probe
--     re-points a row does it record the old and new group ids in a
--     transaction-local temporary table.
--   * Statement trigger, AFTER UPDATE OF style_group_id. It fires only for
--     statements that set style_group_id; when nothing was recorded it costs
--     one to_regclass lookup. Otherwise it rolls each recorded group up exactly
--     once per statement with the existing functions, then clears the list.
--   Each rollup is the existing refresh_style_group_rich_metadata: it reads the
--   group's extraction rows and writes public.assets product_material /
--   product_dimensions only for member rows whose values actually differ
--   (IS DISTINCT FROM guard), so its cost is one indexed read of the group's
--   members plus writes to changed members only. That UPDATE does not set
--   style_group_id, so neither trigger re-fires from it.
--   The row->statement hand-off uses a session-local temp table created
--   on first use inside the transaction (ON COMMIT DROP) and emptied by the
--   statement trigger, so it never carries ids across statements.
--
-- Privilege boundary: the control is the existing RLS on public.assets (RLS
-- enabled; the only UPDATE policy is "Admins can update assets"), not the
-- REVOKE below, since trigger functions cannot be called directly. Both functions are SECURITY DEFINER because the caller
-- (service_role, or an admin through the "Admins can update assets" RLS policy)
-- has no grant on dam.pdf_rich_extraction. They take no caller-supplied values:
-- they copy the asset's new style_group_id into its own extraction row and
-- re-run the existing SECURITY DEFINER rollups, which recompute from stored
-- extraction data. EXECUTE is revoked from public, anon and authenticated.
--
-- Rollback (not executed here):
--   drop trigger trg_assets_rollup_pdf_rich_extraction_groups on public.assets;
--   drop trigger trg_assets_sync_pdf_rich_extraction_group on public.assets;
--   drop function dam.rollup_moved_pdf_rich_extraction_groups();
--   drop function dam.sync_pdf_rich_extraction_style_group();
-- Plain CREATE (no OR REPLACE / DROP) on purpose, so the statements stay
-- purely additive for the production risk gate. The migration is applied in
-- one transaction and recorded once in the ledger, so a partial apply cannot
-- persist and a re-apply is never attempted.
-- No data is changed by this migration itself.

create function dam.sync_pdf_rich_extraction_style_group()
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

create function dam.rollup_moved_pdf_rich_extraction_groups()
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
  select array_agg(style_group_id) into v_gids from drained;

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

create trigger trg_assets_sync_pdf_rich_extraction_group
  after update of style_group_id on public.assets
  for each row
  when (old.style_group_id is distinct from new.style_group_id)
  execute function dam.sync_pdf_rich_extraction_style_group();

create trigger trg_assets_rollup_pdf_rich_extraction_groups
  after update of style_group_id on public.assets
  for each statement
  execute function dam.rollup_moved_pdf_rich_extraction_groups();
