-- Issue #2507: truthful terminal outcomes for dedicated PopSG PDF extraction.
--
-- Additive only. Existing rows and the v1 completion RPC remain untouched for
-- staggered clients. This migration performs no extraction work and no backfill.

alter table public.style_guide_pdf_text
  add column if not exists extraction_method varchar(100),
  add column if not exists terminal_reason varchar(2000);

comment on column public.style_guide_pdf_text.extraction_method is
  'Issue #2507. The extraction path used by the worker, such as native text, local OCR, or an approved fallback.';

comment on column public.style_guide_pdf_text.terminal_reason is
  'Issue #2507. Durable bounded reason for a failed or reviewed skipped terminal outcome; distinct from extracted text.';

create or replace function public.complete_style_guide_pdf_text_v2(
  p_style_guide_file_id uuid,
  p_content_identity text,
  p_status text,
  p_method text default null,
  p_page_count integer default null,
  p_text text default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_method text := nullif(btrim(p_method), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_updated integer;
begin
  if v_status not in ('extracted', 'failed', 'skipped') then
    raise exception 'complete_style_guide_pdf_text_v2 status must be extracted, failed, or skipped';
  end if;

  if v_status = 'extracted' and nullif(btrim(p_text), '') is null then
    raise exception 'complete_style_guide_pdf_text_v2 requires non-empty text for extracted';
  end if;

  if v_status in ('failed', 'skipped') and v_reason is null then
    raise exception 'complete_style_guide_pdf_text_v2 requires a reason for failed or skipped';
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'complete_style_guide_pdf_text_v2 reason exceeds 2000 characters';
  end if;

  if char_length(v_method) > 100 then
    raise exception 'complete_style_guide_pdf_text_v2 method exceeds 100 characters';
  end if;

  if p_page_count is not null and p_page_count < 0 then
    raise exception 'complete_style_guide_pdf_text_v2 page count cannot be negative';
  end if;

  -- Refuse inactive files, spent claims, stale worker identities, and files whose
  -- current content identity moved after the claim was issued.
  update public.style_guide_pdf_text t
     set status = v_status,
         extraction_method = v_method,
         terminal_reason = case when v_status in ('failed', 'skipped') then v_reason else null end,
         extracted_text = case when v_status = 'extracted' then p_text else null end,
         page_count = p_page_count,
         error_message = case when v_status in ('failed', 'skipped') then v_reason else null end,
         extracted_at = case when v_status = 'extracted' then now() else null end,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = now()
    from public.style_guide_files f
   where t.style_guide_file_id = p_style_guide_file_id
     and f.id = t.style_guide_file_id
     and f.is_active
     and t.status = 'claimed'
     and t.content_identity = p_content_identity
     and t.content_identity = md5(
       f.relative_path || '|' || coalesce(f.size_bytes::text, '') || '|' || coalesce(f.modified_at::text, '')
     );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  -- Match the v1 completion path: refresh only this file's existing document.
  update public.style_guide_search_documents d
     set pdf_text_status = t.status,
         pdf_text_length = coalesce(t.text_length, 0),
         search_vector =
           setweight(to_tsvector('simple', coalesce(d.filename, '')), 'A')
           || setweight(to_tsvector('simple', coalesce(d.style_guide_name, '') || ' ' ||
                                              coalesce(d.property_folder, '') || ' ' ||
                                              coalesce(d.licensor_name, '')), 'B')
           || setweight(to_tsvector('simple', coalesce(d.relative_path, '') || ' ' ||
                                              array_to_string(d.tag_names, ' ')), 'C')
           || setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D'),
         document_updated_at = now()
    from public.style_guide_pdf_text t
   where d.style_guide_file_id = p_style_guide_file_id
     and t.style_guide_file_id = d.style_guide_file_id;

  return true;
end;
$function$;

comment on function public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text) is
  'Issue #2507. Service-role-only PopSG PDF completion with explicit extracted, failed, or skipped outcome; refuses inactive, stale-content, and spent claims and refreshes one search document.';

revoke all on function public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text) from public;
revoke all on function public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text) from anon;
revoke all on function public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text) from authenticated;
grant execute on function public.complete_style_guide_pdf_text_v2(uuid, text, text, text, integer, text, text) to service_role;

do $verify$
begin
  if to_regprocedure('public.complete_style_guide_pdf_text_v2(uuid,text,text,text,integer,text,text)') is null then
    raise exception 'issue #2507: v2 completion RPC is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'style_guide_pdf_text'
       and column_name = 'extraction_method'
       and character_maximum_length = 100
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'style_guide_pdf_text'
       and column_name = 'terminal_reason'
       and character_maximum_length = 2000
  ) then
    raise exception 'issue #2507: bounded method or terminal reason column is missing';
  end if;
end;
$verify$;
