-- #5747 Step 5 (fix-forward of preview-only 20261106060723, retired by #5850):
-- exact unfiltered total without per-candidate heap probes. A maintained "has a
-- default-visible member" flag on dam_search_documents is used only for
-- unfiltered searches whose every candidate flag is current.
-- Change from 060723: per-document serialization uses ROW locks (the asset row
-- or the style_groups row, FOR NO KEY UPDATE) instead of transaction advisory
-- locks, which a large sweep or bulk asset update could exhaust (lock table is
-- ~5,760 slots). Sweep batches are 5,000 every minute. Idempotent on preview,
-- where 060723 ran; production never applied 060723.
-- Preview only: the Oct 21 body (md5 9e96cb…, 8s timeout) replayed there by
-- historical recovery of 20261021063716 (#5860) is also accepted and replaced.
-- derived-from: 20261106042721
begin;
set local lock_timeout='500ms';
set local statement_timeout='2500ms';
set local transaction_timeout='3s';
set local search_path=pg_catalog,public,extensions;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc) in ('1bede30349edd91071a493a6d5ff1203','0c040b9c12a8cf5bea4582ea6404c03b','9e96cb277fa1e8fd63629f320fa053c3') and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and pg_get_function_arguments(p.oid)='p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding vector DEFAULT NULL::vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real'
      and pg_get_function_result(p.oid)='TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)'
      and p.proconfig in (ARRAY['search_path=public, extensions','statement_timeout=30s']::text[], ARRAY['search_path=public, extensions','statement_timeout=8s']::text[])
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception '#5747 pre-change search contract differs (expected #5731 or 060723 body); reconcile rather than overwrite';
  end if;
end;
$guard$;


-- 1. Flag columns. Nullable, no default, no index: adding them is metadata-only,
--    and flag updates stay HOT. NULL = not yet computed -> fast path refuses.
alter table public.dam_search_documents
  add column if not exists has_default_visible_member boolean,
  add column if not exists default_visible_min_date timestamptz;

comment on column public.dam_search_documents.has_default_visible_member is
  '#5747: true when >= 1 member asset passes dam_asset_matches_filters with empty filters, computed with default_visible_min_date. Maintained synchronously by asset triggers; NULL = unknown.';

-- 2. The flag value, exactly the probe of search_dam_documents with empty filters.
create or replace function public.dam_default_visible_member(p_document_type text, p_asset_id uuid, p_style_group_id uuid, p_min_date timestamptz)
returns boolean language sql stable
set search_path = public, pg_temp
as $f$
  select case
    when p_document_type = 'asset' and p_asset_id is not null then exists (
      select 1 from public.assets a where a.id = p_asset_id and not a.is_deleted
        and (a.modified_at >= p_min_date or a.file_created_at >= p_min_date or a.thumbnail_url is not null))
    when p_document_type = 'style_group' and p_style_group_id is not null then exists (
      select 1 from public.assets a where a.style_group_id = p_style_group_id and not a.is_deleted
        and (a.modified_at >= p_min_date or a.file_created_at >= p_min_date or a.thumbnail_url is not null))
    else false end
$f$;

-- Serialize every writer of one document's flag on a row that already exists
-- whenever the document can have members: the asset row for an asset document,
-- the style_groups row for a group document. Row locks live in the tuple, not
-- the shared lock table. FOR NO KEY UPDATE does not block foreign-key checks.
create or replace function public.dam_lock_default_visible_owner(p_document_type text, p_entity_id uuid)
returns void language plpgsql volatile security definer
set search_path = public, pg_temp
as $f$
begin
  if p_entity_id is null then return; end if;
  if p_document_type = 'asset' then
    perform 1 from public.assets where id = p_entity_id for no key update;
  elsif p_document_type = 'style_group' then
    perform 1 from public.style_groups where id = p_entity_id for no key update;
  end if;
end
$f$;

