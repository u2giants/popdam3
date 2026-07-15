-- Public RPC wrappers for worker access to dam.pdf_rich_extraction.
--
-- The `dam` schema is intentionally NOT in PostgREST's exposed schemas
-- (pgrst.db_schemas), because it holds worker-internal tables the frontend
-- never queries. The Railway worker therefore cannot reach dam.* over PostgREST
-- (".schema('dam')" -> "Invalid schema: dam"). These SECURITY DEFINER functions
-- live in the exposed `public` schema and give the service role read/upsert
-- access without broadening the API surface. Additive.

create or replace function public.get_pdf_rich_extraction_hashes(p_asset_ids uuid[])
returns table (asset_id uuid, source_text_sha256 text)
language sql
security definer
set search_path = public, dam
as $$
  select e.asset_id, e.source_text_sha256
  from dam.pdf_rich_extraction e
  where e.asset_id = any (p_asset_ids);
$$;

comment on function public.get_pdf_rich_extraction_hashes(uuid[]) is
  'Worker helper: existing (asset_id, source_text_sha256) for the given source PDF assets, for rich-PDF extraction idempotency.';

create or replace function public.upsert_pdf_rich_extraction(
  p_asset_id uuid,
  p_style_group_id uuid,
  p_sku text,
  p_doc_kind text,
  p_data jsonb,
  p_source_text_sha256 text,
  p_model text,
  p_prompt_version text,
  p_schema_version integer,
  p_parse_error text
)
returns void
language sql
security definer
set search_path = public, dam
as $$
  insert into dam.pdf_rich_extraction (
    asset_id, style_group_id, sku, doc_kind, data, source_text_sha256,
    model, prompt_version, schema_version, parse_error, extracted_at
  )
  values (
    p_asset_id, p_style_group_id, p_sku, p_doc_kind, coalesce(p_data, '{}'::jsonb),
    p_source_text_sha256, p_model, p_prompt_version, coalesce(p_schema_version, 1),
    p_parse_error, now()
  )
  on conflict (asset_id) do update
  set style_group_id = excluded.style_group_id,
      sku = excluded.sku,
      doc_kind = excluded.doc_kind,
      data = excluded.data,
      source_text_sha256 = excluded.source_text_sha256,
      model = excluded.model,
      prompt_version = excluded.prompt_version,
      schema_version = excluded.schema_version,
      parse_error = excluded.parse_error,
      extracted_at = now();
$$;

comment on function public.upsert_pdf_rich_extraction(uuid, uuid, text, text, jsonb, text, text, text, integer, text) is
  'Worker helper: upsert one dam.pdf_rich_extraction row (keyed by asset_id) from the rich-PDF extraction op.';

grant execute on function public.get_pdf_rich_extraction_hashes(uuid[]) to service_role;
grant execute on function public.upsert_pdf_rich_extraction(uuid, uuid, text, text, jsonb, text, text, text, integer, text) to service_role;
