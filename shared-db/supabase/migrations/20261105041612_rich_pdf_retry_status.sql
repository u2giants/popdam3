-- Expose failure age so the worker can retry provider failures after a cooldown.
-- Return type expansion requires recreation; the transaction preserves callers.
begin;
drop function public.get_pdf_rich_extraction_hashes(uuid[]);
create function public.get_pdf_rich_extraction_hashes(p_asset_ids uuid[])
returns table (asset_id uuid, source_text_sha256 text, parse_error text, extracted_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select e.asset_id, e.source_text_sha256, e.parse_error, e.extracted_at
  from dam.pdf_rich_extraction e
  where e.asset_id = any (p_asset_ids);
$$;
revoke all on function public.get_pdf_rich_extraction_hashes(uuid[]) from public, anon, authenticated;
grant execute on function public.get_pdf_rich_extraction_hashes(uuid[]) to service_role;
comment on function public.get_pdf_rich_extraction_hashes(uuid[]) is
  'Worker-only extraction identity and failure age for bounded retries; successful hashes retain idempotency.';
commit;
