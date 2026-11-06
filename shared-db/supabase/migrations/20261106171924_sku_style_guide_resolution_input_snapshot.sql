-- derived-from: 20261105061627
-- #5608: freeze exact raw file/declaration inputs once; derive keys only for pending SKUs.
-- Applied predecessors remain immutable. v4 invalidates potentially incoherent legacy progress once.
set local lock_timeout='5s';
do $resolver_transition$
begin
  if not pg_try_advisory_xact_lock(5608,2) then
    raise exception using errcode='55P03',message='SKU resolver is active; retry the governed migration in an idle gap';
  end if;
end $resolver_transition$;

create or replace function public.prepare_sku_style_guide_resolution(p_full boolean default false)
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_portal_hash text;
  v_count integer;
begin
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='v') then
    drop view pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='m') then
    drop materialized view pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='f') then
    drop foreign table pg_temp.sku_sg_inputs;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_inputs' and relkind='S') then
    drop sequence pg_temp.sku_sg_inputs;
  else
    drop table if exists pg_temp.sku_sg_inputs;
  end if;
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='v') then
    drop view pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='m') then
    drop materialized view pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='f') then
    drop foreign table pg_temp.sku_sg_portal;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_portal' and relkind='S') then
    drop sequence pg_temp.sku_sg_portal;
  else
    drop table if exists pg_temp.sku_sg_portal;
  end if;
  if exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='v') then
    drop view pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='m') then
    drop materialized view pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='f') then
    drop foreign table pg_temp.sku_sg_pending;
  elsif exists (select from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and relname='sku_sg_pending' and relkind='S') then
    drop sequence pg_temp.sku_sg_pending;
  else
    drop table if exists pg_temp.sku_sg_pending;
  end if;
  -- Freeze every observation once; duplicates and NULL filename keys remain significant.
  create temporary table pg_temp.sku_sg_portal on commit preserve rows as
  with portal as (
select * from plm.asset_file_style_guide_keys
  ) select i.*,pg_catalog.hash_record_extended(row(i.source_system COLLATE "C",i.file_name_norm COLLATE "C",i.source_style_guide_key COLLATE "C",
     i.style_guide_label COLLATE "C",i.core_style_guide_id,i.matched_file_name COLLATE "C"),5608) as portal_hash_1,
     pg_catalog.hash_record_extended(row(i.source_system COLLATE "C",i.file_name_norm COLLATE "C",i.source_style_guide_key COLLATE "C",
     i.style_guide_label COLLATE "C",i.core_style_guide_id,i.matched_file_name COLLATE "C"),5609) as portal_hash_2
  from portal i;
  select 'v4:'||md5(concat_ws(':',count(*),sum(portal_hash_1::numeric),sum(portal_hash_2::numeric)))
  into v_portal_hash from pg_temp.sku_sg_portal;
  create temporary table pg_temp.sku_sg_pending (
    sku text primary key,input_hash text not null,portal_hash text not null,output_hash text
  ) on commit preserve rows;
  -- One UNION ALL statement freezes the same input multiset used by hashing
  -- and all batches. Keep raw duplicates and the original eligibility predicates.
  create temporary table pg_temp.sku_sg_inputs on commit preserve rows as
    select u.sku, 'file'::text as input_kind, u.file_name,
      null::text as file_name_norm,
      null::text as declared_label, null::text as declared_key,
      null::text as label_key, md5(row('file', u.file_name)::text) as row_hash
    from public.sku_files_used u
    where u.sku is not null and u.file_name is not null and btrim(u.file_name) <> ''
    union all
    select a.sku, 'sheet'::text, null::text, null::text,
      p.declared_style_guide_label, p.declared_style_guide_key,
      null::text,
      md5(row('sheet', p.declared_style_guide_label,p.declared_style_guide_key)::text)
    from public.pdf_text_samples p join public.assets a on a.id=p.asset_id
    where a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text,a.filename)
      and nullif(p.declared_style_guide_key,'') is not null;
  insert into pg_temp.sku_sg_pending(sku,input_hash,portal_hash)
  select sku,md5(string_agg(row_hash,'' order by row_hash)),v_portal_hash
  from pg_temp.sku_sg_inputs group by sku;

  -- Re-derive if an independent parser/service changed the semantic output.
  update pg_temp.sku_sg_pending q set output_hash = (
    select md5(coalesce(string_agg(row(l.id,l.sku,l.file_name,l.source_system,l.source_style_guide_key,l.style_guide_label,l.match_method,l.match_confidence,l.matched_asset_count,l.core_style_guide_id)::text, E'\n' order by l.id), '')) from public.sku_style_guide_links l
      where l.id = any(p.active_link_ids))
    from public.sku_style_guide_resolver_progress p where p.sku = q.sku;
  if not p_full then
    -- Exact observed membership preserves quarantined history while allowing
    -- independent parsers to touch currently valid evidence between nightly runs.
    update public.sku_style_guide_links l set last_seen_at = now()
    from public.sku_style_guide_resolver_progress p, pg_temp.sku_sg_pending q
    where l.sku = p.sku and p.sku = q.sku
      and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash
      and p.output_hash = q.output_hash and l.id = any(p.active_link_ids);
    update public.sku_style_guide_resolver_progress p set resolved_at = now()
    from pg_temp.sku_sg_pending q where p.sku = q.sku
      and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash and p.output_hash = q.output_hash;
    delete from pg_temp.sku_sg_pending q using public.sku_style_guide_resolver_progress p
      where p.sku = q.sku and p.input_hash = q.input_hash and p.portal_hash = q.portal_hash and p.output_hash = q.output_hash;
  end if;
  select count(*) into v_count from pg_temp.sku_sg_pending;
  if v_count > 0 then
    create index on pg_temp.sku_sg_portal(file_name_norm);
    create index on pg_temp.sku_sg_portal(style_guide_label_key);
    analyze pg_temp.sku_sg_portal;
    create index on pg_temp.sku_sg_inputs(input_kind,sku);
    update pg_temp.sku_sg_inputs i set file_name_norm=public.file_name_norm(i.file_name)
      from pg_temp.sku_sg_pending q where q.sku=i.sku and i.input_kind='file';
    update pg_temp.sku_sg_inputs i set label_key=public.style_guide_label_norm(i.declared_label)
      from pg_temp.sku_sg_pending q where q.sku=i.sku and i.input_kind='sheet';
    analyze pg_temp.sku_sg_inputs;
  end if;
  return v_count;
