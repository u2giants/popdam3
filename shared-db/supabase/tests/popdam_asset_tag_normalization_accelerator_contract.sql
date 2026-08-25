-- #1427 historical accelerator/final forward-state contract checks.
-- Transaction rollback keeps the test non-destructive.
begin;

do $$
begin
  -- 20260825025154 is retained as truthful preview history. Prerequisite A
  -- recreated this index, and recovery B deliberately retains it because live
  -- old snapshots can prevent even a concurrent drop from completing.
  if to_regclass('public.asset_tags_pending_metadata_normalization_idx') is null then
    raise exception 'deliberate-held normalization recovery index is missing';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.asset_tags'::regclass
      and attname in ('category', 'status', 'confidence', 'model', 'evidence',
                      'rejected_at', 'rejected_by', 'updated_at')
      and not attisdropped
    group by attrelid
    having count(*) = 8
  ) then
    raise exception 'normalization prerequisite columns are incomplete';
  end if;
end $$;

rollback;
