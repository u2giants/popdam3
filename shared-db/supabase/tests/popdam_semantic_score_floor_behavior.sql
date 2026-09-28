-- #3457 behaviour tests T1–T8 for public.search_dam_documents semantic score floor.
-- Each block is independent and uses a transaction rollback.
-- Asserts objects with to_regprocedure / pg_get_functiondef, never ledger rows alone.
-- T3's sem-low title/path use words outside the query 'zz3457 sem low'.
-- Its no-embedding assertion verifies that this row cannot enter through the keyword leg.
-- Posted by MiMo chat unknown on edge-dev

begin;

-- T8 (structure first): old 7-arg signature gone; 8-arg present; grants correct.
do $$
declare
  v_old oid;
  v_new oid;
  v_def text;
begin
  v_old := to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real)');
  if v_old is not null then
    raise exception 'T8 FAIL: old 7-arg signature still present';
  end if;

  v_new := to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)');
  if v_new is null then
    raise exception 'T8 FAIL: 8-arg signature with p_min_semantic_score is missing';
  end if;

  select pg_get_functiondef(v_new) into v_def;
  if position('p_min_semantic_score' in v_def) = 0 then
    raise exception 'T8 FAIL: p_min_semantic_score not in function body';
  end if;
  if position('min_semantic_score' in v_def) = 0 then
    raise exception 'T8 FAIL: clamped min_semantic_score not computed in params';
  end if;
  if position('p.min_semantic_score is null' in v_def) = 0 then
    raise exception 'T8 FAIL: semantic floor not applied only inside semantic leg';
  end if;

  if has_function_privilege('anon',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)','EXECUTE') then
    raise exception 'T8 FAIL: anon has EXECUTE on the 8-arg signature';
  end if;
  if not has_function_privilege('authenticated',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)','EXECUTE') then
    raise exception 'T8 FAIL: authenticated lacks EXECUTE on the 8-arg signature';
  end if;
  if not has_function_privilege('service_role',
       'public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)','EXECUTE') then
    raise exception 'T8 FAIL: service_role lacks EXECUTE on the 8-arg signature';
  end if;
  raise notice 'T8 PASS: 8-arg present, 7-arg dropped, grants correct';
end;
$$;

-- T1–T7 behaviour fixtures. Insert a DAM-entitled caller and four documents:
--   kw-only   : keyword hit, no embedding
--   sem-high  : semantic-only hit with high score
--   sem-low   : semantic-only hit with low score (below typical floor)
--   mixed     : keyword hit AND semantic hit with low score
set local session_replication_role = replica;
insert into auth.users (id,email) values
  ('34570000-0000-4000-8000-000000000001','zz3457-dam@example.invalid');
set local session_replication_role = origin;

insert into app.profile (auth_user_id,email,display_name,status) values
  ('34570000-0000-4000-8000-000000000001','zz3457-dam@example.invalid','ZZ3457 DAM','active');
insert into app.app_access (profile_id,app)
select id,'dam'::app.app_name from app.profile
where auth_user_id = '34570000-0000-4000-8000-000000000001';

-- Assets that will back dam_search_documents rows.
insert into public.assets (id, filename, relative_path, file_type, quick_hash, modified_at, thumbnail_url, is_deleted) values
  ('34570000-0000-4000-8000-000000000010','zz3457-kw-only.ai','zz3457-kw-only.ai','ai','zz3457-kw',now(),'https://example.invalid/kw.png',false),
  ('34570000-0000-4000-8000-000000000011','zz3457-sem-high.ai','zz3457-sem-high.ai','ai','zz3457-sh',now(),'https://example.invalid/sh.png',false),
  ('34570000-0000-4000-8000-000000000012','cerulean-lampstone.ai','cerulean-lampstone.ai','ai','zz3457-sl',now(),'https://example.invalid/sl.png',false),
  ('34570000-0000-4000-8000-000000000013','zz3457-mixed.ai','zz3457-mixed.ai','ai','zz3457-mx',now(),'https://example.invalid/mx.png',false);

