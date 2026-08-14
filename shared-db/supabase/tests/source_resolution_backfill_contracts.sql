-- Issue #963: migration backfill and required catalog objects are present.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from pg_trigger
  where not tgisinternal and tgname in (
    'pmt_property_resolution_immutable','pmt_character_resolution_immutable',
    'nbcu_property_resolution_immutable','nbcu_character_resolution_immutable',
    'nbcu_style_guide_resolution_immutable','nbcu_asset_resolution_immutable'
  );
  if v_count <> 6 then raise exception 'expected 6 legacy guards, found %', v_count; end if;

  select count(*) into v_count from pg_constraint
  where conrelid = 'plm.source_resolution'::regclass
    and conname in (
      'source_resolution_pkey','source_resolution_entity_kind_chk',
      'source_resolution_status_chk','source_resolution_target_kind_chk',
      'source_resolution_matched_target_chk','source_resolution_audit_pair_chk'
    );
  if v_count <> 6 then raise exception 'source_resolution constraints incomplete: %', v_count; end if;

  if obj_description('plm.source_resolution'::regclass) is null then
    raise exception 'source_resolution table comment is missing';
  end if;
end;
$$;

do $$
declare v_winner text;
begin
  with candidates(source_id,captured_at,resolved_at,capture_tiebreaker,decision) as (values
    ('same','2026-08-14 12:00Z'::timestamptz,'2026-08-14 12:01Z'::timestamptz,'a','older'),
    ('same','2026-08-14 12:00Z'::timestamptz,'2026-08-14 12:02Z'::timestamptz,'a','newer'),
    ('tie','2026-08-14 12:00Z'::timestamptz,'2026-08-14 12:02Z'::timestamptz,'a','low-id'),
    ('tie','2026-08-14 12:00Z'::timestamptz,'2026-08-14 12:02Z'::timestamptz,'b','high-id')
  ), ranked as (select *,row_number() over(partition by source_id order by captured_at desc nulls last,resolved_at desc nulls last,capture_tiebreaker desc) choice from candidates)
  select string_agg(decision,',' order by source_id) into v_winner from ranked where choice=1;
  if v_winner <> 'newer,high-id' then raise exception 'deterministic ordering selected %',v_winner; end if;
end;
$$;
