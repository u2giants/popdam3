-- #1703 forward 4: use the observed synonym-expansion cardinality when costing
-- ranked search.  Production returns at most four variants for the active
-- synonym vocabulary (95th percentile: three); ROWS is an estimate only and
-- does not limit or otherwise change the variants returned.

alter function public.expand_dam_search_queries(text) rows 4;

comment on function public.expand_dam_search_queries(text) is
  'Expands a DAM query through curated synonyms. ROWS 4 is a planner estimate only; all distinct expansions remain returned.';