-- dam_search_documents rows. Embeddings are 384-dim unit vectors.
-- Query embedding for the semantic tests is the first basis vector e0.
-- Distances are exact by construction (no exact 1.0 match, so no float-boundary coin flip):
--   sem-high cosine similarity 0.90  -> semantic_rank 0.90
--   sem-low  cosine similarity 0.20  -> semantic_rank 0.20
--   mixed    cosine similarity 0.30  -> semantic_rank 0.30
delete from public.dam_search_documents where entity_id in (
  '34570000-0000-4000-8000-000000000010','34570000-0000-4000-8000-000000000011',
  '34570000-0000-4000-8000-000000000012','34570000-0000-4000-8000-000000000013'
);
insert into public.dam_search_documents
  (document_type, entity_id, asset_id, style_group_id, title, path, customer, program, embedding)
values
  ('asset','34570000-0000-4000-8000-000000000010','34570000-0000-4000-8000-000000000010',null,
   'zz3457 kw only canvas','zz3457-kw-only.ai',null,null, null),
  ('asset','34570000-0000-4000-8000-000000000011','34570000-0000-4000-8000-000000000011',null,
   'zz3457 sem high unrelated','zz3457-sem-high.ai',null,null,
   (select array_fill(0.0::real, array[384])::extensions.vector)),
  ('asset','34570000-0000-4000-8000-000000000012','34570000-0000-4000-8000-000000000012',null,
   'cerulean lampstone canvas','cerulean-lampstone.ai',null,null,
   (select array_fill(0.5::real, array[384])::extensions.vector)),
  ('asset','34570000-0000-4000-8000-000000000013','34570000-0000-4000-8000-000000000013',null,
   'zz3457 mixed canvas','zz3457-mixed.ai',null,null,
   (select array_fill(0.5::real, array[384])::extensions.vector));

-- Make the embeddings distinguishable unit vectors along known angles to qemb=e0.
-- sem-high: cos=0.90 (high, but strictly below 1.0 so floor=1.0 cannot pass it).
update public.dam_search_documents
set embedding = (
  select (array[0.9::real, sqrt(0.19)::real] || array_fill(0.0::real, array[382]))::extensions.vector
)
where asset_id = '34570000-0000-4000-8000-000000000011';

update public.dam_search_documents
set embedding = (
  select (array[0.2::real, sqrt(0.96)::real] || array_fill(0.0::real, array[382]))::extensions.vector
)
where asset_id = '34570000-0000-4000-8000-000000000012';

update public.dam_search_documents
set embedding = (
  select (array[0.3::real, sqrt(0.91)::real] || array_fill(0.0::real, array[382]))::extensions.vector
)
where asset_id = '34570000-0000-4000-8000-000000000013';

do $$
declare
  dam_uid uuid := '34570000-0000-4000-8000-000000000001';
  qemb extensions.vector(384);
  fixture_asset_ids uuid[] := array[
    '34570000-0000-4000-8000-000000000010'::uuid,
    '34570000-0000-4000-8000-000000000011'::uuid,
    '34570000-0000-4000-8000-000000000012'::uuid,
    '34570000-0000-4000-8000-000000000013'::uuid
  ];
  n int;
  sem real;
