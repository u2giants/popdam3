-- #4081: behavioral proof that a Warner product-catalogue row is hidden when
-- an art-assets row with the same source_id exists (catalogue-only titles stay),
-- and that Lucasfilm rows whose source_ids differ only in hyphen runs collapse
-- to one row (to the Disney row when a Disney identity matches).
--
-- Run by .github/workflows/database-contract-tests.yml inside a rolled-back
-- transaction. EVERY VALUE IN THIS FILE IS INVENTED (ZZTEST labels).

do $$
declare
  v_profile uuid;
  v_auth uuid;
  v_role_id uuid;
  v_result jsonb;
  v_rows jsonb;
  v_capture_id uuid;
  v_art integer := 0; v_cat_twin integer := 0; v_cat_only integer := 0;
  v_luc_first integer := 0; v_luc_other integer := 0; v_luc_disney_variant integer := 0;
  v_disney integer := 0; v_luc_unique integer := 0; v_n integer;
  v_cursor text;
begin
  -- Licensing principal fixture.
  select p.id, p.auth_user_id into v_profile, v_auth
  from app.profile p
  where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1;
  if v_profile is null then
    raise exception 'fixture requires an active authenticated profile';
  end if;
  select r.id into v_role_id from app.role r where r.slug = 'licensing'::app.app_role;
  delete from app.user_role where profile_id = v_profile and role_id = v_role_id;
  delete from app.app_access where profile_id = v_profile and app in ('plm', 'admin');
  insert into app.user_role (profile_id, role_id) values (v_profile, v_role_id);
  insert into app.app_access (profile_id, app) values (v_profile, 'plm');
  perform set_config('request.jwt.claim.sub', v_auth::text, true);

  -- Warner: one title in both namespaces with the same source_id, and one
  -- catalogue-only title.
  insert into plm.wb_capture
    (capture_id, chunk_number, target, status, captured_at,
     private_source_commit, snapshot_sha256, expected_row_count,
     captured_by, source_url, started_at)
  values
    (extensions.gen_random_uuid(), 0, 'wb_property', 'loading', current_date,
     'zztest', repeat('a', 64), 3,
     'zztest', 'https://example.invalid', now())
  returning capture_id into v_capture_id;

  insert into plm.wb_property
    (source_namespace, identity_method, source_id, fallback_key, label,
     capture_id, capture_chunk, source_url, raw, source_hash)
  values
    ('warner_art_assets', 'source_id', 'zztest-4081-shared', null,
     'ZZTEST 4081 Warner Shared', v_capture_id, 0, 'https://example.invalid', '{}'::jsonb, 'zztest-4081-h1'),
    ('warner_product_catalogue', 'source_id', 'zztest-4081-shared', null,
     'ZZTEST 4081 Warner Shared', v_capture_id, 0, 'https://example.invalid', '{}'::jsonb, 'zztest-4081-h2'),
    ('warner_product_catalogue', 'source_id', 'zztest-4081-catonly', null,
     'ZZTEST 4081 Warner Catalogue Only', v_capture_id, 0, 'https://example.invalid', '{}'::jsonb, 'zztest-4081-h3');

  -- Star Wars: three Lucasfilm spellings of one slug (no Disney twin; under
  -- collate "C" '-' sorts before letters, so '---title--a' is first), one
  -- Lucasfilm spelling variant of a Disney identity, and one unique slug.
  insert into plm.dcp_property (source_system, source_id, display_name)
  values ('disney_dcpvault', 'dcpvault:zztest-4081---disney-a', 'ZZTEST 4081 Disney');

  insert into plm.lucasfilm_dcp_property (source_system, source_id, display_name)
  values
    ('lucasfilm_dcpvault', 'dcpvault:zztest-4081---title-a', 'ZZTEST 4081 Title'),
    ('lucasfilm_dcpvault', 'dcpvault:zztest-4081-title-a', 'ZZTEST 4081 Title'),
    ('lucasfilm_dcpvault', 'dcpvault:zztest-4081---title--a', 'ZZTEST 4081 Title'),
    ('lucasfilm_dcpvault', 'dcpvault:zztest-4081-disney-a', 'ZZTEST 4081 Disney'),
    ('lucasfilm_dcpvault', 'dcpvault:zztest-4081-unique', 'ZZTEST 4081 Unique');

  v_cursor := null;
  loop
    v_result := api.db_data_admin_scraped_source_inventory('property', 'ZZTEST 4081', v_cursor, 1000);
    v_rows := coalesce(v_result -> 'rows', '[]'::jsonb);

    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'warner_art_assets:source_id:zztest-4081-shared';
    v_art := v_art + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'warner_product_catalogue:source_id:zztest-4081-shared';
    v_cat_twin := v_cat_twin + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_id' = 'warner_product_catalogue:source_id:zztest-4081-catonly';
    v_cat_only := v_cat_only + v_n;

    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'source_id' = 'dcpvault:zztest-4081---title--a';
    v_luc_first := v_luc_first + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'source_id' in ('dcpvault:zztest-4081-title-a', 'dcpvault:zztest-4081---title-a');
    v_luc_other := v_luc_other + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'source_id' = 'dcpvault:zztest-4081-disney-a';
    v_luc_disney_variant := v_luc_disney_variant + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.dcp_property'
      and r ->> 'source_id' = 'dcpvault:zztest-4081---disney-a';
    v_disney := v_disney + v_n;
    select count(*) into v_n from jsonb_array_elements(v_rows) r
    where r ->> 'source_table' = 'plm.lucasfilm_dcp_property'
      and r ->> 'source_id' = 'dcpvault:zztest-4081-unique';
    v_luc_unique := v_luc_unique + v_n;

    exit when (v_result ->> 'next_cursor') is null;
    v_cursor := v_result ->> 'next_cursor';
  end loop;

  if v_art <> 1 then raise exception 'C1: expected the Warner art-assets survivor once, got %', v_art; end if;
  if v_cat_twin <> 0 then raise exception 'C2: Warner catalogue twin still visible (count=%)', v_cat_twin; end if;
  if v_cat_only <> 1 then raise exception 'C3: expected catalogue-only Warner title once, got %', v_cat_only; end if;
  if v_luc_first <> 1 then raise exception 'C4: expected first-sorting Lucasfilm spelling once, got %', v_luc_first; end if;
  if v_luc_other <> 0 then raise exception 'C5: other Lucasfilm spellings still visible (count=%)', v_luc_other; end if;
  if v_luc_disney_variant <> 0 then raise exception 'C6: Lucasfilm spelling variant of a Disney identity still visible (count=%)', v_luc_disney_variant; end if;
  if v_disney <> 1 then raise exception 'C7: expected Disney survivor once, got %', v_disney; end if;
  if v_luc_unique <> 1 then raise exception 'C8: expected unique Lucasfilm identity once, got %', v_luc_unique; end if;
end $$;
