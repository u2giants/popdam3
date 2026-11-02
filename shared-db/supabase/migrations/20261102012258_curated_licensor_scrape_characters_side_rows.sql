-- Issue popcre/shared-db#5079: restore the Disney (MV/DY/SW) provenance and
-- property-link rows on the shared preview database — the parts of the
-- 20261030153101 Disney sections deferred this morning while two other claims
-- held these tables. The characters and their matched plm.source_resolution
-- rows were restored by 20261101125528; this migration adds the
-- core.taxonomy_source_ref provenance rows, the direct OPA property-character
-- edges, and the property-character associations those sections write.
--
-- Idempotent on production (every write is conflict-guarded and the post-state
-- check passes unchanged there). Anti-vacuous guard: the restored characters
-- must exist before any side rows load.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.


-- MV (Disney OPA bucket MV)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261102012258 (Disney side rows for the preview restore)';
  v_lic uuid;
  v_n integer;
begin
  select id into v_lic from core.licensor where code = 'MV';
  if v_lic is null then raise exception '#5079 MV: licensor missing'; end if;

  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n = 0 then raise exception '#5079 restore MV: no restored characters found; refusing a vacuous pass'; end if;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null::numeric, true,
         jsonb_build_object('loaded_by', v_actor, 'issue', v_issue), v_actor, v_actor
    from plm.opa_property_character pc
    join core.character ch
      on ch.licensor_id = v_lic and ch.code = 'disney_opa:' || pc.character_id::text and ch.metadata ->> 'issue' = v_issue
    join core.taxonomy_source_ref pr
      on pr.source_system = 'disney_opa' and pr.source_table = 'plm.opa_property'
     and pr.entity_schema = 'core' and pr.entity_table = 'property'
     and pr.source_id = pc.licensed_property_id::text
    join core.property p on p.id = pr.entity_id and p.licensor_id = v_lic
   where not exists (select 1 from core.property_character_source_edge e
                      where e.property_id = pr.entity_id and e.character_id = ch.id and e.licensor_id = v_lic
                        and e.source_system = 'disney_opa' and e.evidence_kind = 'direct_source_assertion' and e.is_current);

  insert into core.property_character_associations (property_id, character_id, is_current)
  select distinct e.property_id, e.character_id, true
    from core.property_character_source_edge e
   where e.licensor_id = v_lic and e.metadata ->> 'issue' = v_issue and e.is_current
  on conflict (property_id, character_id) do nothing;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 MV: % characters lack licensor-stamped provenance', v_n; end if;
end
$characters$;

-- DY (Disney OPA bucket DY)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261102012258 (Disney side rows for the preview restore)';
  v_lic uuid;
  v_n integer;
begin
  select id into v_lic from core.licensor where code = 'DY';
  if v_lic is null then raise exception '#5079 DY: licensor missing'; end if;

  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n = 0 then raise exception '#5079 restore DY: no restored characters found; refusing a vacuous pass'; end if;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null::numeric, true,
         jsonb_build_object('loaded_by', v_actor, 'issue', v_issue), v_actor, v_actor
    from plm.opa_property_character pc
    join core.character ch
      on ch.licensor_id = v_lic and ch.code = 'disney_opa:' || pc.character_id::text and ch.metadata ->> 'issue' = v_issue
    join core.taxonomy_source_ref pr
      on pr.source_system = 'disney_opa' and pr.source_table = 'plm.opa_property'
     and pr.entity_schema = 'core' and pr.entity_table = 'property'
     and pr.source_id = pc.licensed_property_id::text
    join core.property p on p.id = pr.entity_id and p.licensor_id = v_lic
   where not exists (select 1 from core.property_character_source_edge e
                      where e.property_id = pr.entity_id and e.character_id = ch.id and e.licensor_id = v_lic
                        and e.source_system = 'disney_opa' and e.evidence_kind = 'direct_source_assertion' and e.is_current);

  insert into core.property_character_associations (property_id, character_id, is_current)
  select distinct e.property_id, e.character_id, true
    from core.property_character_source_edge e
   where e.licensor_id = v_lic and e.metadata ->> 'issue' = v_issue and e.is_current
  on conflict (property_id, character_id) do nothing;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 DY: % characters lack licensor-stamped provenance', v_n; end if;
end
$characters$;

-- SW (Disney OPA bucket SW)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261102012258 (Disney side rows for the preview restore)';
  v_lic uuid;
  v_n integer;
begin
  select id into v_lic from core.licensor where code = 'SW';
  if v_lic is null then raise exception '#5079 SW: licensor missing'; end if;

  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n = 0 then raise exception '#5079 restore SW: no restored characters found; refusing a vacuous pass'; end if;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null::numeric, true,
         jsonb_build_object('loaded_by', v_actor, 'issue', v_issue), v_actor, v_actor
    from plm.opa_property_character pc
    join core.character ch
      on ch.licensor_id = v_lic and ch.code = 'disney_opa:' || pc.character_id::text and ch.metadata ->> 'issue' = v_issue
    join core.taxonomy_source_ref pr
      on pr.source_system = 'disney_opa' and pr.source_table = 'plm.opa_property'
     and pr.entity_schema = 'core' and pr.entity_table = 'property'
     and pr.source_id = pc.licensed_property_id::text
    join core.property p on p.id = pr.entity_id and p.licensor_id = v_lic
   where not exists (select 1 from core.property_character_source_edge e
                      where e.property_id = pr.entity_id and e.character_id = ch.id and e.licensor_id = v_lic
                        and e.source_system = 'disney_opa' and e.evidence_kind = 'direct_source_assertion' and e.is_current);

  insert into core.property_character_associations (property_id, character_id, is_current)
  select distinct e.property_id, e.character_id, true
    from core.property_character_source_edge e
   where e.licensor_id = v_lic and e.metadata ->> 'issue' = v_issue and e.is_current
  on conflict (property_id, character_id) do nothing;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 SW: % characters lack licensor-stamped provenance', v_n; end if;
end
$characters$;
