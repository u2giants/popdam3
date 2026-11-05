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
  asset_id uuid, extracted_text text, sampled_at timestamptz, char_count integer,
  declared_style_guide_label text, declared_style_guide_key text
);
create trigger sku_sg_pdf_keys before insert or update of extracted_text, declared_style_guide_label, declared_style_guide_key
  on public.pdf_text_samples for each row execute function public.sku_sg_pdf_keys();
create table public.sku_files_used (
  sku text, file_name text, source text, unique (sku, file_name)
);
create table public.sku_style_contract_index (
  source_system text, file_name_norm text, source_style_guide_key text,
  style_guide_label text, core_style_guide_id uuid, matched_file_name text
);
create or replace view plm.asset_file_style_guide_index with (security_invoker = true) as
  select * from public.sku_style_contract_index;
create or replace view plm.asset_file_style_guide_keys with (security_invoker = true) as
  select *, public.style_guide_label_norm(style_guide_label) as style_guide_label_key
  from public.sku_style_contract_index;

insert into public.assets values
 ('50910000-0000-0000-0000-000000000001', '#5091-inline', 'pdf', 'licensing_sheet.pdf'),
 ('50910000-0000-0000-0000-000000000002', '#5091-lines', 'pdf', 'tech_pack.pdf'),
 ('50910000-0000-0000-0000-000000000003', '#5091-ignore', 'pdf', 'catalog.pdf');
