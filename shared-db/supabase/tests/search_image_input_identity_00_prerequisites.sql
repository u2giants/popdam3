-- Runs before search_image_input_identity_contracts.sql in the canonical sorted
-- contract runner. Keep its original 45 behavior assertions byte-identical.
begin;
create function pg_temp.va_require_image_identity_dependencies(signatures text[])
returns void language plpgsql as $$
declare missing text[];
begin
 select array_agg(signature order by signature) into missing
 from unnest(signatures) signature
 where to_regprocedure(signature) is null;
 if missing is not null then
  raise exception using errcode='55000',
   message='image identity prerequisites missing (install prerequisite74126 then revision142040): '||array_to_string(missing,', ');
 end if;
end $$;
do $$
declare missing_message text;
begin
 perform pg_temp.va_require_image_identity_dependencies(array[
  'dam.search_embedding_image_provenance(uuid,text,jsonb)',
  'dam.search_embedding_inputs_match(jsonb,jsonb,text,text,text,timestamptz,timestamptz)',
  'public.refresh_dam_search_asset_document(uuid)',
  'public.refresh_dam_search_style_group_document(uuid)',
  'public.claim_dam_search_embedding_documents(integer,text,integer)',
  'public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector,text)',
  'public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text)',
  'public.refresh_dam_search_after_render_completion()',
  'public.refresh_dam_search_after_source_size_change()'
 ]);
 -- A deliberately absent signature must fail before definition cloning, with
 -- an explicit prerequisite diagnostic rather than a later missing helper.
 begin
  perform pg_temp.va_require_image_identity_dependencies(array[
   'public.refresh_dam_search_asset_document(uuid)',
   'public.va_image_identity_intentionally_missing_prerequisite()'
  ]);
  raise exception 'missing prerequisite was silently accepted';
 exception when object_not_in_prerequisite_state then
  get stacked diagnostics missing_message=message_text;
  if missing_message <> 'image identity prerequisites missing (install prerequisite74126 then revision142040): public.va_image_identity_intentionally_missing_prerequisite()' then
   raise exception 'incorrect prerequisite diagnostic: %',missing_message;
  end if;
 end;
end $$;
rollback;
