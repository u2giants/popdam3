-- PopDAM #1427 recovery B: bounded reconciliation and final activation.
-- GitHub: u2giants/shared-db#1479, #1474, #1427; u2giants/popdam3#96, #97.
-- Prerequisite 20260825041343 installs nullable columns and recovery indexes.
set statement_timeout = '10min';
begin;

-- A pending reconciliation marker is not proof that hardening is missing.
-- Preview already carries the complete historical contract, so capture that
-- truth before replacing the marker. This probe intentionally covers every
-- lock-taking contract family and its callable/security surface.
select set_config(
  'popdam.final_contract_complete',
  case when
    (select count(*) = 4 from information_schema.columns
      where table_schema='public' and table_name='asset_tags'
        and column_name in ('category','status','evidence','updated_at')
        and is_nullable='NO')
    and (select count(*) = 6 from pg_constraint
      where conrelid='public.asset_tags'::regclass and convalidated
        and conname in ('asset_tags_tag_normalized_check','asset_tags_source_normalized_check',
          'asset_tags_category_check','asset_tags_status_check','asset_tags_confidence_check',
          'asset_tags_rejection_check'))
    and to_regclass('public.style_group_tags') is not null
    and to_regclass('public.dam_search_documents') is not null
    and (select count(*) = 5 from information_schema.columns
      where table_schema='public' and table_name='style_groups'
        and column_name in ('group_ai_description','group_ai_description_source',
          'group_ai_description_model','group_ai_tagged_at','group_ai_evidence_asset_ids'))
    and (select count(*) = 7 from information_schema.columns
      where table_schema='public' and table_name='dam_search_documents'
        and column_name in ('embedding_lease_token','embedding_lease_owner','embedding_lease_expires_at',
          'embedding_attempts','embedding_max_attempts','embedding_error_category','embedding_next_retry_at'))
    and (select count(*) = 2 from pg_constraint
      where conrelid=to_regclass('public.dam_search_documents') and convalidated
        and conname in ('dam_search_embedding_attempts_check','dam_search_embedding_error_category_check'))
    and (select count(*) = 3 from pg_constraint
      where conrelid=to_regclass('public.style_group_tags') and convalidated
        and conname in ('style_group_tags_unique','style_group_tags_source_normalized_check',
          'style_group_tags_rejection_check'))
    and to_regclass('public.style_group_tags_active_group_idx') is not null
    and to_regclass('public.asset_tags_active_asset_idx') is not null
    and to_regclass('public.dam_search_embedding_claim_idx') is not null
    and (select relrowsecurity from pg_class where oid=to_regclass('public.style_group_tags'))
    and exists (select 1 from pg_policy where polrelid=to_regclass('public.style_group_tags')
      and polname='Authenticated read style_group_tags' and polcmd='r'
      and to_regrole('authenticated')=any(polroles) and pg_get_expr(polqual,polrelid)='true')
    and exists (select 1 from pg_policy where polrelid=to_regclass('public.style_group_tags')
      and polname='Admin manage style_group_tags' and polcmd='*'
      and to_regrole('authenticated')=any(polroles)
      and pg_get_expr(polqual,polrelid) like '%has_role%admin%'
      and pg_get_expr(polwithcheck,polrelid) like '%has_role%admin%')
    and to_regprocedure('public.sync_asset_tags_to_array()') is not null
    and to_regprocedure('public.refresh_dam_search_asset_document(uuid)') is not null
    and to_regprocedure('public.refresh_dam_search_style_group_document(uuid)') is not null
    and to_regprocedure('public.refresh_dam_search_documents_batch(uuid[],uuid[],integer)') is not null
    and to_regprocedure('public.trg_refresh_dam_tag_or_character()') is not null
    and to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])') is not null
    and to_regprocedure('public.replace_asset_ai_tag_result(uuid,text,text,jsonb)') is not null
    and to_regprocedure('public.get_effective_asset_metadata(uuid)') is not null
    and to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is not null
    and to_regprocedure('public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector,text)') is not null
    and to_regprocedure('public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text)') is not null
    and to_regprocedure('public.get_dam_search_embedding_status()') is not null
    and to_regprocedure('public.reset_dam_search_embedding_errors(text,uuid[])') is not null
    and (select count(*) = 4 from pg_trigger where not tgisinternal and tgenabled <> 'D' and (
      (tgrelid=to_regclass('public.asset_tags') and tgname='asset_tags_sync_assets_tags'
        and tgfoid=to_regprocedure('public.sync_asset_tags_to_array()'))
      or (tgrelid=to_regclass('public.asset_tags') and tgname='asset_tags_dam_search_refresh'
        and tgfoid=to_regprocedure('public.trg_refresh_dam_tag_or_character()'))
      or (tgrelid=to_regclass('public.style_group_tags') and tgname='style_group_tags_dam_search_refresh'
        and tgfoid=to_regprocedure('public.trg_refresh_dam_tag_or_character()'))
      or (tgrelid=to_regclass('public.asset_characters') and tgname='asset_characters_dam_search_refresh'
        and tgfoid=to_regprocedure('public.trg_refresh_dam_tag_or_character()'))))
    and has_table_privilege('authenticated',to_regclass('public.style_group_tags'),'SELECT')
    and has_table_privilege('service_role',to_regclass('public.style_group_tags'),'SELECT')
    and has_function_privilege('service_role',to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])'),'EXECUTE')
    and has_function_privilege('service_role',to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)'),'EXECUTE')
    and not has_function_privilege('authenticated',to_regprocedure('public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[])'),'EXECUTE')
    and not has_function_privilege('authenticated',to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)'),'EXECUTE')
    then 'on' else 'off' end,
  false
);

