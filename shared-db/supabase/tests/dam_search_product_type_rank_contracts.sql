-- u2giants/popdam3#1037 (popcre/shared-db#6791): with the text leg on, a candidate whose recorded
-- product type (merchandise group / category names) is known and is not the type the typed words
-- name ranks 0.15 lower. The step only reorders: the minimum rank is tested before it, and the
-- text-leg-off formula is unchanged.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare src text;
begin
  select p.prosrc into src from pg_proc p
  where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real,extensions.halfvec,real,real)');
  if src is null then raise exception 'search_dam_documents missing'; end if;
  if position('product_types as materialized' in src)=0 or position('named_type as materialized' in src)=0 then
    raise exception 'popdam3#1037 product type: product_types / named_type CTEs missing';
  end if;
  if position('concat_ws('' '',g.mg01_name,g.mg02_name,g.mg03_name,g.product_category)' in src)=0 then
    raise exception 'popdam3#1037 product type: type must come from the recorded merchandise group and category';
  end if;
  if position('where (select has_text_embedding from params)
      and cardinality((select query_lexemes from params)) > 0' in src)=0 then
    raise exception 'popdam3#1037 product type: the step must apply only with the text leg on';
  end if;
  if position('(r.rank - r.type_step)::real rank' in src)=0
     or position('where r.rank >= (select min_rank from params)' in src)=0 then
    raise exception 'popdam3#1037 product type: minimum rank must be tested before the type step';
  end if;
  if position('else coalesce(c.semantic_rank,0) * 0.35 end)::real rank,' in src)=0 then
    raise exception 'popdam3#1037 product type: text-leg-off ranking must stay keyword + 0.35 x picture';
  end if;
  -- English word forms on both sides ("framed" names the "Framed" merchandise group as "frame")
  if not (tsvector_to_array(to_tsvector('english','marie framed')) && tsvector_to_array(to_tsvector('english',
          regexp_replace('Framed/Glass/SBox w Attachment','[-_/]+',' ','g')))) then
    raise exception 'popdam3#1037 product type: word forms must match';
  end if;
end;
$test$;

rollback;
