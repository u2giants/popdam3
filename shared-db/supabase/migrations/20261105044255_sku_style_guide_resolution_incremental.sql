-- derived-from: 20261030043848
-- #5608: persist expensive keys; resolve only changed SKU inputs in committed batches.
-- No known incident for these new keys; historical resolver timeout is tracked on #5141.
-- Keep all eight direct portal assertions and the upsert-only quarantine semantics.
set local lock_timeout = '5s';
create or replace function public.sku_declared_style_guide_label(p_text text)
returns text language sql immutable parallel safe returns null on null input
set search_path = public
as $$
  select case when p_text ~* 'style\s+guide\s+used\s*:' then
    btrim(btrim((regexp_match(p_text,
      '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]), E' \t.,;:') end
$$;
revoke all on function public.sku_declared_style_guide_label(text) from public, anon, authenticated;
grant execute on function public.sku_declared_style_guide_label(text) to service_role, postgres, authenticated;
-- Plain nullable columns add metadata only. NULL means pending; empty key means
-- computed normalization was NULL. Backfill commits at most 1000 rows at a time.
alter table public.pdf_text_samples add column declared_style_guide_label text,
  add column declared_style_guide_key text;
create index sku_sg_pdf_declared_key_idx on public.pdf_text_samples(declared_style_guide_key, asset_id);
create function public.sku_sg_pdf_keys() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.extracted_text is distinct from old.extracted_text
     or new.declared_style_guide_key is null
     or new.declared_style_guide_key is distinct from old.declared_style_guide_key
     or new.declared_style_guide_label is distinct from old.declared_style_guide_label then
    new.declared_style_guide_label := public.sku_declared_style_guide_label(new.extracted_text);
    new.declared_style_guide_key := coalesce(public.style_guide_label_norm(new.declared_style_guide_label), '');
  end if;
  return new;
end $$;
create trigger sku_sg_pdf_keys before insert or update of extracted_text, declared_style_guide_label, declared_style_guide_key
  on public.pdf_text_samples for each row execute function public.sku_sg_pdf_keys();
create function public.sku_sg_file_exact_filename_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.exact_filename is distinct from old.exact_filename
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.exact_filename), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_file_exact_filename_key() from public, anon, authenticated;
grant execute on function public.sku_sg_file_exact_filename_key() to service_role, postgres;
create function public.sku_sg_file_file_name_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.file_name is distinct from old.file_name
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.file_name), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_file_file_name_key() from public, anon, authenticated;
grant execute on function public.sku_sg_file_file_name_key() to service_role, postgres;
create function public.sku_sg_file_original_file_name_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.original_file_name is distinct from old.original_file_name
     or new.sku_sg_file_key is null or new.sku_sg_file_key is distinct from old.sku_sg_file_key then
    new.sku_sg_file_key := coalesce(public.file_name_norm(new.original_file_name), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_file_original_file_name_key() from public, anon, authenticated;
grant execute on function public.sku_sg_file_original_file_name_key() to service_role, postgres;
alter table plm.dcp_asset add column sku_sg_file_key text;
create index sku_sg_dcp_asset_file_idx on plm.dcp_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.dcp_asset for each row execute function public.sku_sg_file_file_name_key();
alter table plm.lucasfilm_dcp_asset add column sku_sg_file_key text;
create index sku_sg_lucasfilm_dcp_asset_file_idx on plm.lucasfilm_dcp_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.lucasfilm_dcp_asset for each row execute function public.sku_sg_file_file_name_key();
alter table plm.marvel_dcp_asset add column sku_sg_file_key text;
create index sku_sg_marvel_dcp_asset_file_idx on plm.marvel_dcp_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.marvel_dcp_asset for each row execute function public.sku_sg_file_file_name_key();
alter table plm.marvel_asgard_node_asset_observation add column sku_sg_file_key text;
create index sku_sg_marvel_asgard_node_asset_observation_file_idx on plm.marvel_asgard_node_asset_observation(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of exact_filename, sku_sg_file_key
  on plm.marvel_asgard_node_asset_observation for each row execute function public.sku_sg_file_exact_filename_key();
alter table plm.nbcu_asset add column sku_sg_file_key text;
create index sku_sg_nbcu_asset_file_idx on plm.nbcu_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.nbcu_asset for each row execute function public.sku_sg_file_file_name_key();
alter table plm.wb_asset_normalized add column sku_sg_file_key text;
create index sku_sg_wb_asset_normalized_file_idx on plm.wb_asset_normalized(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.wb_asset_normalized for each row execute function public.sku_sg_file_file_name_key();
alter table plm.peanuts_asset add column sku_sg_file_key text;
create index sku_sg_peanuts_asset_file_idx on plm.peanuts_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of file_name, sku_sg_file_key
  on plm.peanuts_asset for each row execute function public.sku_sg_file_file_name_key();
alter table plm.sesame_asset add column sku_sg_file_key text;
create index sku_sg_sesame_asset_file_idx on plm.sesame_asset(sku_sg_file_key);
create trigger sku_sg_file_key before insert or update of original_file_name, sku_sg_file_key
  on plm.sesame_asset for each row execute function public.sku_sg_file_original_file_name_key();
create function public.sku_sg_label_exact_label_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.exact_label is distinct from old.exact_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.exact_label), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_label_exact_label_key() from public, anon, authenticated;
grant execute on function public.sku_sg_label_exact_label_key() to service_role, postgres;
create function public.sku_sg_label_folder_name_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.folder_name is distinct from old.folder_name
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.folder_name), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_label_folder_name_key() from public, anon, authenticated;
grant execute on function public.sku_sg_label_folder_name_key() to service_role, postgres;
create function public.sku_sg_label_label_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.label is distinct from old.label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.label), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_label_label_key() from public, anon, authenticated;
grant execute on function public.sku_sg_label_label_key() to service_role, postgres;
create function public.sku_sg_label_style_guide_label_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.style_guide_label is distinct from old.style_guide_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.style_guide_label), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_label_style_guide_label_key() from public, anon, authenticated;
grant execute on function public.sku_sg_label_style_guide_label_key() to service_role, postgres;
create function public.sku_sg_label_value_label_key() returns trigger language plpgsql
set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' or new.value_label is distinct from old.value_label
     or new.sku_sg_label_key is null or new.sku_sg_label_key is distinct from old.sku_sg_label_key then
    new.sku_sg_label_key := coalesce(public.style_guide_label_norm(new.value_label), '');
  end if;
  return new;
end $$;
revoke all on function public.sku_sg_label_value_label_key() from public, anon, authenticated;
grant execute on function public.sku_sg_label_value_label_key() to service_role, postgres;
alter table plm.dcp_style_guide add column sku_sg_label_key text;
create index sku_sg_dcp_style_guide_label_idx on plm.dcp_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_dcp_style_guide_pending_idx on plm.dcp_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of folder_name, sku_sg_label_key
  on plm.dcp_style_guide for each row execute function public.sku_sg_label_folder_name_key();
alter table plm.lucasfilm_dcp_style_guide add column sku_sg_label_key text;
create index sku_sg_lucasfilm_dcp_style_guide_label_idx on plm.lucasfilm_dcp_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_lucasfilm_dcp_style_guide_pending_idx on plm.lucasfilm_dcp_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of folder_name, sku_sg_label_key
  on plm.lucasfilm_dcp_style_guide for each row execute function public.sku_sg_label_folder_name_key();
alter table plm.marvel_dcp_style_guide add column sku_sg_label_key text;
create index sku_sg_marvel_dcp_style_guide_label_idx on plm.marvel_dcp_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_marvel_dcp_style_guide_pending_idx on plm.marvel_dcp_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of folder_name, sku_sg_label_key
  on plm.marvel_dcp_style_guide for each row execute function public.sku_sg_label_folder_name_key();
alter table plm.marvel_asgard_style_guide add column sku_sg_label_key text;
create index sku_sg_marvel_asgard_style_guide_label_idx on plm.marvel_asgard_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_marvel_asgard_style_guide_pending_idx on plm.marvel_asgard_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of exact_label, sku_sg_label_key
  on plm.marvel_asgard_style_guide for each row execute function public.sku_sg_label_exact_label_key();
alter table plm.nbcu_style_guide add column sku_sg_label_key text;
create index sku_sg_nbcu_style_guide_label_idx on plm.nbcu_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_nbcu_style_guide_pending_idx on plm.nbcu_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of style_guide_label, sku_sg_label_key
  on plm.nbcu_style_guide for each row execute function public.sku_sg_label_style_guide_label_key();
alter table plm.wb_style_guide_normalized add column sku_sg_label_key text;
create index sku_sg_wb_style_guide_normalized_label_idx on plm.wb_style_guide_normalized(nullif(sku_sg_label_key, ''));
create index sku_sg_wb_style_guide_normalized_pending_idx on plm.wb_style_guide_normalized(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of label, sku_sg_label_key
  on plm.wb_style_guide_normalized for each row execute function public.sku_sg_label_label_key();
alter table plm.peanuts_style_guide add column sku_sg_label_key text;
create index sku_sg_peanuts_style_guide_label_idx on plm.peanuts_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_peanuts_style_guide_pending_idx on plm.peanuts_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of value_label, sku_sg_label_key
  on plm.peanuts_style_guide for each row execute function public.sku_sg_label_value_label_key();
alter table plm.sesame_style_guide add column sku_sg_label_key text;
create index sku_sg_sesame_style_guide_label_idx on plm.sesame_style_guide(nullif(sku_sg_label_key, ''));
create index sku_sg_sesame_style_guide_pending_idx on plm.sesame_style_guide(sku_sg_label_key) where sku_sg_label_key is null;
create trigger sku_sg_label_key before insert or update of value_label, sku_sg_label_key
  on plm.sesame_style_guide for each row execute function public.sku_sg_label_value_label_key();
revoke all on function public.sku_sg_pdf_keys() from public, anon, authenticated;
grant execute on function public.sku_sg_pdf_keys() to service_role, postgres;

create or replace view plm.asset_file_style_guide_index with (security_invoker = true) as
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    a.sku_sg_file_key as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    public.file_name_norm(a.file_name) as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    null::text as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    null::text,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    null::text,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    o.sku_sg_file_key,
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key <> ''
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    public.file_name_norm(o.exact_filename),
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key is null
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    null::text,
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key = ''
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    a.sku_sg_file_key,
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key <> ''
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    public.file_name_norm(a.file_name),
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key is null
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    null::text,
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key = ''
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    null::text,
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    a.sku_sg_file_key,
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key <> ''
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    public.file_name_norm(a.file_name),
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key is null
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    null::text,
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key = ''
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    a.sku_sg_file_key,
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key <> ''
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    public.file_name_norm(a.original_file_name),
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key is null
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    null::text,
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key = '';
create or replace view plm.asset_file_style_guide_keys with (security_invoker = true) as
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    a.sku_sg_file_key as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    public.file_name_norm(a.file_name) as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
-- Disney DCP Vault: dcp_asset.style_guide_id is a direct FK.
  select
    'disney_dcpvault'::text          as source_system,
    null::text as file_name_norm,
    coalesce(nullif(g.source_guide_id, ''), g.id::text) as source_style_guide_key,
    g.folder_name                    as style_guide_label,
    g.core_style_guide_id            as core_style_guide_id,
    a.file_name                      as matched_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.dcp_asset a
  join plm.dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Lucasfilm / Star Wars DCP Vault: same shape, separate namespace.
  select
    'lucasfilm_dcpvault',
    null::text,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.lucasfilm_dcp_asset a
  join plm.lucasfilm_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Marvel DCP Vault.
  select
    'marvel_dcpvault',
    null::text,
    coalesce(nullif(g.source_guide_id, ''), g.id::text),
    g.folder_name,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_dcp_asset a
  join plm.marvel_dcp_style_guide g on g.id = a.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    o.sku_sg_file_key,
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key <> ''
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    public.file_name_norm(o.exact_filename),
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key is null
  union all
  -- Marvel ASGARD: filename lives on the node asset observation; the guide is
  -- reached through guide_node -> style_guide. Observation carries the exact
  -- visible filename, which is the more faithful match key.
  select
    'marvel_asgard',
    null::text,
    coalesce(nullif(g.source_guide_key, ''), g.source_identity_key),
    g.exact_label,
    null::uuid,
    o.exact_filename, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.marvel_asgard_node_asset_observation o
  join plm.marvel_asgard_guide_node n on n.id = o.guide_node_id
  join plm.marvel_asgard_style_guide g on g.id = n.style_guide_id
  where btrim(o.exact_filename) <> ''
 and o.sku_sg_file_key = ''
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    a.sku_sg_file_key,
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key <> ''
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    public.file_name_norm(a.file_name),
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key is null
  union all
  -- NBCU Creative Asset Factory: junction table is the direct assertion.
  select
    'nbcu',
    null::text,
    g.style_guide_key,
    g.style_guide_label,
    g.core_style_guide_id,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.nbcu_asset a
  join plm.nbcu_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_key = a.asset_source_key
  join plm.nbcu_style_guide g
    on g.capture_id = l.capture_id and g.style_guide_key = l.style_guide_key

  where a.sku_sg_file_key = ''
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    a.sku_sg_file_key,
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key <> ''
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    public.file_name_norm(a.file_name),
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key is null
  union all
  -- Warner STARLABS: normalised arm. source_id is '' for every Warner guide
  -- (the portal publishes no guide id), so identity falls back to fallback_key.
  select
    'warner_starlabs',
    null::text,
    coalesce(nullif(g.source_id, ''), g.fallback_key),
    g.label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.wb_asset_normalized a
  join plm.wb_asset_style_guide_normalized l on l.asset_id = a.id
  join plm.wb_style_guide_normalized g on g.id = l.style_guide_id

  where a.sku_sg_file_key = ''
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    a.sku_sg_file_key,
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key <> ''
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    public.file_name_norm(a.file_name),
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key is null
  union all
  -- Peanuts (Tenovos): the asset row itself carries the style guide key.
  select
    'peanuts_tenovos',
    null::text,
    g.value_key,
    g.value_label,
    null::uuid,
    a.file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.peanuts_asset a
  join plm.peanuts_style_guide g
    on g.capture_id = a.capture_id and g.value_key = a.style_guide_key

  where a.sku_sg_file_key = ''
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    a.sku_sg_file_key,
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key <> ''
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    public.file_name_norm(a.original_file_name),
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key is null
  union all
  -- Sesame Workshop (NetX): junction asset -> style guide.
  select
    'sesame_netx',
    null::text,
    g.value_key,
    g.value_label,
    null::uuid,
    a.original_file_name, nullif(g.sku_sg_label_key, '') as style_guide_label_key
  from plm.sesame_asset a
  join plm.sesame_asset_style_guide l
    on l.capture_id = a.capture_id and l.asset_source_id = a.asset_source_id
  join plm.sesame_style_guide g
    on g.capture_id = l.capture_id and g.value_key = l.value_key
  where btrim(a.original_file_name) <> '' and a.sku_sg_file_key = '';
revoke all on plm.asset_file_style_guide_keys from public, anon, authenticated;
grant select on plm.asset_file_style_guide_keys to service_role;

create table public.sku_style_guide_resolver_progress (
  sku text primary key,
  input_hash text not null,
  portal_hash text not null,
  active_link_ids uuid[] not null default '{}',
  output_hash text not null,
  resolved_at timestamptz not null
);
alter table public.sku_style_guide_resolver_progress enable row level security;
revoke all on public.sku_style_guide_resolver_progress from public, anon, authenticated;
grant all on public.sku_style_guide_resolver_progress to service_role, postgres;
create policy service_all on public.sku_style_guide_resolver_progress to service_role using (true) with check (true);

-- Backfill existing rows without holding rewrite locks. New writes are keyed by
-- their narrow BEFORE triggers, including source changes during this catch-up.
create function public.backfill_sku_style_guide_key_batch(p_batch_size integer default 1000)
returns integer language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare r record; n integer;
begin
  if p_batch_size < 1 or p_batch_size > 10000 then raise exception 'Invalid key batch size'; end if;
  perform pg_advisory_xact_lock(5608, 1);
  for r in select * from (values
    ('public.pdf_text_samples','extracted_text','declared_style_guide_key'),
    ('plm.dcp_asset','file_name','sku_sg_file_key'),
    ('plm.lucasfilm_dcp_asset','file_name','sku_sg_file_key'),
    ('plm.marvel_dcp_asset','file_name','sku_sg_file_key'),
    ('plm.marvel_asgard_node_asset_observation','exact_filename','sku_sg_file_key'),
    ('plm.nbcu_asset','file_name','sku_sg_file_key'),
    ('plm.wb_asset_normalized','file_name','sku_sg_file_key'),
    ('plm.peanuts_asset','file_name','sku_sg_file_key'),
    ('plm.sesame_asset','original_file_name','sku_sg_file_key'),
    ('plm.dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.lucasfilm_dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.marvel_dcp_style_guide','folder_name','sku_sg_label_key'),
    ('plm.marvel_asgard_style_guide','exact_label','sku_sg_label_key'),
    ('plm.nbcu_style_guide','style_guide_label','sku_sg_label_key'),
    ('plm.wb_style_guide_normalized','label','sku_sg_label_key'),
    ('plm.peanuts_style_guide','value_label','sku_sg_label_key'),
    ('plm.sesame_style_guide','value_label','sku_sg_label_key')) as sources(table_name, source_column, key_column)
  loop
    -- Reassign only our key: do not fire unrelated UPDATE OF source triggers.
    execute format('with batch as (select ctid from %s where %I is null limit $1 for update) '
      'update %s t set %I = t.%I from batch where t.ctid = batch.ctid',
      r.table_name,r.key_column,r.table_name,r.key_column,r.key_column) using p_batch_size;
    get diagnostics n = row_count;
    if n > 0 then return n; end if;
  end loop;
  return 0;
end;
$function$;
revoke all on function public.backfill_sku_style_guide_key_batch(integer) from public, anon, authenticated;
grant execute on function public.backfill_sku_style_guide_key_batch(integer) to service_role, postgres;

create or replace function public.prepare_sku_style_guide_resolution(p_full boolean default false)
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $function$
declare
  v_portal_hash text;
  v_count integer;
begin
  -- Order-independent multiset fingerprint: duplicate observations are significant.
  -- Include exact spelling, labels, guide identity and canonical guide association.
  select md5(concat_ws(':', count(*),
      sum(('x' || substr(h, 1, 16))::bit(64)::bigint::numeric),
      sum(('x' || substr(h, 17, 16))::bit(64)::bigint::numeric)))
  into v_portal_hash
  from (select md5(row(i.source_system, i.file_name_norm,
    i.source_style_guide_key, i.style_guide_label,
    i.core_style_guide_id, i.matched_file_name)::text) h
    from plm.asset_file_style_guide_index i) fingerprints;

  drop table if exists pg_temp.sku_sg_pending;
  create temporary table sku_sg_pending (
    sku text primary key, input_hash text not null, portal_hash text not null, output_hash text
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
    join plm.asset_file_style_guide_index i on i.file_name_norm = s.fn
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
    from plm.asset_file_style_guide_keys i
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

-- Compatibility entry point retains full re-derivation for existing service callers.
create or replace function public.resolve_sku_style_guide_links()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  r jsonb;
  nf integer := 0; nd integer := 0; nl integer := 0;
begin
  if not pg_try_advisory_xact_lock(5608, 2) then
    raise exception 'SKU style-guide resolution already running';
  end if;
  while public.backfill_sku_style_guide_key_batch() > 0 loop null; end loop;
  perform public.prepare_sku_style_guide_resolution(true);
  loop
    r := public.resolve_sku_style_guide_batch();
    exit when (r->>'sku_rows')::integer = 0;
    nf := nf + (r->>'filename_rows')::integer;
    nd := nd + (r->>'declared_rows')::integer;
    nl := nl + (r->>'label_match_rows')::integer;
  end loop;
  return jsonb_build_object('filename_rows',nf,'declared_rows',nd,'label_match_rows',nl);
end;
$function$;

-- COMMIT is legal only for an invoker procedure with no SET clause. The cron
-- caller is postgres; browsers cannot execute this or its definer helpers.
create function public.finish_sku_style_guide_catchup()
returns void language plpgsql security definer set search_path=pg_catalog, public
as $$
begin
  if exists(select 1 from pg_temp.sku_sg_pending) then
    raise exception 'Cannot finish SKU catch-up with pending work';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname='sku-style-guide-links-catchup-5608';
end $$;
revoke all on function public.finish_sku_style_guide_catchup() from public, anon, authenticated;
grant execute on function public.finish_sku_style_guide_catchup() to service_role, postgres;

create or replace procedure public.resolve_sku_style_guide_links_run(p_full boolean default false)
language plpgsql security invoker
as $procedure$
declare r jsonb; n integer;
begin
  -- Session lock survives COMMIT and prevents the catch-up and nightly jobs
  -- from doing duplicate work. pg_cron closes the connection on cancellation.
  -- Reject explicit-transaction CALL before taking a session-scoped lock.
  commit;
  if not pg_try_advisory_lock(5608, 2) then
    raise exception 'SKU style-guide resolution already running' using errcode='55P03';
  end if;
  loop
    begin
      n := public.backfill_sku_style_guide_key_batch();
    exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
      perform pg_advisory_unlock(5608, 2); raise;
    end;
    commit;
    exit when n = 0;
  end loop;
  begin
    perform public.prepare_sku_style_guide_resolution(p_full);
  exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
    perform pg_advisory_unlock(5608, 2); raise;
  end;
  commit;
  loop
    begin
      r := public.resolve_sku_style_guide_batch();
    exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
      perform pg_advisory_unlock(5608, 2); raise;
    end;
    commit;
    exit when (r->>'sku_rows')::integer = 0;
  end loop;
  begin
    perform public.finish_sku_style_guide_catchup();
  exception when query_canceled or assert_failure then
      perform pg_advisory_unlock(5608, 2); raise;
    when others then
    perform pg_advisory_unlock(5608, 2); raise;
  end;
  perform pg_advisory_unlock(5608, 2);
end;
$procedure$;
revoke all on function public.prepare_sku_style_guide_resolution(boolean) from public, anon, authenticated;
revoke all on function public.resolve_sku_style_guide_batch(integer) from public, anon, authenticated;
revoke all on function public.resolve_sku_style_guide_links() from public, anon, authenticated;
revoke all on procedure public.resolve_sku_style_guide_links_run(boolean) from public, anon, authenticated;
grant execute on function public.prepare_sku_style_guide_resolution(boolean) to service_role, postgres;
grant execute on function public.resolve_sku_style_guide_batch(integer) to service_role, postgres;
grant execute on function public.resolve_sku_style_guide_links() to service_role, postgres;
grant execute on procedure public.resolve_sku_style_guide_links_run(boolean) to service_role, postgres;
select cron.schedule('resolve-sku-style-guide-links-nightly', '30 4 * * *',
  $$call public.resolve_sku_style_guide_links_run()$$);
-- First catch-up is bounded by the server's existing outer statement budget;
-- committed key/progress batches survive cancellation and resume next invocation.
select cron.schedule('sku-style-guide-links-catchup-5608', '*/5 * * * *',
  $$call public.resolve_sku_style_guide_links_run()$$);
