-- Rollback-safe Step 10 contract test for the Licensor -> Property tree.
-- Run on preview only after migration 20260722203000 is applied.
--
-- Proves (all counts derived from the live canonical tables inside this
-- transaction — no timeless hard-coded production row counts):
--   * function signature, SECURITY DEFINER gating, and grants
--     (EXECUTE revoked from public; granted to authenticated);
--   * the full authorization matrix, including denial of an administrator
--     WITHOUT an explicit, non-revoked `admin` app_access grant, denial of a
--     non-administrator WITH a grant, and revoke/un-revoke behavior;
--   * exact canonical reconciliation: the snapshot's licensor/property counts
--     equal the live core.licensor / core.property counts in the same
--     transaction, the with-licensor + orphan partition reconciles, and the
--     "expected orphan count is zero" flag tracks reality;
--   * every canonical Property appears under exactly one Licensor or as a
--     loud orphan — no duplicates, none lost across the full paginated
--     payload;
--   * loud orphan behavior: a null-licensor property is surfaced in a
--     separate, always-complete orphan_properties list with licensor_id null;
--   * division/type-qualified source context (plm_context carries
--     division_code + mg_code + an explicit mg_type label, and a licensor
--     with two source divisions shows both);
--   * the edge is NEVER inferred from mg_code or globally unique codes: a
--     property whose PLM mg_code collides with a different licensor's code is
--     still nested under the licensor named by its core.property.licensor_id;
--   * dated snapshot metadata (snapshot_at, store, feeder status) and that
--     live_upstream_reconciliation is always false and is independent of
--     feeder_available (observed feeder recency never implies a live
--     upstream reconciliation claim);
--   * search, inactive inclusion, and invalid-cursor rejection.

begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_sig text := 'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)';
  v_role_id uuid;
  v_admin_profile uuid;
  v_admin_auth uuid;
  v_no_grant_profile uuid;
  v_no_grant_auth uuid;
  v_non_admin_profile uuid;
  v_non_admin_auth uuid;
  v_call text := 'api.db_data_admin_licensor_property_tree()';
  v_calls text[];
  v_result jsonb;
  v_page jsonb;
  v_cursor text;
  v_pages integer;
  v_all_licensors jsonb := '[]'::jsonb;
  v_orphans jsonb;
  v_core_licensors integer;
  v_core_properties integer;
  v_core_orphan integer;
  v_core_with_lic integer;
  v_lic_a uuid;
  v_lic_b uuid;
  v_lic_inactive uuid;
  v_prop1 uuid;
  v_prop2 uuid;
  v_prop_collide uuid;
  v_prop_inactive uuid;
  v_orphan uuid;
  v_nested integer;
  v_total_appearances integer;
  v_distinct_ids integer;
  v_lic_a_node jsonb;
  v_lic_b_node jsonb;