-- One canonical probe governs every bounded phase. Preview already has this
-- complete contract from its truthful historical ledger, so B must not walk
-- millions of rows there. Production after prerequisite A lacks these objects
-- and therefore performs the full bounded reconciliation.
select set_config(
  'popdam.recovery_b_needed',
  case when (to_regclass('public.style_group_tags') is not null
         and to_regclass('public.dam_search_documents') is not null
         and to_regprocedure('public.get_effective_asset_metadata(uuid)') is not null
         and to_regprocedure('public.claim_dam_search_embedding_documents(integer,text,integer)') is not null)
         or exists (
           select 1 from pg_attribute a
           where a.attrelid='public.asset_tags'::regclass and a.attname='category'
             and col_description(a.attrelid,a.attnum)=
               'PopDAM #1479 reconciliation complete; final activation pending.'
         )
       then 'off' else 'on' end,
  true
);

-- Suppress the legacy row trigger without taking a table-level trigger DDL lock.
-- This setting is transaction-local; any failure restores normal replication role.
set local session_replication_role = replica;

create table pg_temp.popdam_1479_cursor (
  phase text primary key,
  last_uuid uuid,
  processed bigint not null default 0
) on commit drop;

insert into pg_temp.popdam_1479_cursor(phase) values
  ('legacy_import'), ('dedupe'), ('normalize'), ('compatibility_rebuild');

create or replace function pg_temp.popdam_1479_import_legacy_batch(p_limit integer)
returns integer language plpgsql as $fn$
declare v_count integer; v_last uuid;
begin
  if current_setting('popdam.recovery_b_needed') <> 'on' then return 0; end if;
  select last_uuid into v_last from pg_temp.popdam_1479_cursor where phase='legacy_import' for update;
  with batch as (
    select a.id from public.assets a
    where (v_last is null or a.id > v_last) and cardinality(coalesce(a.tags, '{}')) > 0
    order by a.id limit greatest(1, least(p_limit, 10000))
  ), inserted as (
    insert into public.asset_tags(asset_id,tag,source,category,status,evidence,created_at,updated_at)
    select a.id,btrim(t.tag),'manual','other','active',jsonb_build_object('legacy_assets_tags',true),
      coalesce(a.created_at,now()),now()
    from batch b join public.assets a on a.id=b.id
    cross join lateral unnest(coalesce(a.tags,'{}'::text[])) t(tag)
    where nullif(btrim(t.tag),'') is not null
    on conflict(asset_id,tag) do nothing returning 1
  ) select count(*),(select id from batch order by id desc limit 1) into v_count,v_last from inserted;
  if v_last is not null then
    update pg_temp.popdam_1479_cursor set last_uuid=v_last,processed=processed+v_count where phase='legacy_import';
  end if;
  return coalesce(v_count,0);
end $fn$;

create or replace function pg_temp.popdam_1479_dedupe_batch(p_limit integer)
returns integer language plpgsql as $fn$
declare v_count integer; v_last uuid;
begin
  if current_setting('popdam.recovery_b_needed') <> 'on' then return 0; end if;
  select last_uuid into v_last from pg_temp.popdam_1479_cursor where phase='dedupe' for update;
  with batch_assets as (
    select distinct t.asset_id from public.asset_tags t
    where v_last is null or t.asset_id>v_last order by t.asset_id
    limit greatest(1,least(p_limit,10000))
  ), ranked as (
    select t.id,row_number() over(partition by t.asset_id,btrim(t.tag)
      order by case when t.source='manual' or t.created_by is not null then 0 else 1 end,t.created_at,t.id) rn
    from public.asset_tags t join batch_assets b on b.asset_id=t.asset_id
  ), removed as (
    delete from public.asset_tags t using ranked r where t.id=r.id and r.rn>1 returning 1
  ) select count(*),(select asset_id from batch_assets order by asset_id desc limit 1) into v_count,v_last from removed;
  if v_last is not null then
    update pg_temp.popdam_1479_cursor set last_uuid=v_last,processed=processed+v_count where phase='dedupe';
  end if;
  return coalesce(v_count,0);
end $fn$;

create or replace function pg_temp.popdam_1479_normalize_batch(p_limit integer)
returns integer language plpgsql as $fn$
declare v_count integer; v_last uuid; v_next uuid;
begin
  if current_setting('popdam.recovery_b_needed') <> 'on' then return 0; end if;
  select last_uuid into v_last from pg_temp.popdam_1479_cursor where phase='normalize' for update;
  with batch as (
    select id from public.asset_tags
    where id > coalesce(v_last, '00000000-0000-0000-0000-000000000000'::uuid)
      and (tag is distinct from btrim(tag) or source is distinct from btrim(source)
       or category is null or status is null or source is null or source='')
    order by id limit greatest(1,least(p_limit,10000)) for update skip locked
  ), changed as (
    update public.asset_tags t set
      tag=btrim(t.tag),
      source=case when btrim(coalesce(t.source,''))='ai' then 'ai'
                  else coalesce(nullif(btrim(t.source),''),'manual') end,
      category=case when btrim(coalesce(t.source,''))='ai' then 'legacy_unscoped'
                    else coalesce(t.category,'other') end,
      status=coalesce(t.status,'active'),
      evidence=coalesce(t.evidence,'{}'::jsonb),
      updated_at=coalesce(t.updated_at,now())
    from batch b where t.id=b.id returning t.id
  ) select count(*), (array_agg(id order by id desc))[1] into v_count, v_next from changed;
  if v_next is not null then
    update pg_temp.popdam_1479_cursor set last_uuid=v_next,processed=processed+v_count where phase='normalize';
  end if;
  return v_count;
