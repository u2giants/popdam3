-- Rollback-safe contracts for issues #1589 and #1936. The 8,000 generated
-- source rows and retained DCP observation history contain no licensed values.

begin;

do $$
declare
  v_sig text := 'api.db_data_admin_scraped_properties(text,text,integer)';
  v_definition text;
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_search text;
  v_role_id uuid;
  v_profile uuid;
  v_auth uuid;
  v_page jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_cursor text;
  v_pages integer := 0;
  v_count integer;
  v_dcp_crawl uuid := gen_random_uuid();
  v_dcp_run uuid := gen_random_uuid();
  v_dcp_run_2 uuid := gen_random_uuid();
  v_dcp_guide uuid;
begin
  v_search := 'Issue1589-' || v_suffix;

  if to_regprocedure(v_sig) is null then
    raise exception 'missing scraped Properties function: %', v_sig;
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'execute')
     or has_function_privilege('anon', v_sig::regprocedure, 'execute')
     or has_function_privilege('service_role', v_sig::regprocedure, 'execute')
     or not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
    raise exception 'scraped Properties execution grants changed';
  end if;

  select pg_get_functiondef(v_sig::regprocedure) into v_definition;
  if position('app.require_licensing_manager_access()' in v_definition) = 0
     or position('plm.opa_property_studio_resolution' in v_definition) = 0
     or position('page_submission_source_candidates as materialized' in v_definition) = 0
     or position('select distinct o.dcp_asset_id' in v_definition) = 0
     or position('page_dcp_context_rows as materialized' in v_definition) = 0
     or position('page_dcp_retained_assets as materialized' in v_definition) = 0
     or position('dcp_asset_context as materialized' in v_definition) = 0
     or position('left join source_rows s' in v_definition) <> 0
     or position('Disney OPA (unsplit)' in v_definition) <> 0 then
    raise exception 'authorization, targeted labels, OPA resolution, or retired-group contract changed';
  end if;
  if to_regclass('plm.idx_dcp_asset_property_obs_property_asset') is null
     or to_regclass('plm.idx_lucasfilm_dcp_asset_property_obs_property_asset') is null then
    raise exception 'covering retained-observation indexes are missing';
  end if;

  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id
  limit 1;
  if v_profile is null then
    raise exception 'fixture requires one active authenticated profile';
  end if;

  select r.id into v_role_id
  from app.role r
  where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  insert into plm.opa_property (licensed_property_id, property_name)
  select -800000000000 - g, v_search || '-OPA-' || lpad(g::text, 4, '0')
  from generate_series(1, 4000) g;

  insert into plm.opa_property_studio_resolution (
    licensed_property_id, studio_code, resolution_status, provenance_type,
    provenance_reference, resolution_reason, resolved_by
  )
  select
    -800000000000 - g,
    case
      when g between 1 and 244 then 'disney'
      when g between 245 and 449 then 'marvel'
      when g between 450 and 451 then 'lucasfilm'
      when g between 452 and 515 then 'pixar'
      else null
    end,
    case
      when g <= 515 then 'canonical'
      when g <= 535 then 'ambiguous_crossover'
      else 'unresolved'
    end,
    case
      when g <= 515 then 'owner_reviewed_resolution'
      when g <= 535 then 'ambiguous_crossover'
      else 'unresolved'
    end,
    case when g <= 535 then 'synthetic-contract' else null end,
    null,
    'issue-1589-contract'
  from generate_series(1, 4000) g;

  -- Populate every valid direct-route branch across a large OPA subset. This
  -- is the stage the production-sized source set previously rescanned per row.
  insert into plm.opa_property_scope_membership (
    licensed_property_id, region_code, branch_code, line_of_business_id,
    product_type_code, template_id, workflow_id, capture_id,
    source_captured_at, approval_status, evidence_reference, evidence_sha256,
    approved_at, approved_by
  )
  select
    -800000000000 - g, 'north-america',
    case when g <= 244 then 'disney' else 'lucasfilm' end,
    200, 'home-standard', 462, 50, v_search || '-scope-' || g,
    clock_timestamp(), 'approved', 'synthetic-populated-scope', repeat('9',64),
    clock_timestamp(), 'contract'
  from generate_series(1, 4000) g
  where g <= 244 or g between 450 and 451;

  -- Populate DCP exact resolutions, members, and their OPA scopes at the same
  -- scale. Temporary identities contain no licensed source values and roll back.
  create temporary table issue1936_dcp_resolution_fixture (
    ordinal integer primary key,
    resolution_id uuid not null
  ) on commit drop;
  insert into issue1936_dcp_resolution_fixture
  select g, gen_random_uuid() from generate_series(1, 4000) g;

  insert into plm.dcp_property (source_system, source_id, display_name)
  select 'disney_dcpvault', v_search || '/DCP-' || lpad(g::text, 4, '0'),
    v_search || ' DCP ' || lpad(g::text, 4, '0')
  from generate_series(1, 4000) g;

  -- Populate the production-shaped dominant path: 250 early page-visible DCP
  -- properties each retain 1,600 distinct assets across two metadata runs.
  -- The resulting 800,000 observations model the measured 2:1 history fanout
  -- and hundreds-of-thousands-of-assets page skew without licensed values.
  insert into plm.dcp_crawl (
    crawl_id,captured_on,portal_base_url,crawler_version,account_scope,
    line_of_business,started_at,captured_by,private_source_commit,status,
    rows_received,distinct_assets_received,finished_at
  ) values (
    v_dcp_crawl,current_date,'https://invalid.example','contract','contract',
    'contract',now(),'contract',repeat('d',40),'running',1600,1600,now()
  );
  insert into plm.dcp_style_guide (
    source_path,folder_name,region,year_segment,first_seen_crawl_id
  ) values (
    '/contract/'||v_suffix||'/guide','Contract Guide '||v_suffix,
    'contract','contract',v_dcp_crawl
  ) returning id into v_dcp_guide;
  create temporary table issue1936_dcp_asset_fixture (
    ordinal integer primary key,
    asset_id uuid not null
  ) on commit drop;
  insert into issue1936_dcp_asset_fixture
  select g,gen_random_uuid() from generate_series(1,1600) g;
  insert into plm.dcp_asset (
    id,source_path,style_guide_id,file_name,file_extension,first_seen_crawl_id
  )
  select asset_id,'/contract/'||v_suffix||'/asset-'||ordinal||'.png',
    v_dcp_guide,'asset-'||ordinal||'.png','png',v_dcp_crawl
  from issue1936_dcp_asset_fixture;
  insert into plm.dcp_asset_crawl (crawl_id,dcp_asset_id,observed_row_hash)
  select v_dcp_crawl,asset_id,repeat('d',64)
  from issue1936_dcp_asset_fixture;
  update plm.dcp_crawl set status='complete' where crawl_id=v_dcp_crawl;
  insert into plm.dcp_metadata_run (
    metadata_run_id,source_crawl_id,status,captured_on,started_at,
    endpoint_suffix,crawler_version,captured_by,private_source_commit,assets_expected
  ) values (
    v_dcp_run,v_dcp_crawl,'planned',current_date,now(),'/contract',
    'contract','contract',repeat('d',40),1600
  );
  insert into plm.dcp_metadata_asset (
    metadata_run_id,source_crawl_id,dcp_asset_id
  )
  select v_dcp_run,v_dcp_crawl,asset_id from issue1936_dcp_asset_fixture;
  update plm.dcp_metadata_asset set
    fetch_status='success',http_status=200,raw_metadata='{"contract":true}',
    retrieved_at=now(),source_hash=repeat('d',64),normalized_hash=repeat('e',64)
  where metadata_run_id=v_dcp_run;
  insert into plm.dcp_metadata_run (
    metadata_run_id,source_crawl_id,status,captured_on,started_at,
    endpoint_suffix,crawler_version,captured_by,private_source_commit,assets_expected
  ) values (
    v_dcp_run_2,v_dcp_crawl,'planned',current_date,now(),'/contract-2',
    'contract','contract',repeat('e',40),1600
  );
  insert into plm.dcp_metadata_asset (
    metadata_run_id,source_crawl_id,dcp_asset_id
  )
  select v_dcp_run_2,v_dcp_crawl,asset_id from issue1936_dcp_asset_fixture;
  update plm.dcp_metadata_asset set
    fetch_status='success',http_status=200,raw_metadata='{"contract":true}',
    retrieved_at=now(),source_hash=repeat('e',64),normalized_hash=repeat('f',64)
  where metadata_run_id=v_dcp_run_2;
  insert into plm.dcp_asset_property_observation (
    metadata_run_id,dcp_asset_id,dcp_property_id
  )
  select r.run_id,a.asset_id,p.id
  from (values (v_dcp_run),(v_dcp_run_2)) r(run_id)
  cross join issue1936_dcp_asset_fixture a
  cross join plm.dcp_property p
  where p.source_system='disney_dcpvault'
    and p.source_id between v_search||'/DCP-0001' and v_search||'/DCP-0250';

  insert into plm.dcp_opa_property_resolution (
    resolution_id, source_system, source_table, source_property_id,
    decision_version, approval_status, evidence_reference, evidence_sha256,
    decision_reason, contract_asserted_studio_code,
    contract_evidence_reference, contract_evidence_sha256,
    approved_at, approved_by
  )
  select f.resolution_id, 'disney_dcpvault', 'plm.dcp_property',
    v_search || '/DCP-' || lpad(f.ordinal::text, 4, '0'), 1, 'approved',
    'synthetic-exact-link', repeat('8',64), 'synthetic populated decision',
    case when f.ordinal % 2 = 0 then 'disney' else 'lucasfilm' end,
    'synthetic-contract', repeat('7',64), clock_timestamp(), 'contract'
  from issue1936_dcp_resolution_fixture f;

  insert into plm.dcp_opa_property_resolution_member (
    resolution_id, licensed_property_id, member_ordinal
  )
  select f.resolution_id, -800000000000 - f.ordinal, 1
  from issue1936_dcp_resolution_fixture f;

  -- Forward-4 regression: every synthetic OPA row on the early pages carries
  -- a real Creative-to-Submissions member whose display label must be resolved
  -- from the DCP source arm. Before the repair, a cursor page could re-run the
  -- complete source union once per mapped row through this exact lateral path.
  create temporary table issue1936_creative_resolution_fixture (
    ordinal integer primary key,
    resolution_id uuid not null
  ) on commit drop;
  insert into issue1936_creative_resolution_fixture
  select g, gen_random_uuid() from generate_series(1, 4000) g;

  insert into plm.creative_submission_property_resolution (
    resolution_id, creative_source_system, creative_source_table,
    creative_source_id, decision_version, decision_state, reviewed_batch_id,
    reviewed_batch_digest, approval_actor_id, approved_at
  )
  select f.resolution_id, 'disney_opa', 'plm.opa_property',
    (-800000000000 - f.ordinal)::text, 1, 'mapped', gen_random_uuid(),
    'sha256:' || repeat('6',64), gen_random_uuid(), clock_timestamp()
  from issue1936_creative_resolution_fixture f;

  insert into plm.creative_submission_property_resolution_member (
    resolution_member_id, resolution_id, submission_source_system,
    submission_source_table, submission_source_id
  )
  select gen_random_uuid(), f.resolution_id, 'disney_dcpvault',
    'plm.dcp_property', v_search || '/DCP-' || lpad(f.ordinal::text, 4, '0')
  from issue1936_creative_resolution_fixture f;

  create temporary table issue1936_dcp_creative_resolution_fixture (
    ordinal integer primary key,
    resolution_id uuid not null
  ) on commit drop;
  insert into issue1936_dcp_creative_resolution_fixture
  select g, gen_random_uuid() from generate_series(1, 4000) g;
  insert into plm.creative_submission_property_resolution (
    resolution_id, creative_source_system, creative_source_table,
    creative_source_id, decision_version, decision_state, reviewed_batch_id,
    reviewed_batch_digest, approval_actor_id, approved_at
  )
  select f.resolution_id, 'disney_dcpvault', 'plm.dcp_property',
    v_search || '/DCP-' || lpad(f.ordinal::text, 4, '0'), 1, 'mapped',
    gen_random_uuid(), 'sha256:' || repeat('5',64), gen_random_uuid(),
    clock_timestamp()
  from issue1936_dcp_creative_resolution_fixture f;
  insert into plm.creative_submission_property_resolution_member (
    resolution_member_id, resolution_id, submission_source_system,
    submission_source_table, submission_source_id
  )
  select gen_random_uuid(), f.resolution_id, 'disney_opa',
    'plm.opa_property', (-800000000000 - f.ordinal)::text
  from issue1936_dcp_creative_resolution_fixture f;

  -- These source-preserving DCP groups must remain distinct from the new OPA groups.
  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', v_search || '/disney-dcp', v_search || ' Disney DCP');
  insert into plm.marvel_dcp_property (source_system, source_id, display_name)
  values ('marvel_dcpvault', v_search || '/marvel-dcp', v_search || ' Marvel DCP');
  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values ('lucasfilm_dcpvault', v_search || '/star-wars-dcp', v_search || ' Star Wars DCP');

  insert into plm.dcp_property_licensor_resolution (
    source_system, source_property_id, presentation_licensor_key,
    presentation_licensor_name, resolution_status, authority_kind,
    authority_reference, evidence_reference, source_hash, resolved_at,
    decision_version, approval_status, approved_at, approved_by, decision_reason
  ) values
    ('disney_dcpvault', v_search || '/disney-dcp', 'disney', 'Disney',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('a',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('marvel_dcpvault', v_search || '/marvel-dcp', 'marvel', 'Marvel',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('b',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision'),
    ('lucasfilm_dcpvault', v_search || '/star-wars-dcp', 'star-wars', 'Star Wars',
     'supported_core_ownership', 'synthetic', 'synthetic', 'synthetic', repeat('c',64), now(), 1, 'approved', now(), 'contract', 'synthetic decision');

  -- The public gateway cancels at ten seconds. Keep more than 50% headroom on
  -- every populated first-page and cursor-page call.
  perform set_config('statement_timeout', '4000', true);
  select api.db_data_admin_scraped_properties(v_search, null, 1000) into v_page;
  if jsonb_array_length(v_page -> 'rows') <> 1000
     or nullif(v_page ->> 'next_cursor','') is null then
    raise exception 'populated first page did not return 1,000 rows and a real cursor';
  end if;
  v_rows := v_page -> 'rows';
  v_cursor := v_page ->> 'next_cursor';
  v_pages := 1;

  -- This is an actual cursor returned by page 1, not a fabricated boundary.
  select api.db_data_admin_scraped_properties(v_search, v_cursor, 1000) into v_page;
  if jsonb_array_length(v_page -> 'rows') <> 1000
     or nullif(v_page ->> 'next_cursor','') is null then
    raise exception 'populated real cursor page 2 did not return 1,000 rows and a cursor';
  end if;
  if (select count(*) from jsonb_array_elements(v_page -> 'rows') r
      where r ->> 'mapping_state' = 'mapped'
        and jsonb_array_length(r -> 'submissions') = 1) < 995 then
    raise exception 'real cursor page 2 did not exercise the populated submission-label path';
  end if;
  v_rows := v_rows || (v_page -> 'rows');
  v_cursor := v_page ->> 'next_cursor';
  v_pages := 2;

  loop
    exit when v_cursor is null;
    select api.db_data_admin_scraped_properties(v_search, v_cursor, 1000) into v_page;
    v_rows := v_rows || (v_page -> 'rows');
    v_cursor := v_page ->> 'next_cursor';
    v_pages := v_pages + 1;
    exit when v_cursor is null;
    if v_pages > 9 then
      raise exception 'OPA pagination did not terminate';
    end if;
  end loop;
  perform set_config('statement_timeout', '0', true);

  select count(*) into v_count
  from jsonb_array_elements(v_rows) r
  where r ->> 'source_table' = 'plm.opa_property';
  if v_count <> 4000 then
    raise exception 'expected exactly 4,000 OPA rows, got %', v_count;
  end if;

  select count(distinct r ->> 'source_property_id') into v_count
  from jsonb_array_elements(v_rows) r
  where r ->> 'source_table' = 'plm.opa_property';
  if v_count <> 4000 then
    raise exception 'OPA source identities were omitted or repeated: % distinct', v_count;
  end if;

  if (select count(*) from jsonb_array_elements(v_rows) r
      where r ->> 'source_table'='plm.dcp_property'
        and (r ->> 'asset_count')::integer=1600
        and (r ->> 'style_guide_count')::integer=1
        and jsonb_array_length(r -> 'style_guide_names')=1) <> 250
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table'='plm.dcp_property'
           and (r ->> 'asset_count')::integer=0
           and (r ->> 'style_guide_count')::integer=0
           and jsonb_array_length(r -> 'style_guide_names')=0) <> 3751 then
    raise exception 'retained DCP asset/style context was lost or duplicated';
  end if;

  if (select count(*) from jsonb_array_elements(v_rows) r
      where r ->> 'source_table' = 'plm.opa_property'
        and r ->> 'presentation_licensor_name' = 'Disney - Submissions (OPA)') <> 244
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Marvel - Submissions (OPA)') <> 205
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Lucasfilm / Star Wars - Submissions (OPA)') <> 2
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'Pixar - Submissions (OPA)') <> 64
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'OPA - Submissions (scope conflict)') <> 20
     or (select count(*) from jsonb_array_elements(v_rows) r
         where r ->> 'source_table' = 'plm.opa_property'
           and r ->> 'presentation_licensor_name' = 'OPA - Submissions (unresolved)') <> 3465 then
    raise exception 'the six OPA presentation outcomes changed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'presentation_licensor_name' = 'Disney OPA (unsplit)'
  ) then
    raise exception 'retired Disney OPA unsplit group remains visible';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Creative - unresolved authority'
      and r ->> 'source_system' = 'disney_dcpvault'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.marvel_dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Vault - Creative (non-authoritative Marvel tag)'
      and r ->> 'source_system' = 'marvel_dcpvault'
  ) or not exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'presentation_licensor_name' = 'DCP Creative - unresolved authority'
      and r ->> 'source_system' = 'lucasfilm_dcpvault'
  ) then
    raise exception 'DCP Creative authority presentation or provenance changed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) r
    where r ?| array['raw', 'source_url', 'licensed_asset', 'metadata']
  ) then
    raise exception 'restricted fields leaked through the API envelope';
  end if;
end $$;

rollback;