begin
  v_calls := array[v_call];

  -- ------------------------------------------------------------------
  -- Static object and privilege assertions.
  -- ------------------------------------------------------------------
  if to_regprocedure(v_sig) is null then
    raise exception 'missing protected function: %', v_sig;
  end if;
  if has_function_privilege('public', v_sig::regprocedure, 'execute') then
    raise exception 'public can execute %', v_sig;
  end if;
  if not has_function_privilege('authenticated', v_sig::regprocedure, 'execute') then
    raise exception 'authenticated cannot execute %', v_sig;
  end if;
  -- SECURITY DEFINER: the definer (not the caller) owns the body.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'db_data_admin_licensor_property_tree'
      and p.prosecdef = true
  ) then
    raise exception 'licensor_property_tree must be SECURITY DEFINER';
  end if;

  -- ------------------------------------------------------------------
  -- Fixture identities: reuse three active preview profiles. Role/access
  -- rows are normalized inside this transaction and restored by rollback.
  -- ------------------------------------------------------------------
  select p.id, p.auth_user_id into v_admin_profile, v_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 0;
  select p.id, p.auth_user_id into v_no_grant_profile, v_no_grant_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 1;
  select p.id, p.auth_user_id into v_non_admin_profile, v_non_admin_auth
  from app.profile p where p.status = 'active' and p.auth_user_id is not null
  order by p.created_at, p.id limit 1 offset 2;
  if v_non_admin_profile is null then
    raise exception 'fixture requires three active authenticated profiles';
  end if;

  select r.id into v_role_id from app.role r where r.slug = 'administrator'::app.app_role;
  if v_role_id is null then
    raise exception 'fixture requires the administrator role';
  end if;

  delete from app.user_role
  where profile_id in (v_admin_profile, v_no_grant_profile, v_non_admin_profile)
    and role_id = v_role_id;
  delete from app.app_access
  where profile_id in (v_admin_profile, v_no_grant_profile, v_non_admin_profile)
    and app = 'admin';
  insert into app.user_role (profile_id, role_id) values
    (v_admin_profile, v_role_id),
    (v_no_grant_profile, v_role_id);
  insert into app.app_access (profile_id, app) values
    (v_admin_profile, 'admin'),
    (v_non_admin_profile, 'admin');

  -- ------------------------------------------------------------------
  -- Authorization matrix.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  foreach v_call in array v_calls loop
    begin
      execute 'select ' || v_call;
    exception
      when insufficient_privilege then
        raise exception 'authorized administrator was denied on %', v_call;
    end;
  end loop;

  perform set_config('request.jwt.claim.sub', v_no_grant_auth::text, true);
  begin
    perform api.db_data_admin_licensor_property_tree();
    raise exception 'administrator without explicit admin grant was allowed';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_non_admin_auth::text, true);
  begin
    perform api.db_data_admin_licensor_property_tree();
    raise exception 'non-administrator with explicit grant was allowed';
  exception
    when insufficient_privilege then null;
  end;

  update app.app_access set revoked_at = now()
  where profile_id = v_admin_profile and app = 'admin';
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);
  begin
    perform api.db_data_admin_licensor_property_tree();
    raise exception 'revoked admin grant was accepted';
  exception
    when insufficient_privilege then null;
  end;
  update app.app_access set revoked_at = null
  where profile_id = v_admin_profile and app = 'admin';

  -- ------------------------------------------------------------------
  -- Canonical fixtures (as the authorized administrator).
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin_auth::text, true);

  insert into core.licensor (name, code, status)
  values ('Step10 Licensor Alpha ' || v_suffix, 'LICA-' || v_suffix, 'active')
  returning id into v_lic_a;
  insert into core.licensor (name, code, status)
  values ('Step10 Licensor Bravo ' || v_suffix, 'LICB-' || v_suffix, 'active')
  returning id into v_lic_b;
  insert into core.licensor (name, code, status)
  values ('Step10 Licensor Inactive ' || v_suffix, 'LICI-' || v_suffix, 'inactive')
  returning id into v_lic_inactive;

  insert into core.property (licensor_id, name, code, status)
  values (v_lic_a, 'Step10 Property One ' || v_suffix, 'P1-' || v_suffix, 'active')
  returning id into v_prop1;
  insert into core.property (licensor_id, name, code, status)
  values (v_lic_a, 'Step10 Property Two ' || v_suffix, 'P2-' || v_suffix, 'active')
  returning id into v_prop2;
  -- Collision fixture: PLM mg_code collides with licensor Bravo's code, but
  -- the canonical edge (licensor_id) points at Alpha. It must nest under Alpha.
  insert into core.property (licensor_id, name, code, status)
  values (v_lic_a, 'Step10 Property Collide ' || v_suffix, 'PC-' || v_suffix, 'active')
  returning id into v_prop_collide;
  insert into core.property (licensor_id, name, code, status)
  values (v_lic_inactive, 'Step10 Property Inactive ' || v_suffix, 'PI-' || v_suffix, 'inactive')
  returning id into v_prop_inactive;
  insert into core.property (licensor_id, name, code, status)
  values (null, 'Step10 Orphan Property ' || v_suffix, 'PO-' || v_suffix, 'active')
  returning id into v_orphan;

  insert into core.character (property_id, name, status)
  values (v_prop1, 'Step10 Character ' || v_suffix, 'active');

  insert into core.taxonomy_source_ref (entity_schema, entity_table, entity_id,
                                        source_system, source_table, source_id,
                                        source_code, source_name)
  values ('core', 'licensor', v_lic_a, 'designflow_plm', 'merchGroup',
          'S10LA-' || v_suffix, 'LICA-' || v_suffix, 'Step10 Licensor Alpha Source');
  insert into core.taxonomy_source_ref (entity_schema, entity_table, entity_id,
                                        source_system, source_table, source_id,
                                        source_code, source_name)
  values ('core', 'property', v_prop1, 'designflow_plm', 'merchGroup',
          'S10P1-' || v_suffix, 'P1-' || v_suffix, 'Step10 Property One Source');

  -- Division-qualified PLM context: Alpha carries two source divisions
  -- (the POP-Lic / Spruce-Lic collapse documented in the taxonomy doc).
  insert into plm.licensor_import (plm_licensor_id, licensor_id, title, mg_code,
                                    division_code, mg_category)
  values ('S10-LA-CW-' || v_suffix, v_lic_a, 'Step10 Licensor Alpha ' || v_suffix,
          'LICA-' || v_suffix, 'CW001', 'licensed'),
         ('S10-LA-SP-' || v_suffix, v_lic_a, 'Step10 Licensor Alpha ' || v_suffix,
          'LICA-' || v_suffix, 'SP001', 'licensed');
  -- The collide property's PLM row carries Bravo's code under Alpha.
  insert into plm.property_import (plm_property_id, property_id, licensor_id, title,
                                    mg_code, division_code, mg_category)
  values ('S10-PC-' || v_suffix, v_prop_collide, v_lic_a,
          'Step10 Property Collide ' || v_suffix, 'LICB-' || v_suffix, 'CW001', 'licensed');

  -- ------------------------------------------------------------------
  -- Default call: hide inactive. Alpha and Bravo are visible; the inactive
  -- licensor and its property are not; the orphan is always surfaced.
  -- ------------------------------------------------------------------
  select api.db_data_admin_licensor_property_tree('Step10 Licensor Alpha ' || v_suffix)
  into v_result;
  if jsonb_array_length(v_result -> 'licensors') <> 1
     or (v_result -> 'licensors' -> 0 ->> 'id')::uuid <> v_lic_a then
    raise exception 'search must return exactly licensor Alpha';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result -> 'orphan_properties') p
    where (p ->> 'id')::uuid = v_orphan
  ) then
    raise exception 'orphan must be surfaced even on a filtered search page';
  end if;

  -- ------------------------------------------------------------------
  -- Full snapshot with inactive included: load every page.
  -- ------------------------------------------------------------------
  v_all_licensors := '[]'::jsonb;
  v_cursor := null;
  v_pages := 0;
  loop
    select api.db_data_admin_licensor_property_tree(null, true, v_cursor, 200)
    into v_page;
    v_pages := v_pages + 1;
    v_all_licensors := v_all_licensors || (v_page -> 'licensors');
    v_orphans := v_page -> 'orphan_properties';      -- always complete per page
    v_result := v_page;                               -- last page carries snapshot+reconciliation
    v_cursor := v_page ->> 'next_cursor';
    exit when v_cursor is null;
    if v_pages > 50 then
      raise exception 'tree pagination did not terminate';
    end if;
  end loop;

  -- Dated snapshot metadata and honest feeder status.
  if v_result -> 'snapshot' ->> 'snapshot_at' is null then
    raise exception 'snapshot must carry a dated snapshot_at';
  end if;
  if position('core.licensor' in coalesce(v_result -> 'snapshot' ->> 'store', '')) = 0 then
    raise exception 'snapshot store must name the canonical tables';
  end if;
  if v_result -> 'snapshot' ->> 'source_system' is distinct from 'designflow_plm' then
    raise exception 'snapshot source_system must be designflow_plm';
  end if;
  if not (v_result -> 'snapshot' ? 'feeder_available')
     or not (v_result -> 'snapshot' ? 'feeder_last_run_status') then
    raise exception 'snapshot must expose feeder availability and last run status';
  end if;
  -- live_upstream_reconciliation is false unconditionally: this RPC reads
  -- only the canonical mirror + ingest.sync_run and never reconciles against
  -- live DesignFlow. It must NOT track feeder_available (observed recency),
  -- so the two booleans are intentionally decoupled.
  if (v_result -> 'snapshot' ->> 'live_upstream_reconciliation')::boolean
     is distinct from false then
    raise exception 'live_upstream_reconciliation must always be false (mirror-only; observed feeder recency does not imply live reconciliation)';
  end if;
  if v_result -> 'snapshot' ->> 'note' is null then
    raise exception 'snapshot must carry a provenance note';
  end if;

  -- Exact canonical reconciliation, derived from the live tables.
  select count(*) into v_core_licensors from core.licensor;
  select count(*),
         count(*) filter (where licensor_id is null),
         count(*) filter (where licensor_id is not null)
  into v_core_properties, v_core_orphan, v_core_with_lic
  from core.property;

  if (v_result -> 'reconciliation' ->> 'licensor_count')::integer <> v_core_licensors then
    raise exception 'reconciliation licensor_count must equal live core.licensor count';
  end if;
  if (v_result -> 'reconciliation' ->> 'property_count')::integer <> v_core_properties then
    raise exception 'reconciliation property_count must equal live core.property count';
  end if;
  if (v_result -> 'reconciliation' ->> 'orphan_property_count')::integer <> v_core_orphan then
    raise exception 'reconciliation orphan_property_count must equal live orphan count';
  end if;
  if (v_result -> 'reconciliation' ->> 'properties_with_licensor')::integer <> v_core_with_lic then
    raise exception 'reconciliation properties_with_licensor must equal live count';
  end if;
  if (v_result -> 'reconciliation' ->> 'partition_reconciles')::boolean is distinct from true then
    raise exception 'with-licensor + orphan partition must reconcile to total';
  end if;
  if (v_result -> 'reconciliation' ->> 'expected_orphan_count_is_zero')::boolean
     is distinct from (v_core_orphan = 0) then
    raise exception 'expected_orphan_count_is_zero must track the live orphan count';
  end if;

  -- Every canonical Property appears under exactly one Licensor or as a loud
  -- orphan: no duplicates, none lost across the full paginated payload.
  select coalesce(sum(jsonb_array_length(l -> 'properties')), 0)
  into v_nested
  from jsonb_array_elements(v_all_licensors) l;
  v_total_appearances := v_nested + jsonb_array_length(v_orphans);
  if v_total_appearances <> v_core_properties then
    raise exception 'payload property appearances (%) must equal canonical total (%)',
      v_total_appearances, v_core_properties;
  end if;
  select count(distinct pid) into v_distinct_ids from (
    select (l -> 'properties' -> i ->> 'id')::uuid as pid
    from jsonb_array_elements(v_all_licensors) l,
         generate_series(0, greatest(jsonb_array_length(l -> 'properties') - 1, -1)) i
    where jsonb_array_length(l -> 'properties') > 0
    union all
    select (o ->> 'id')::uuid from jsonb_array_elements(v_orphans) o
  ) s;
  if v_distinct_ids <> v_core_properties then
    raise exception 'distinct payload property ids (%) must equal canonical total (%); a property appears more than once',
      v_distinct_ids, v_core_properties;
  end if;

  -- Loud orphan behavior: orphan list only contains null-licensor properties.
  if not exists (
    select 1 from jsonb_array_elements(v_orphans) o where (o ->> 'id')::uuid = v_orphan
  ) then
    raise exception 'fixture orphan must be in orphan_properties';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_orphans) o where o ->> 'licensor_id' is not null
  ) then
    raise exception 'orphan_properties must only contain null-licensor properties';
  end if;

  -- Locate the Alpha and Bravo nodes in the full payload.
  select l into v_lic_a_node
  from jsonb_array_elements(v_all_licensors) l
  where (l ->> 'id')::uuid = v_lic_a;
  select l into v_lic_b_node
  from jsonb_array_elements(v_all_licensors) l
  where (l ->> 'id')::uuid = v_lic_b;
  if v_lic_a_node is null or v_lic_b_node is null then
    raise exception 'Alpha and Bravo must both appear in the full payload';
  end if;

  -- Division/type-qualified source context on Alpha: two source divisions,
  -- each carrying a division_code, an mg_code, and an explicit mg_type label.
  if jsonb_array_length(v_lic_a_node -> 'plm_context') <> 2 then
    raise exception 'Alpha must expose two division-qualified PLM source rows';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_lic_a_node -> 'plm_context') c
    where c ->> 'division_code' = 'CW001' and c ->> 'mg_type' = 'licensor'
  ) or not exists (
    select 1 from jsonb_array_elements(v_lic_a_node -> 'plm_context') c
    where c ->> 'division_code' = 'SP001'
  ) then
    raise exception 'Alpha plm_context must qualify both source divisions with mg_type';
  end if;
  if jsonb_array_length(v_lic_a_node -> 'source_refs') <> 1
     or v_lic_a_node -> 'source_refs' -> 0 ->> 'source_system' <> 'designflow_plm' then
    raise exception 'Alpha must embed its designflow_plm source ref';
  end if;
  if (v_lic_a_node ->> 'property_count')::integer
     <> jsonb_array_length(v_lic_a_node -> 'properties') then
    raise exception 'Alpha property_count must equal its embedded properties length';
  end if;

  -- Source context + character count on a property.
  if not exists (
    select 1 from jsonb_array_elements(v_lic_a_node -> 'properties') p
    where (p ->> 'id')::uuid = v_prop1
      and (p ->> 'character_count')::integer = 1
      and jsonb_array_length(p -> 'source_refs') = 1
      and p -> 'source_refs' -> 0 ->> 'source_code' = 'P1-' || v_suffix
  ) then
    raise exception 'Property One must expose its source ref and character count';
  end if;

  -- The edge is never inferred from mg_code / globally unique codes: the
  -- collide property's PLM mg_code equals Bravo's code, yet it nests under
  -- Alpha (its core.property.licensor_id) and never under Bravo.
  if not exists (
    select 1 from jsonb_array_elements(v_lic_a_node -> 'properties') p
    where (p ->> 'id')::uuid = v_prop_collide
  ) then
    raise exception 'collide property must nest under Alpha (its licensor_id)';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lic_b_node -> 'properties') p
    where (p ->> 'id')::uuid = v_prop_collide
  ) then
    raise exception 'collide property must NOT nest under Bravo despite an mg_code collision';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_lic_a_node -> 'properties') p
    where (p ->> 'id')::uuid = v_prop_collide
      and p -> 'plm_context' -> 0 ->> 'mg_code' = 'LICB-' || v_suffix
      and p -> 'plm_context' -> 0 ->> 'mg_type' = 'property'
  ) then
    raise exception 'collide property must still show its division/type-qualified mg_code as context';
  end if;

  -- Include-inactive toggling: with include_inactive the inactive licensor +
  -- its property appear; without it they are hidden.
  if not exists (
    select 1 from jsonb_array_elements(v_all_licensors) l
    where (l ->> 'id')::uuid = v_lic_inactive
  ) then
    raise exception 'inactive licensor must appear when include_inactive is true';
  end if;
  select api.db_data_admin_licensor_property_tree(null, false, null, 200) into v_page;
  if exists (
    select 1 from jsonb_array_elements(v_page -> 'licensors') l
    where (l ->> 'id')::uuid = v_lic_inactive
  ) then
    raise exception 'inactive licensor must be hidden without include_inactive';
  end if;

  -- Invalid cursor is rejected, never silently ignored.
  begin
    perform api.db_data_admin_licensor_property_tree(null, true, 'not-base64-cursor', 50);
    raise exception 'invalid cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

rollback;