end $fn$;

create or replace function pg_temp.popdam_1479_rebuild_batch(p_limit integer)
returns integer language plpgsql as $fn$
declare v_count integer; v_last uuid;
begin
  if current_setting('popdam.recovery_b_needed') <> 'on' then return 0; end if;
  select last_uuid into v_last from pg_temp.popdam_1479_cursor where phase='compatibility_rebuild' for update;
  with batch_ids as (
    select distinct t.asset_id from public.asset_tags t
    where v_last is null or t.asset_id>v_last order by t.asset_id
    limit greatest(1,least(p_limit,10000))
  ), desired as (
    select b.asset_id,coalesce(array_agg(t.tag order by lower(t.tag),t.tag)
      filter(where t.status='active'),'{}'::text[]) tags
    from batch_ids b join public.asset_tags t on t.asset_id=b.asset_id group by b.asset_id
  ), changed as (
    update public.assets a set tags=d.tags from desired d
    where a.id=d.asset_id and a.tags is distinct from d.tags returning 1
  ) select count(*),(select asset_id from batch_ids order by asset_id desc limit 1) into v_count,v_last from changed;
  if v_last is not null then
    update pg_temp.popdam_1479_cursor set last_uuid=v_last,processed=processed+v_count where phase='compatibility_rebuild';
  end if;
  return coalesce(v_count,0);
end $fn$;

-- TOP_LEVEL_BATCH_CALLS are expanded below. Each invocation is a separately
-- timed SQL statement; the helpers return zero after their keyspace is exhausted.
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);
select pg_temp.popdam_1479_import_legacy_batch(5000);

-- Deterministic duplicate collapse after legacy import, keyset-batched by asset.
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);
select pg_temp.popdam_1479_dedupe_batch(5000);

select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);
select pg_temp.popdam_1479_normalize_batch(5000);

do $assert$ begin
  if current_setting('popdam.recovery_b_needed') = 'on' and exists(select 1 from public.asset_tags where tag is distinct from btrim(tag) or nullif(tag,'') is null
    or source is distinct from btrim(source) or nullif(source,'') is null or category is null or status is null
    or evidence is null or updated_at is null) then
    raise exception 'PopDAM #1479 normalization incomplete';
  end if;
  if current_setting('popdam.recovery_b_needed') = 'on' and exists (
    select 1 from public.assets a cross join lateral unnest(coalesce(a.tags,'{}'::text[])) x(tag)
    where nullif(btrim(x.tag),'') is not null
      and not exists(select 1 from public.asset_tags t where t.asset_id=a.id and t.tag=btrim(x.tag))
  ) then
    raise exception 'PopDAM #1479 legacy import incomplete';
  end if;
end $assert$;

select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);
select pg_temp.popdam_1479_rebuild_batch(10000);

do $assert$ begin
  if current_setting('popdam.recovery_b_needed') = 'on' and exists (select 1 from public.assets a join public.asset_tags t on t.asset_id=a.id
    group by a.id,a.tags having a.tags is distinct from coalesce(array_agg(t.tag order by lower(t.tag),t.tag)
      filter(where t.status='active'),'{}'::text[])) then
    raise exception 'PopDAM #1479 compatibility rebuild incomplete';
  end if;
end $assert$;

set local session_replication_role = origin;

-- Durable retry boundary: if final hardening is
-- interrupted, the next run skips the already-committed large reconciliation.
comment on column public.asset_tags.category is
  'PopDAM #1479 reconciliation complete; final activation pending.';
commit;

-- Deliberately retain both prerequisite-A indexes as compatibility recovery
-- indexes. Even DROP INDEX CONCURRENTLY can wait indefinitely for persistent
-- old snapshots, so index cleanup must never gate activation. They are harmless
-- after reconciliation, keep retry/repair paths indexed, and may be reconsidered
-- only by a separately governed migration with independent live-traffic proof.

begin;

create or replace function pg_temp.popdam_1479_apply_final_ddl(p_sql text)
returns boolean language plpgsql as $apply$
begin
  if current_setting('popdam.final_contract_complete') = 'on' then
    return false;
  end if;
  execute p_sql;
  return true;
end $apply$;

select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags add constraint asset_tags_category_nn_recovery_check check (category is not null) not valid');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags add constraint asset_tags_status_nn_recovery_check check (status is not null) not valid');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags add constraint asset_tags_evidence_nn_recovery_check check (evidence is not null) not valid');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags add constraint asset_tags_updated_at_nn_recovery_check check (updated_at is not null) not valid');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_category_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_status_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_evidence_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_updated_at_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags alter column category set not null');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags alter column status set not null');
select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.asset_tags alter column evidence set default '{}'::jsonb$ddl$);
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags alter column evidence set not null');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags alter column updated_at set default now()');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags alter column updated_at set not null');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags drop constraint asset_tags_category_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags drop constraint asset_tags_status_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags drop constraint asset_tags_evidence_nn_recovery_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags drop constraint asset_tags_updated_at_nn_recovery_check');

