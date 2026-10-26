-- #4800: corpus-verified compound-word variants in expand_dam_search_queries.
-- Synthetic fixtures; the CI harness wraps the file in begin/rollback.

reset role;

-- Isolate the new behaviour from curated synonyms (e.g. spiderman -> spider man).
update public.dam_search_synonyms set is_active = false;

insert into public.dam_search_keys (document_type, entity_id, title, path, title_key, title_tsv, search_tsv)
select 'style_group', gen_random_uuid(), t, p, lower(t), to_tsvector('simple', t), to_tsvector('simple', t || ' ' || p)
from (values
  ('Spider-Man Floor Mat', '/fixtures/4800/spider-man-mat'),
  ('Coir Doormat', '/fixtures/4800/coir-doormat'),
  ('Spider Manual', '/fixtures/4800/manual')) f(t, p);

do $$
declare
  v text[];
begin
  select array_agg(query_text) into v from public.expand_dam_search_queries('spiderman floor mat');
  if v is null or not ('spider man floor mat' = any(v)) then
    raise exception 'split variant missing: %', v;
  end if;

  select array_agg(query_text) into v from public.expand_dam_search_queries('door mat');
  if v is null or not ('doormat' = any(v)) then
    raise exception 'join variant missing: %', v;
  end if;

  select array_agg(query_text) into v from public.expand_dam_search_queries('covering');
  if v is null or not ('covering' = any(v)) then
    raise exception 'base variant missing: %', v;
  end if;
  if 'cove ring' = any(v) or 'cover ing' = any(v) then
    raise exception 'unverified split emitted: %', v;
  end if;

  -- "Spider Manual" alone must not justify "spider man" (whole-word boundary).
  delete from public.dam_search_keys where path = '/fixtures/4800/spider-man-mat';
  select array_agg(query_text) into v from public.expand_dam_search_queries('spiderman');
  if v is null or not ('spiderman' = any(v)) then
    raise exception 'base variant missing: %', v;
  end if;
  if exists (select 1 from public.dam_search_keys k where k.title ~* 'spider[^[:alnum:]]+man([^[:alnum:]]|$)')
     then return; -- corpus genuinely has the split form; nothing to assert
  end if;
  if 'spider man' = any(v) then
    raise exception 'prefix-only match emitted split: %', v;
  end if;
end $$;

-- anon may not execute the function.
do $$
begin
  if has_function_privilege('anon', 'public.expand_dam_search_queries(text)', 'execute') then
    raise exception 'anon can execute expand_dam_search_queries';
  end if;
  if not has_function_privilege('authenticated', 'public.expand_dam_search_queries(text)', 'execute') then
    raise exception 'authenticated lost execute on expand_dam_search_queries';
  end if;
end $$;

-- A signed-in user without DAM access is refused.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform * from public.expand_dam_search_queries('spiderman');
    raise exception 'non-DAM user was not refused';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
end $$;
