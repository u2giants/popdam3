-- Stage 0 bridge (pass 1): drop only legacy-targeted DAM taxonomy FKs.
--
-- Ordered between 20260723112900 (timeout guard, applied on production) and
-- 20260723113000 (unsafe single-transaction cutover — applied on preview only).
--
-- Idempotent:
--   * constraint missing → no-op
--   * constraint already references core.licensor / core.property → leave it
--   * constraint references public.licensors / public.properties → DROP
--
-- No bulk DML. No migration-metadata writes.
-- After this migration, run tools/dam-core-taxonomy-safe-cutover.mjs --apply
-- to clear residual non-core ids before 20260723112920 (backfill gate).

do $drop_legacy$
declare
  r record;
  v_ref text;
begin
  for r in
    select
      c.oid,
      c.conname,
      n.nspname as table_schema,
      rel.relname as table_name,
      rn.nspname || '.' || ref.relname as ref_table
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      -- Exact five table+constraint pairs only (never match same conname on another table).
      and (
        (n.nspname = 'public' and rel.relname = 'assets' and c.conname = 'assets_licensor_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'assets' and c.conname = 'assets_property_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'style_groups' and c.conname = 'style_groups_licensor_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'style_groups' and c.conname = 'style_groups_property_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'ai_tag_bakeoff_results' and c.conname = 'ai_tag_bakeoff_results_property_id_fkey')
      )
  loop
    v_ref := r.ref_table;
    if v_ref in ('public.licensors', 'public.properties') then
      execute format(
        'alter table %I.%I drop constraint if exists %I',
        r.table_schema,
        r.table_name,
        r.conname
      );
      raise notice 'dam_core_taxonomy: dropped legacy FK %.% → %',
        r.table_schema || '.' || r.table_name, r.conname, v_ref;
    elsif v_ref in ('core.licensor', 'core.property') then
      raise notice 'dam_core_taxonomy: keeping core FK %.% → %',
        r.table_schema || '.' || r.table_name, r.conname, v_ref;
    else
      raise notice 'dam_core_taxonomy: leaving unexpected FK %.% → % untouched',
        r.table_schema || '.' || r.table_name, r.conname, v_ref;
    end if;
  end loop;
end
$drop_legacy$;
