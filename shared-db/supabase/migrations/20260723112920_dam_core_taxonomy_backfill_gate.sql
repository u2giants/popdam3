-- Stage 0 bridge (pass 2 entry): refuse to continue while residual legacy ids remain.
--
-- After 20260723112910 drops legacy FKs, operators run the DML-only tool
-- tools/dam-core-taxonomy-safe-cutover.mjs --apply in bounded batches.
-- This gate is a short, no-DML migration that blocks finalize until residuals
-- are zero. Re-run `supabase db push` after the tool reports residuals clear.
--
-- Idempotent when residuals are already zero (preview / completed production).

do $backfill_gate$
declare
  v_assets bigint;
  v_sg bigint;
  v_bo bigint;
begin
  select count(*) into v_assets
  from public.assets a
  where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
     or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id));

  select count(*) into v_sg
  from public.style_groups sg
  where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
     or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id));

  select count(*) into v_bo
  from public.ai_tag_bakeoff_results r
  where r.property_id is not null
    and not exists (select 1 from core.property p where p.id = r.property_id);

  if v_assets <> 0 or v_sg <> 0 or v_bo <> 0 then
    raise exception
      'DAM core taxonomy backfill gate: residuals remain assets=% style_groups=% bakeoff=%. Finish tools/dam-core-taxonomy-safe-cutover.mjs --apply (DML only), then re-run db push. Do not re-run 20260723113000.',
      v_assets, v_sg, v_bo;
  end if;

  raise notice 'dam_core_taxonomy backfill gate: zero residual non-core ids';
end
$backfill_gate$;