select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.asset_tags
  drop constraint if exists asset_tags_tag_normalized_check,
  drop constraint if exists asset_tags_source_normalized_check,
  drop constraint if exists asset_tags_category_check,
  drop constraint if exists asset_tags_status_check,
  drop constraint if exists asset_tags_confidence_check,
  drop constraint if exists asset_tags_rejection_check$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.asset_tags
  add constraint asset_tags_tag_normalized_check check (tag = btrim(tag) and tag <> '') not valid,
  add constraint asset_tags_source_normalized_check check (source = btrim(source) and source <> '') not valid,
  add constraint asset_tags_category_check check (category in
    ('file_type','view','scene','color','visible_content','technique','other','legacy_unscoped')) not valid,
  add constraint asset_tags_status_check check (status in ('active','candidate','rejected')) not valid,
  add constraint asset_tags_confidence_check check (confidence is null or confidence between 0 and 1) not valid,
  add constraint asset_tags_rejection_check check (
    (status = 'rejected' and rejected_at is not null) or
    (status <> 'rejected' and rejected_at is null and rejected_by is null)
  ) not valid$ddl$);
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_tag_normalized_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_source_normalized_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_category_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_status_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_confidence_check');
select pg_temp.popdam_1479_apply_final_ddl('alter table public.asset_tags validate constraint asset_tags_rejection_check');

select pg_temp.popdam_1479_apply_final_ddl($ddl$create table if not exists public.style_group_tags (
  id uuid primary key default gen_random_uuid(),
  style_group_id uuid not null references public.style_groups(id) on delete cascade,
  tag text not null check (tag = btrim(tag) and tag <> ''),
  category text not null check (category in
    ('product_type','theme','style','occasion','audience','technique','other')),
  source text not null default 'manual',
  status text not null default 'active' check (status in ('active','candidate','rejected')),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  model text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_group_tags_unique unique (style_group_id, tag),
  constraint style_group_tags_source_normalized_check check (source = btrim(source) and source <> ''),
  constraint style_group_tags_rejection_check check (
    (status = 'rejected' and rejected_at is not null) or
    (status <> 'rejected' and rejected_at is null and rejected_by is null)
  )
)$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create index if not exists style_group_tags_active_group_idx on public.style_group_tags(style_group_id, tag)
  where status = 'active'$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create index if not exists asset_tags_active_asset_idx on public.asset_tags(asset_id, tag)
  where status = 'active'$ddl$);

select pg_temp.popdam_1479_apply_final_ddl('alter table public.style_group_tags enable row level security');
select pg_temp.popdam_1479_apply_final_ddl('drop policy if exists "Authenticated read style_group_tags" on public.style_group_tags');
select pg_temp.popdam_1479_apply_final_ddl('drop policy if exists "Admin manage style_group_tags" on public.style_group_tags');
select pg_temp.popdam_1479_apply_final_ddl($ddl$create policy "Authenticated read style_group_tags" on public.style_group_tags
  for select to authenticated using (true);
 $ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create policy "Admin manage style_group_tags" on public.style_group_tags
  for all to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'))$ddl$);

select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.style_groups
  add column if not exists group_ai_description text,
  add column if not exists group_ai_description_source text,
  add column if not exists group_ai_description_model text,
  add column if not exists group_ai_tagged_at timestamptz,
  add column if not exists group_ai_evidence_asset_ids uuid[] not null default '{}'::uuid[]$ddl$);

select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.dam_search_documents
  drop constraint if exists dam_search_embedding_attempts_check,
  drop constraint if exists dam_search_embedding_error_category_check$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.dam_search_documents
  add column if not exists embedding_lease_token uuid,
  add column if not exists embedding_lease_owner text,
  add column if not exists embedding_lease_expires_at timestamptz,
  add column if not exists embedding_attempts integer not null default 0,
  add column if not exists embedding_max_attempts integer not null default 5,
  add column if not exists embedding_error_category text,
  add column if not exists embedding_next_retry_at timestamptz$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$alter table public.dam_search_documents
  add constraint dam_search_embedding_attempts_check check (
    embedding_attempts >= 0 and embedding_max_attempts between 1 and 20),
  add constraint dam_search_embedding_error_category_check check (
    embedding_error_category is null or embedding_error_category in ('transient','permanent'))$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create index if not exists dam_search_embedding_claim_idx on public.dam_search_documents(indexed_at, document_type, entity_id)
  where embedding is null$ddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.sync_asset_tags_to_array()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_asset_id uuid;
begin
  for v_asset_id in select distinct x from unnest(case when tg_op='INSERT' then array[new.asset_id]
    when tg_op='DELETE' then array[old.asset_id] else array[old.asset_id,new.asset_id] end) x loop
    update public.assets
    set tags = coalesce((select array_agg(t.tag order by lower(t.tag), t.tag)
                         from public.asset_tags t
                         where t.asset_id = v_asset_id and t.status = 'active'), '{}'::text[])
    where id = v_asset_id;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$$applyddl$);
