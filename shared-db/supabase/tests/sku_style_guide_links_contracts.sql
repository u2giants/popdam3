-- #5091: rolled-back behavioral contracts; no licensed source data is needed.
begin;

do $contract$
declare
  privilege text;
  service_function text;
  role_name text;
  definition text := pg_get_viewdef('plm.asset_file_style_guide_index'::regclass, true);
begin
  if has_table_privilege('authenticated', 'plm.asset_file_style_guide_index', 'select')
     or not has_table_privilege('service_role', 'plm.asset_file_style_guide_index', 'select')
     or not has_table_privilege('authenticated', 'public.sku_style_guide_links', 'select') then
    raise exception 'Internal index must be service-only; UI results must remain readable';
  end if;
  foreach privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.sku_style_guide_links', privilege) then
      raise exception 'Authenticated must not have % on SKU style-guide results', privilege;
    end if;
  end loop;
  -- Runtime ACLs are asserted only for objects this migration introduces. The
  -- three replaced parsers (backfill_pdf_files_used, parse_pdf_files_used,
  -- parse_pdf_declared_style_guide) also carry explicit revokes here, but the CI
  -- harness restores baseline routine snapshots AFTER the migrations run
  -- (database-contract-tests.yml step "Prove pass-2 routine restoration"), which
  -- re-grants their baseline ACLs and would make a runtime assertion lie about
  -- this migration. Their revoke statements are pinned statically in
  -- scripts/sku-style-guide-links.test.mjs instead.
  foreach service_function in array array[
    'public.resolve_sku_style_guide_links()',
    'public.parse_pdf_files_used_v2(uuid)',
    'public.backfill_pdf_files_used_v2()',
    'public.parse_pdf_declared_style_guide(uuid)'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_function_privilege(role_name, service_function, 'EXECUTE') then
        raise exception '% must not execute %', role_name, service_function;
      end if;
    end loop;
    if not has_function_privilege('service_role', service_function, 'EXECUTE') then
      raise exception 'Service role must execute %', service_function;
    end if;
  end loop;
  if definition ~ '(sega_style_guide_candidate|wildbrain_asset_guide|wildbrain_guide)' then
    raise exception 'Inferred relationships leaked into the direct-source index';
  end if;
  if public.file_name_norm(E'C:\\art\\Hero.PSD') is distinct from 'hero'
     or public.file_name_norm('/art/MS_Core3.0_Extension_comp_02')
        is distinct from 'ms_core3.0_extension_comp_02'
     or public.file_name_norm('   ') is not null
     or public.file_name_norm(null) is not null
     or public.style_guide_label_norm(' The Hero: Guide! ') is distinct from 'hero guide' then
    raise exception 'Filename or guide normalization regressed';
  end if;
  if public.is_plausible_source_file_name('123')
     or public.is_plausible_source_file_name('see attached')
     or public.is_plausible_source_file_name(repeat('a', 201))
     or not public.is_plausible_source_file_name(repeat('a', 200)) then
    raise exception 'Filename noise/length filter regressed';
  end if;
end;
$contract$;

-- Swap only test inputs, transactionally. The real result table, constraints,
-- parsers and resolver remain in use. ROLLBACK restores every original object.
alter table public.assets rename to sku_style_contract_original_assets;
alter table public.pdf_text_samples rename to sku_style_contract_original_samples;
alter table public.sku_files_used rename to sku_style_contract_original_files;
create table public.assets (id uuid primary key, sku text, file_type text, filename text);
create table public.pdf_text_samples (
  asset_id uuid, extracted_text text, sampled_at timestamptz, char_count integer
);
create table public.sku_files_used (
  sku text, file_name text, source text, unique (sku, file_name)
);
create table public.sku_style_contract_index (
  source_system text, file_name_norm text, source_style_guide_key text,
  style_guide_label text, core_style_guide_id uuid, matched_file_name text
);
create or replace view plm.asset_file_style_guide_index with (security_invoker = true) as
  select * from public.sku_style_contract_index;

insert into public.assets values
 ('50910000-0000-0000-0000-000000000001', '#5091-inline', 'pdf', 'licensing_sheet.pdf'),
 ('50910000-0000-0000-0000-000000000002', '#5091-lines', 'pdf', 'tech_pack.pdf'),
 ('50910000-0000-0000-0000-000000000003', '#5091-ignore', 'pdf', 'catalog.pdf');
insert into public.pdf_text_samples values
 ('50910000-0000-0000-0000-000000000001', E'FILES USED: stale.psd', '2020-01-01', 120),
 ('50910000-0000-0000-0000-000000000001',
  E'FILES USED: Hero.PSD; Shared | Third.ai.,; 123; none\nCORE/STYLE GUIDE USED: The Hero Guide',
  '2020-01-02', 120),
 ('50910000-0000-0000-0000-000000000001',
  E'FILES USED: Hero.PSD; Shared | Third.ai.,; 123; none\nCORE/STYLE GUIDE USED: The Hero Guide',
  '2020-01-03', 120),
 ('50910000-0000-0000-0000-000000000002',
  E'SOURCE ART:\nLine_A.psd\n\nNot_a_file.psd\nARTWORK FILES:\nLine_B.ai\nNEXT FIELD:\nNot_a_file_either.psd',
  '2020-01-02', 120),
 ('50910000-0000-0000-0000-000000000003', E'FILES USED: Wrong.psd', '2020-01-02', 120);

insert into public.sku_style_contract_index values
 ('contract', 'hero', 'hero', 'Hero Guide', null, 'Hero.PSD'),
 ('contract', 'hero', 'hero', 'The Hero Guide!', null, 'hero.psd'),
 ('contract', 'shared', 'shared-a', 'Shared A', null, 'Shared.psd'),
 ('contract', 'shared', 'shared-b', 'Shared B', null, 'Shared.ai');

do $contract$
declare
  n integer;
  before_count integer;
  result jsonb;
begin
  n := public.parse_pdf_files_used_v2('50910000-0000-0000-0000-000000000001');
  if n <> 3 or (select count(*) from public.sku_files_used where sku = '#5091-inline') <> 3
     or not exists (select 1 from public.sku_files_used where file_name = 'Third.ai') then
    raise exception 'Inline delimiters, punctuation, noise or latest-sample selection regressed: n=%, rows=%, names=%, body=%',
      n,
      (select count(*) from public.sku_files_used where sku = '#5091-inline'),
      (select coalesce(string_agg(file_name, ' | '), '<none>') from public.sku_files_used where sku = '#5091-inline'),
      (select prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'parse_pdf_files_used_v2');
  end if;
  perform public.parse_pdf_files_used_v2('50910000-0000-0000-0000-000000000001');
  if (select count(*) from public.sku_files_used where sku = '#5091-inline') <> 3 then
    raise exception 'Repeated parsing duplicated files';
  end if;
  n := public.parse_pdf_files_used_v2('50910000-0000-0000-0000-000000000002');
  if n <> 2 or exists (select 1 from public.sku_files_used where file_name like 'Not_a_file%') then
    raise exception 'Multiline section boundaries regressed';
  end if;
  if public.parse_pdf_files_used_v2('50910000-0000-0000-0000-000000000003') <> 0 then
    raise exception 'Non-source PDF was parsed';
  end if;
  -- Exercise the historical backfill independently of the per-asset calls.
  delete from public.sku_files_used;
  n := public.backfill_pdf_files_used_v2();
  if n <> 5 or (select count(*) from public.sku_files_used) <> 5
     or not exists (select 1 from public.sku_style_guide_links
       where sku = '#5091-inline' and source_system = 'sheet_declared') then
    raise exception 'Historical backfill failed to run both parsers: %', n;
  end if;
  result := public.resolve_sku_style_guide_links();
  if (result->>'filename_rows')::integer <> 3
     or (result->>'declared_rows')::integer <> 1
     or (result->>'label_match_rows')::integer <> 1 then
    raise exception 'Resolver arms returned unexpected counts: %', result;
  end if;
  if not exists (select 1 from public.sku_style_guide_links
      where sku = '#5091-inline' and file_name = 'Hero.PSD'
        and match_method = 'filename_exact' and match_confidence = 1)
     or (select count(*) from public.sku_style_guide_links
      where sku = '#5091-inline' and file_name = 'Shared'
        and match_method = 'filename_normalized' and match_confidence = 0.5) <> 2
     or not exists (select 1 from public.sku_style_guide_links
      where sku = '#5091-inline' and source_system = 'sheet_declared'
        and file_name is null and style_guide_label = 'The Hero Guide')
     or not exists (select 1 from public.sku_style_guide_links
      where sku = '#5091-inline' and source_system = 'contract'
        and file_name is null and match_method = 'sheet_label_match') then
    raise exception 'Resolver evidence, confidence or NULL-file identity regressed';
  end if;
  -- A re-derived exact match must replace an older normalized classification.
  update public.sku_style_guide_links set match_method = 'filename_normalized'
    where sku = '#5091-inline' and file_name = 'Hero.PSD';
  perform public.resolve_sku_style_guide_links();
  if not exists (select 1 from public.sku_style_guide_links
      where sku = '#5091-inline' and file_name = 'Hero.PSD'
        and match_method = 'filename_exact' and match_confidence = 1) then
    raise exception 'Resolver retained a stale match method';
  end if;
  select count(*) into before_count from public.sku_style_guide_links where sku like '#5091-%';
  perform public.resolve_sku_style_guide_links();
  if (select count(*) from public.sku_style_guide_links where sku like '#5091-%') <> before_count then
    raise exception 'Resolver rerun duplicated identity keys';
  end if;
  delete from public.sku_style_contract_index;
  perform public.resolve_sku_style_guide_links();
  if (select count(*) from public.sku_style_guide_links where sku like '#5091-%') <> before_count then
    raise exception 'Resolver deleted quarantined evidence';
  end if;
end;
$contract$;
rollback;
