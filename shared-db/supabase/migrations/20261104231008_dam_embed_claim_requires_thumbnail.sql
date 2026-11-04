-- Work issue #5584; application issue u2giants/popdam3#663.
-- derived-from: 20261101123510
-- A document with no thumbnail cannot be embedded. Claiming one spends an attempt, and
-- at embedding_max_attempts mark_dam_search_embedding_error makes it permanent, which
-- nothing clears when the thumbnail arrives. Leave such documents unclaimed until they
-- have one. Only the candidate predicate changes; CREATE OR REPLACE keeps the grants.
do $$
begin
  if to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is null then
    raise exception 'claim_dam_search_embedding_documents must exist before this migration';
  end if;
end $$;

create or replace function public.claim_dam_search_embedding_documents(p_limit integer default 100, p_worker_id text default null::text, p_lease_seconds integer default 300)
 returns table(document_type text, entity_id uuid, search_text text, thumbnail_url text, content_sha256 text, lease_token uuid, lease_expires_at timestamp with time zone, attempt integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (select auth.role()) <> 'service_role' or nullif(btrim(p_worker_id),'') is null then raise exception 'service_role and worker id required' using errcode='42501'; end if;
  return query with candidates as (
    select d.document_type,d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at<=now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at<=now())
      and d.embedding_error_category is distinct from 'permanent'
      and nullif(d.metadata->>'thumbnail_url','') is not null
    order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), claimed as (update public.dam_search_documents d set embedding_lease_token=gen_random_uuid(),
    embedding_lease_owner=p_worker_id,embedding_lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),3600))),
    embedding_attempts=d.embedding_attempts+1 from candidates c where d.document_type=c.document_type and d.entity_id=c.entity_id
    returning d.*)
  select c.document_type,c.entity_id,left(c.search_text,8000),
    c.metadata->>'thumbnail_url',
    c.content_sha256,c.embedding_lease_token,c.embedding_lease_expires_at,c.embedding_attempts from claimed c;
end
$function$;
