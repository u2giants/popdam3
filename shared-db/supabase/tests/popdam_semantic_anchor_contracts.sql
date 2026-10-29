-- #4999 contracts for public.dam_search_semantic_anchor.
-- Asserts objects with to_regprocedure / has_function_privilege, never ledger rows alone.
-- Synthetic fixtures; the CI harness wraps the file in begin/rollback.

reset role;

do $$
declare v oid := to_regprocedure('public.dam_search_semantic_anchor(extensions.vector,text[])');
begin
  if v is null then raise exception '#4999 FAIL: function missing'; end if;
  if (select provolatile from pg_proc where oid = v) <> 's' then raise exception '#4999 FAIL: not STABLE'; end if;
  if not (select prosecdef from pg_proc where oid = v) then raise exception '#4999 FAIL: not SECURITY DEFINER'; end if;
  if position('require_dam_access()' in pg_get_functiondef(v)) = 0 then raise exception '#4999 FAIL: no DAM gate'; end if;
  if has_function_privilege('anon', v, 'EXECUTE') then raise exception '#4999 FAIL: anon can execute'; end if;
  if has_function_privilege('public', v, 'EXECUTE') then raise exception '#4999 FAIL: PUBLIC can execute'; end if;
  if not has_function_privilege('authenticated', v, 'EXECUTE') then raise exception '#4999 FAIL: authenticated cannot execute'; end if;
  if not has_function_privilege('service_role', v, 'EXECUTE') then raise exception '#4999 FAIL: service_role cannot execute'; end if;
end
$$;

set local session_replication_role = replica;
insert into public.dam_search_documents
  (document_type, entity_id, asset_id, style_group_id, title, path, embedding, embedding_model)
values
  ('asset', '49990000-0000-4000-8000-000000000001', '49990000-0000-4000-8000-000000000001', null,
   'zz4999 anchor asset', 'zz4999-a.ai',
   (array[1::real] || array_fill(0::real, array[767]))::extensions.vector, 'google/siglip2-base-patch16-naflex'),
  ('style_group', '49990000-0000-4000-8000-000000000002', null, '49990000-0000-4000-8000-000000000002',
   'zz4999 anchor group', 'zz4999-g',
   (array[0::real, 1::real] || array_fill(0::real, array[766]))::extensions.vector, 'google/siglip2-base-patch16-naflex');
set local session_replication_role = origin;

do $$
declare
  qa extensions.vector := (array[1::real] || array_fill(0::real, array[767]))::extensions.vector;
  qg extensions.vector := (array[0::real, 1::real] || array_fill(0::real, array[766]))::extensions.vector;
  s real;
begin
  s := public.dam_search_semantic_anchor(qa, array['asset']);
  if s is null or s < 0.999 then raise exception '#4999 FAIL: asset anchor % (expected ~1)', s; end if;
  s := public.dam_search_semantic_anchor(qg, array['style_group']);
  if s is null or s < 0.999 then raise exception '#4999 FAIL: style_group anchor % (expected ~1)', s; end if;
  s := public.dam_search_semantic_anchor(qa, null);
  if s is null or s < 0.999 then raise exception '#4999 FAIL: untyped anchor % (expected ~1)', s; end if;
  s := public.dam_search_semantic_anchor(null, array['asset']);
  if s is not null then raise exception '#4999 FAIL: NULL embedding returned %', s; end if;
end
$$;

do $$
begin
  execute 'set local role anon';
  begin
    perform public.dam_search_semantic_anchor(null, null);
    raise exception '#4999 FAIL: anon call succeeded';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end
$$;

