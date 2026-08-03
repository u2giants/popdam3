-- The lateral lookup in 20260802194000 proves its normalized key is nonblank
-- through equality to the outer RFQ code, but PostgreSQL does not infer the
-- partial-index predicate from that correlated condition. Replace the partial
-- index with the same normalized key as a general expression index so the
-- browser query reliably uses an index scan.

drop index if exists dflow.idx_dflow_rfqitem_style_number_normalized;

create index idx_dflow_rfqitem_style_number_normalized
  on dflow."RFQItem" ((upper(trim("rfqItem_style_number"))));

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'dflow'
      and indexname = 'idx_dflow_rfqitem_style_number_normalized'
      and indexdef not ilike '% where %'
  ) then
    raise exception 'ASSERT: normalized RFQ item lookup index must be non-partial';
  end if;
end
$$;
