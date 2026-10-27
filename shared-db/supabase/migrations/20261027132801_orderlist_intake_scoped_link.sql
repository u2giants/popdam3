-- Work #4886 / claim #4887; PopDAM application acceptance #526.
-- derived-from: none
-- Additive service-only scope; existing global/user relink contracts unchanged.
begin;

create function public.link_dam_order_lines_scoped(p_line_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_ids uuid[];
  v_count integer;
  v_result jsonb;
begin
  if p_line_ids is null or cardinality(p_line_ids) < 1
     or cardinality(p_line_ids) > 500 or array_position(p_line_ids, null) is not null then
    raise exception 'link_dam_order_lines_scoped requires 1..500 non-null line IDs'
      using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into v_ids from unnest(p_line_ids) id;

  -- Stable order prevents reciprocal caller batches from taking reversed locks.
  perform l.id from plm.production_order_line l
  where l.id = any(v_ids) order by l.id for update;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then
    raise exception 'link_dam_order_lines_scoped: one or more scoped lines no longer exist'
      using errcode = 'P0002';
  end if;

  with base as materialized (
    select l.id, l.sku_normalized, l.source_style_type, l.item_id,
      l.master_data_match_status as prior_status
    from plm.production_order_line l where l.id = any(v_ids)
  ), candidates as materialized (
    -- Exactly the user's linking contract: trim+case-fold SKU and explicit
    -- catalog, count distinct items across ALL matching bridge rows.
    select l.id, count(distinct b.plm_item_id)::integer as candidate_count,
      (array_agg(distinct b.plm_item_id order by b.plm_item_id)
        filter (where b.plm_item_id is not null))[1] as item_id
    from base l
    left join public.style_tracker_rows r
      on nullif(btrim(lower(r.sku)), '') = l.sku_normalized
    left join plm.style_tracker_item_bridge b on b.style_tracker_row_id = r.id
      and b.tracker_type = l.source_style_type
    where l.item_id is null and l.prior_status not in ('manual', 'not_applicable')
      and l.source_style_type is not null
    group by l.id
  ), eligible as materialized (
    select c.*, (select f.facts->>'source'
      from dam.orderlist_product_facts(c.item_id, l.source_style_type) f) as workflow_source
    from candidates c join base l on l.id = c.id where c.candidate_count = 1
  ), changed as (
    update plm.production_order_line l
      set item_id = e.item_id, master_data_match_status = 'matched',
          metadata = coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object(
            'last_relinked_by', 'system:coldlion_intake',
            'last_relinked_at', now(), 'link_candidate_item_count', e.candidate_count,
            'pre_intake_relink_match_status', l.master_data_match_status),
          updated_at = now()
    from eligible e
    where l.id = e.id and e.workflow_source = 'master_data'
      and l.item_id is null and l.master_data_match_status not in ('manual', 'not_applicable')
    returning l.id
  )
  select jsonb_build_object(
    'considered', (select count(*) from base),
    'linked', (select count(*) from changed),
    'existing_preserved', (select count(*) from base where item_id is not null),
    'manual_or_not_applicable_preserved', (select count(*) from base where item_id is null and prior_status in ('manual', 'not_applicable')),
    'missing_catalog', (select count(*) from base where item_id is null and prior_status not in ('manual', 'not_applicable') and source_style_type is null),
    'ambiguous', (select count(*) from candidates where candidate_count > 1),
    'no_candidate', (select count(*) from candidates where candidate_count = 0),
    'conflicting_workflow', (select count(*) from eligible where workflow_source is distinct from 'master_data')
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.link_dam_order_lines_scoped(uuid[]) from public, anon, authenticated;
grant execute on function public.link_dam_order_lines_scoped(uuid[]) to service_role;
comment on function public.link_dam_order_lines_scoped(uuid[]) is
  'Service-only, 1..500 explicit line IDs, exact SKU/catalog unique-item linking with consistent current Master Data workflow. Preserves existing/manual/not-applicable links; counts only receipts. ColdLion intake owns the surrounding transaction.';

commit;
