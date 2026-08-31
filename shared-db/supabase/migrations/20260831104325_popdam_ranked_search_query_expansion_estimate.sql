-- PostgreSQL otherwise assumes this set-returning function emits 1,000 rows.
-- Production DAM searches normally emit only a handful of query variants; the
-- default estimate multiplied the ranked candidate plan enough to exceed the
-- edge timeout. ROWS changes planner costing only: it does not truncate any
-- synonym expansion or change the search contract.

alter function public.expand_dam_search_queries(text) rows 32;

comment on function public.expand_dam_search_queries(text) is
  'Expands a DAM query through curated synonyms. ROWS 32 is a planner estimate only; all distinct expansions remain returned.';
