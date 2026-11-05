-- Pure installed helper behavior and privilege/signature contracts. No source rows.
begin;
do $$
declare p jsonb; q jsonb; f regprocedure; role_name text; bad text;
begin
 p:='{"thumbnail_url":"https://example.invalid/a","_embedding_input":{"sha256":"same","asset_id":"00000000-0000-4000-8000-000000056340","source_modified_at":"2026-01-01T00:00:00Z"}}';
 if not dam.search_embedding_inputs_match(p,p,'old','new','google/siglip2-base-patch16-naflex',now(),now()) then raise exception 'same image canonical vector must survive changed keywords'; end if;
 if dam.search_embedding_inputs_match(p,p,'old','new','wrong-model',now(),now()) then raise exception 'wrong model must abstain'; end if;
 q:=jsonb_set(p,'{_embedding_input,sha256}','"changed"');
 if dam.search_embedding_inputs_match(p,q,'same','same','google/siglip2-base-patch16-naflex',now(),now()) then raise exception 'changed image must invalidate even with equal keyword hash'; end if;
 foreach bad in array array['not-a-date','2026-01-01T00:00:00+99:99','999999999999999-01-01'] loop
  q:=jsonb_set(p,'{_embedding_input,source_modified_at}',to_jsonb(bad));
  if dam.search_embedding_inputs_match(p,q,'old','new','google/siglip2-base-patch16-naflex',now(),now()) then raise exception 'corrupt dates must safely abstain'; end if;
 end loop;
 if dam.search_embedding_image_provenance(null,null) is not null then raise exception 'missing source must abstain'; end if;
 foreach f in array array['dam.search_embedding_image_provenance(uuid,text,jsonb)'::regprocedure,
 'dam.search_embedding_inputs_match(jsonb,jsonb,text,text,text,timestamptz,timestamptz)'::regprocedure] loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_function_privilege(role_name,f,'execute') then raise exception 'image helper must remain service-only'; end if;
  end loop;
  if not has_function_privilege('service_role',f,'execute') then raise exception 'service capability lost'; end if;
 end loop;
 if to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is null then raise exception 'poller claim signature lost'; end if;
end $$;
rollback;
