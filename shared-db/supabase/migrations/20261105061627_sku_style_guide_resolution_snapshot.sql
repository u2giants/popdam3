-- derived-from: 20261105044255
-- #5608 forward repair: read the exact portal multiset once per invocation.
-- Preview ordinary index builds measured 10.363s combined; acquire in 5s.
-- Request 15s statement timeout; the automatic executor outer timeout still applies.
-- Keep the original public view, matching/upsert semantics, cron and locks unchanged.
set local lock_timeout = '5s';
set local statement_timeout = '15s';
-- Fence the atomic old-prepare/new-batch transition against in-flight callers.
do $transition$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(5608, 2) then
    raise exception using errcode='55P03',message='SKU style-guide resolution already running; retry migration after it completes';
  end if;
end;
$transition$;
create index sku_sg_nbcu_asset_snapshot_idx
  on plm.nbcu_asset(capture_id,asset_source_key) include(file_name,sku_sg_file_key);
create index sku_sg_wb_asset_snapshot_idx
  on plm.wb_asset_normalized(id) include(file_name,sku_sg_file_key);

-- Full-source snapshot readers do not need three readiness branches per arm.
-- CASE retains original normalization while pending and the empty-key NULL sentinel.
create or replace view plm.asset_file_style_guide_keys with (security_invoker = true) as
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.folder_name) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.folder_name) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.folder_name) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    case when o.sku_sg_file_key is null then public.file_name_norm(o.exact_filename) else nullif(o.sku_sg_file_key, '') end,
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.exact_label) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end,
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.style_guide_label) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end,
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.label) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.file_name) else nullif(a.sku_sg_file_key, '') end,
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.value_label) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    case when a.sku_sg_file_key is null then public.file_name_norm(a.original_file_name) else nullif(a.sku_sg_file_key, '') end,
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name, case when g.sku_sg_label_key is null then public.style_guide_label_norm(g.value_label) else nullif(g.sku_sg_label_key, '') end as style_guide_label_key
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> ''
  ;
revoke all on plm.asset_file_style_guide_keys from public, anon, authenticated;
grant select on plm.asset_file_style_guide_keys to service_role;

create or replace function public.prepare_sku_style_guide_resolution(p_full boolean default false)
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_portal_hash text;
  v_count integer;
begin
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
  select 'v3:'||md5(concat_ws(':',count(*),sum(portal_hash_1::numeric),sum(portal_hash_2::numeric)))
  into v_portal_hash from pg_temp.sku_sg_portal;
  create temporary table pg_temp.sku_sg_pending (
    sku text primary key,input_hash text not null,portal_hash text not null,output_hash text
  ) on commit preserve rows;
  insert into pg_temp.sku_sg_pending(sku,input_hash,portal_hash)
  select sku, md5(string_agg(h, '' order by h)), v_portal_hash
  from (
    select u.sku, md5(row('file', u.file_name)::text) h
      from public.sku_files_used u
      where u.sku is not null and u.file_name is not null and btrim(u.file_name) <> ''
    union all
    select a.sku, md5(row('sheet', p.declared_style_guide_label,
       p.declared_style_guide_key)::text)
      from public.pdf_text_samples p join public.assets a on a.id = p.asset_id
      where a.sku is not null and btrim(a.sku) <> ''
        and public.is_style_guide_source_pdf(a.file_type::text, a.filename)
        and nullif(p.declared_style_guide_key, '') is not null
  ) inputs group by sku;

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
  perform pg_advisory_xact_lock(5608, 1);
  select array_agg(sku) into v_skus from
    (select sku from pg_temp.sku_sg_pending order by sku limit p_batch_size) q;
  if v_skus is null then
    return jsonb_build_object('sku_rows', 0, 'filename_rows', 0, 'declared_rows', 0, 'label_match_rows', 0);
  end if;
  -- ARM 1 - extracted file name -> portal style guide.
  with src as (
    select distinct u.sku, u.file_name, public.file_name_norm(u.file_name) as fn
    from public.sku_files_used u
    where u.sku = any(v_skus) and u.file_name is not null and btrim(u.file_name) <> ''
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
    select a.sku,
           p.declared_style_guide_label as label
    from public.pdf_text_samples p
    join public.assets a on a.id = p.asset_id
    where a.sku = any(v_skus) and nullif(p.declared_style_guide_key, '') is not null
      and a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text, a.filename)
  ),
  decl as (
    -- One proposal per result identity, including equivalent OCR spellings.
    select sku, public.style_guide_label_norm(label) as label_key, min(label) as label
    from raw_decl
    where label <> ''
      and public.style_guide_label_norm(label) is not null
      and public.is_plausible_source_file_name(label)
    group by sku, public.style_guide_label_norm(label)
  ),
  ins as (
    insert into public.sku_style_guide_links
      (sku, file_name, source_system, source_style_guide_key, style_guide_label,
       match_method, match_confidence, matched_asset_count)
    select d.sku, null, 'sheet_declared', d.label_key,
           d.label, 'sheet_declared', 1.0, 1
    from decl d
    where d.label <> ''
      and public.style_guide_label_norm(d.label) is not null
      and public.is_plausible_source_file_name(d.label)
    on conflict on constraint sku_style_guide_links_identity_key
    do update set last_seen_at = now(), style_guide_label = excluded.style_guide_label
    returning id
  )
  select count(*), coalesce(array_agg(id),'{}'::uuid[]) into v_declared_rows,v_declared_ids from ins;

  -- ARM 3 - declared label matched against a portal style-guide label.
  with decl as (
    select a.sku,
           p.declared_style_guide_label as label
    from public.pdf_text_samples p
    join public.assets a on a.id = p.asset_id
    where a.sku = any(v_skus) and nullif(p.declared_style_guide_key, '') is not null
      and a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text, a.filename)
  ),
  guides as (
    select distinct i.source_system, i.source_style_guide_key, i.style_guide_label,
           i.core_style_guide_id,
           i.style_guide_label_key as ln
    from pg_temp.sku_sg_portal i
    where btrim(i.style_guide_label) <> ''
      and i.style_guide_label_key in (select public.style_guide_label_norm(label) from decl)
  ),
  hits as (
    select d.sku, g.source_system, g.source_style_guide_key,
           min(g.style_guide_label) as style_guide_label
    from decl d
    join guides g on g.ln = public.style_guide_label_norm(d.label)
    where public.style_guide_label_norm(d.label) is not null
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


-- CREATE OR REPLACE preserves ACLs; state the service-only boundary explicitly.
revoke all on function public.prepare_sku_style_guide_resolution(boolean),
  public.resolve_sku_style_guide_batch(integer) from public, anon, authenticated;
grant execute on function public.prepare_sku_style_guide_resolution(boolean),
  public.resolve_sku_style_guide_batch(integer) to service_role, postgres;

-- Bind acceptance to this source version without replacing or rescheduling the job.
do $nightly_identity$
declare v_count integer; v_job_id bigint;
begin
  select count(*),min(jobid) into v_count,v_job_id from cron.job
    where jobname='resolve-sku-style-guide-links-nightly';
  if v_count<>1 then
    raise exception 'Expected exactly one existing nightly SKU style-guide job, found %',v_count;
  end if;
  perform cron.alter_job(v_job_id,
    command => 'call public.resolve_sku_style_guide_links_run() /* shared-db:20261105061627 */');
end;
$nightly_identity$;