insert into public.pdf_text_samples(asset_id,extracted_text,sampled_at,char_count) values
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
-- #5608: incrementality, old-sheet/new-portal convergence and failure custody.
-- Existing synthetic inputs and fake keyed index above remain transaction-isolated.
do $incremental$
declare r jsonb; n integer; old_seen timestamptz; hash_before text;
begin
  -- Full compatibility calls above covered original match arithmetic. Establish
  -- incremental progress and verify unchanged inputs have no resolver batches.
  perform public.resolve_sku_style_guide_links();
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 0 then raise exception 'Unchanged SKU inputs were queued: %',n; end if;
  r := public.resolve_sku_style_guide_batch(1);
  if (r->>'sku_rows')::integer <> 0 then raise exception 'Empty queue was not empty'; end if;

  -- A portal guide appearing later must rematch the already saved old sheet.
  insert into public.sku_style_contract_index values
    ('contract','new-file','late-guide','The Hero Guide',null,'new-file.psd');
  n := public.prepare_sku_style_guide_resolution(false);
  if n = 0 then raise exception 'New portal observations did not invalidate progress'; end if;
  r := public.resolve_sku_style_guide_batch(1);
  if (r->>'sku_rows')::integer <> 1 then raise exception 'Batch size was not bounded'; end if;
  while (public.resolve_sku_style_guide_batch(1)->>'sku_rows')::integer > 0 loop null; end loop;
  if not exists(select 1 from public.sku_style_guide_links
    where sku='#5091-inline' and source_style_guide_key='late-guide' and match_method='sheet_label_match') then
    raise exception 'New portal guide did not match old licensing sheet';
  end if;


  -- A parser may touch a valid result between nights. Membership, not a
  -- last_seen equality heuristic, must refresh it on the next unchanged run.
  update public.sku_style_guide_links set last_seen_at=clock_timestamp()
    where sku='#5091-inline' and source_system='sheet_declared';
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 0 or exists(select 1 from public.sku_style_guide_links
    where sku='#5091-inline' and source_system='sheet_declared' and last_seen_at<>now()) then
    raise exception 'Independent parser timestamp prevented nightly freshness';
  end if;
  -- Equivalent OCR spellings use the original min(label), even when the parser
  -- independently replaced that value without changing any input fingerprint.
  update public.sku_style_guide_links set style_guide_label='The Hero Guide!'
    where sku='#5091-inline' and source_system='sheet_declared';
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 1 then raise exception 'Changed resolver output must queue its SKU'; end if;
  perform public.resolve_sku_style_guide_batch(1);
  if not exists(select 1 from public.sku_style_guide_links
    where sku='#5091-inline' and source_system='sheet_declared' and style_guide_label='The Hero Guide') then
    raise exception 'External parser edit was not restored to original min(label)';
  end if;

  -- Exact spelling is part of portal fingerprint even when normalized key is unchanged.
  select portal_hash into hash_before from public.sku_style_guide_resolver_progress where sku='#5091-inline';
  update public.sku_style_contract_index set matched_file_name='NEW-FILE.PSD';
  perform public.prepare_sku_style_guide_resolution(false);
  if not exists(select 1 from pg_temp.sku_sg_pending where portal_hash<>hash_before) then
    raise exception 'Exact portal filename spelling was omitted from fingerprint';
  end if;
  while (public.resolve_sku_style_guide_batch(1)->>'sku_rows')::integer > 0 loop null; end loop;

  -- New files-used rows are detected independently of portal change.
  insert into public.sku_files_used values('#5091-inline','NEW-FILE.PSD','contract');
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 1 then raise exception 'Changed files-used input must queue one SKU: %', n; end if;
  perform public.resolve_sku_style_guide_batch(1);
  if not exists(select 1 from public.sku_style_guide_links
    where sku='#5091-inline' and file_name='NEW-FILE.PSD' and match_method='filename_exact') then
    raise exception 'New files-used row did not resolve exact filename';
  end if;

  -- A failed batch must retain its pending work and last durable progress.
  perform public.prepare_sku_style_guide_resolution(true);
  select input_hash into hash_before from public.sku_style_guide_resolver_progress where sku='#5091-inline';
  begin
    perform public.resolve_sku_style_guide_batch(0);
    raise exception 'Invalid batch should have failed';
  exception when raise_exception then
    if sqlerrm='Invalid batch should have failed' then raise; end if;
  end;
  if (select input_hash from public.sku_style_guide_resolver_progress where sku='#5091-inline') is distinct from hash_before
     or not exists(select 1 from pg_temp.sku_sg_pending where sku='#5091-inline') then
    raise exception 'Failed batch advanced or discarded progress';
  end if;

  -- Removed portal inputs invalidate progress without deleting quarantine rows.
  select count(*) into n from public.sku_style_guide_links where sku like '#5091-%';
  delete from public.sku_style_contract_index;
  perform public.prepare_sku_style_guide_resolution(false);
  while (public.resolve_sku_style_guide_batch(1)->>'sku_rows')::integer > 0 loop null; end loop;
  if (select count(*) from public.sku_style_guide_links where sku like '#5091-%') <> n then
    raise exception 'Incremental portal deletion removed quarantined evidence';
  end if;
  update public.sku_style_guide_links set last_seen_at='2000-01-01'
    where sku='#5091-inline' and source_system='contract';
  perform public.prepare_sku_style_guide_resolution(false);
  if exists(select 1 from public.sku_style_guide_links where sku='#5091-inline'
    and source_system='contract' and last_seen_at<>'2000-01-01'::timestamptz) then
    raise exception 'Unchanged run refreshed removed portal evidence';
  end if;

  -- Changing a saved sheet label computes new keys and queues its existing SKU.
  update public.pdf_text_samples set extracted_text='CORE/STYLE GUIDE USED: The Changed Guide'
    where asset_id='50910000-0000-0000-0000-000000000001';
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 1 then raise exception 'Changed PDF label must queue its SKU: %',n;end if;
  perform public.resolve_sku_style_guide_batch(1);
  if not exists(select 1 from public.sku_style_guide_links where sku='#5091-inline'
    and source_system='sheet_declared' and source_style_guide_key='changed guide') then
    raise exception 'Changed sheet key did not converge';
  end if;
  update public.sku_style_guide_links set last_seen_at='2000-01-01'
    where sku='#5091-inline' and source_system='sheet_declared' and source_style_guide_key='hero guide';
  n := public.prepare_sku_style_guide_resolution(false);
  if n <> 0 or exists(select 1 from public.sku_style_guide_links where sku='#5091-inline'
    and source_system='sheet_declared' and source_style_guide_key='hero guide'
    and last_seen_at<>'2000-01-01'::timestamptz) then
    raise exception 'Removed sheet declaration was refreshed or deleted';
  end if;
end;
$incremental$;

rollback;
