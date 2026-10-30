-- Item -> licensor-scrape style guide links (schema half).
--
-- WHY. PopDAM licensing-sheet / tech-pack PDFs carry a "FILES USED:" list of the
-- licensor source art a design was built from. Those names are parsed into
-- public.sku_files_used and today resolve only against the PopSG NAS crawl
-- (public.style_guide_files). This migration adds the second, licensor-authoritative
-- resolution: match each extracted file name against the licensor portal scrape
-- landings in plm.*, follow that portal's own asset -> style-guide assertion, and
-- record which style guide(s) the item drew from.
--
-- OWNERSHIP. App-owned PopDAM data, written by a governed resolver and read by the
-- PopDAM UI. It is deliberately NOT dam.asset_style_guide: that table is a canonical
-- asset-level edge, is written only by a governed migration, and requires DIRECT source
-- support (core.require_direct_support_for_canonical_edge). A filename match is DERIVED
-- evidence and the subject here is the ITEM (SKU / style group), not a single asset
-- file. Quarantine model, same as public.sku_files_used: rows are never auto-deleted.
--
-- No licensed licensor row value appears in this file.

-- ---------------------------------------------------------------------------
-- 1. Normalised file-name key
-- ---------------------------------------------------------------------------
-- Tech-pack "FILES USED" values are usually bare stems (no extension) while portal
-- asset rows carry real filenames with extensions and sometimes a folder prefix.
-- Both sides are keyed on: basename, lowercased, trailing extension stripped.
-- The extension pattern deliberately requires the first extension character to be a
-- letter so a dotted stem such as "MS_Core3.0_Extension_comp_02" is left intact.
create or replace function public.file_name_norm(p_name text)
returns text
language sql
immutable
parallel safe
returns null on null input
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(lower(btrim(p_name)), '.*[/\\]', ''),
        '\.[a-z][a-z0-9]{0,4}$', '')
    ), '')
$$;

comment on function public.file_name_norm(text) is
  'Normalised file-name matching key: basename, lowercased, trailing extension stripped. '
  'Shared by the plm.asset_file_style_guide_index view and the sku_style_guide_links resolver.';

-- ---------------------------------------------------------------------------
-- 2. Cross-portal filename -> style guide index
-- ---------------------------------------------------------------------------
-- One row per (portal, normalised file name, style guide the portal asserts that
-- file belongs to). Every arm below is a DIRECT portal assertion: an asset -> guide
-- relationship the source system publishes. No arm infers a guide from co-occurrence.
--
-- Portals WITHOUT a published style-guide relationship are deliberately absent:
--   * Paramount Creative Library publishes Collections, not Style Guides. A Collection
--     is not a Style Guide and must never be stored as one (level-mismatch trap).
--   * Coca-Cola publishes assets with no guide relationship.
--   * Disney OPA publishes properties/characters only - it has no file or guide arm.
--   * Sega guide candidates and Wildbrain keyword guides are pipeline inferences,
--     not portal-declared style guides.
-- Adding a portal means adding one UNION ALL arm here, after confirming the portal
-- itself asserts asset -> style guide.
create or replace view plm.asset_file_style_guide_index
with (security_invoker = true) as
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
  where btrim(a.original_file_name) <> '';

comment on view plm.asset_file_style_guide_index is
  'Cross-portal index: one row per (portal, normalised file name, style guide the portal '
  'asserts that file belongs to). Every arm is a DIRECT source assertion; no arm infers a '
  'guide from co-occurrence. Paramount Collections and Coca-Cola assets are deliberately '
  'absent - neither portal publishes a style-guide relationship. Sega and Wildbrain '
  'are excluded because their guide relationships are inferred.';

alter view plm.asset_file_style_guide_index owner to postgres;

-- Internal resolver index: ASGARD landing tables are service-role-only.
-- UI readers use the authenticated-readable sku_style_guide_links result instead.
revoke all on plm.asset_file_style_guide_index from public, anon, authenticated;
grant select on plm.asset_file_style_guide_index to service_role;

