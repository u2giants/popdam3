-- Review finding #5591 on 20261104231008; application issue u2giants/popdam3#663.
-- derived-from: 20261102211347
-- The claim now skips documents with no thumbnail, so the partial index must leave them
-- out (or every claim re-reads them) and the meter must stop calling them pending
-- (or it reports a backlog that never drains). Claim behaviour is unchanged.
do $$
begin
  if to_regprocedure('public.get_dam_search_embedding_status()') is null
     or to_regclass('public.dam_search_embedding_claim_order_idx') is null then
    raise exception 'embedding meter and claim index must exist before this migration';
  end if;
end $$;

drop index public.dam_search_embedding_claim_order_idx;
create index dam_search_embedding_claim_order_idx
  on public.dam_search_documents ((document_type = 'style_group') desc, indexed_at, document_type, entity_id)
  where embedding is null
    and embedding_error_category is distinct from 'permanent'
    and nullif(metadata->>'thumbnail_url','') is not null;

create or replace function public.get_dam_search_embedding_status()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
select jsonb_build_object('total_documents',count(*),'embedded_documents',count(*) filter(where embedding is not null),
 'pending_documents',count(*) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is not null),
 'waiting_for_thumbnail_documents',count(*) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is null),
 'leased_documents',count(*) filter(where embedding_lease_expires_at>now()),'errored_documents',count(*) filter(where embedding_error is not null),
 'exhausted_documents',count(*) filter(where embedding is null and (embedding_attempts>=embedding_max_attempts or embedding_error_category='permanent')),
 'asset_documents',count(*) filter(where document_type='asset'),'style_group_documents',count(*) filter(where document_type='style_group'),
 'oldest_pending_indexed_at',min(indexed_at) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent' and nullif(metadata->>'thumbnail_url','') is not null),'newest_indexed_at',max(indexed_at)) from public.dam_search_documents;
$function$;
