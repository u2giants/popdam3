-- Contracts for 20261204003532_search_embedding_health_fast.sql (#6630,
-- review finding #6632). Synthetic writes only; everything rolls back.
--   1. A picture-vector write (embedding_updated_at advances) moves
--      dam.search_embedding_last_write and the health row's last_write.
--   2. An older or unchanged embedding_updated_at never moves it backwards.
--   3. The dam errored count covers documents WITHOUT a picture vector; a row
--      carrying both a vector and a stale error is deliberately not counted
--      (errors are only recorded on leased, unembedded documents and a
--      successful write clears them).
begin;
do $test$
declare
  v_id uuid := gen_random_uuid();
  v_t timestamptz := now() - interval '10 minutes';
  health record;
  v_last timestamptz;
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  update dam.search_embedding_last_write set last_write = null where corpus = 'dam';

  insert into public.dam_search_documents(document_type, entity_id, indexed_at, metadata)
  values ('asset', v_id, now(), '{"thumbnail_url":"https://example.invalid/hw.png"}');
  update public.dam_search_documents set embedding_updated_at = v_t
   where document_type = 'asset' and entity_id = v_id;
  select last_write into v_last from dam.search_embedding_last_write where corpus = 'dam';
  if v_last is distinct from v_t then
    raise exception 'last_write did not advance on a write: %', v_last;
  end if;
  select * into health from public.get_search_embedding_health() where corpus = 'dam';
  if health.last_write is distinct from v_t or health.minutes_since_last_write < 9 then
    raise exception 'health does not report the recorded write: %', row_to_json(health);
  end if;

  update public.dam_search_documents set embedding_updated_at = v_t - interval '1 hour'
   where document_type = 'asset' and entity_id = v_id;
  select last_write into v_last from dam.search_embedding_last_write where corpus = 'dam';
  if v_last is distinct from v_t then
    raise exception 'last_write moved backwards: %', v_last;
  end if;

  -- 3. errored scope
  delete from public.dam_search_documents;
  insert into public.dam_search_documents(document_type, entity_id, indexed_at, metadata, embedding_error, embedding_error_category)
  values ('asset', gen_random_uuid(), now(), '{}', 'boom', 'transient');
  insert into public.dam_search_documents(document_type, entity_id, indexed_at, metadata, embedding_error, embedding)
  values ('asset', gen_random_uuid(), now(), '{}', 'stale error',
          ('[' || array_to_string(array_fill(0.036::real, array[768]), ',') || ']')::extensions.vector);
  select * into health from public.get_search_embedding_health() where corpus = 'dam';
  if health.errored <> 1 then
    raise exception 'dam errored must count only unembedded errors: %', health.errored;
  end if;
end;
$test$;
rollback;