-- ---------------------------------------------------------------------------
-- 3. Item -> style guide link table
-- ---------------------------------------------------------------------------
create table if not exists public.sku_style_guide_links (
  id                     uuid primary key default gen_random_uuid(),
  sku                    text not null,
  -- The extracted source file that produced the match. NULL when the row came from
  -- the sheet's own declared "CORE/STYLE GUIDE USED" field rather than a file match.
  file_name              text,
  source_system          text not null,
  source_style_guide_key text not null,
  style_guide_label      text not null,
  match_method           text not null,
  match_confidence       real not null default 1.0,
  -- How many distinct portal asset file names collapse onto this normalised key.
  -- >1 means the file name is not unique in the portal and the guide is one of
  -- several candidates - read the row as "possible", not "certain".
  matched_asset_count    integer not null default 1,
  -- Reserved for promotion to the canonical catalogue. core.style_guide is seeded
  -- empty today (fix_characters_style_guides.md Phase 3), so this stays NULL until
  -- that backfill lands. Never invented here.
  core_style_guide_id    uuid references core.style_guide (id) on delete set null,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint sku_style_guide_links_sku_chk            check (btrim(sku) <> ''),
  constraint sku_style_guide_links_source_system_chk  check (btrim(source_system) <> ''),
  constraint sku_style_guide_links_source_key_chk     check (btrim(source_style_guide_key) <> ''),
  constraint sku_style_guide_links_label_chk          check (btrim(style_guide_label) <> ''),
  constraint sku_style_guide_links_match_method_chk   check (
    match_method in ('filename_exact', 'filename_normalized', 'sheet_declared', 'sheet_label_match')
  ),
  constraint sku_style_guide_links_confidence_chk     check (match_confidence >= 0 and match_confidence <= 1),
  constraint sku_style_guide_links_asset_count_chk    check (matched_asset_count >= 1),
  constraint sku_style_guide_links_file_name_chk      check (file_name is null or btrim(file_name) <> ''),
  -- file_name is NULLable, so the identity key uses NULLS NOT DISTINCT the same way
  -- dam.sku_style_guide_source does. Named so the resolver can target it explicitly.
  constraint sku_style_guide_links_identity_key unique nulls not distinct
    (sku, source_system, source_style_guide_key, file_name)
);

create index if not exists sku_style_guide_links_sku_idx
  on public.sku_style_guide_links (sku);

create index if not exists sku_style_guide_links_guide_idx
  on public.sku_style_guide_links (source_system, source_style_guide_key);

create index if not exists sku_style_guide_links_core_guide_idx
  on public.sku_style_guide_links (core_style_guide_id)
  where core_style_guide_id is not null;

create trigger set_updated_at before update on public.sku_style_guide_links
  for each row execute function app.set_updated_at();

comment on table public.sku_style_guide_links is
  'Which licensor style guide(s) a PopDAM item (SKU / style group) drew its source art '
  'from. Derived by matching the item''s extracted "FILES USED" file names against '
  'plm.asset_file_style_guide_index, and by the sheet''s own "CORE/STYLE GUIDE USED" '
  'field. Evidence, not canonical: quarantine model, never auto-deleted. '
  'core_style_guide_id is a reserved promotion slot to core.style_guide (currently empty).';

comment on column public.sku_style_guide_links.file_name is
  'Extracted source file that produced the match. NULL for rows taken from the sheet''s '
  'declared "CORE/STYLE GUIDE USED" field.';

comment on column public.sku_style_guide_links.matched_asset_count is
  'Number of distinct portal asset file names that collapse onto this normalised key. '
  'Greater than 1 means the file name is ambiguous in the portal.';

alter table public.sku_style_guide_links enable row level security;

drop policy if exists "service role all" on public.sku_style_guide_links;
create policy "service role all" on public.sku_style_guide_links
  for all to service_role using (true) with check (true);

drop policy if exists "authenticated read" on public.sku_style_guide_links;
create policy "authenticated read" on public.sku_style_guide_links
  for select to authenticated using (true);

revoke all on public.sku_style_guide_links from public, anon, authenticated;
grant select on public.sku_style_guide_links to authenticated;
grant select, insert, update, delete, truncate on public.sku_style_guide_links to service_role, postgres;

-- Item -> licensor-scrape style guide links (resolver half).
--
-- Companion to the schema half above in this migration.
--
-- Three evidence arms write into public.sku_style_guide_links:
--   1. filename_exact / filename_normalized  - an extracted "FILES USED" name matched
--      against plm.asset_file_style_guide_index, following the portal's own
--      asset -> style-guide assertion.
--   2. sheet_declared                        - the licensing sheet's own
--      "CORE/STYLE GUIDE USED:" field, kept verbatim.
--   3. sheet_label_match                     - that declared field matched by normalised
--      label against a portal style-guide label.
--
-- Quarantine model: the resolver only upserts and refreshes last_seen_at. It never
-- deletes or unlinks a row.

-- ---------------------------------------------------------------------------
-- 1. Normalised style-guide label key (declared label <-> portal label)
-- ---------------------------------------------------------------------------
create or replace function public.style_guide_label_norm(p_label text)
returns text
language sql
immutable
parallel safe
returns null on null input
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(lower(btrim(p_label)), '^\s*(the|a|an)\s+', ''),
        '[^a-z0-9]+', ' ', 'g')
    ), '')
