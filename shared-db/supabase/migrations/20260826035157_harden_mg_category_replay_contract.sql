-- Issue #1187 follow-ups to the normalized mgCategory taxonomy.
--
-- This migration does not change the seven categories or their mappings. It makes the
-- replay contract unambiguous and adds the two diagnostics that the original migration
-- could not distinguish reliably:
--   * category display names are migration-authoritative and are restored on replay;
--   * duplicate active MG01 rows are grouped by the normalized division key;
--   * an empty MG01 population is reported separately from an all-inactive population.

comment on column core.mg_category.name is
  'Migration-authoritative display label for the hidden product category. Governed '
  'rewording must ship in a new shared-db migration; replay intentionally restores the '
  'declared label rather than preserving an out-of-band edit.';

do $$
declare
  v_all_mg01 integer;
  v_active_mg01 integer;
  v_dupes text;
begin
  select
    count(*) filter (where "mgTypeCode" = '01'),
    count(*) filter (where "mgTypeCode" = '01' and is_active is true)
  into v_all_mg01, v_active_mg01
  from core."merchGroup";

  if v_all_mg01 = 0 then
    raise notice
      'Issue #1187: core."merchGroup" contains no MG01 rows at all; category-link '
      'validation has no source population.';
  elsif v_active_mg01 = 0 then
    raise notice
      'Issue #1187: core."merchGroup" contains % MG01 rows, but none is active '
      '(is_active IS TRUE); category-link validation has an all-inactive source '
      'population, not an empty database.', v_all_mg01;
  else
    with active_mg01 as (
      select
        upper(btrim(coalesce("divisionCode_fk", ''))) as division_key,
        upper(btrim(mg_code)) as code_key,
        lower(btrim(mg_desc)) as desc_key,
        count(*) as row_count
      from core."merchGroup" mg
      join core.mg_category_merch_group link
        on link.merch_group_mg_id = mg.mg_id
      where mg."mgTypeCode" = '01' and mg.is_active is true
      group by
        upper(btrim(coalesce("divisionCode_fk", ''))),
        upper(btrim(mg_code)),
        lower(btrim(mg_desc))
      having count(*) > 1
    )
    select string_agg(
      coalesce(nullif(division_key, ''), '(blank division)') || ' / ' ||
      code_key || ' ' || desc_key || ' (' || row_count || ' active rows)',
      '; ' order by division_key, code_key, desc_key
    )
    into v_dupes
    from active_mg01;

    if v_dupes is not null then
      raise exception
        'Issue #1187: duplicate active MG01 rows share the same normalized '
        '(division, code, description): %. Resolve the source duplicates before '
        'relying on category mappings.', v_dupes;
    end if;
  end if;
end;
$$;
