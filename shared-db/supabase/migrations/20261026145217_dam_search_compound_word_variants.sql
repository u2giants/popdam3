-- #4800: generic compound-word join/split query variants for DAM keyword search.
-- derived-from: 20260714173500
-- "spiderman" also searches "spider man" (matches "Spider-Man"), "door mat" also
-- searches "doormat", etc. A split or join is emitted only when the corpus
-- (dam_search_keys title/path, trigram-indexed regex) contains that form as a
-- whole word (a singular query form also accepts a plural corpus form: "door mats"),
-- so arbitrary splits ("cove ring") are never generated. Compound probes run only
-- for queries of at most six words, split only words of 6-20 letters, and are
-- capped at 40 probes per call.
-- Variants feed the existing synonym passes. search_dam_documents is unchanged:
-- it already unions every variant this function returns.
--
-- Access: the probes read dam_search_keys, which only DAM users may search, so
-- the function now requires public.require_dam_access() (as search_dam_documents
-- does) and is not executable by PUBLIC/anon.
-- enable_seqscan=off: measured on production, the per-candidate EXISTS probes
-- otherwise seq-scan dam_search_keys (2.3 s for 6 probes) instead of using the
-- GIN trigram indexes (~25 ms per probe). It is call-scoped (does not leak).
-- jit=off: the seqscan penalty inflates plan cost past jit_above_cost, and JIT
-- compilation would add ~0.8 s per call.
-- ROWS 4 is kept: an under-estimate is the safer direction for the ranked plan;
-- typical queries return 2-5 variants.
CREATE OR REPLACE FUNCTION public.expand_dam_search_queries(p_query text)
 RETURNS TABLE(query_text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER ROWS 4
 SET search_path TO 'public'
 SET enable_seqscan TO 'off'
 SET jit TO 'off'
AS $function$
  with normalized as (
    select nullif(
      btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')),
      ''
    ) as raw_query
    where public.require_dam_access()
  ),
  words as (
    select t.w, t.ord
    from normalized n
    cross join lateral regexp_split_to_table(
      btrim(lower(regexp_replace(n.raw_query, '[-_/[:space:]]+', ' ', 'g'))), ' '
    ) with ordinality as t(w, ord)
    where n.raw_query is not null
      and t.w <> ''
  ),
  word_count as (
    select count(*) as n from words
  ),
  -- Split: "spiderman" -> "spider man" only when the corpus really writes it
  -- apart ("Spider-Man", "spider man"). Trigram-indexed regex; generic, no list.
  split_candidates as (
    select w.ord, substr(w.w, 1, k) as a, substr(w.w, k + 1) as b
    from words w
    cross join word_count c
    cross join lateral generate_series(3, length(w.w) - 3) as k
    where c.n <= 6
      and w.w ~ '^[[:alpha:]]{6,20}$'
    order by w.ord, k
    limit 40
  ),
  split_ok as (
    select distinct on (s.ord) s.ord, s.a || ' ' || s.b as repl
    from split_candidates s
    where exists (
      select 1
      from public.dam_search_keys k
      where k.title ~* ('(^|[^[:alnum:]])' || s.a || '[^[:alnum:]]+' || s.b || 's?([^[:alnum:]]|$)')
         or k.path ~* ('(^|[^[:alnum:]])' || s.a || '[^[:alnum:]]+' || s.b || 's?([^[:alnum:]]|$)')
    )
    order by s.ord, abs(length(s.a) - length(s.b)), length(s.a) desc
  ),
  -- Join: "door mat" -> "doormat" only when the corpus writes it joined.
  join_ok as (
    select w1.ord, w1.w || w2.w as joined
    from words w1
    join words w2 on w2.ord = w1.ord + 1
    cross join word_count c
    where c.n <= 6
      and w1.w ~ '^[[:alnum:]]+$'
      and w2.w ~ '^[[:alnum:]]+$'
      and length(w1.w || w2.w) between 5 and 30
      and exists (
        select 1
        from public.dam_search_keys k
        where k.title ~* ('(^|[^[:alnum:]])' || w1.w || w2.w || 's?([^[:alnum:]]|$)')
           or k.path ~* ('(^|[^[:alnum:]])' || w1.w || w2.w || 's?([^[:alnum:]]|$)')
      )
  ),
  compound_variants as (
    -- every verified split applied at once
    select string_agg(coalesce(s.repl, w.w), ' ' order by w.ord) as query_text
    from words w
    left join split_ok s on s.ord = w.ord
    where exists (select 1 from split_ok)
    union
    -- each verified split alone
    select string_agg(case when w.ord = s.ord then s.repl else w.w end, ' ' order by w.ord)
    from split_ok s
    cross join words w
    group by s.ord
    union
    -- each verified join alone
    select string_agg(x.word, ' ' order by x.ord)
    from (
      select j.ord as jord, w.ord,
        case when w.ord = j.ord then j.joined else w.w end as word
      from join_ok j
      cross join words w
      where w.ord <> j.ord + 1
    ) x
    group by x.jord
  ),
  base_variants as (
    select raw_query as query_text
    from normalized
    where raw_query is not null

    union

    select nullif(
      btrim(
        regexp_replace(
          regexp_replace(raw_query, '[-_/]+', ' ', 'g'),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) as query_text
    from normalized
    where raw_query is not null

    union

    select query_text from compound_variants
  ),
  synonym_pass_1 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          b.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from base_variants b
    join public.dam_search_synonyms s
      on s.is_active
     and lower(b.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_pass_2 as (
    select distinct nullif(
      btrim(
        regexp_replace(
          p.query_text,
          '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)',
          E'\\1' || s.expansion || E'\\2',
          'gi'
        )
      ),
      ''
    ) as query_text
    from synonym_pass_1 p
    join public.dam_search_synonyms s
      on s.is_active
     and lower(p.query_text) ~ (
       '(^|[^[:alnum:]])' || regexp_replace(s.search_term, '\s+', '[^[:alnum:]]+', 'g') || '([^[:alnum:]]|$)'
     )
  ),
  synonym_variants as (
    select query_text from synonym_pass_1
    union
    select query_text from synonym_pass_2
  )
  select distinct query_text
  from (
    select query_text from base_variants
    union all
    select query_text from synonym_variants
  ) variants
  where query_text is not null;
$function$;

REVOKE ALL ON FUNCTION public.expand_dam_search_queries(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expand_dam_search_queries(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.expand_dam_search_queries(text) IS
  'DAM search query variants: hyphen/slash normalization, corpus-verified compound-word join/split variants (#4800), and active dam_search_synonyms expansions. Requires DAM access.';