$$;

comment on function public.style_guide_label_norm(text) is
  'Normalised style-guide label key: lowercased, leading article removed, punctuation '
  'collapsed to single spaces. Used to match a sheet-declared guide name against a '
  'portal style-guide label.';

-- ---------------------------------------------------------------------------
-- 2. Plausible source-file-name test
-- ---------------------------------------------------------------------------
-- "FILES USED" sections carry OCR noise. A real source-art name always contains at
-- least one letter, underscore, hyphen or dot; pure numbers and page furniture do not.
create or replace function public.is_plausible_source_file_name(p_name text)
returns boolean
language sql
immutable
parallel safe
returns null on null input
as $$
  select length(btrim(p_name)) between 2 and 200
     and btrim(p_name) ~ '[A-Za-z0-9._-]'
     and btrim(p_name) ~ '[A-Za-z]'
     and btrim(p_name) !~ '^[0-9]+$'
     and lower(btrim(p_name)) not in (
       'none','n/a','na','tbd','see attached','see attachment','various','multiple',
       'page','mockup','quick reference','item dimensions','licensor info'
     )
$$;

-- ---------------------------------------------------------------------------
-- 3. FILES USED parser (improved) - writes public.sku_files_used
-- ---------------------------------------------------------------------------
-- Replaces the first-cut parser. Improvements, all learned from the live corpus:
--   * header aliases widened (artwork files / source art / files used / ...);
--   * inline values split on comma, semicolon and pipe;
--   * trailing OCR punctuation stripped;
--   * entries validated by is_plausible_source_file_name instead of "not all digits".
-- Multi-line sections still stop at a blank line or a "label:" line, which is how the
-- POP licensing-sheet template is laid out.
-- The implementation lives in parse_pdf_files_used_v2 and the legacy name delegates.
-- Rationale: the CI harness re-applies the pre-adoption baseline after the migrations
-- replay (database-contract-tests.yml steps 12-14), so a CREATE OR REPLACE of a routine
-- the baseline also defines is silently restored to the baseline body before the tests
-- run. A migration-owned name is the only parser the harness cannot overwrite. The
-- legacy delegating wrapper keeps production callers on the new behaviour and degrades
-- to the old body only inside that harness.
create or replace function public.parse_pdf_files_used_v2(p_asset_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sku     text;
  v_ftype   text;
  v_fname   text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
begin
  select sku, file_type::text, filename into v_sku, v_ftype, v_fname
  from assets where id = p_asset_id;
  if v_sku is null or btrim(v_sku) = '' then return 0; end if;

  -- Style Guide Sources are parsed ONLY from licensing-sheet / tech-pack PDFs.
  if not public.is_style_guide_source_pdf(v_ftype, v_fname) then return 0; end if;

  select extracted_text into v_text
  from pdf_text_samples
  where asset_id = p_asset_id and extracted_text is not null
  order by sampled_at desc limit 1;
  if v_text is null then return 0; end if;

  v_lines := string_to_array(v_text, E'\n');
  foreach v_line in array v_lines loop
    v_trimmed := btrim(v_line);

    if v_trimmed ~* '^(files?\s+used|source\s+files?|art\s+files?|artwork\s+files?|design\s+files?|source\s+art(work)?)\s*:' then
      v_in_sect := true;
      v_inline := btrim(regexp_replace(v_trimmed,
        '(?i)^(files?\s+used|source\s+files?|art\s+files?|artwork\s+files?|design\s+files?|source\s+art(work)?)\s*:\s*', ''));
      v_inline := btrim(v_inline, E' \t.,;:');
      if v_inline <> '' then
        foreach v_entry in array regexp_split_to_array(v_inline, '[,;|]') loop
          v_entry := btrim(btrim(v_entry), E' \t.,;:');
          if public.is_plausible_source_file_name(v_entry) then
            insert into sku_files_used (sku, file_name, source)
            values (v_sku, v_entry, 'pdf_text')
            on conflict (sku, file_name) do nothing;
            v_count := v_count + 1;
          end if;
        end loop;
        v_in_sect := false;
      end if;
      continue;
    end if;

    if v_in_sect then
      if v_trimmed = '' or v_trimmed ~ '^\S[^:]*:\s*$' then
        v_in_sect := false;
        continue;
      end if;
      v_entry := btrim(v_trimmed, E' \t.,;:');
      if public.is_plausible_source_file_name(v_entry) then
        insert into sku_files_used (sku, file_name, source)
        values (v_sku, v_entry, 'pdf_text')
        on conflict (sku, file_name) do nothing;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$function$;

comment on function public.parse_pdf_files_used_v2(uuid) is
  'Parse the "FILES USED" section of a licensing-sheet / tech-pack PDF text sample into '
  'public.sku_files_used. Gated by is_style_guide_source_pdf; entries are validated by '
  'is_plausible_source_file_name. Migration-owned name: the CI harness restores baseline '
  'routine bodies for pre-existing names after the migrations replay.';

-- Legacy entry point: the pdf_text_samples trigger and older callers use this name.
create or replace function public.parse_pdf_files_used(p_asset_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $function$
begin
  return public.parse_pdf_files_used_v2(p_asset_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Declared style-guide parser - writes public.sku_style_guide_links
-- ---------------------------------------------------------------------------
-- The POP licensing-sheet template carries its own "CORE/STYLE GUIDE USED:" field.
-- That is the designer's declaration, captured verbatim. It is stored as evidence
-- (source_system = 'sheet_declared') and is never presented as a portal identity.
create or replace function public.parse_pdf_declared_style_guide(p_asset_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sku   text;
  v_ftype text;
  v_fname text;
  v_text  text;
  v_label text;
  v_key   text;
begin
  select sku, file_type::text, filename into v_sku, v_ftype, v_fname
  from assets where id = p_asset_id;
  if v_sku is null or btrim(v_sku) = '' then return 0; end if;
  if not public.is_style_guide_source_pdf(v_ftype, v_fname) then return 0; end if;

  select extracted_text into v_text
  from pdf_text_samples
  where asset_id = p_asset_id and extracted_text is not null
  order by sampled_at desc limit 1;
  if v_text is null then return 0; end if;

  v_label := btrim((regexp_match(v_text,
    '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]);
  if v_label is null then return 0; end if;
  v_label := btrim(v_label, E' \t.,;:');
  if not public.is_plausible_source_file_name(v_label) then
    return 0;
  end if;

  v_key := public.style_guide_label_norm(v_label);
  if v_key is null or v_key = '' then return 0; end if;

  insert into sku_style_guide_links
    (sku, file_name, source_system, source_style_guide_key, style_guide_label,
     match_method, match_confidence, matched_asset_count)
  values
    (v_sku, null, 'sheet_declared', v_key, v_label, 'sheet_declared', 1.0, 1)
  on conflict on constraint sku_style_guide_links_identity_key
  do update set last_seen_at = now(), style_guide_label = excluded.style_guide_label;
  return 1;
end;
$function$;

comment on function public.parse_pdf_declared_style_guide(uuid) is
  'Capture the licensing sheet''s own "CORE/STYLE GUIDE USED:" value for an item as '
  'sheet_declared evidence in public.sku_style_guide_links. Verbatim; no portal claim.';

-- ---------------------------------------------------------------------------
-- 5. Backfill both parsers across every existing text sample
-- ---------------------------------------------------------------------------
-- Migration-owned name, for the same baseline-restoration reason as
-- parse_pdf_files_used_v2. The legacy name delegates to it.
create or replace function public.backfill_pdf_files_used_v2()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_id    uuid;
  v_total int := 0;
begin
  for v_id in (
    select distinct asset_id
    from pdf_text_samples
    where asset_id is not null
      and extracted_text is not null
      and char_count > 100
  ) loop
    v_total := v_total + public.parse_pdf_files_used_v2(v_id);
    perform public.parse_pdf_declared_style_guide(v_id);
  end loop;
  return v_total;
end;
$function$;

comment on function public.backfill_pdf_files_used_v2() is
  'Re-run the FILES USED and declared-style-guide parsers over every existing '
  'pdf_text_samples row. Needed because bulk_insert_pdf_text_samples skips the per-row '
  'trigger and only parses the rows in that batch; samples written before the parsers '
  'existed are otherwise never parsed.';

create or replace function public.backfill_pdf_files_used()
returns integer
language plpgsql
set search_path to 'public'
as $function$
begin
  return public.backfill_pdf_files_used_v2();
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Cross-reference resolver
-- ---------------------------------------------------------------------------
create or replace function public.resolve_sku_style_guide_links()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
declare
  v_filename_rows int := 0;
  v_declared_rows int := 0;
  v_label_rows    int := 0;
begin
  -- ARM 1 - extracted file name -> portal style guide.
  with src as (
    select distinct u.sku, u.file_name, public.file_name_norm(u.file_name) as fn
    from public.sku_files_used u
    where u.file_name is not null and btrim(u.file_name) <> ''
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
    returning 1
  )
  select count(*) into v_filename_rows from ins;

  -- ARM 2 - the sheet's own declared style guide, verbatim.
  with raw_decl as (
    select a.sku,
           btrim(btrim((regexp_match(p.extracted_text,
             '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]),
             E' \t.,;:') as label
    from public.pdf_text_samples p
    join public.assets a on a.id = p.asset_id
    where p.extracted_text is not null
      and p.extracted_text ~* 'style\s+guide\s+used\s*:'
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
    returning 1
  )
  select count(*) into v_declared_rows from ins;

  -- ARM 3 - declared label matched against a portal style-guide label.
  with decl as (
    select a.sku,
           btrim(btrim((regexp_match(p.extracted_text,
             '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]),
             E' \t.,;:') as label
    from public.pdf_text_samples p
    join public.assets a on a.id = p.asset_id
    where p.extracted_text is not null
      and p.extracted_text ~* 'style\s+guide\s+used\s*:'
      and a.sku is not null and btrim(a.sku) <> ''
      and public.is_style_guide_source_pdf(a.file_type::text, a.filename)
  ),
  guides as (
    select distinct i.source_system, i.source_style_guide_key, i.style_guide_label,
           i.core_style_guide_id,
           public.style_guide_label_norm(i.style_guide_label) as ln
    from plm.asset_file_style_guide_index i
    where btrim(i.style_guide_label) <> ''
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
    returning 1
  )
  select count(*) into v_label_rows from ins;

  return jsonb_build_object(
    'filename_rows', v_filename_rows,
    'declared_rows', v_declared_rows,
    'label_match_rows', v_label_rows
  );
end;
$function$;

comment on function public.resolve_sku_style_guide_links() is
  'Derive public.sku_style_guide_links from (a) extracted FILES USED file names matched '
  'against plm.asset_file_style_guide_index, (b) the sheet''s declared CORE/STYLE GUIDE '
  'USED field, and (c) that declared field matched to a portal guide label. Upsert only; '
  'never deletes. SECURITY DEFINER because plm.* is not PostgREST-exposed.';

revoke all on function public.resolve_sku_style_guide_links() from public, anon, authenticated;
grant execute on function public.resolve_sku_style_guide_links() to service_role, postgres;
revoke all on function public.backfill_pdf_files_used_v2() from public, anon, authenticated;
grant execute on function public.backfill_pdf_files_used_v2() to service_role, postgres;
revoke all on function public.backfill_pdf_files_used() from public, anon, authenticated;
grant execute on function public.backfill_pdf_files_used() to service_role, postgres;
revoke all on function public.parse_pdf_files_used_v2(uuid) from public, anon, authenticated;
grant execute on function public.parse_pdf_files_used_v2(uuid) to service_role, postgres;
revoke all on function public.parse_pdf_files_used(uuid) from public, anon, authenticated;
grant execute on function public.parse_pdf_files_used(uuid) to service_role, postgres;
revoke all on function public.parse_pdf_declared_style_guide(uuid) from public, anon, authenticated;
grant execute on function public.parse_pdf_declared_style_guide(uuid) to service_role, postgres;
grant execute on function public.style_guide_label_norm(text) to service_role, postgres, authenticated;
grant execute on function public.is_plausible_source_file_name(text) to service_role, postgres, authenticated;
grant execute on function public.file_name_norm(text) to service_role, postgres, authenticated;

-- ---------------------------------------------------------------------------
-- Historical parse deliberately NOT run inline (#5141): the per-row normalized
-- filename lookups overrun this migration's own statement budget on real data
-- (run 41067960648 rolled back at the 120s cap). The migration installs the
-- parsers and the nightly resolver; the one-time historical parse runs as
-- service_role after promotion, per HANDOFF.d/20261030T0640Z-EDGE-DEV section 4:
--   select public.backfill_pdf_files_used_v2();
--   select public.resolve_sku_style_guide_links();
-- Root-cause guard for wherever that parse is run from: the function carries
-- its own statement budget so it can never again inherit a caller's short cap.
alter function public.backfill_pdf_files_used_v2() set statement_timeout = '30min';

-- ---------------------------------------------------------------------------
-- 7. Nightly refresh
-- ---------------------------------------------------------------------------
-- Runs after the 02:00 UTC PopSG crawl and the 04:00 UTC sku_files_used resolver, so
-- newly captured portal rows and newly linked files-used rows are picked up the same
-- night.
select cron.schedule(
  'resolve-sku-style-guide-links-nightly',
  '30 4 * * *',
  $$select public.resolve_sku_style_guide_links()$$
);