select pg_temp.popdam_1479_apply_final_ddl('drop trigger if exists trg_sync_asset_tags on public.asset_tags');
select pg_temp.popdam_1479_apply_final_ddl('drop trigger if exists asset_tags_sync_assets_tags on public.asset_tags');
select pg_temp.popdam_1479_apply_final_ddl($ddl$create trigger asset_tags_sync_assets_tags after insert or update or delete on public.asset_tags
for each row execute function public.sync_asset_tags_to_array()$ddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.refresh_dam_search_asset_document(p_asset_id uuid)
returns void language plpgsql security definer set search_path = public, dam, extensions as $$
declare v_text text; v_hash text; v_old_group uuid; v_new_group uuid;
begin
  select style_group_id into v_old_group from public.dam_search_documents
  where document_type='asset' and entity_id=p_asset_id;
  if not exists (select 1 from public.assets where id=p_asset_id and is_deleted=false) then
    delete from public.dam_search_documents where document_type='asset' and entity_id=p_asset_id;
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    return;
  end if;
  select coalesce(concat_ws(' ', a.filename,a.relative_path,a.content_type,sg.item_description,
    sg.group_ai_description,a.cover_description,a.ai_description,a.scene_description,a.customer,a.program,
    case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
    case when a.style_group_id is null then a.property_name else sg.property_name end,
    a.product_category,array_to_string(a.product_material,' '),a.product_dimensions,
    dam.jsonb_leaf_text(sg.rich_metadata),pdf.txt,atg.tags,gtg.tags,chars.names), '')
  into v_text
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id
  left join lateral (select string_agg(p.extracted_text,' ' order by p.sampled_at desc) txt
    from public.pdf_text_samples p where p.asset_id=a.id and p.extracted_text is not null) pdf on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.asset_tags t where t.asset_id=a.id and t.status='active') atg on true
  left join lateral (select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags
    from public.style_group_tags t where t.style_group_id=a.style_group_id and t.status='active') gtg on true
  left join lateral (select string_agg(c.name,' ' order by lower(c.name),c.id) names
    from public.asset_characters ac join public.characters c on c.id=ac.character_id where ac.asset_id=a.id) chars on true
  where a.id=p_asset_id;
  v_hash := encode(digest(v_text,'sha256'),'hex');
  insert into public.dam_search_documents(document_type,entity_id,asset_id,style_group_id,title,path,customer,program,
    search_text,content_sha256,metadata,source_updated_at,indexed_at)
  select 'asset',a.id,a.id,a.style_group_id,coalesce(a.filename,''),coalesce(a.relative_path,''),a.customer,a.program,
    v_text,v_hash,jsonb_strip_nulls(jsonb_build_object('file_type',a.file_type,'asset_type',a.asset_type,
      'content_type',a.content_type,'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
      'product_material',a.product_material,'product_dimensions',a.product_dimensions,'workflow_status',a.workflow_status,
      'is_licensed',a.is_licensed,'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
      'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
      'product_category',a.product_category,'thumbnail_url',a.thumbnail_url)),
    greatest(coalesce(a.updated_at,'-infinity'),coalesce(a.modified_at,'-infinity')),now()
  from public.assets a left join public.style_groups sg on sg.id=a.style_group_id where a.id=p_asset_id and not a.is_deleted
  on conflict(document_type,entity_id) do update set asset_id=excluded.asset_id,style_group_id=excluded.style_group_id,
    title=excluded.title,path=excluded.path,customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,
    content_sha256=excluded.content_sha256,metadata=excluded.metadata,source_updated_at=excluded.source_updated_at,indexed_at=now(),
    embedding=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding end,
    embedding_model=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null,embedding_next_retry_at=null;
  select style_group_id into v_new_group from public.assets where id=p_asset_id;
  if v_old_group is distinct from v_new_group then
    if v_old_group is not null then perform public.refresh_dam_search_style_group_document(v_old_group); end if;
    if v_new_group is not null then perform public.refresh_dam_search_style_group_document(v_new_group); end if;
  end if;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.refresh_dam_search_style_group_document(p_style_group_id uuid)
