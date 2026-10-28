-- #4905 (u2giants/popdam3 #540): the thumbnail-error requeue route must scan
-- through the partial text_pattern_ops index on public.assets.thumbnail_error,
-- not seq-scan the whole relation under the 8 s PostgREST statement cap.

do $$
declare
  index_is_valid boolean;
  index_predicate text;
  key_column text;
  opclass_name text;
  plan_line text;
  plan_text text := '';
begin
  select i.indisvalid and i.indisready,
         lower(regexp_replace(regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()]', '', 'g'), '\s+', '', 'g')),
         (select a.attname from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = i.indkey[0]),
         (select opc.opcname from pg_opclass opc where opc.oid = i.indclass[0])
  into index_is_valid, index_predicate, key_column, opclass_name
  from pg_index i
  where i.indexrelid = 'public.idx_assets_thumbnail_error_pattern'::regclass;

  if index_is_valid is distinct from true then
    raise exception 'public.idx_assets_thumbnail_error_pattern is not valid and ready';
  end if;

  if key_column is distinct from 'thumbnail_error'
     or opclass_name is distinct from 'text_pattern_ops' then
    raise exception 'thumbnail-error requeue index key is not (thumbnail_error text_pattern_ops)';
  end if;

  if index_predicate is distinct from 'thumbnail_errorisnotnull' then
    raise exception 'thumbnail-error requeue index predicate is not "thumbnail_error is not null"';
  end if;

  -- The admin-api requeue-broken-thumbnails marker scan must plan through the
  -- index once sequential scans are taken off the table.
  perform set_config('enable_seqscan', 'off', true);
  for plan_line in
    execute $explain$
      explain (costs off)
      select id
      from public.assets
      where thumbnail_error like 'Thumbnail not found in storage%'
    $explain$
  loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;

  if plan_text not like '%idx_assets_thumbnail_error_pattern%' then
    raise exception 'the marker scan does not plan through the required index';
  end if;
end;
$$;