begin
  -- Query embedding aligned with sem-high (first dim = 1, rest 0).
  qemb := (select (array_fill(1.0::real, array[1]) || array_fill(0.0::real, array[383]))::extensions.vector(384));
  -- Prove the three UPDATEs actually established the intended fixture scores.
  if not exists (
    select 1 from public.dam_search_documents
    where asset_id = '34570000-0000-4000-8000-000000000011'
      and abs((1 - (embedding <=> qemb)) - 0.90) < 0.01
  ) or not exists (
    select 1 from public.dam_search_documents
    where asset_id = '34570000-0000-4000-8000-000000000012'
      and abs((1 - (embedding <=> qemb)) - 0.20) < 0.01
  ) or not exists (
    select 1 from public.dam_search_documents
    where asset_id = '34570000-0000-4000-8000-000000000013'
      and abs((1 - (embedding <=> qemb)) - 0.30) < 0.01
  ) then
    raise exception 'fixture embeddings do not have the expected semantic scores';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',dam_uid,'role','authenticated')::text, true);


  ----------------------------------------------------------------
  -- T1: null floor identical to current (no-floor) behaviour.
  ----------------------------------------------------------------
  select count(*) into n
  from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,qemb,null)
  where asset_id = any(fixture_asset_ids);
  if n < 2 then
    raise exception 'T1 FAIL: null floor returned % rows, expected at least 2 (kw + semantic)', n;
  end if;
  select count(*) into n
  from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,qemb,null)
  where semantic_rank is not null and asset_id = any(fixture_asset_ids);
  if n < 2 then
    raise exception 'T1 FAIL: null floor should surface semantic ranks, got % semantic rows', n;
  end if;
  raise notice 'T1 PASS: null floor preserves prior blended behaviour (% rows)', n;

  ----------------------------------------------------------------
  -- T2: keyword-only survives a high semantic floor.
  ----------------------------------------------------------------
  select count(*) into n
  from public.search_dam_documents('zz3457 kw only','{}'::jsonb,50,0,null,qemb,null,0.99)
  where asset_id = '34570000-0000-4000-8000-000000000010';
  if n <> 1 then
    raise exception 'T2 FAIL: keyword-only doc did not survive floor=0.99 (got %)', n;
  end if;
  select semantic_rank into sem
  from public.search_dam_documents('zz3457 kw only','{}'::jsonb,50,0,null,qemb,null,0.99)
  where asset_id = '34570000-0000-4000-8000-000000000010';
  if sem is not null then
    raise exception 'T2 FAIL: keyword-only doc should have semantic_rank null, got %', sem;
  end if;
  raise notice 'T2 PASS: keyword-only survives floor with semantic_rank null';

  ----------------------------------------------------------------
  -- T3: semantic-only removal when below floor.
  ----------------------------------------------------------------
  select count(*) into n
  from public.search_dam_documents('zz3457 sem low','{}'::jsonb,50,0,null,qemb,null,0.5)
  where asset_id = '34570000-0000-4000-8000-000000000012';
  if n <> 0 then
    raise exception 'T3 FAIL: semantic-only below-floor doc was not removed (got %)', n;
  end if;
  -- A missing query embedding must not return this fixture via the keyword leg.
  select count(*) into n
  from public.search_dam_documents('zz3457 sem low','{}'::jsonb,50,0,null,null,null,0.5)
  where asset_id = '34570000-0000-4000-8000-000000000012';
  if n <> 0 then
    raise exception 'T3 FAIL: sem-low fixture also matches the keyword leg (got %)', n;
  end if;
  -- The same doc must appear when the floor is null.
  select count(*) into n
  from public.search_dam_documents('zz3457 sem low','{}'::jsonb,50,0,null,qemb,null,null)
  where asset_id = '34570000-0000-4000-8000-000000000012';
  if n <> 1 then
    raise exception 'T3 FAIL: semantic-only doc missing under null floor (got %)', n;
  end if;
  raise notice 'T3 PASS: semantic-only below-floor removed; null floor keeps it';

  ----------------------------------------------------------------
  -- T4: mixed doc (keyword + below-floor semantic) survives with semantic_rank null.
  ----------------------------------------------------------------
  select count(*) into n
  from public.search_dam_documents('zz3457 mixed','{}'::jsonb,50,0,null,qemb,null,0.5)
  where asset_id = '34570000-0000-4000-8000-000000000013';
  if n <> 1 then
    raise exception 'T4 FAIL: mixed doc did not survive floor=0.5 (got %)', n;
  end if;
  select semantic_rank into sem
  from public.search_dam_documents('zz3457 mixed','{}'::jsonb,50,0,null,qemb,null,0.5)
  where asset_id = '34570000-0000-4000-8000-000000000013';
  if sem is not null then
    raise exception 'T4 FAIL: mixed doc below-floor semantic should be null, got %', sem;
  end if;
  raise notice 'T4 PASS: mixed keyword+below-floor semantic survives with semantic_rank null';

  ----------------------------------------------------------------
  -- T5: pagination exactness under a floor.
  ----------------------------------------------------------------
  declare
    total1 bigint; total2 bigint; has1 boolean; has2 boolean;
    p1 int; p2 int;
  begin
    select total_count, has_more into total1, has1
    from public.search_dam_documents('zz3457','{}'::jsonb,1,0,null,qemb,null,0.0)
    where asset_id = any(fixture_asset_ids)
    limit 1;
    select total_count, has_more into total2, has2
    from public.search_dam_documents('zz3457','{}'::jsonb,1,1,null,qemb,null,0.0)
    where asset_id = any(fixture_asset_ids)
    limit 1;
    if total1 is distinct from total2 then
      raise exception 'T5 FAIL: total_count differs across pages (% vs %)', total1, total2;
    end if;
    if has1 is not true then
      raise exception 'T5 FAIL: has_more should be true on page 0 of a multi-row result';
    end if;
    select count(*) into p1
    from public.search_dam_documents('zz3457','{}'::jsonb,1,0,null,qemb,null,0.0)
    where asset_id = any(fixture_asset_ids);
    select count(*) into p2
    from public.search_dam_documents('zz3457','{}'::jsonb,1,1,null,qemb,null,0.0)
    where asset_id = any(fixture_asset_ids);
    if p1 <> 1 or p2 <> 1 then
      raise exception 'T5 FAIL: page sizes wrong (p1=% p2=%)', p1, p2;
    end if;
    raise notice 'T5 PASS: pagination exactness holds under floor (total=%)', total1;
  end;

  ----------------------------------------------------------------
  -- T6: floor=1 rejects every non-exact semantic hit; floor=0 ≡ null;
  --      out-of-range floors clamp into [0,1].
  -- No fixture has cosine similarity 1.0, so floor=1.0 is a stable zero
  -- (the semantic leg ignores query text, so the absent query alone is not
  -- what suppresses the rows).
  ----------------------------------------------------------------
  select count(*) into n
  from public.search_dam_documents('zz3457 absent query','{}'::jsonb,50,0,null,qemb,null,1.0)
  where asset_id = any(fixture_asset_ids);
  if n <> 0 then
    raise exception 'T6 FAIL: floor=1 with no exact semantic match returned % rows, expected 0', n;
  end if;
  -- Out-of-range floor 1.5 clamps to 1.0 and must behave identically.
  select count(*) into n
  from public.search_dam_documents('zz3457 absent query','{}'::jsonb,50,0,null,qemb,null,1.5)
  where asset_id = any(fixture_asset_ids);
  if n <> 0 then
    raise exception 'T6 FAIL: floor=1.5 (clamp 1.0) returned % rows, expected 0', n;
  end if;
  -- floor=0 must match null-floor row count exactly.
  -- floor=-0.5 clamps to 0.0 and must match as well.
  declare
    n0 int; nnull int; nneg int;
  begin
    select count(*) into n0
    from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,qemb,null,0.0)
    where asset_id = any(fixture_asset_ids);
    select count(*) into nnull
    from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,qemb,null,null)
    where asset_id = any(fixture_asset_ids);
    select count(*) into nneg
    from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,qemb,null,-0.5)
    where asset_id = any(fixture_asset_ids);
    if n0 <> nnull then
      raise exception 'T6 FAIL: floor=0 (=%) is not equivalent to null floor (=%)', n0, nnull;
    end if;
    if nneg <> nnull then
      raise exception 'T6 FAIL: floor=-0.5 clamp (=%) is not equivalent to null floor (=%)', nneg, nnull;
    end if;
    raise notice 'T6 PASS: floor=1/1.5 -> 0 rows; floor=0/-0.5 ≡ null (% rows)', n0;
  end;

  ----------------------------------------------------------------
  -- T7: no embedding -> floor has no effect.
  ----------------------------------------------------------------
  declare
    n_floor int; n_nofloor int;
  begin
    select count(*) into n_floor
    from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,null,null,0.99)
    where asset_id = any(fixture_asset_ids);
    select count(*) into n_nofloor
    from public.search_dam_documents('zz3457','{}'::jsonb,50,0,null,null,null,null)
    where asset_id = any(fixture_asset_ids);
    if n_floor <> n_nofloor then
      raise exception 'T7 FAIL: floor changed results without an embedding (% vs %)', n_floor, n_nofloor;
    end if;
    if n_nofloor = 0 then
      raise exception 'T7 FAIL: expected keyword rows without embedding, got 0';
    end if;
    raise notice 'T7 PASS: no embedding -> floor has no effect (% rows)', n_floor;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
end;
$$;

rollback;