returns void language plpgsql security definer set search_path = public, dam, extensions as $$
declare v_text text; v_hash text;
begin
  if not exists(select 1 from public.style_groups where id=p_style_group_id) then
    delete from public.dam_search_documents where document_type='style_group' and entity_id=p_style_group_id; return;
  end if;
  select coalesce(concat_ws(' ',sg.sku,sg.folder_path,sg.cover_description,sg.item_description,sg.group_ai_description,
    dam.jsonb_leaf_text(sg.rich_metadata),sg.customer,sg.program,sg.licensor_name,sg.property_name,sg.product_category,
    sg.division_name,sg.mg01_name,sg.mg02_name,sg.mg03_name,sg.size_name,gtg.tags,chars.names),'') into v_text
  from public.style_groups sg
  left join lateral(select string_agg(t.tag,' ' order by lower(t.tag),t.tag) tags from public.style_group_tags t
    where t.style_group_id=sg.id and t.status='active') gtg on true
  left join lateral(select string_agg(c.name,' ' order by lower(c.name),c.id) names from public.assets a
    join public.asset_characters ac on ac.asset_id=a.id join public.characters c on c.id=ac.character_id
    where a.style_group_id=sg.id and not a.is_deleted) chars on true where sg.id=p_style_group_id;
  v_hash:=encode(digest(v_text,'sha256'),'hex');
  insert into public.dam_search_documents(document_type,entity_id,style_group_id,title,path,customer,program,search_text,
    content_sha256,metadata,source_updated_at,indexed_at)
  select 'style_group',sg.id,sg.id,coalesce(sg.sku,''),coalesce(sg.folder_path,''),sg.customer,sg.program,v_text,v_hash,
    jsonb_strip_nulls(jsonb_build_object('asset_count',sg.asset_count,'workflow_status',sg.workflow_status,
      'is_licensed',sg.is_licensed,'licensor_name',sg.licensor_name,'property_name',sg.property_name,
      'product_category',sg.product_category,'item_description_source',sg.item_description_source,
      'group_ai_description_source',sg.group_ai_description_source,'group_ai_description_model',sg.group_ai_description_model,
      'rich_metadata_source',sg.rich_metadata_source,'thumbnail_url',sg.primary_thumbnail_url)),
    greatest(coalesce(sg.updated_at,'-infinity'),coalesce(sg.latest_file_date,'-infinity')),now()
  from public.style_groups sg where sg.id=p_style_group_id
  on conflict(document_type,entity_id) do update set style_group_id=excluded.style_group_id,title=excluded.title,path=excluded.path,
    customer=excluded.customer,program=excluded.program,search_text=excluded.search_text,content_sha256=excluded.content_sha256,
    metadata=excluded.metadata,source_updated_at=excluded.source_updated_at,indexed_at=now(),
    embedding=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding end,
    embedding_model=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_model end,
    embedding_updated_at=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_updated_at end,
    embedding_error=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error end,
    embedding_error_category=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_error_category end,
    embedding_attempts=case when dam_search_documents.content_sha256=excluded.content_sha256 then dam_search_documents.embedding_attempts else 0 end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null,embedding_next_retry_at=null;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.refresh_dam_search_documents_batch(p_asset_ids uuid[] default '{}', p_style_group_ids uuid[] default '{}', p_limit int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_a int:=0; v_g int:=0; v_limit int:=greatest(1,least(coalesce(p_limit,500),1000));
begin
  for v_id in select distinct x from unnest(coalesce(p_asset_ids,'{}')) x order by x limit v_limit loop
    perform public.refresh_dam_search_asset_document(v_id); v_a:=v_a+1;
  end loop;
  for v_id in select distinct x from unnest(coalesce(p_style_group_ids,'{}')) x order by x limit greatest(0,v_limit-v_a) loop
    perform public.refresh_dam_search_style_group_document(v_id); v_g:=v_g+1;
  end loop;
  return jsonb_build_object('asset_documents',v_a,'style_group_documents',v_g,'bounded_limit',v_limit);
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.trg_refresh_dam_tag_or_character()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_assets uuid[]:='{}'; v_groups uuid[]:='{}';
begin
  if tg_table_name='style_group_tags' then
    v_groups:=case when tg_op='INSERT' then array[new.style_group_id] when tg_op='DELETE' then array[old.style_group_id]
      else array[old.style_group_id,new.style_group_id] end;
  else
    v_assets:=case when tg_op='INSERT' then array[new.asset_id] when tg_op='DELETE' then array[old.asset_id]
      else array[old.asset_id,new.asset_id] end;
    select coalesce(array_agg(distinct a.style_group_id) filter(where a.style_group_id is not null),'{}') into v_groups
    from public.assets a where a.id=any(v_assets);
  end if;
  perform public.refresh_dam_search_documents_batch(v_assets,v_groups,4);
  return case when tg_op='DELETE' then old else new end;
end $$$applyddl$);
select pg_temp.popdam_1479_apply_final_ddl('drop trigger if exists asset_tags_dam_search_refresh on public.asset_tags');
select pg_temp.popdam_1479_apply_final_ddl('drop trigger if exists style_group_tags_dam_search_refresh on public.style_group_tags');
select pg_temp.popdam_1479_apply_final_ddl('drop trigger if exists asset_characters_dam_search_refresh on public.asset_characters');
select pg_temp.popdam_1479_apply_final_ddl($ddl$create trigger asset_tags_dam_search_refresh after insert or update or delete on public.asset_tags
for each row execute function public.trg_refresh_dam_tag_or_character()$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create trigger style_group_tags_dam_search_refresh after insert or update or delete on public.style_group_tags
for each row execute function public.trg_refresh_dam_tag_or_character()$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$create trigger asset_characters_dam_search_refresh after insert or update or delete on public.asset_characters
for each row execute function public.trg_refresh_dam_tag_or_character()$ddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.replace_style_group_ai_profile(p_style_group_id uuid,p_source text,p_model text,
  p_description text,p_tags jsonb default '[]',p_evidence_asset_ids uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; v_count int;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  if p_style_group_id is null or nullif(btrim(p_source),'') is null or lower(btrim(p_source))='manual' or nullif(btrim(p_model),'') is null
     or jsonb_typeof(p_tags)<>'array' then raise exception 'invalid AI profile'; end if;
  if exists(select 1 from unnest(coalesce(p_evidence_asset_ids,'{}')) e left join public.assets a on a.id=e
            where a.id is null or a.style_group_id is distinct from p_style_group_id) then raise exception 'invalid evidence asset'; end if;
  update public.style_groups set group_ai_description=nullif(btrim(p_description),''),group_ai_description_source=p_source,
    group_ai_description_model=p_model,group_ai_tagged_at=now(),group_ai_evidence_asset_ids=coalesce(p_evidence_asset_ids,'{}')
  where id=p_style_group_id; if not found then raise exception 'style group not found'; end if;
  delete from public.style_group_tags where style_group_id=p_style_group_id and source=p_source and model=p_model
    and status in ('active','candidate') and created_by is null;
  for r in select value from jsonb_array_elements(p_tags) loop
    if coalesce(r->>'category','') not in ('product_type','theme','style','occasion','audience','technique','other')
       or coalesce(r->>'status','') not in ('active','candidate','rejected')
       or nullif(btrim(r->>'tag'),'') is null
       or (r ? 'confidence' and ((r->>'confidence')::numeric < 0 or (r->>'confidence')::numeric > 1)) then raise exception 'invalid group tag'; end if;
    insert into public.style_group_tags(style_group_id,tag,category,source,status,confidence,model,evidence,rejected_at)
    values(p_style_group_id,btrim(r->>'tag'),r->>'category',p_source,r->>'status',(r->>'confidence')::numeric,p_model,
      coalesce(r->'evidence','{}'),case when r->>'status'='rejected' then now() end)
    on conflict(style_group_id,tag) do update set category=excluded.category,source=excluded.source,status=excluded.status,
      confidence=excluded.confidence,model=excluded.model,evidence=excluded.evidence,rejected_at=excluded.rejected_at,updated_at=now()
    where style_group_tags.created_by is null and style_group_tags.source=excluded.source and style_group_tags.model=excluded.model;
  end loop;
  perform public.refresh_dam_search_documents_batch('{}',array[p_style_group_id],1);
  select count(*) into v_count from public.style_group_tags where style_group_id=p_style_group_id and source=p_source and model=p_model;
  return jsonb_build_object('style_group_id',p_style_group_id,'tag_count',v_count);
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.replace_asset_ai_tag_result(p_asset_id uuid,p_source text,p_model text,p_tags jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; v_count int;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  if p_asset_id is null or nullif(btrim(p_source),'') is null or lower(btrim(p_source))='manual' or nullif(btrim(p_model),'') is null or jsonb_typeof(p_tags)<>'array'
     or not exists(select 1 from public.assets where id=p_asset_id) then raise exception 'invalid asset AI result'; end if;
  delete from public.asset_tags where asset_id=p_asset_id and source=p_source and model=p_model
    and status in ('active','candidate') and created_by is null;
  for r in select value from jsonb_array_elements(p_tags) loop
    if coalesce(r->>'category','') not in ('file_type','view','scene','color','visible_content','technique','other')
       or coalesce(r->>'status','') not in ('active','candidate','rejected') or nullif(btrim(r->>'tag'),'') is null
       or (r ? 'confidence' and ((r->>'confidence')::numeric<0 or (r->>'confidence')::numeric>1)) then raise exception 'invalid asset tag'; end if;
    insert into public.asset_tags(asset_id,tag,category,source,status,confidence,model,evidence,rejected_at)
    values(p_asset_id,btrim(r->>'tag'),r->>'category',p_source,r->>'status',(r->>'confidence')::numeric,p_model,
      coalesce(r->'evidence','{}'),case when r->>'status'='rejected' then now() end)
    on conflict(asset_id,tag) do update set category=excluded.category,source=excluded.source,status=excluded.status,
      confidence=excluded.confidence,model=excluded.model,evidence=excluded.evidence,rejected_at=excluded.rejected_at,updated_at=now()
    where asset_tags.created_by is null and asset_tags.source=excluded.source and asset_tags.model=excluded.model;
  end loop;
  perform public.refresh_dam_search_documents_batch(array[p_asset_id],'{}',2);
  select count(*) into v_count from public.asset_tags where asset_id=p_asset_id and source=p_source and model=p_model;
  return jsonb_build_object('asset_id',p_asset_id,'tag_count',v_count);
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.get_effective_asset_metadata(p_asset_id uuid)
returns table(scope text,tag text,category text,source text,status text,confidence numeric,model text,created_by uuid,
  effective_licensor_id uuid,effective_property_id uuid,style_group_id uuid)
language sql stable security invoker set search_path=public as $$
  select * from (
  select 'style_group'::text as scope,t.tag,t.category,t.source,t.status,t.confidence,t.model,t.created_by,
    sg.licensor_id,sg.property_id,a.style_group_id from public.assets a join public.style_groups sg on sg.id=a.style_group_id
    join public.style_group_tags t on t.style_group_id=sg.id where a.id=p_asset_id
  union all
  select 'asset'::text as scope,t.tag,t.category,t.source,t.status,t.confidence,t.model,t.created_by,
    case when a.style_group_id is null then a.licensor_id else sg.licensor_id end,
    case when a.style_group_id is null then a.property_id else sg.property_id end,a.style_group_id
    from public.assets a left join public.style_groups sg on sg.id=a.style_group_id join public.asset_tags t on t.asset_id=a.id
    where a.id=p_asset_id
  ) m order by m.scope,lower(m.tag),m.tag;
$$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl('drop function if exists public.claim_dam_search_embedding_documents(int)');
select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.claim_dam_search_embedding_documents(p_limit int default 100,p_worker_id text default null,p_lease_seconds int default 300)
returns table(document_type text,entity_id uuid,search_text text,content_sha256 text,lease_token uuid,lease_expires_at timestamptz,attempt int)
language plpgsql security definer set search_path=public as $$
begin
  if (select auth.role()) <> 'service_role' or nullif(btrim(p_worker_id),'') is null then raise exception 'service_role and worker id required' using errcode='42501'; end if;
  return query with candidates as (
    select d.document_type,d.entity_id from public.dam_search_documents d
    where d.embedding is null and d.embedding_attempts<d.embedding_max_attempts
      and (d.embedding_next_retry_at is null or d.embedding_next_retry_at<=now())
      and (d.embedding_lease_expires_at is null or d.embedding_lease_expires_at<=now())
      and d.embedding_error_category is distinct from 'permanent'
    order by d.indexed_at,d.document_type,d.entity_id for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),1000))
  ), claimed as (update public.dam_search_documents d set embedding_lease_token=gen_random_uuid(),
    embedding_lease_owner=p_worker_id,embedding_lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,300),3600))),
    embedding_attempts=d.embedding_attempts+1 from candidates c where d.document_type=c.document_type and d.entity_id=c.entity_id
    returning d.*)
  select c.document_type,c.entity_id,left(c.search_text,8000),c.content_sha256,c.embedding_lease_token,c.embedding_lease_expires_at,c.embedding_attempts from claimed c;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl('drop function if exists public.upsert_dam_search_embedding(text,uuid,text,extensions.vector(384),text)');
