-- Issue #4235 (claim #4236): link the 38 owner-approved ColdLion MG05 Licensor source
-- identities to their existing canonical Licensors.
--
-- Why: production core.taxonomy_source_ref has no ColdLion Licensor identity at all, so
-- PopDAM licensing resolution (source key EDGEHOME/<division>/05/<code>) fails for every
-- licensed asset (u2giants/popdam3#357).
--
-- Authority: the owner-approved ColdLion mapping (Albert Hazan, approved 2026-08-18;
-- widened set hash 09e18e47d67181b06483d6cf4454e053, 552 mappings; private artifact).
-- Its Licensor subset is exactly the 19 codes below in CW001 and SP001 (38 rows, subset
-- hash b8e5cc3126a742eca1e8a5e0db4d8f57). Owner direction for this task, verbatim from
-- Albert's chat: "all licensing questions can be answered by the licensor scrapes."
--
-- What this does: INSERT provenance rows only. No canonical Licensor or Property row is
-- created, renamed, re-parented or re-statused (AGENTS.md 6.4 matched-row abstention).
-- MG06 Property identities are out of scope (issue #2541 replacement direction and the
-- 2026-09-25 owner HOLD remain untouched).
--
-- Fail-closed rules:
--   * provenance is the owner-approved mapping, not a ColdLion capture: raw records
--     authority 'owner_approved_mapping' and freshness_basis 'migration_apply_time';
--     first_seen_at/last_seen_at are apply time and do NOT prove ColdLion freshness;
--   * the ColdLion taxonomy breaker must be closed (checked up front with a clear error);
--   * an environment with none of the 19 canonical Licensors (CI shadow) is a no-op;
--     some-but-not-all present aborts;
--   * each canonical Licensor must carry exactly the approved code, and no other
--     Licensor may carry it (core.licensor.code is also UNIQUE);
--   * an existing source row for any of the 38 keys, under any case/whitespace spelling of
--     the source system/table, must be the exact approved row (idempotent), else abort;
--   * after insert, each key resolves to its approved Licensor with source_licensor_id
--     derived to that same Licensor, and the 38 keys hash to the approved subset hash.
--
-- Recovery: the rows are identified exactly by raw->>'implementation_issue' = '#4235'.
-- Repository doctrine records absence with missing_since rather than deleting rows, and the
-- identity guard locks source_licensor_id while the target is unchanged. A correction is a
-- reviewed forward curated migration that records missing_since on (or repoints) exactly
-- these rows; never a manual delete.
--
-- Dependencies: the breaker pre-check reads plm.taxonomy_circuit_breaker directly (the
-- curated row-load allowlist forbids function calls); migrations apply as postgres, which
-- bypasses its RLS. The enforcing control remains coldlion_source_ref_breaker_guard.
-- The spelling-insensitive conflict probe wraps the indexed columns and scans
-- core.taxonomy_source_ref (about 550 rows) 38 times; accepted for a one-time load.
--
-- Pinned invariants: plm.taxonomy_baseline_pin 'phase4_preview' pins coldlion_source_ref_count
-- and taxonomy_source_ref_count, and this load moves both. The curated row-load allowlist
-- does not permit writing plm.taxonomy_baseline_pin, so the pins are NOT refreshed here.
-- Consequence: a later manual run of the preview-only phase-6 parallel comparison (schedules
-- removed by #3536; production hard-refused) would report drift and may auto-trip the
-- breaker; re-pin through that lane's own reviewed path before any such run. Production
-- pins were already drifted before this load (taxonomy_source_ref_count pinned 515, live 538).
--
-- Tested locally (PostgreSQL 16, minimal fixture): empty environment no-op; 38 inserted;
-- rerun idempotent; a conflicting pre-existing row refused.
do $migration$
declare
  v_codes constant text[] := array['1P','AA','CB','CC','DC','DY','HP','MV','NB','PN','PP','SE','SM','SS','SW','VM','WB','WW','ZZ'];
  v_ids constant uuid[] := array['f39fe07e-e438-46b2-9e17-fb711358e790','e90c3124-e66d-404f-b777-0dae9a5ee4f3','b96edc00-9261-46ec-af93-9de0f5b88d48','c70e095c-2baf-404e-a2a3-c198a259a3e6','33962356-f1f9-4226-b3ef-00154e5b7d56','7d141a6f-e229-46a2-b3f5-0ba0c97dd820','ea61e3bb-37f2-4cef-a6f4-8aa314ea131f','f143c083-2dfd-48b9-ac9b-43d2290a4e4c','154bf54b-6f7d-4999-b0fb-c2828b12b56a','afff41a6-df31-4a9a-aea5-b919d1daff54','a03fff4b-65f4-4fd6-98ad-c9db3216b140','e5f1686c-700c-42f6-bbc6-98aaa9ce1634','1619ecdc-a0ad-4d1e-b8f2-7ea2aa1184fb','4dba7d87-54ed-4dee-894b-570326953d92','14f2902d-42de-4820-83c5-e4f359a6e0d6','5f951f5e-aaee-4add-bb51-fea888951405','88313675-0089-4072-87be-5b989df8a3fc','7575d1db-dbee-4336-84a9-aa378f05f105','80276015-a751-4438-8c25-759c8dd005b2']::uuid[];
  v_divisions constant text[] := array['CW001','SP001'];
  v_code text;
  v_id uuid;
  v_division text;
  v_key text;
  v_name text;
  v_present integer := 0;
  v_existing uuid;
  v_text text := null;
  v_hash text;
begin
  for i in 1..19 loop
    perform 1 from core.licensor l where l.id = v_ids[i];
    if found then v_present := v_present + 1; end if;
  end loop;
  perform 1 from plm.taxonomy_circuit_breaker b
  where b.lane = 'coldlion_licensor_property' and b.state = 'tripped';
  if found then
    raise exception 'issue #4235: ColdLion taxonomy circuit breaker is tripped; refusing before any write';
  end if;
  if v_present = 0 then
    for i in 1..19 loop
      perform 1 from core.licensor l where l.code = v_codes[i];
      if found then
        raise exception 'issue #4235: Licensor code % exists under a different id than approved; wrong or re-seeded database, refusing', v_codes[i];
      end if;
    end loop;
    raise notice 'issue #4235: no approved canonical Licensor exists in this environment; no-op';
    return;
  end if;
  if v_present <> 19 then
    raise exception 'issue #4235: % of 19 approved canonical Licensors exist; refusing partial link', v_present;
  end if;

  for i in 1..19 loop
    v_code := v_codes[i];
    v_id := v_ids[i];
    select l.name into v_name from core.licensor l
    where l.id = v_id and btrim(coalesce(l.code, '')) = v_code;
    if v_name is null then
      raise exception 'issue #4235: canonical Licensor % no longer carries approved code %; refusing', v_id, v_code;
    end if;
    perform 1 from core.licensor l where l.id <> v_id and l.code = v_code;
    if found then
      raise exception 'issue #4235: approved code % is carried by another Licensor; refusing', v_code;
    end if;
    foreach v_division in array v_divisions loop
      v_key := 'EDGEHOME/' || v_division || '/05/' || v_code;
      v_existing := null;
      select r.entity_id into v_existing from core.taxonomy_source_ref r
      where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails' and r.source_id = v_key
        and r.entity_schema = 'core' and r.entity_table = 'licensor';
      perform 1 from core.taxonomy_source_ref r
      where lower(btrim(r.source_system)) = 'coldlion' and upper(btrim(r.source_id)) = upper(v_key)
        and (r.source_system <> 'coldlion' or r.source_table <> 'merchGroupDetails' or r.source_id <> v_key
             or r.entity_schema <> 'core' or r.entity_table <> 'licensor' or r.entity_id <> v_id);
      if found then
        raise exception 'issue #4235: existing ColdLion source row % conflicts with the approved mapping; refusing', v_key;
      end if;
      if v_existing is null then
        insert into core.taxonomy_source_ref(entity_schema, entity_table, entity_id, source_system,
          source_table, source_id, source_code, source_name, confidence, raw, first_seen_at, last_seen_at)
        values ('core', 'licensor', v_id, 'coldlion', 'merchGroupDetails', v_key, v_code, v_name, 'verified',
          jsonb_build_object('implementation_issue', '#4235', 'consumer_issue', 'u2giants/popdam3#357',
            'approved_mapping_hash', '09e18e47d67181b06483d6cf4454e053',
            'approved_licensor_subset_hash', 'b8e5cc3126a742eca1e8a5e0db4d8f57',
            'authority', 'owner_approved_mapping', 'freshness_basis', 'migration_apply_time'),
          now(), now());
      end if;
    end loop;
    v_name := null;
  end loop;

  -- Post-insert proof: every approved key resolves to its approved Licensor, and the set
  -- hashes to the owner-approved subset (C-collation order: division, then code; the code
  -- array above is already in C order; newline-joined; md5).
  foreach v_division in array v_divisions loop
    for i in 1..19 loop
      v_key := 'EDGEHOME/' || v_division || '/05/' || v_codes[i];
      v_existing := null;
      select r.entity_id into v_existing from core.taxonomy_source_ref r
      where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails' and r.source_id = v_key
        and r.entity_schema = 'core' and r.entity_table = 'licensor'
        and r.source_licensor_id = v_ids[i];
      if v_existing is distinct from v_ids[i] then
        raise exception 'issue #4235: approved key % does not resolve to % after insert', v_key, v_ids[i];
      end if;
      v_text := case when v_text is null then '' else v_text || E'\n' end
        || 'licensor|' || v_key || '|' || v_existing::text;
    end loop;
  end loop;
  v_hash := md5(v_text);
  if v_hash <> 'b8e5cc3126a742eca1e8a5e0db4d8f57' then
    raise exception 'issue #4235: approved set hash %, expected b8e5cc3126a742eca1e8a5e0db4d8f57', v_hash;
  end if;

end
$migration$;
