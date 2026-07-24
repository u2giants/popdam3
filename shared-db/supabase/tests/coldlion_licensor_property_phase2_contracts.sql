-- Rollback-safe Phase 2A contract tests for
-- 20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql
-- (plm.sync_coldlion_licensors_properties / public.sync_coldlion_licensors_properties).
--
-- Run against a disposable DB or preview AFTER migrations 20260724030000 (Phase 1) and
-- 20260724060000 (Phase 2A) are applied. Fixtures roll back. Do not run as a long-lived
-- production session.
--
-- Proves the Phase 2A MIRROR-ONLY importer contract (fix_coldlion_licensor_property_cutover.md
-- §6, §11.1 applicable Phase-2 cases):
--   * mirror insert / update / multi-division + cross-entity distinctness; mgDesc rename;
--     rerun idempotency (identical second call = unchanged accounting)
--   * raw_record keyed by the encoded composite natural key; raw payloads + hashes preserved
--   * run accounting (rows_seen/inserted/updated/unchanged, divisions, snapshot hash)
--   * ZERO canonical / source-ref mutation: core counts, UUIDs, statuses, property.licensor_id,
--     and core.taxonomy_source_ref all unchanged by a mirror_only run
--   * mirror rows land resolution_status='unresolved' by default (new record => unresolved)
--   * FR / 1P cross-entity code collision opens a conflict finding on the property key;
--     it never cross-links; core.property.licensor_id untouched
--   * NASA/ZAG/FRIDA lapsed presence mirrors faithfully and leaves canonical status unchanged
--   * DesignFlow-style parent/status is preserved across a ColdLion pull
--   * mode guard: link_approved / promote_approved raise loudly (Phase 2A = mirror_only only)
--   * empty headers / empty details / empty pairs abort before any mirror write
--   * incomplete pagination, semantic mismatch (EH001 Big Theme as licensor), conflicting
--     duplicate natural key, and excessive count-drop each abort with no partial work
--   * function execute privilege: service_role yes, authenticated/public no (browser cannot
--     trigger an import)

begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_run1 jsonb;
  v_run2 jsonb;
  v_run_rename jsonb;
  v_count integer;
  v_name text;
  v_lic_count_before bigint;
  v_prop_count_before bigint;
  v_sr_coldlion_before bigint;
  v_sr_total_before bigint;
  v_lic_uuid uuid;
  v_prop_uuid uuid;
  v_prop_parent uuid;
  v_prop_status app.entity_status;
  v_lic_status app.entity_status;
  v_term_bad text;
  v_has_exec_service boolean;
  v_has_exec_auth boolean;
