-- Merge the Licensed sheet's old RFQ # column (H) and RFQ Code column (V)
-- into a single RFQ Code value at column H. Keep the legacy rfq_code key as
-- the stable cross-layout name used by the Master Data UI.

do $$
begin
  if to_regclass('public.style_tracker_rows') is null then
    return;
  end if;

  with merged as (
    select
      r.id,
      nullif(btrim(r.row_data ->> 'H'), '') as old_rfq_number,
      nullif(btrim(r.row_data ->> 'V'), '') as old_rfq_code_column,
      nullif(btrim(r.row_data ->> 'rfq_code'), '') as old_rfq_code_key
    from public.style_tracker_rows r
    where r.source_sheet = 'License.Style'
      and (
        r.row_data ? 'H'
        or r.row_data ? 'V'
        or r.row_data ? 'rfq_code'
      )
  ),
  values_to_merge as (
    select
      m.id,
      string_agg(value, ' / ' order by ordinal) as rfq_code
    from merged m
    cross join lateral (
      select distinct on (normalized_value)
        value,
        normalized_value,
        ordinal
      from (
        values
          (m.old_rfq_number, 1),
          (m.old_rfq_code_column, 2),
          (m.old_rfq_code_key, 3)
      ) as candidates(value, ordinal)
      cross join lateral (select lower(regexp_replace(value, '\s+', ' ', 'g')) as normalized_value) normalized
      where value is not null
      order by normalized_value, ordinal
    ) deduped
    group by m.id
  )
  update public.style_tracker_rows r
  set
    row_data = case
      when v.rfq_code is null then (r.row_data - 'V' - 'rfq_code' - 'H')
      else jsonb_set(
        jsonb_set(r.row_data - 'V', '{H}', to_jsonb(v.rfq_code), true),
        '{rfq_code}', to_jsonb(v.rfq_code), true
      )
    end,
    updated_at = now()
  from values_to_merge v
  where r.id = v.id
    and r.row_data is distinct from case
      when v.rfq_code is null then (r.row_data - 'V' - 'rfq_code' - 'H')
      else jsonb_set(
        jsonb_set(r.row_data - 'V', '{H}', to_jsonb(v.rfq_code), true),
        '{rfq_code}', to_jsonb(v.rfq_code), true
      )
    end;
end $$;