-- 3. Recompute one document's flag under a per-document transaction lock.
--    The owner row lock serializes every writer of the same document (also when
--    the document row does not exist yet); the EXISTS runs in a later statement,
--    so under READ COMMITTED it sees every transaction that held the lock before
--    us (delete-both-members race). Writes only when the value changes.
create or replace function public.dam_refresh_default_visible_flag(p_document_type text, p_entity_id uuid)
returns void language plpgsql volatile security definer
set search_path = public, pg_temp
as $f$
declare v_min timestamptz; v_asset uuid; v_sg uuid; v_flag boolean;
begin
  if p_entity_id is null then return; end if;
  perform public.dam_lock_default_visible_owner(p_document_type, p_entity_id);
  select d.asset_id, d.style_group_id into v_asset, v_sg
    from public.dam_search_documents d
   where d.document_type = p_document_type and d.entity_id = p_entity_id;
  if not found then return; end if;
  v_min := public.assets_thumbnail_min_date();
  v_flag := public.dam_default_visible_member(p_document_type, v_asset, v_sg, v_min);
  update public.dam_search_documents d
     set has_default_visible_member = v_flag, default_visible_min_date = v_min
   where d.document_type = p_document_type and d.entity_id = p_entity_id
     and (d.has_default_visible_member is distinct from v_flag
          or d.default_visible_min_date is distinct from v_min);
end
$f$;

-- 4. New / re-keyed documents get their flag at write time.
create or replace function public.dam_search_documents_set_default_visible()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $f$
begin
  perform public.dam_lock_default_visible_owner(new.document_type, new.entity_id);
  new.default_visible_min_date := public.assets_thumbnail_min_date();
  new.has_default_visible_member := public.dam_default_visible_member(new.document_type, new.asset_id, new.style_group_id, new.default_visible_min_date);
  return new;
end
$f$;

drop trigger if exists dam_search_documents_default_visible on public.dam_search_documents;
create trigger dam_search_documents_default_visible
  before insert or update of document_type, entity_id, asset_id, style_group_id
  on public.dam_search_documents
  for each row execute function public.dam_search_documents_set_default_visible();