begin
  -- Baseline canonical + source-ref counts (must be unchanged by every mirror_only call).
  select count(*) into v_lic_count_before from core.licensor;
  select count(*) into v_prop_count_before from core.property;
  select count(*) into v_sr_coldlion_before from core.taxonomy_source_ref where source_system = 'coldlion';
  select count(*) into v_sr_total_before from core.taxonomy_source_ref;

  -- A canonical fixture whose UUID/status/parent must survive every mirror_only pull.
  insert into core.licensor (name, code, status, metadata)
  values ('P2 Fixture Licensor ' || v_suffix, 'P2L-' || v_suffix, 'active',
          jsonb_build_object('test', 'phase2a', 'suffix', v_suffix))
  returning id into v_lic_uuid;

  insert into core.property (licensor_id, name, code, status, metadata)
  values (v_lic_uuid, 'P2 Fixture Property ' || v_suffix, 'P2P-' || v_suffix, 'active',
          jsonb_build_object('test', 'phase2a', 'suffix', v_suffix))
  returning id into v_prop_uuid;

  select licensor_id, status into v_prop_parent, v_prop_status from core.property where id = v_prop_uuid;
  select status into v_lic_status from core.licensor where id = v_lic_uuid;

  -- ---------------------------------------------------------------------------------
  -- A baseline good snapshot. CW001 + SP001 licensed pairs; a cross-entity collision
  -- code (ZZ) in CW001; a couple of licensors/properties per division.
  -- ---------------------------------------------------------------------------------
  declare
    v_snap jsonb := $snap${
      "companyCode": "EDGEHOME",
      "headers": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","createdTime":"2026-01-01T00:00:00","modTime":"2026-01-01T00:00:00"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","createdTime":"2026-01-01T00:00:00","modTime":"2026-01-01T00:00:00"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","createdTime":"2026-01-01T00:00:00","modTime":"2026-01-01T00:00:00"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","createdTime":"2026-01-01T00:00:00","modTime":"2026-01-01T00:00:00"},
        {"companyCode":"EDGEHOME","divisionCode":"EH001","mgTypeCode":"05","mgTypeDesc":"Big Theme","createdTime":"2026-01-01T00:00:00","modTime":"2026-01-01T00:00:00"}
      ],
      "pairs": [
        {"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},
        {"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}
      ],
      "details": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-1","mgDesc":"Alpha Licensor","mgTypeDesc":"Licensor","itemNoCode":"P2A-1","mgCode2":"P2A-1","mgCategory":""},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"ZZ","mgDesc":"Collision Licensor","mgTypeDesc":"Licensor","itemNoCode":"ZZ","mgCode2":"ZZ","mgCategory":""},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P2A-2","mgDesc":"Alpha Property","mgTypeDesc":"Property","itemNoCode":"P2A-2","mgCode2":"P2A-2","mgCategory":""},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"ZZ","mgDesc":"Collision Property","mgTypeDesc":"Property","itemNoCode":"ZZ","mgCode2":"ZZ","mgCategory":""},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgCode":"P2A-1","mgDesc":"Alpha Licensor SP","mgTypeDesc":"Licensor","itemNoCode":"P2A-1","mgCode2":"P2A-1","mgCategory":""},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgCode":"P2A-3","mgDesc":"Bravo Property SP","mgTypeDesc":"Property","itemNoCode":"P2A-3","mgCode2":"P2A-3","mgCategory":""}
      ],
      "pages": [
        {"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":2},
        {"divisionCode":"CW001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":2},
        {"divisionCode":"SP001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1}
      ],
      "config": {"headerDivisions":["CW001","SP001","EH001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
      "prior": null
    }$snap$;
  begin
    -- 1) First run: all licensed details are new -> inserted.
    select to_jsonb(t) into v_run1 from plm.sync_coldlion_licensors_properties(v_snap, 'mirror_only') t;

    if (v_run1 ->> 'licensor_rows')::int <> 3 or (v_run1 ->> 'property_rows')::int <> 3 then
      raise exception 'run1 counts wrong: %', v_run1;
    end if;
    if (v_run1 ->> 'rows_inserted')::int <> 6 then
      raise exception 'run1 expected 6 inserted, got %', v_run1 ->> 'rows_inserted';
    end if;
    if (v_run1 ->> 'rows_updated')::int <> 0 or (v_run1 ->> 'rows_unchanged')::int <> 0 then
      raise exception 'run1 expected 0 updated / 0 unchanged';
    end if;
    if (v_run1 ->> 'cross_entity_collisions')::int < 1 then
      raise exception 'run1 expected >=1 cross-entity collision (ZZ)';
    end if;
    if (v_run1 ->> 'snapshot_hash') is null or (v_run1 ->> 'snapshot_hash') = '' then
      raise exception 'run1 snapshot_hash missing';
    end if;

    -- 2) Idempotent re-run: identical snapshot -> 0 inserted / 0 updated / 6 unchanged.
    select to_jsonb(t) into v_run2 from plm.sync_coldlion_licensors_properties(v_snap, 'mirror_only') t;
    if (v_run2 ->> 'rows_inserted')::int <> 0
       or (v_run2 ->> 'rows_updated')::int <> 0
       or (v_run2 ->> 'rows_unchanged')::int <> 6 then
      raise exception 'run2 idempotency failed: %', v_run2;
    end if;
    if (v_run1 ->> 'snapshot_hash') is distinct from (v_run2 ->> 'snapshot_hash') then
      raise exception 'snapshot_hash not stable across identical runs';
    end if;

    -- mirror row count + default resolution_status = unresolved (new record => unresolved).
    select count(*) into v_count from plm.erp_licensor
      where mg_code like 'P2A-%' or mg_code = 'ZZ';
    if v_count <> 3 then raise exception 'expected 3 licensor mirror rows, got %', v_count; end if;

    select count(*) into v_count from plm.erp_licensor
      where mg_code = 'P2A-1';
    if v_count <> 2 then raise exception 'same mg_code across divisions not distinct (expected 2)'; end if;

    select count(*) into v_count from plm.erp_licensor e
      where resolution_status <> 'unresolved' and (e.mg_code like 'P2A-%' or e.mg_code = 'ZZ');
    if v_count <> 0 then raise exception 'new mirror rows must default to unresolved'; end if;

    -- cross-entity same code: licensor ZZ (05) and property ZZ (06) coexist, distinct types.
    select count(*) into v_count from (
      select 1 from plm.erp_licensor where company_code='EDGEHOME' and division_code='CW001' and mg_type_code='05' and mg_code='ZZ'
      union all
      select 1 from plm.erp_property where company_code='EDGEHOME' and division_code='CW001' and mg_type_code='06' and mg_code='ZZ'
    ) x;
    if v_count <> 2 then raise exception 'cross-entity ZZ pair not both present'; end if;

    -- raw_record keyed by the encoded composite natural key; raw + hash preserved.
    select count(*) into v_count from ingest.raw_record
      where source_system='coldlion' and source_table='merchGroupDetails'
        and source_id = 'EDGEHOME/CW001/05/P2A-1';
    if v_count <> 1 then raise exception 'raw_record not keyed by composite natural key'; end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- 3) mgDesc rename updates the mirror in place (no duplicate); accounting = updated.
  -- ---------------------------------------------------------------------------------
  declare
    v_snap_rename jsonb := $snap${
      "companyCode": "EDGEHOME",
      "headers": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}
      ],
      "pairs": [
        {"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},
        {"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}
      ],
      "details": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-RENAME","mgDesc":"Renamed Original","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P2A-PROPR","mgDesc":"Prop R","mgTypeDesc":"Property"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgCode":"P2A-RENAME-SP","mgDesc":"Renamed SP","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgCode":"P2A-PROPR-SP","mgDesc":"Prop R SP","mgTypeDesc":"Property"}
      ],
      "pages": [
        {"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"CW001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1}
      ],
      "config": {"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
      "prior": null
    }$snap$;
    v_snap_rename2 jsonb;
  begin
    perform plm.sync_coldlion_licensors_properties(v_snap_rename, 'mirror_only');
    -- mutate the description only (same composite key)
    v_snap_rename2 := jsonb_set(v_snap_rename, '{details,0,mgDesc}', to_jsonb('Renamed Updated'::text));
    select to_jsonb(t) into v_run_rename from plm.sync_coldlion_licensors_properties(v_snap_rename2, 'mirror_only') t;

    if (v_run_rename ->> 'rows_updated')::int < 1 then
      raise exception 'rename should register >=1 updated row';
    end if;

    select count(*), max(name) into v_count, v_name
      from plm.erp_licensor
      where company_code='EDGEHOME' and division_code='CW001' and mg_type_code='05' and mg_code='P2A-RENAME';
    if v_count <> 1 or v_name is distinct from 'Renamed Updated' then
      raise exception 'rename did not update in place (count=% name=%)', v_count, v_name;
    end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- 4) FR / 1P cross-entity collision: a conflict finding opens on the property key;
  --    no canonical cross-link; core.property.licensor_id unchanged.
  -- ---------------------------------------------------------------------------------
  select count(*) into v_count from plm.taxonomy_resolution_review r
    where r.entity_type='property' and r.finding_scope='source'
      and r.company_code='EDGEHOME' and r.division_code='CW001'
      and r.mg_type_code='06' and r.mg_code='ZZ'
      and r.status='conflict' and r.match_method='cross_entity_code';
  if v_count < 1 then raise exception 'expected conflict finding for cross-entity ZZ property'; end if;

  if (select licensor_id from core.property where id = v_prop_uuid) is distinct from v_prop_parent then
    raise exception 'mirror_only mutated core.property.licensor_id on the fixture';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5) NASA/ZAG/FRIDA-style lapsed presence: mirrors faithfully, canonical status
  --    unchanged (no resurrection). Uses unique fixture codes (not real codes).
  -- ---------------------------------------------------------------------------------
  declare
    v_lic_lapsed uuid;
    v_snap_lapsed jsonb := $snap${
      "companyCode": "EDGEHOME",
      "headers": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}
      ],
      "pairs": [
        {"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},
        {"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}
      ],
      "details": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-LAPSED","mgDesc":"Lapsed Licensor","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P2A-LAPSED-P","mgDesc":"Lapsed Fixture Property","mgTypeDesc":"Property"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgCode":"P2A-LAPSED-SP","mgDesc":"Lapsed Fixture Licensor SP","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgCode":"P2A-LAPSED-P-SP","mgDesc":"Lapsed Fixture Property SP","mgTypeDesc":"Property"}
      ],
      "pages": [
        {"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"CW001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1}
      ],
      "config": {"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
      "prior": null
    }$snap$;
  begin
    insert into core.licensor (name, code, status, metadata)
    values ('P2 Lapsed ' || v_suffix, 'P2LAPSED-' || v_suffix, 'inactive',
            jsonb_build_object('test','phase2a','role','lapsed','suffix',v_suffix))
    returning id into v_lic_lapsed;

    perform plm.sync_coldlion_licensors_properties(v_snap_lapsed, 'mirror_only');

    select count(*) into v_count from plm.erp_licensor
      where mg_code='P2A-LAPSED';
    if v_count <> 1 then raise exception 'lapsed licensor not mirrored faithfully'; end if;

    if (select status from core.licensor where id = v_lic_lapsed) is distinct from 'inactive' then
      raise exception 'ColdLion presence resurrected an inactive canonical licensor';
    end if;
    if (select licensor_id is not null from core.property where id = v_prop_uuid) is distinct from true then
      raise exception 'mirror_only nulled a fixture property parent';
    end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- 6) DesignFlow-style parent/status change survives a ColdLion pull. We flip the
  --    fixture property status to inactive (simulating a curated lifecycle change) and
  --    re-run; the curated status must persist (mirror_only never writes core.status).
  -- ---------------------------------------------------------------------------------
  update core.property set status = 'inactive' where id = v_prop_uuid;
  perform plm.sync_coldlion_licensors_properties($snap${
    "companyCode":"EDGEHOME",
    "headers":[
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},
      {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
      {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}
    ],
    "pairs":[
      {"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
      {"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},
      {"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
      {"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}
    ],
    "details":[
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-1","mgDesc":"Alpha Licensor","mgTypeDesc":"Licensor"},
      {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P2A-2","mgDesc":"Alpha Property","mgTypeDesc":"Property"},
      {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgCode":"P2A-1","mgDesc":"Alpha Licensor SP","mgTypeDesc":"Licensor"},
      {"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgCode":"P2A-3","mgDesc":"Bravo Property SP","mgTypeDesc":"Property"}
    ],
    "pages":[
      {"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
      {"divisionCode":"CW001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1},
      {"divisionCode":"SP001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
      {"divisionCode":"SP001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1}
    ],
    "config":{"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
    "prior":null
  }$snap$, 'mirror_only');
  if (select status from core.property where id = v_prop_uuid) is distinct from 'inactive' then
    raise exception 'curated property status did not survive the ColdLion pull';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 7) ZERO canonical / source-ref mutation across all the above mirror_only runs.
  -- ---------------------------------------------------------------------------------
  if (select count(*) from core.licensor) <> v_lic_count_before + 2  -- the 2 fixtures we inserted
     or (select count(*) from core.property) <> v_prop_count_before + 1 then
    raise exception 'core.licensor/property count changed unexpectedly (importer must not create canonical rows)';
  end if;
  if (select count(*) from core.taxonomy_source_ref where source_system='coldlion') <> v_sr_coldlion_before then
    raise exception 'mirror_only created coldlion source refs (forbidden in Phase 2A)';
  end if;
  if (select count(*) from core.taxonomy_source_ref) <> v_sr_total_before then
    raise exception 'mirror_only mutated core.taxonomy_source_ref';
  end if;
  -- canonical UUID set + status + parent preserved on the fixtures.
  if (select id from core.licensor where code = 'P2L-' || v_suffix) is distinct from v_lic_uuid
     or (select id from core.property where code = 'P2P-' || v_suffix) is distinct from v_prop_uuid then
    raise exception 'canonical fixture UUIDs changed';
  end if;
  if (select status from core.licensor where id = v_lic_uuid) is distinct from v_lic_status then
    raise exception 'canonical licensor status changed';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 8) Mode guard: link_approved and promote_approved raise loudly (Phase 4/5 only).
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.sync_coldlion_licensors_properties(jsonb_build_object('companyCode','EDGEHOME','headers','[]'::jsonb,'details','[]'::jsonb,'pairs','[]'::jsonb,'pages','[]'::jsonb), 'link_approved');
    raise exception 'link_approved mode was accepted in Phase 2A';
  exception when others then
    if sqlerrm !~* 'mirror_only' then raise exception 'link_approved rejection message unexpected: %', sqlerrm; end if;
  end;
  begin
    perform public.sync_coldlion_licensors_properties(jsonb_build_object('companyCode','EDGEHOME','headers','[]'::jsonb,'details','[]'::jsonb,'pairs','[]'::jsonb,'pages','[]'::jsonb), 'promote_approved');
    raise exception 'promote_approved mode was accepted in Phase 2A';
  exception when others then
    if sqlerrm !~* 'mirror_only' then raise exception 'promote_approved rejection message unexpected: %', sqlerrm; end if;
  end;

  -- ---------------------------------------------------------------------------------
  -- 9) Empty / incomplete / semantic / duplicate / count-drop guards abort with no
  --    partial mirror work. Each uses a unique code (P2A-BAD-*) that must NOT appear.
  -- ---------------------------------------------------------------------------------
  begin
    perform plm.sync_coldlion_licensors_properties(jsonb_build_object('companyCode','EDGEHOME','headers','[]'::jsonb,'details','[{"a":1}]'::jsonb,'pairs','[{"a":1}]'::jsonb,'pages','[]'::jsonb), 'mirror_only');
    raise exception 'empty headers accepted';
  exception when others then null; end;

  begin
    perform plm.sync_coldlion_licensors_properties(jsonb_build_object('companyCode','EDGEHOME',
      'headers','[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"}]'::jsonb,
      'pairs','[{"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"}]'::jsonb,
      'details','[]'::jsonb,'pages','[]'::jsonb), 'mirror_only');
    raise exception 'empty details accepted';
  exception when others then null; end;

  -- incomplete pagination
  begin
    perform plm.sync_coldlion_licensors_properties($snap${
      "companyCode":"EDGEHOME",
      "headers":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}],
      "pairs":[{"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},{"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}],
      "details":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-BAD-PAGE","mgDesc":"X","mgTypeDesc":"Licensor"}],
      "pages":[{"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":2,"terminalReached":false,"rowCount":1}],
      "config":{"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},"prior":null
    }$snap$, 'mirror_only');
    raise exception 'incomplete pagination accepted';
  exception when others then null; end;

  -- semantic mismatch: EH001 Big Theme declared as licensor
  begin
    perform plm.sync_coldlion_licensors_properties($snap${
      "companyCode":"EDGEHOME",
      "headers":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"},{"companyCode":"EDGEHOME","divisionCode":"EH001","mgTypeCode":"05","mgTypeDesc":"Big Theme"}],
      "pairs":[{"divisionCode":"EH001","mgTypeCode":"05","mgTypeDesc":"Big Theme","entityType":"licensor"},{"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},{"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}],
      "details":[{"companyCode":"EDGEHOME","divisionCode":"EH001","mgTypeCode":"05","mgCode":"P2A-BAD-SEM","mgDesc":"Big","mgTypeDesc":"Licensor"}],
      "pages":[
        {"divisionCode":"CW001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"CW001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"EH001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":1}
      ],
      "config":{"headerDivisions":["CW001","SP001","EH001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},"prior":null
    }$snap$, 'mirror_only');
    raise exception 'EH001 Big Theme accepted as licensor';
  exception when others then null; end;

  -- conflicting duplicate natural key
  begin
    perform plm.sync_coldlion_licensors_properties($snap${
      "companyCode":"EDGEHOME",
      "headers":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}],
      "pairs":[{"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},{"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}],
      "details":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-BAD-DUP","mgDesc":"One","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-BAD-DUP","mgDesc":"Two","mgTypeDesc":"Licensor"}],
      "pages":[
        {"divisionCode":"CW001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":2},
        {"divisionCode":"CW001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":0},
        {"divisionCode":"SP001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":0},
        {"divisionCode":"SP001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":0}
      ],
      "config":{"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},"prior":null
    }$snap$, 'mirror_only');
    raise exception 'conflicting duplicate natural key accepted';
  exception when others then null; end;

  -- excessive count drop vs prior
  begin
    perform plm.sync_coldlion_licensors_properties($snap${
      "companyCode":"EDGEHOME",
      "headers":[{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor"},{"companyCode":"EDGEHOME","divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property"}],
      "pairs":[{"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"},{"divisionCode":"SP001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},{"divisionCode":"SP001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}],
      "details":[
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P2A-BAD-DROP","mgDesc":"Only One","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P2A-BAD-DROP-P","mgDesc":"Only Prop","mgTypeDesc":"Property"}
      ],
      "pages":[
        {"divisionCode":"CW001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"CW001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"SP001","mgTypeCode":"05","entityType":"licensor","pagesFetched":1,"terminalReached":true,"rowCount":0},
        {"divisionCode":"SP001","mgTypeCode":"06","entityType":"property","pagesFetched":1,"terminalReached":true,"rowCount":0}
      ],
      "config":{"headerDivisions":["CW001","SP001"],"requiredDivisions":["CW001","SP001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
      "prior":{"licensorCount":1000,"propertyCount":1000}
    }$snap$, 'mirror_only');
    raise exception 'excessive count drop accepted';
  exception when others then null; end;

  -- None of the P2A-BAD-* codes were mirrored (no partial work on a failed run).
  select count(*) into v_count from plm.erp_licensor where mg_code like 'P2A-BAD-%';
  if v_count <> 0 then raise exception 'failed run left partial mirror work (P2A-BAD-* rows)'; end if;
  select count(*) into v_count from plm.erp_property where mg_code like 'P2A-BAD-%';
  if v_count <> 0 then raise exception 'failed run left partial property mirror work'; end if;

  -- ---------------------------------------------------------------------------------
  -- 10) Function execute privilege: service_role may, authenticated may not.
  -- ---------------------------------------------------------------------------------
  select has_function_privilege('service_role','plm.sync_coldlion_licensors_properties(jsonb,text)','execute'),
         has_function_privilege('authenticated','plm.sync_coldlion_licensors_properties(jsonb,text)','execute')
    into v_has_exec_service, v_has_exec_auth;
  if v_has_exec_service is not true then raise exception 'service_role must have execute on the importer'; end if;
  if v_has_exec_auth is true then raise exception 'authenticated must NOT have execute on the importer (browser cannot trigger import)'; end if;

  -- api run-list surface exists and is admin-gated.
  if to_regprocedure('api.coldlion_licensor_property_run_list(integer)') is null then
    raise exception 'missing api.coldlion_licensor_property_run_list(integer)';
  end if;

  raise notice 'Phase 2A contracts passed (suffix=%)', v_suffix;
end $$;

rollback;