select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.upsert_dam_search_embedding(p_document_type text,p_entity_id uuid,p_content_sha256 text,p_lease_token uuid,
  p_embedding extensions.vector(384),p_embedding_model text default 'gte-small') returns boolean language plpgsql security definer set search_path=public as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
  update public.dam_search_documents set embedding=p_embedding,embedding_model=p_embedding_model,embedding_updated_at=now(),
    embedding_error=null,embedding_error_category=null,embedding_next_retry_at=null,embedding_lease_token=null,
    embedding_lease_owner=null,embedding_lease_expires_at=null where document_type=p_document_type and entity_id=p_entity_id
    and content_sha256=p_content_sha256 and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl('drop function if exists public.mark_dam_search_embedding_error(text,uuid,text,text)');
select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.mark_dam_search_embedding_error(p_document_type text,p_entity_id uuid,p_content_sha256 text,p_lease_token uuid,
  p_error text,p_category text default 'transient') returns boolean language plpgsql security definer set search_path=public as $$
begin
  if (select auth.role()) <> 'service_role' or p_category not in ('transient','permanent') then raise exception 'invalid embedding error'; end if;
  update public.dam_search_documents set embedding_error=left(coalesce(p_error,'unknown embedding error'),1000),
    embedding_error_category=case when p_category='permanent' or embedding_attempts>=embedding_max_attempts then 'permanent' else 'transient' end,
    embedding_next_retry_at=case when p_category='transient' and embedding_attempts<embedding_max_attempts
      then now()+make_interval(secs=>least(3600,30*(2^greatest(0,embedding_attempts-1))::int)) end,
    embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null
  where document_type=p_document_type and entity_id=p_entity_id and content_sha256=p_content_sha256
    and embedding_lease_token=p_lease_token and embedding_lease_expires_at>now(); return found;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.get_dam_search_embedding_status() returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('total_documents',count(*),'embedded_documents',count(*) filter(where embedding is not null),
 'pending_documents',count(*) filter(where embedding is null and embedding_attempts<embedding_max_attempts and embedding_error_category is distinct from 'permanent'),
 'leased_documents',count(*) filter(where embedding_lease_expires_at>now()),'errored_documents',count(*) filter(where embedding_error is not null),
 'exhausted_documents',count(*) filter(where embedding is null and (embedding_attempts>=embedding_max_attempts or embedding_error_category='permanent')),
 'asset_documents',count(*) filter(where document_type='asset'),'style_group_documents',count(*) filter(where document_type='style_group'),
 'oldest_pending_indexed_at',min(indexed_at) filter(where embedding is null),'newest_indexed_at',max(indexed_at)) from public.dam_search_documents;
