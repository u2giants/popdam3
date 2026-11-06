-- derived-from: 20261027012301
-- #5758 Step 3a (claim #5779): style-guide embedding writers stop rewriting rows
-- whose target values are already in place.
--
-- public.style_guide_search_documents carries the 768-dim vector and fourteen
-- indexes on one wide row with 0% HOT updates (baseline
-- docs/verification/db-anti-bloat-5758/20261105T2318Z/baseline.md: 197,739 updates,
-- 0 hot). The claim/release cycle is a queue by design and moves to a side table in
-- the plan's Phase B; what is pure waste TODAY is a write that changes nothing:
-- reset_sg_search_embedding_errors re-rewrites every already-reset row, and
-- upsert/mark_error would rewrite a row already carrying exactly the values they
-- would store. Each writer below now refuses its own no-op write.
--
-- Bodies are the 20261027012301 definitions with the WHERE guards added; grants are
-- restated because create or replace re-strips anon (AGENTS.md 10.2).

-- 1) Worker success write: lease-token and content identity still gate the write;
--    a call whose every target value is already present writes nothing and reports
--    the row unchanged (found stays false only when no row matched the lease; a
--    matched row already in the target state now reports false WITHOUT writing -
--    the distinction is recorded so callers can tell "no such lease" from "already
--    stored exactly this").
create or replace function public.upsert_sg_search_embedding(
  p_style_guide_file_id uuid,
  p_content_sha256 text,
  p_lease_token uuid,
  p_embedding extensions.vector(768),
  p_embedding_model text default 'google/siglip2-base-patch16-naflex'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service_role required' using errcode = '42501'; end if;
  if p_embedding_model is distinct from 'google/siglip2-base-patch16-naflex'
     or extensions.vector_dims(p_embedding) is distinct from 768 then
    raise exception 'unsupported embedding model or dimension' using errcode = '22023';
  end if;
  -- pgvector has no equality operator; the text cast is the canonical exact
  -- value comparison ('[v1,v2,...]' with the same formatting on both sides).
  select (embedding::text is not distinct from p_embedding::text
          and embedding_model is not distinct from p_embedding_model
          and embedding_error is null
          and embedding_error_category is null
          and embedding_next_retry_at is null
          and embedding_lease_token is null
          and embedding_lease_owner is null
          and embedding_lease_expires_at is null)
    into v_already
    from public.style_guide_search_documents
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and embedding_lease_token = p_lease_token
     and embedding_lease_expires_at > now();
  if v_already then
    -- Nothing to store: same vector, same model, no error state, no lease to
    -- release. Rewriting the wide row here is the no-op churn this migration
    -- removes (#5758 D2: skip-unchanged writes are mandatory).
    return false;
  end if;
  update public.style_guide_search_documents
     set embedding = p_embedding,
         embedding_model = p_embedding_model,
         embedding_updated_at = now(),
         embedding_error = null,
         embedding_error_category = null,
         embedding_next_retry_at = null,
         embedding_lease_token = null,
         embedding_lease_owner = null,
         embedding_lease_expires_at = null
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and embedding_lease_token = p_lease_token
     and embedding_lease_expires_at > now();
  return found;
end;
$$;

-- 2) Worker failure report: identical treatment. A row that already carries
--    exactly this error text, category and computed backoff, with no lease left to
--    release, is not rewritten. (Through the live lease path the token match makes
--    this unreachable - the guard is the invariant, stated where it is enforced.)
create or replace function public.mark_sg_search_embedding_error(
  p_style_guide_file_id uuid,
  p_content_sha256 text,
  p_lease_token uuid,
  p_error text,
  p_category text default 'transient'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  if p_category not in ('transient','permanent') then
    raise exception 'invalid embedding error category' using errcode = '22023';
  end if;
  select (embedding_error is not distinct from left(coalesce(p_error, 'unknown embedding error'), 1000)
          and embedding_error_category is not distinct from (
            case when p_category = 'permanent' or embedding_attempts >= embedding_max_attempts
                 then 'permanent' else 'transient' end)
          and embedding_next_retry_at is null
          and embedding_lease_token is null
          and embedding_lease_owner is null
          and embedding_lease_expires_at is null)
    into v_already
    from public.style_guide_search_documents
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and embedding_lease_token = p_lease_token
     and embedding_lease_expires_at > now();
  if v_already then
    return false;
  end if;
  update public.style_guide_search_documents
     set embedding_error = left(coalesce(p_error, 'unknown embedding error'), 1000),
         embedding_error_category = case when p_category = 'permanent'
                                              or embedding_attempts >= embedding_max_attempts
                                         then 'permanent' else 'transient' end,
         embedding_next_retry_at = case when p_category = 'transient'
                                             and embedding_attempts < embedding_max_attempts
                                        then now() + make_interval(secs => least(3600, 30 * power(2, greatest(0, embedding_attempts - 1))::int)) end,
         embedding_lease_token = null,
         embedding_lease_owner = null,
         embedding_lease_expires_at = null
   where style_guide_file_id = p_style_guide_file_id
     and content_sha256 = p_content_sha256
     and embedding_lease_token = p_lease_token
     and embedding_lease_expires_at > now();
  return found;
end;
$$;

-- 3) Admin/worker retry reset: only rows that are not already in the reset state
--    are touched. A repeat reset rewrites nothing - this was the live no-op writer
--    (the reset runs over exhausted rows and matched already-reset rows again).
create or replace function public.reset_sg_search_embedding_errors(
  p_style_guide_file_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;
  update public.style_guide_search_documents
     set embedding_error = null,
         embedding_error_category = null,
         embedding_attempts = 0,
         embedding_next_retry_at = null,
         embedding_lease_token = null,
         embedding_lease_owner = null,
         embedding_lease_expires_at = null
   where embedding is null
     and (embedding_error is not null
          or embedding_error_category is not null
          or embedding_attempts <> 0
          or embedding_next_retry_at is not null
          or embedding_lease_token is not null
          or embedding_lease_owner is not null
          or embedding_lease_expires_at is not null)
     and (p_style_guide_file_ids is null or style_guide_file_id = any (p_style_guide_file_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_sg_search_embedding(uuid, text, uuid, extensions.vector(768), text) from public, anon, authenticated;
revoke all on function public.mark_sg_search_embedding_error(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.reset_sg_search_embedding_errors(uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_sg_search_embedding(uuid, text, uuid, extensions.vector(768), text) to service_role;
grant execute on function public.mark_sg_search_embedding_error(uuid, text, uuid, text, text) to service_role;
grant execute on function public.reset_sg_search_embedding_errors(uuid[]) to service_role;