-- 5. Asset writes recompute the affected documents in the same transaction.
--    Skips when the asset's own visibility and group did not change.
create or replace function public.assets_refresh_default_visible_flags()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $f$
declare v_min timestamptz; old_vis boolean; new_vis boolean;
begin
  v_min := public.assets_thumbnail_min_date();
  if tg_op in ('UPDATE','DELETE') then
    old_vis := not old.is_deleted and (old.modified_at >= v_min or old.file_created_at >= v_min or old.thumbnail_url is not null);
  end if;
  if tg_op in ('UPDATE','INSERT') then
    new_vis := not new.is_deleted and (new.modified_at >= v_min or new.file_created_at >= v_min or new.thumbnail_url is not null);
  end if;
  if tg_op = 'UPDATE' and old_vis is not distinct from new_vis
     and old.style_group_id is not distinct from new.style_group_id and old.id = new.id then
    return null;
  end if;
  -- Asset documents first (their rows are this statement's own), then groups
  -- in uuid order so two movers between the same groups cannot deadlock.
  if tg_op in ('UPDATE','DELETE') then
    perform public.dam_refresh_default_visible_flag('asset', old.id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.id <> old.id) then
    perform public.dam_refresh_default_visible_flag('asset', new.id);
  end if;
  perform public.dam_refresh_default_visible_flag('style_group', g)
    from (select distinct g from unnest(array[
            case when tg_op in ('UPDATE','DELETE') then old.style_group_id end,
            case when tg_op in ('UPDATE','INSERT') then new.style_group_id end]) g
          where g is not null order by g) gs;
  return null;
end
$f$;

drop trigger if exists zz_assets_refresh_default_visible_flags on public.assets;
create trigger zz_assets_refresh_default_visible_flags
  after insert or delete or update of id, is_deleted, modified_at, file_created_at, thumbnail_url, style_group_id
  on public.assets
  for each row execute function public.assets_refresh_default_visible_flags();

-- 6. Batched sweep: backfill, and recompute after a THUMBNAIL_MIN_DATE change
--    (the min-date equality guard keeps totals exact until the sweep catches up).
create or replace function public.dam_sweep_default_visible_flags(p_limit integer default 5000)
returns integer language plpgsql volatile security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $f$
declare v_min timestamptz := public.assets_thumbnail_min_date(); r record; n integer := 0;
begin
  for r in
    select d.document_type, d.entity_id from public.dam_search_documents d
     where d.has_default_visible_member is null or d.default_visible_min_date is distinct from v_min
     limit greatest(p_limit, 0)
  loop
    perform public.dam_refresh_default_visible_flag(r.document_type, r.entity_id);
    n := n + 1;
  end loop;
  return n;
end
$f$;

-- Cron entry point: same sweep, but commits after every document so it never
-- holds more than one owner row lock (no lock pile-up, no deadlock with bulk
-- writers). Transaction control forbids SET clauses, so it is invoker-rights
-- with fully qualified names; pg_cron runs it as the job owner.
create or replace procedure public.dam_sweep_default_visible_flags_batched(p_limit integer default 5000)
language plpgsql
as $f$
declare v_min timestamptz := public.assets_thumbnail_min_date(); r record;
begin
  for r in
    select d.document_type, d.entity_id from public.dam_search_documents d
     where d.has_default_visible_member is null or d.default_visible_min_date is distinct from v_min
     limit greatest(p_limit, 0)
  loop
    perform public.dam_refresh_default_visible_flag(r.document_type, r.entity_id);
    commit;
  end loop;
end
$f$;

revoke all on procedure public.dam_sweep_default_visible_flags_batched(integer) from public, anon, authenticated;

revoke all on function public.dam_default_visible_member(text,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.dam_refresh_default_visible_flag(text,uuid) from public, anon, authenticated;
revoke all on function public.dam_search_documents_set_default_visible() from public, anon, authenticated;
revoke all on function public.assets_refresh_default_visible_flags() from public, anon, authenticated;
revoke all on function public.dam_sweep_default_visible_flags(integer) from public, anon, authenticated;

revoke all on function public.dam_lock_default_visible_owner(text,uuid) from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule upserts by name, replacing 060723's 20,000-per-5-minutes job on preview.
    perform cron.schedule('dam-default-visible-flag-sweep', '* * * * *',
      'call public.dam_sweep_default_visible_flags_batched(5000)');
  end if;
end
$cron$;

CREATE OR REPLACE FUNCTION public.search_dam_documents(p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real)
 RETURNS TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '30s'
AS $function$
  select set_config('hnsw.ef_search', '100', true);
  select set_config('hnsw.iterative_scan', 'relaxed_order', true);
  select set_config('hnsw.max_scan_tuples', '20000', true);
  with params as materialized (
    select nullif(trim(p_query),'') query_text,
      greatest(1,least(coalesce(p_limit,100),20000)) page_limit,
      greatest(coalesce(p_offset,0),0) page_offset,
      greatest(coalesce(p_min_rank,0),0)::real min_rank,
      case when p_min_semantic_score is null then null
        else greatest(0,least(1,p_min_semantic_score))::real end min_semantic_score,
      case when p_query_embedding is null then false else true end has_embedding,
      1000 summary_probe_limit
    where public.require_dam_access()
  ), queries as materialized (
    select q.query_text, websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g')) tsq,
      '%' || replace(replace(replace(q.query_text, '\', '\\'), '%', '\%'), '_', '\_') || '%' like_pattern,
      (length(q.query_text) >= 3 and q.query_text ~ '[[:alnum:]]{3,}'
        and (length(q.query_text) >= 4 or q.query_text ~ '[0-9]')) allow_substring
    from params p cross join public.expand_dam_search_queries(p.query_text) q
    where p.query_text is not null
      and websearch_to_tsquery('simple', regexp_replace(q.query_text, '[-_/]+', ' ', 'g'))::text <> ''
  ), distinct_queries as materialized (
    select distinct q.query_text, q.tsq, q.allow_substring, q.like_pattern,
      btrim(lower(regexp_replace(btrim(q.query_text), '[-_/[:space:]]+', ' ', 'g'))) normalized_query,
      regexp_replace(q.query_text, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') regex_literal
    from queries q
  ), substring_regex as materialized (
    select '(' || string_agg(distinct q.regex_literal, '|') || ')' rx
    from distinct_queries q where q.allow_substring
  ), rank_queries as materialized (
    select q.normalized_query, q.tsq,
      coalesce(array_agg(distinct q.like_pattern) filter (where q.allow_substring), '{}'::text[]) like_patterns
    from distinct_queries q
    group by q.normalized_query, q.tsq
  ), full_text_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.title_key,d.title_tsv
    from public.dam_search_keys d
    where (p_document_types is null or d.document_type = any(p_document_types))
      and d.search_tsv @@ any(array(select distinct q.tsq from queries q))
  ), substring_matches as materialized (
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,d.title,d.path,d.customer,d.program,d.title_key,d.title_tsv
    from substring_regex r
    join public.dam_search_keys d on r.rx is not null and
      (d.title ~* r.rx or d.path ~* r.rx or d.customer ~* r.rx or d.program ~* r.rx)
    where (p_document_types is null or d.document_type = any(p_document_types))
  ), keyword_features as materialized (
    select m.document_type,m.entity_id,m.asset_id,m.style_group_id,m.in_substring,
      m.title,m.path,m.customer,m.program,
      m.title_key,m.title_tsv
    from (
      select f.document_type,f.entity_id,f.asset_id,f.style_group_id,f.title,f.title_key,f.title_tsv,
        s.path,s.customer,s.program,(s.entity_id is not null) in_substring
      from full_text_matches f
      left join substring_matches s
        on s.document_type = f.document_type and s.entity_id = f.entity_id
      union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.title,s.title_key,s.title_tsv,
        s.path,s.customer,s.program,true
      from substring_matches s
      where not exists (
        select 1 from full_text_matches f
        where f.document_type = s.document_type and f.entity_id = s.entity_id)
    ) m
  ), keyword_candidates as materialized (
    select k.document_type,k.entity_id,k.asset_id,k.style_group_id,
      (select max(
        case
          when k.title_key = q.normalized_query then 1.0
          when k.in_substring and k.title ilike any(q.like_patterns) then 0.6
          when k.title_tsv @@ q.tsq then 0.45
          when k.in_substring and k.path ilike any(q.like_patterns) then 0.3
          when k.in_substring and (k.customer ilike any(q.like_patterns) or k.program ilike any(q.like_patterns)) then 0.2
          else 0.1
        end
        + 0.09 * least(1.0, length(q.normalized_query)::numeric / greatest(length(k.title_key),1))
      ) from rank_queries q)::real keyword_rank
    from keyword_features k
  ), semantic_ann as materialized (
    -- HNSW leg: used whenever assets are searched. hnsw.iterative_scan=relaxed_order
    -- (set_config at the top of the body) keeps scanning past ef_search until the post-filtered
    -- LIMIT is met, instead of stopping at the ~100-row candidate list (#4664).
    -- HNSW returns distance order; do NOT add a secondary sort key here.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join public.dam_search_documents d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    -- also used for any requested type that has no exact leg (anything but style_group; #4664 M2).
    -- This constant test must stay in WHERE: it becomes a one-time filter that
    -- skips the scan. Behind only the params join, a keyword-only call (null
    -- embedding) walks ~24k HNSW tuples for nothing: 19 s, up to the 30 s limit.
    where p_query_embedding is not null
      and (p_document_types is null
        or exists (select 1 from unnest(p_document_types) t where t is distinct from 'style_group'))
      and (p_document_types is null or d.document_type = any(p_document_types))
    order by d.embedding <=> p_query_embedding
    limit 2000
  ), semantic_exact as materialized (
    -- Exact leg: when assets are NOT searched (style groups only, ~6k vectors; the
    -- only other document type),
    -- a filtered HNSW walk must cross ~25x more asset tuples than it keeps (15 s for
    -- 964 rows on production). An exact distance sort over the pkey range is ~0.1 s.
    -- "+ 0" keeps the planner off the HNSW index on purpose.
    select d.document_type,d.entity_id,d.asset_id,d.style_group_id,
      greatest(0,1-(d.embedding <=> p_query_embedding))::real semantic_rank
    from params p
    join dam.search_group_vectors d
      on p.has_embedding
      and d.embedding is not null
      and d.embedding_model = 'google/siglip2-base-patch16-naflex'
    where p_document_types is not null and not ('asset' = any(p_document_types))
      and 'style_group' = any(p_document_types)
      and d.document_type = 'style_group'  -- literal: a parameter here makes the planner seq-scan (3.5 s)
    order by (d.embedding <=> p_query_embedding) + 0
    limit 2000
  ), semantic_candidates as materialized (
    -- threshold applied after the legs so it never extends the HNSW walk (#4664 M1).
    select s.document_type,s.entity_id,s.asset_id,s.style_group_id,s.semantic_rank from (
      select * from semantic_ann
      union all
      select * from semantic_exact
    ) s
    cross join params p
    where p.min_semantic_score is null
       or s.semantic_rank >= p.min_semantic_score
  ), candidate_ranks as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,max(c.keyword_rank)::real keyword_rank,
      max(c.semantic_rank)::real semantic_rank,
      (coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35)::real rank
    from (select k.*,null::real semantic_rank from keyword_candidates k union all
      select s.document_type,s.entity_id,s.asset_id,s.style_group_id,null::real,s.semantic_rank from semantic_candidates s) c
    group by c.document_type,c.entity_id,c.asset_id,c.style_group_id
    having coalesce(max(c.keyword_rank),0) + coalesce(max(c.semantic_rank),0) * 0.35 >= (select min_rank from params)
  ), ordered_candidates as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      row_number() over (order by c.rank desc, c.document_type, c.entity_id) rn
    from candidate_ranks c
  ), candidate_asset_ids as not materialized (
    select c.document_type, c.entity_id, c.asset_id, c.style_group_id,
      c.keyword_rank, c.semantic_rank, c.rank, x.id, c.rn
    from (select * from ordered_candidates order by rn) c
    join lateral (
      select c.asset_id id where c.document_type='asset' and c.asset_id is not null
      union all
      select m.id from public.assets m
      where c.document_type='style_group' and c.style_group_id is not null
        and m.style_group_id=c.style_group_id and not m.is_deleted
    ) x on true
  ), visibility_params as materialized (
    select coalesce(p_filters,'{}'::jsonb)-'search' f,
    public.assets_thumbnail_min_date() thumbnail_min_date
  ), visible_assets as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,c.keyword_rank,c.semantic_rank,c.rank,
      a.id, a.style_group_id asset_style_group_id, a.file_type, a.status,
      a.workflow_status, a.stage, a.is_licensed, c.rn
    from candidate_asset_ids c
    join public.assets a on a.id = c.id
    left join public.style_groups sg on sg.id=a.style_group_id
    cross join visibility_params v
    where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
    order by c.rn
    limit (select summary_probe_limit + 1 from params)
  ), probe_state as materialized (
    select count(*) > (select summary_probe_limit from params) truncated
    from visible_assets
  ), summary_assets as materialized (
    select a.document_type,a.entity_id,a.asset_id,a.style_group_id,a.keyword_rank,a.semantic_rank,a.rank,
      a.id,a.asset_style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed,a.rn
    from visible_assets a
    where not (select truncated from probe_state)
       or a.rn < (select max(x.rn) from visible_assets x)
  ), matched_assets as materialized (
    select distinct a.id,a.asset_style_group_id style_group_id,a.file_type,a.status,a.workflow_status,a.stage,a.is_licensed from summary_assets a
  ), page_documents as materialized (
    select c.document_type,c.entity_id,c.asset_id,c.style_group_id,
      c.keyword_rank,c.semantic_rank,c.rank,c.rn
    from (select * from ordered_candidates order by rn) c
    where coalesce((
      select true
      from (
        select c.asset_id id where c.document_type='asset' and c.asset_id is not null
        union all
        select m.id from public.assets m
        where c.document_type='style_group' and c.style_group_id is not null
          and m.style_group_id=c.style_group_id and not m.is_deleted
      ) x
      join public.assets a on a.id = x.id
      left join public.style_groups sg on sg.id=a.style_group_id
      cross join visibility_params v
      where public.dam_asset_matches_filters(
          a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
          a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
          a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
          a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
          a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
          v.f, v.thumbnail_min_date)
      limit 1
    ), false)
    order by c.rn
    limit (select page_offset + page_limit + 1 from params)
  ), page_state as materialized (
    select count(*) visible_through_page from page_documents
  ), default_flag_state as materialized (
    -- #5747 Step 5: unfiltered exact-count fast path. Usable only when the
    -- request has no filters AND every candidate document carries a flag
    -- computed with the CURRENT thumbnail min date for the same members.
    -- Any doubt falls back to the per-document probe below (exact either way).
    select count(*) filter (where d.has_default_visible_member) flagged_visible,
      coalesce(bool_and(d.has_default_visible_member is not null
        and d.default_visible_min_date = v.thumbnail_min_date
        and d.asset_id is not distinct from c.asset_id
        and d.style_group_id is not distinct from c.style_group_id), true) all_current
    from visibility_params v
    join ordered_candidates c on v.f = '{}'::jsonb
    left join public.dam_search_documents d
      on d.document_type = c.document_type and d.entity_id = c.entity_id
    group by v.thumbnail_min_date
  ), exact_docs as materialized (
    -- Owner ask 2026-10-29 (issue #5053): totals must be exact, never lower
    -- bounds. Fast path (#5747): unfiltered request with every flag current
    -- -> count maintained flags. Otherwise count EVERY candidate document
    -- that has at least one member asset passing the same visibility
    -- predicate, short-circuiting per document (LIMIT 1).
    select case
      when (select f from visibility_params) = '{}'::jsonb
       and coalesce((select all_current from default_flag_state), true)
      then coalesce((select flagged_visible from default_flag_state), 0)
      else (
        select count(*) from (
          select c.document_type, c.entity_id
          from ordered_candidates c
          where exists (
            select 1
            from (
              select c.asset_id id where c.document_type='asset' and c.asset_id is not null
              union all
              select m.id from public.assets m
              where c.document_type='style_group' and c.style_group_id is not null
                and m.style_group_id=c.style_group_id and not m.is_deleted
            ) x
            join public.assets a on a.id = x.id
            left join public.style_groups sg on sg.id=a.style_group_id
            cross join visibility_params v
            where public.dam_asset_matches_filters(
              a.id, a.is_deleted, a.modified_at, a.file_created_at, a.thumbnail_url,
              a.style_group_id, a.licensor_id, sg.licensor_id, a.property_id, sg.property_id,
              a.customer_id, sg.customer_id, a.file_type, a.content_type, a.product_material,
              a.status, a.workflow_status, a.stage, a.is_licensed, a.asset_type, a.art_source,
              a.thumbnail_error, a.product_category, a.relative_path, a.customer, a.program,
              v.f, v.thumbnail_min_date)
            limit 1
          )
        ) d
      )
    end total_count
  ), summary as materialized (
    select
      (select total_count from exact_docs) total_count,
      case when (select truncated from probe_state)
        -- Facet aggregates count assets, and the probe sees only the first
        -- 1,001; past the cap the per-key counts would be lower bounds, which
        -- the owner ruled out. Emit only the exactness flags; the filter
        -- sidebar shows blanks instead of under-counts (documented fallback
        -- shape, still exact totals).
        then jsonb_build_object(
          'fileType','{}'::jsonb,'status','{}'::jsonb,'workflowStatus','{}'::jsonb,'stage','{}'::jsonb,'isLicensed','{}'::jsonb,
          'totalExact',true,'totalKind','exact')
        else jsonb_build_object(
      'fileType',coalesce((select jsonb_object_agg(k,c) from (select file_type::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'status',coalesce((select jsonb_object_agg(k,c) from (select status::text k,count(*) c from matched_assets group by 1)x),'{}'::jsonb),
      'workflowStatus',coalesce((select jsonb_object_agg(k,c) from (select workflow_status::text k,count(*) c from matched_assets where workflow_status is not null group by 1)x),'{}'::jsonb),
      'stage',coalesce((select jsonb_object_agg(k,c) from (select stage k,count(*) c from matched_assets where stage is not null group by 1)x),'{}'::jsonb),
      'isLicensed',jsonb_build_object('true',(select count(*) from matched_assets where is_licensed is true),'false',(select count(*) from matched_assets where is_licensed is not true)),
      'totalExact',true,
      'totalKind','exact'
    ) end facets
    -- from (select 1): summary is ALWAYS exactly one row, including the
    -- no-match query (total 0). Every select-list item is a scalar
    -- subquery, so a constant anchor row yields the same values as any
    -- matched_assets row would.
    from (select 1) as summary_anchor
  ), page as materialized (
    select r.document_type,r.entity_id,r.asset_id,r.style_group_id,r.keyword_rank,r.semantic_rank,r.rank
    from page_documents r order by r.rn
    offset (select page_offset from params) limit (select page_limit from params)
  )
  select p.document_type,p.entity_id,p.asset_id,p.style_group_id,p.keyword_rank,p.semantic_rank,p.rank,
    s.total_count,
    (select visible_through_page from page_state) > (select page_offset+page_limit from params),
    s.facets
  from summary s
  left join page p on true
  order by p.rank desc nulls last, p.document_type nulls last, p.entity_id nulls last;
$function$;

do $guard$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.search_dam_documents(text,jsonb,integer,integer,text[],extensions.vector,real,real)')
      and md5(p.prosrc)='0c040b9c12a8cf5bea4582ea6404c03b' and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='s' and p.proretset
      and pg_get_function_arguments(p.oid)='p_query text, p_filters jsonb, p_limit integer, p_offset integer, p_document_types text[] DEFAULT NULL::text[], p_query_embedding vector DEFAULT NULL::vector, p_min_rank real DEFAULT 0, p_min_semantic_score real DEFAULT NULL::real'
      and pg_get_function_result(p.oid)='TABLE(document_type text, entity_id uuid, asset_id uuid, style_group_id uuid, keyword_rank real, semantic_rank real, rank real, total_count bigint, has_more boolean, facets jsonb)'
      and p.proconfig=ARRAY['search_path=public, extensions','statement_timeout=30s']::text[]
      and p.proacl::text='{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}') then
    raise exception '#5747 installed search contract differs; reconcile rather than overwrite';
  end if;
end;
$guard$;

commit;
