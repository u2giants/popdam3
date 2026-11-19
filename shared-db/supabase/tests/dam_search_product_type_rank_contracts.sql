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
  if position('(r.rank - least(r.type_step, r.rank - (select min_rank from params)))::real rank' in src)=0
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

-- Behaviour (synthetic): three products with the same words. A: text 1.0, type Garden Planter.
-- B: text 0.95, type Framed Print. C: text 0.95, no recorded type. Query "zqptype frame".
do $test$
declare
  model text := dam.search_text_embedding_model();
  q extensions.halfvec := (array[1]::real[] || array_fill(0::real, array[1023]))::extensions.halfvec;
  g uuid[] := array[]::uuid[]; gid uuid; i int; ra real; rb real; rc real; ids uuid[]; nums numeric[]; n1 bigint; n2 bigint;
begin
  if model is null then raise exception 'SEARCH_TEXT_EMBEDDING_MODEL unset in test database'; end if;
  for i in 1..3 loop
    insert into public.style_groups (sku, folder_path, mg01_name, mg02_name)
      values ('ZQPT' || i, '/zqpt/' || i, case i when 1 then 'Garden' when 2 then 'Framed' end,
              case i when 1 then 'Planter' when 2 then 'Print' end) returning id into gid;
    insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
      values ('zqpt-' || i || '.pdf', 'zqpt/' || i || '.pdf', 'pdf', 'zqpt-' || i, now(), now(),
              'https://example.invalid/zqpt-' || i || '.png', gid);
    insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
    values ('style_group', gid, null, gid, 'zqptype frame item ' || i, '/zqpt/' || i)
    on conflict (document_type, entity_id) do update
      set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path;
    g := g || gid;
  end loop;
  insert into dam.search_text_vectors (document_type, entity_id, model, input_sha256, embedding)
  select 'style_group', g[x.i], model, repeat('e', 64),
    (array[x.s, sqrt(1 - x.s*x.s)]::real[] || array_fill(0::real, array[1022]))::extensions.halfvec
  from (values (1, 1.0::real), (2, 0.95::real), (3, 0.95::real)) x(i, s)
  on conflict (document_type, entity_id) do update set model = excluded.model, embedding = excluded.embedding;

  -- text on: the planter (A) is moved 0.15 down, below the framed product (B); C is not moved
  select max(d.rank) filter (where d.entity_id=g[1]), max(d.rank) filter (where d.entity_id=g[2]),
         max(d.rank) filter (where d.entity_id=g[3]), min(d.total_count)
    into ra, rb, rc, n1
  from public.search_dam_documents('zqptype frame', '{}'::jsonb, 50, 0, array['style_group'], null, 0, null, q, null, 0.10) d;
  if ra is null or rb is null or rc is null then raise exception 'product type: a product was hidden (% % %)', ra, rb, rc; end if;
  if not (rb > ra) or abs((rb - rc)) > 0.001 or abs((rc - ra) - (0.15 - 0.6*0.05)) > 0.01 then
    raise exception 'product type: ranks A % B % C %', ra, rb, rc;
  end if;
  -- the minimum rank is met by every returned row, and nothing is hidden by the step
  select array_agg(d.entity_id order by d.entity_id), min(d.total_count) into ids, n2
  from public.search_dam_documents('zqptype frame', '{}'::jsonb, 50, 0, array['style_group'], null, (rc - 0.01)::real, null, q, null, 0.10) d;
  if not (ids @> array[g[1], g[2], g[3]]) or n2 <> n1 then raise exception 'product type: min rank hid % (total % vs %)', ids, n2, n1; end if;
  if exists (select 1 from public.search_dam_documents('zqptype frame', '{}'::jsonb, 50, 0, array['style_group'], null, (rc - 0.01)::real, null, q, null, 0.10) d
             where d.rank < rc - 0.01 - 0.0001) then
    raise exception 'product type: a returned rank is below the minimum';
  end if;
  -- words naming no recorded type: nothing moves
  select max(d.rank) filter (where d.entity_id=g[1]) - max(d.rank) filter (where d.entity_id=g[3]) into ra
  from public.search_dam_documents('zqptype', '{}'::jsonb, 50, 0, array['style_group'], null, 0, null, q, null, 0.10) d;
  if ra is null or abs(ra - 0.6*0.05) > 0.01 then raise exception 'product type: moved without a named type (%)', ra; end if;
  -- text off: ranking unchanged (all three tie on the keyword score)
  select array_agg(distinct round(d.rank::numeric, 4)) into nums
  from public.search_dam_documents('zqptype frame', '{}'::jsonb, 50, 0, array['style_group'], null, 0, null) d
  where d.entity_id = any(g);
  if cardinality(nums) is distinct from 1 then raise exception 'product type: text-off ranks changed %', nums; end if;
end;
$test$;

rollback;