$$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl($applyddl$create or replace function public.reset_dam_search_embedding_errors(p_document_type text default null,p_entity_ids uuid[] default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count int;
begin
  if (select auth.role())<>'service_role' and not public.has_role(auth.uid(),'admin') then raise exception 'admin required' using errcode='42501'; end if;
  update public.dam_search_documents set embedding_error=null,embedding_error_category=null,embedding_attempts=0,
    embedding_next_retry_at=null,embedding_lease_token=null,embedding_lease_owner=null,embedding_lease_expires_at=null
  where embedding is null and (p_document_type is null or document_type=p_document_type) and (p_entity_ids is null or entity_id=any(p_entity_ids));
  get diagnostics v_count=row_count; return v_count;
end $$$applyddl$);

select pg_temp.popdam_1479_apply_final_ddl('revoke all on public.style_group_tags from anon');
select pg_temp.popdam_1479_apply_final_ddl('grant select on public.style_group_tags to authenticated,service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant select on public.asset_tags to authenticated,service_role');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[]) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.replace_asset_ai_tag_result(uuid,text,text,jsonb) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.refresh_dam_search_documents_batch(uuid[],uuid[],int) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.claim_dam_search_embedding_documents(int,text,int) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector(384),text) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.get_dam_search_embedding_status() from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('revoke all on function public.reset_dam_search_embedding_errors(text,uuid[]) from public,anon,authenticated');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.replace_style_group_ai_profile(uuid,text,text,text,jsonb,uuid[]) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.replace_asset_ai_tag_result(uuid,text,text,jsonb) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.get_effective_asset_metadata(uuid) to authenticated,service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.refresh_dam_search_documents_batch(uuid[],uuid[],int) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.claim_dam_search_embedding_documents(int,text,int) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.upsert_dam_search_embedding(text,uuid,text,uuid,extensions.vector(384),text) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.mark_dam_search_embedding_error(text,uuid,text,uuid,text,text) to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.get_dam_search_embedding_status() to service_role');
select pg_temp.popdam_1479_apply_final_ddl('grant execute on function public.reset_dam_search_embedding_errors(text,uuid[]) to service_role');

select pg_temp.popdam_1479_apply_final_ddl($ddl$comment on table public.style_group_tags is 'Shared product/artwork tags. Manual rows and rejected tombstones are authoritative; never copy these rows to member assets.'$ddl$);
select pg_temp.popdam_1479_apply_final_ddl($ddl$comment on function public.get_effective_asset_metadata(uuid) is 'RLS-compatible two-scope metadata with group identity winning for grouped assets; it does not copy identity or tags.'$ddl$);
comment on column public.asset_tags.category is 'File-specific PopDAM tag category; final #1427 contract active.';

commit;
