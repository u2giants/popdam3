-- Stage 0 bridge (pass 2 stop / pass 3 entry): ledger barrier before unsafe 113000.
--
-- Linear `supabase db push` order:
--   112900 (prod applied) → 112910 → 112920 → 112930 → 112940 → 113000 → 113100
--
-- 20260723113000 is preview-applied and production-hostile. This barrier REFUSES
-- to let a linear push reach 113000 until that version is already recorded in
-- supabase_migrations.schema_migrations:
--
--   * Preview: 113000 already applied → barrier no-ops (pass). Out-of-order
--     apply of 112910–112940 via --include-all is therefore safe.
--   * Production: after 112910–112930 + DML tool produce the equivalent
--     end-state and operators verify five core FKs / zero residuals, the owner
--     must explicitly approve:
--         supabase migration repair --status applied 20260723113000
--     ONLY AFTER that repair does this barrier pass. Never repair before the
--     equivalent end-state exists. Never edit 113000. Never write the ledger
--     from SQL.
--
-- Pass 3: after repair, db push applies this barrier (pass) then 113100
-- (reset statement_timeout).

do $ledger_barrier$
declare
  v_has_113000 boolean;
begin
  select exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260723113000'
  ) into v_has_113000;

  if v_has_113000 then
    raise notice
      'dam_core_taxonomy ledger barrier: 20260723113000 already recorded applied (preview or post-repair production); pass';
    return;
  end if;

  raise exception
    'DAM core taxonomy ledger barrier: refusing to continue toward unsafe 20260723113000. Complete migrations 20260723112910–20260723112930 and tools/dam-core-taxonomy-safe-cutover.mjs DML backfill, verify five core FKs + zero residuals + dam_character_catalog, then obtain explicit owner approval for: supabase migration repair --status applied 20260723113000. Do not edit or re-run 20260723113000. Do not repair before the equivalent end-state exists. After repair, re-run db push to apply this barrier and 20260723113100.';
end
$ledger_barrier$;
