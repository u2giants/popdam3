-- u2giants/popdam3#1037 Step 7 (popcre/shared-db#6673): English word forms in the exact-word leg
-- of public.search_dam_documents. A word-form-only match is found and ranks below every exact
-- match; recognised names stay exact; the 'simple' index and exact scores are unchanged.
begin;
set local search_path=pg_catalog,public,extensions;

do $test$
declare
  lic uuid;
  g_exact uuid; g_form uuid; g_plural uuid; g_other uuid; g_name_exact uuid; g_name_form uuid; g_name_blur uuid;
  r record; ids uuid[]; expected_page uuid; n bigint; v tsvector; q tsquery; done integer;
  exact_rank real; form_rank real; plural_rank real; base_rank real;
  term text; single_type jsonb; repeated_type jsonb;
begin
  -- the stemmed column, its index and trigger exist; the exact index is untouched
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='dam_search_keys_tsv_en_idx'
                 and indexdef like '%gin (search_tsv_en)%') then
    raise exception 'popdam3#1037 Step 7: dam_search_keys_tsv_en_idx missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='dam_search_keys_tsv_idx'
                 and indexdef like '%gin (search_tsv)%') then
    raise exception 'popdam3#1037 Step 7: the simple index dam_search_keys_tsv_idx must stay';
  end if;
  if has_function_privilege('anon', 'public.dam_search_tsv_en_backfill()', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_tsv_en_backfill()', 'execute')
     or has_function_privilege('authenticated', 'public.dam_search_exact_names(text,jsonb)', 'execute') then
    raise exception 'popdam3#1037 Step 7: helper functions must not be callable by API roles';
  end if;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '10370000-0000-4000-8000-000000000071', repeat('c', 64),
    'popdam3-1037 step 7 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status) values ('Zqmarie', 'ZQ1037-S7', 'active') returning id into lic;

  insert into public.style_groups (sku, folder_path) values ('ZQ7A', '/zq7/a') returning id into g_exact;
  insert into public.style_groups (sku, folder_path) values ('ZQ7B', '/zq7/b') returning id into g_form;
  insert into public.style_groups (sku, folder_path) values ('ZQ7C', '/zq7/c') returning id into g_plural;
  insert into public.style_groups (sku, folder_path) values ('ZQ7D', '/zq7/d') returning id into g_other;
  insert into public.style_groups (sku, folder_path) values ('ZQ7E', '/zq7/e') returning id into g_name_exact;
  insert into public.style_groups (sku, folder_path) values ('ZQ7F', '/zq7/f') returning id into g_name_form;
  insert into public.style_groups (sku, folder_path) values ('ZQ7G', '/zq7/g') returning id into g_name_blur;
  insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at, file_created_at, thumbnail_url, style_group_id)
  select 'zq7'||x.k||'.pdf', 'zq7/'||x.k||'.pdf', 'pdf', 'zq7'||x.k, now(), now(), 'https://example.invalid/'||x.k||'.png', x.g
  from (values ('a',g_exact),('b',g_form),('c',g_plural),('d',g_other),('e',g_name_exact),('f',g_name_form),('g',g_name_blur)) x(k,g);

  insert into public.dam_search_documents (document_type, entity_id, asset_id, style_group_id, title, path)
  values ('style_group', g_exact, null, g_exact, 'zqlamp cerulean frame', '/zq7/a'),
         ('style_group', g_form, null, g_form, 'zqlamp cerulean framed', '/zq7/b'),
         ('style_group', g_plural, null, g_plural, 'zqlamp cerulean frames', '/zq7/c'),
         ('style_group', g_other, null, g_other, 'zqlamp cerulean planter', '/zq7/d'),
         ('style_group', g_name_exact, null, g_name_exact, 'zqmarie zqteal framed', '/zq7/e'),
         ('style_group', g_name_form, null, g_name_form, 'zqmarie zqteal frames', '/zq7/f'),
         ('style_group', g_name_blur, null, g_name_blur, 'zqmary zqteal framed', '/zq7/g')
  on conflict (document_type, entity_id) do update
    set asset_id=excluded.asset_id, style_group_id=excluded.style_group_id, title=excluded.title, path=excluded.path;

  -- the trigger keeps the column on insert and on a search_tsv change
  select k.search_tsv_en into v from public.dam_search_keys k where k.document_type='style_group' and k.entity_id=g_form;
  if v is null or not (v @@ to_tsquery('english','frame')) then
    raise exception 'popdam3#1037 Step 7: search_tsv_en not kept on insert (%)', v;
  end if;
  update public.dam_search_keys set search_tsv = to_tsvector('simple','zqlamp cerulean framing')
   where document_type='style_group' and entity_id=g_other;
  select k.search_tsv_en into v from public.dam_search_keys k where k.document_type='style_group' and k.entity_id=g_other;
  if not (v @@ to_tsquery('english','frame')) then raise exception 'popdam3#1037 Step 7: trigger did not follow an update (%)', v; end if;
  update public.dam_search_keys set search_tsv = to_tsvector('simple','zqlamp cerulean planter')
   where document_type='style_group' and entity_id=g_other;

  -- backfill fills null rows and is a no-op when nothing is left
  update public.dam_search_keys set search_tsv_en = null where document_type='style_group' and entity_id=g_plural;
  done := public.dam_search_tsv_en_backfill();
  if done < 1 or exists (select 1 from public.dam_search_keys where search_tsv_en is null) then
    raise exception 'popdam3#1037 Step 7: backfill left null rows (filled %)', done;
  end if;
  if public.dam_search_tsv_en_backfill() <> 0 then raise exception 'popdam3#1037 Step 7: second backfill not a no-op'; end if;

  -- "frame" finds frame, framed and frames; the exact one ranks first, word forms below every exact match
  select array_agg(s.entity_id order by s.ordinality), min(s.total_count) into ids, n
  from public.search_dam_documents('zqlamp frame', '{}'::jsonb, 50, 0, null, null, 0, null) with ordinality s;
  if n is distinct from 3 or cardinality(ids) is distinct from 3
      or ids[1] is distinct from g_exact or not (ids @> array[g_exact, g_form, g_plural]) then
    raise exception 'popdam3#1037 Step 7: zqlamp frame returned % %', n, ids;
  end if;
  -- The literal style-group index path must preserve exact, stemmed and
  -- substring results against the equivalent general type-array path.
  foreach term in array array['zqlamp frame', 'zqlamp framed', 'cerule'] loop
    select jsonb_agg(to_jsonb(s) order by s.ordinality) into single_type
      from public.search_dam_documents(term, '{}', 2, 1, array['style_group'], null, 0, null)
      with ordinality s;
    select jsonb_agg(to_jsonb(s) order by s.ordinality) into repeated_type
      from public.search_dam_documents(term, '{}', 2, 1, array['style_group','style_group'], null, 0, null)
      with ordinality s;
    if single_type is null or single_type is distinct from repeated_type then
      raise exception '#6871 style-group keyword results differ for %', term;
    end if;
  end loop;
  -- The exact key also matches the stemmed query. Excluding its duplicate must leave
  -- both word forms reachable on later pages and preserve the exact visible total.
  expected_page := ids[3];
  select s.* into strict r
  from public.search_dam_documents('zqlamp frame', '{}'::jsonb, 1, 2, null, null, 0, null) s;
  if r.entity_id is distinct from expected_page or r.total_count is distinct from 3
      or r.has_more is distinct from false then
    raise exception 'popdam3#1037 Step 7: the word-form-only last page or its exact total changed';
  end if;
  select max(s.keyword_rank) filter (where s.entity_id=g_exact), max(s.keyword_rank) filter (where s.entity_id=g_form),
         max(s.keyword_rank) filter (where s.entity_id=g_plural)
    into exact_rank, form_rank, plural_rank
  from public.search_dam_documents('zqlamp frame', '{}'::jsonb, 50, 0, null, null, 0, null) s;
  if not (exact_rank >= 0.1 and form_rank < 0.1 and plural_rank < 0.1 and form_rank >= 0.05) then
    raise exception 'popdam3#1037 Step 7: ranks exact % form % plural %', exact_rank, form_rank, plural_rank;
  end if;
  -- the exact match's score is today's formula (title words match: 0.45 + 0.09 x length ratio)
  if abs(exact_rank - (0.45 + 0.09 * least(1.0, length('zqlamp frame')::numeric / length('zqlamp cerulean frame')))) > 0.0001 then
    raise exception 'popdam3#1037 Step 7: exact score changed (%)', exact_rank;
  end if;
  -- "framed" also finds "frame" by word form
  select array_agg(s.entity_id) into ids from public.search_dam_documents('zqlamp framed', '{}'::jsonb, 50, 0, null, null, 0, null) s;
  if not (ids @> array[g_exact, g_form, g_plural]) then raise exception 'popdam3#1037 Step 7: framed returned %', ids; end if;
  -- a code-like token is never reduced: only its exact form matches
  -- (code tokens carry no English suffix, so every hit is an exact one at today's score)
  select count(*) into n from public.search_dam_documents('zq7a', '{}'::jsonb, 50, 0, null, null, 0, null) s
   where s.entity_id is not null and s.keyword_rank < 0.1;
  if n <> 0 then raise exception 'popdam3#1037 Step 7: code search has % word-form-only hits', n; end if;

  -- names stay exact: the licensor name "Zqmarie" is recognised, so "zqmary" (same English stem) does not match
  q := public.dam_search_exact_names('zqmarie zqteal frame', '{}'::jsonb);
  if q is null or q::text not like '%zqmarie%' then raise exception 'popdam3#1037 Step 7: exact names %', q; end if;
  if public.dam_search_exact_names('zqteal frame', '{}'::jsonb) is not null then
    raise exception 'popdam3#1037 Step 7: no name in the query must give no exact-name query';
  end if;
  if public.dam_search_exact_names('zqmarietta frame', '{"requiredCharacterNames":["Zqmarietta"]}'::jsonb)::text not like '%zqmarietta%' then
    raise exception 'popdam3#1037 Step 7: requiredCharacterNames not kept exact';
  end if;
  select array_agg(s.entity_id) into ids
  from public.search_dam_documents('zqmarie zqteal frame', '{}'::jsonb, 50, 0, null, null, 0, null) s;
  if not (ids @> array[g_name_exact, g_name_form]) or ids && array[g_name_blur] then
    raise exception 'popdam3#1037 Step 7: name guard returned % (want e,f and never g)', ids;
  end if;
end;
$test$;

rollback;