end;
$function$;

create or replace function public.resolve_sku_style_guide_batch(p_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_skus text[];
  v_file_ids uuid[]; v_declared_ids uuid[]; v_label_ids uuid[]; v_active_ids uuid[];
  v_filename_rows int := 0;
  v_declared_rows int := 0;
  v_label_rows    int := 0;
begin
  if p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'Batch size must be between 1 and 1000';
  end if;
  -- Catalog-only checks precede reading any caller-controlled temporary source.
  if not (select count(*)=3 and coalesce(bool_and(
      c.relkind='r' and c.relpersistence='t' and c.relowner=current_user::regrole::oid
      and not c.relrowsecurity and not c.relforcerowsecurity
      and coalesce((select jsonb_agg(jsonb_build_array(a.attname::text,a.atttypid::integer,a.atttypmod,a.attnum::integer) order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)=e.shape,false)
      and not exists(select from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and a.attisdropped)
      and not exists(select from pg_catalog.pg_trigger t where t.tgrelid=c.oid)
      and not exists(select from pg_catalog.pg_rewrite r where r.ev_class=c.oid)
    ),false)
    from (values
      ('sku_sg_inputs','[["sku",25,-1,1],["input_kind",25,-1,2],["file_name",25,-1,3],["file_name_norm",25,-1,4],["declared_label",25,-1,5],["declared_key",25,-1,6],["label_key",25,-1,7],["row_hash",25,-1,8]]'::jsonb),
      ('sku_sg_portal','[["source_system",25,-1,1],["file_name_norm",25,-1,2],["source_style_guide_key",25,-1,3],["style_guide_label",25,-1,4],["core_style_guide_id",2950,-1,5],["matched_file_name",25,-1,6],["style_guide_label_key",25,-1,7],["portal_hash_1",20,-1,8],["portal_hash_2",20,-1,9]]'::jsonb),
      ('sku_sg_pending','[["sku",25,-1,1],["input_hash",25,-1,2],["portal_hash",25,-1,3],["output_hash",25,-1,4]]'::jsonb)
    ) e(name,shape) join pg_catalog.pg_class c on c.relnamespace=pg_catalog.pg_my_temp_schema() and c.relname=e.name
  ) then
    raise exception using errcode='42501',message='Trusted SKU resolution temporary snapshot is missing or incompatible';
  end if;
  perform pg_advisory_xact_lock(5608, 1);
  select array_agg(sku) into v_skus from
    (select sku from pg_temp.sku_sg_pending order by sku limit p_batch_size) q;
  if v_skus is null then
    return jsonb_build_object('sku_rows', 0, 'filename_rows', 0, 'declared_rows', 0, 'label_match_rows', 0);
  end if;
  -- ARM 1 - extracted file name -> portal style guide.
  with src as (
    select distinct u.sku,u.file_name,u.file_name_norm as fn
    from pg_temp.sku_sg_inputs u
    where u.input_kind='file' and u.sku=any(v_skus)
  ),
  hits as (
    select s.sku, s.file_name, i.source_system, i.source_style_guide_key,
           min(i.style_guide_label) as style_guide_label,
           min(i.core_style_guide_id::text)::uuid as core_style_guide_id,
           bool_or(lower(btrim(s.file_name)) = lower(btrim(i.matched_file_name))) as exact_match,
           count(distinct i.matched_file_name)    as matched_asset_count
    from src s
    join pg_temp.sku_sg_portal i on i.file_name_norm = s.fn
    group by s.sku, s.file_name, i.source_system, i.source_style_guide_key
  ),
  scored as (
    -- How many distinct portal guides this one (sku, file_name) lands on. More than
    -- one means the file name is not decisive, so confidence is divided accordingly.
    select h.*, count(*) over (partition by h.sku, h.file_name) as guide_count
    from hits h
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count, core_style_guide_id)
    select s.sku, s.file_name, s.source_system, s.source_style_guide_key,
           s.style_guide_label,
           case when s.exact_match
                then 'filename_exact' else 'filename_normalized' end,
           1.0 / greatest(s.guide_count, 1)::real,
           s.matched_asset_count,
           s.core_style_guide_id
    from scored s
    on conflict on constraint sku_style_guide_links_identity_key
    do update
      set last_seen_at = now(),
          style_guide_label   = excluded.style_guide_label,
          match_method        = excluded.match_method,
          match_confidence    = excluded.match_confidence,
          matched_asset_count = excluded.matched_asset_count,
          core_style_guide_id = coalesce(excluded.core_style_guide_id,
                                        public.sku_style_guide_links.core_style_guide_id)
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_filename_rows,v_file_ids from ins;

  -- ARM 2 - the sheet's own declared style guide, verbatim.
  with raw_decl as (
    select i.sku,i.declared_label as label,i.label_key
    from pg_temp.sku_sg_inputs i
    where i.input_kind='sheet' and i.sku=any(v_skus)
  ),
  decl as (
    -- One proposal per result identity, including equivalent OCR spellings.
    select sku, label_key as label_key, min(label) as label
    from raw_decl
    where label <> ''
      and label_key is not null
      and public.is_plausible_source_file_name(label)
    group by sku, label_key
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count)
    select d.sku, null, 'sheet_declared', d.label_key,
           d.label, 'sheet_declared', 1.0, 1
    from decl d
    where d.label <> ''
      and d.label_key is not null
      and public.is_plausible_source_file_name(d.label)
    on conflict on constraint sku_style_guide_links_identity_key
    do update set last_seen_at = now(), style_guide_label = excluded.style_guide_label
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_declared_rows,v_declared_ids from ins;

  -- ARM 3 - declared label matched against a portal style-guide label.
  with decl as (
    select i.sku,i.declared_label as label,i.label_key
    from pg_temp.sku_sg_inputs i
    where i.input_kind='sheet' and i.sku=any(v_skus)
  ),
  guides as (
    select distinct i.source_system, i.source_style_guide_key, i.style_guide_label,
           i.core_style_guide_id,
           i.style_guide_label_key as ln
    from pg_temp.sku_sg_portal i
    where btrim(i.style_guide_label) <> ''
      and i.style_guide_label_key in (select label_key from decl)
  ),
  hits as (
    select d.sku, g.source_system, g.source_style_guide_key,
           min(g.style_guide_label) as style_guide_label
    from decl d
    join guides g on g.ln = d.label_key
    where d.label_key is not null
    group by d.sku, g.source_system, g.source_style_guide_key
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count)
    select h.sku, null, h.source_system, h.source_style_guide_key,
           h.style_guide_label, 'sheet_label_match', 1.0, 1
    from hits h
    on conflict on constraint sku_style_guide_links_identity_key
    do update set last_seen_at = now(),
                  style_guide_label   = excluded.style_guide_label,
                  core_style_guide_id = coalesce(excluded.core_style_guide_id,
                                                public.sku_style_guide_links.core_style_guide_id)
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_label_rows,v_label_ids from ins;

  v_active_ids := v_file_ids || v_declared_ids || v_label_ids;
  insert into public.sku_style_guide_resolver_progress(sku,input_hash,portal_hash,active_link_ids,output_hash,resolved_at)
    select q.sku,q.input_hash,q.portal_hash,
      coalesce((select array_agg(l.id order by l.id) from public.sku_style_guide_links l
        where l.sku=q.sku and l.id=any(v_active_ids)), '{}'::uuid[]),
      (select md5(coalesce(string_agg(row(l.id,l.sku,l.file_name,l.source_system,l.source_style_guide_key,l.style_guide_label,l.match_method,l.match_confidence,l.matched_asset_count,l.core_style_guide_id)::text, E'\n' order by l.id), '')) from public.sku_style_guide_links l
        where l.sku=q.sku and l.id=any(v_active_ids)),now()
    from pg_temp.sku_sg_pending q where q.sku = any(v_skus)
    on conflict(sku) do update set input_hash=excluded.input_hash,
      portal_hash=excluded.portal_hash,active_link_ids=excluded.active_link_ids,
      output_hash=excluded.output_hash,resolved_at=excluded.resolved_at;
  delete from pg_temp.sku_sg_pending where sku = any(v_skus);
  return jsonb_build_object(
    'sku_rows', cardinality(v_skus),
    'filename_rows', v_filename_rows,
    'declared_rows', v_declared_rows,
    'label_match_rows', v_label_rows
  );
end;
$function$;


-- Preserve the existing nightly identity; bind genuine acceptance to this source.
do $nightly_identity$
declare v_count integer; v_job_id bigint;
begin
  select count(*),min(jobid) into v_count,v_job_id from cron.job
    where jobname='resolve-sku-style-guide-links-nightly';
  if v_count<>1 or not exists(select from cron.job where jobid=v_job_id
    and username='postgres' and schedule='30 4 * * *' and active
    and command='call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */') then
    raise exception 'Expected the one unchanged original SKU nightly job';
  end if;
  perform cron.alter_job(v_job_id,command:='call public.resolve_sku_style_guide_links_run() /* shared-db:20261106171924 */');
end $nightly_identity$;

-- Existing catch-up remains unchanged. If already finished, install the SAME
-- self-removing original job to complete the once-only v4 invalidation.
do $catchup_identity$
declare v_count integer;
begin
  select count(*) into v_count from cron.job where jobname='sku-style-guide-links-catchup-5608';
  if v_count=0 then
    perform cron.schedule('sku-style-guide-links-catchup-5608','*/5 * * * *',
      'call public.resolve_sku_style_guide_links_run()');
  end if;
  if (select count(*) from cron.job where jobname='sku-style-guide-links-catchup-5608')<>1
    or not exists(select from cron.job where jobname='sku-style-guide-links-catchup-5608'
      and username='postgres' and active and schedule='*/5 * * * *'
      and command='call public.resolve_sku_style_guide_links_run()') then
    raise exception 'Expected exactly the original owned SKU catch-up job';
  end if;
end $catchup_identity$;
