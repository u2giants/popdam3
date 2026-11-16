begin;
-- shared-db#6194: the property list is core.property (daily ColdLion fill,
-- cron coldlion-core-property-sync). The 2026-11-12 finding named seven
-- functions as readers of the frozen merch-group copy of the property list.
-- Six of them are pinned here: their definitions must contain no reference
-- to any merch-group copy of the property list, and the property-list
-- consumers among them must read core.property.
-- The seventh, api.resolve_item_mg_category, is intentionally NOT asserted:
-- it belongs to the app-schema lane (claim #6305, designflow-item-master#205
-- step 3.1(a)) and deliberately reads dflow_prod."merchGroup".
do $$
declare
  v_def text;
  v_clean text;
begin
  -- core."merchGroup" (frozen 2026-06-26) is retired: renamed, never dropped.
  assert to_regclass('core."merchGroup"') is null, 'core."merchGroup" must stay retired';
  assert exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relname ~ '^merchGroup_retired_[0-9]{8}$'
  ), 'a retired core."merchGroup" copy must exist (rename, not drop)';

  -- Every function below must exist and must not read any merch-group copy.
  -- Sanitized first: ''merchGroupDetails'', ''merchGroup'' and
  -- ''merchGroup01''..''merchGroup06'' are string literals (ColdLion endpoint,
  -- source-table labels, raw JSON field keys), not table references.
  foreach v_def in array array[
    pg_get_functiondef('plm.link_coldlion_licensors_properties_core(jsonb, jsonb)'::regprocedure),
    pg_get_functiondef('plm.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer)'::regprocedure),
    pg_get_functiondef('plm.compute_taxonomy_immutability_snapshot()'::regprocedure),
    pg_get_functiondef('plm.refresh_style_tracker_item_bridge()'::regprocedure),
    pg_get_functiondef('ingest.apply_coldlion_product_size(uuid, boolean, integer, integer, integer)'::regprocedure),
    pg_get_functiondef('public.search_style_tracker_link_candidates(text, text, integer, text)'::regprocedure)
  ]
  loop
    v_clean := regexp_replace(v_def, '''merchGroupDetails''', '', 'g');
    v_clean := regexp_replace(v_clean, '''merchGroup[0-9]{2}''', '', 'g');
    v_clean := regexp_replace(v_clean, '''merchGroup''', '', 'g');
    assert v_clean !~* 'merchgroup',
      'function definition still references a merch-group copy: ' || left(v_def, 80);
  end loop;

  -- Property-list consumers must read core.property.
  assert pg_get_functiondef('plm.link_coldlion_licensors_properties_core(jsonb, jsonb)'::regprocedure) like '%core.property%', 'link must read core.property';
  assert pg_get_functiondef('plm.verify_coldlion_approved_mapping_identity(jsonb, jsonb, integer)'::regprocedure) like '%core.property%', 'verify must read core.property';
  assert pg_get_functiondef('plm.compute_taxonomy_immutability_snapshot()'::regprocedure) like '%core.property%', 'snapshot must read core.property';
  assert pg_get_functiondef('public.search_style_tracker_link_candidates(text, text, integer, text)'::regprocedure) like '%core.property%', 'style tracker search must read core.property';
end $$;
rollback;
