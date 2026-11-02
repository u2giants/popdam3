-- Contracts for 20261102211347_dam_embedding_claim_order_idx.sql (#5482).

begin;

create or replace function pg_temp.explain_claim()
returns setof text language plpgsql as $$
begin
  return query execute $q$explain (costs off)
    select d.document_type, d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts < d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at <= now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at <= now())
      and d.embedding_error_category is distinct from 'permanent'
    order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id
    for update skip locked limit 100$q$;
end $$;

do $contracts$
declare
  v_def text;
  v_plan text;
  v_order text[];
  v_expected text[];
begin
  select pg_get_indexdef(c.oid) into v_def
  from pg_class c where c.oid = to_regclass('public.dam_search_embedding_claim_order_idx');
  if v_def is null then
    raise exception 'dam_search_embedding_claim_order_idx is missing';
  end if;
  if v_def not like '%((document_type = ''style_group''::text)) DESC, indexed_at, document_type, entity_id%'
     or v_def not like '%embedding IS NULL%'
     or v_def not like '%IS DISTINCT FROM ''permanent''%' then
    raise exception 'unexpected index shape: %', v_def;
  end if;

  -- Fixture rows: two style_group and two other docs with varied indexed_at,
  -- plus one ineligible row of each kind (permanent error, live lease).
  insert into public.dam_search_documents
    (document_type, entity_id, search_text, indexed_at, embedding_error_category, embedding_lease_expires_at)
  values
    ('asset',       '00000000-0000-0000-0000-00000005482a', 't', '2000-01-01', null, null),
    ('style_group', '00000000-0000-0000-0000-00000005482b', 't', '2000-01-03', null, null),
    ('asset',       '00000000-0000-0000-0000-00000005482c', 't', '2000-01-02', null, null),
    ('style_group', '00000000-0000-0000-0000-00000005482d', 't', '2000-01-04', null, null),
    ('style_group', '00000000-0000-0000-0000-00000005482e', 't', '1999-01-01', 'permanent', null),
    ('style_group', '00000000-0000-0000-0000-00000005482f', 't', '1999-01-01', null, now() + interval '1 hour');

  select array_agg(d.entity_id::text order by (d.document_type = 'style_group') desc, d.indexed_at, d.document_type, d.entity_id)
    into v_order
  from public.dam_search_documents d
  where d.entity_id::text like '00000000-0000-0000-0000-00000005482%'
    and d.embedding is null and d.embedding_attempts < d.embedding_max_attempts
    and (d.embedding_next_retry_at is null or d.embedding_next_retry_at <= now())
    and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at <= now())
    and d.embedding_error_category is distinct from 'permanent';
  v_expected := array[
    '00000000-0000-0000-0000-00000005482b', '00000000-0000-0000-0000-00000005482d',
    '00000000-0000-0000-0000-00000005482a', '00000000-0000-0000-0000-00000005482c'];
  if v_order is distinct from v_expected then
    raise exception 'claim order changed: %', v_order;
  end if;

  -- With scan alternatives off, the claim's candidate query must walk the
  -- new index in order with no Sort node.
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  select string_agg(line, E'\n') into v_plan from pg_temp.explain_claim() line;
  if v_plan not like '%dam_search_embedding_claim_order_idx%' or v_plan like '%Sort%' then
    raise exception 'claim candidate query does not use the ordered index: %', v_plan;
  end if;
end $contracts$;

rollback;
