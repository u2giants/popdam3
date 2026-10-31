-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor MV, then DY, SW, WB, NB, VM and SS
-- (Marvel) from the authorized licensor portal scrape, one licensor per change
-- (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions (plm.source_resolution; the legacy plm.*_character resolution columns are
-- write-protected and read through it). Identity is licensor + source id (sec.4): code is
-- '<source_system>:<source id>' under MV. Each character also gets one
-- core.taxonomy_source_ref keyed on the exact source identity (licensor-stamped by its guard).
--
-- core.character holds no MV row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Withdraw before delete: mark this change's property_character_source_edge rows
-- not current (superseded_at, superseded_reason) and its associations retired, set each
-- resolution back to 'unresolved' through plm.set_source_resolution(), then delete the
-- taxonomy_source_ref rows and the characters whose metadata issue/source_system match.
--
-- OPA LICENSOR. OPA is multi-studio. The licensor comes from the canonical studio evidence
-- (plm.opa_property_studio_resolution, 'canonical') of the Properties OPA links the
-- character to: disney and pixar -> DY ("Disney (Pixar)", migration 20261007020907),
-- marvel -> MV, lucasfilm -> SW (three separate Licensors, ruling 2026-09-14). A character
-- whose evidence names more than one licensor, or none, is not promoted. Only OPA
-- lifecycle status 'active' is promoted.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'MV';
  if v_lic is null then raise exception '#5079 MV: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, btrim(c.character_name), 'disney_opa:' || c.character_id::text, 'active',
         jsonb_build_object('source_system', 'disney_opa', 'source_table', 'plm.opa_character', 'source_id', c.character_id::text, 'resolution_source_id', c.character_id::text, 'loaded_by', v_actor, 'issue', v_issue)
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'MV') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution('disney_opa', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'disney_opa'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null, true,
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

  -- self-checks
  select count(*) into v_expected
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'MV') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 MV: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 MV: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 MV: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor DY
-- (Disney (Pixar)) from the authorized licensor portal scrape, one licensor per change
-- (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions (plm.source_resolution; the legacy plm.*_character resolution columns are
-- write-protected and read through it). Identity is licensor + source id (sec.4): code is
-- '<source_system>:<source id>' under DY. Each character also gets one
-- core.taxonomy_source_ref keyed on the exact source identity (licensor-stamped by its guard).
--
-- core.character holds no DY row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Withdraw before delete: mark this change's property_character_source_edge rows
-- not current (superseded_at, superseded_reason) and its associations retired, set each
-- resolution back to 'unresolved' through plm.set_source_resolution(), then delete the
-- taxonomy_source_ref rows and the characters whose metadata issue/source_system match.
--
-- OPA LICENSOR. OPA is multi-studio. The licensor comes from the canonical studio evidence
-- (plm.opa_property_studio_resolution, 'canonical') of the Properties OPA links the
-- character to: disney and pixar -> DY ("Disney (Pixar)", migration 20261007020907),
-- marvel -> MV, lucasfilm -> SW (three separate Licensors, ruling 2026-09-14). A character
-- whose evidence names more than one licensor, or none, is not promoted. Only OPA
-- lifecycle status 'active' is promoted.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'DY';
  if v_lic is null then raise exception '#5079 DY: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, btrim(c.character_name), 'disney_opa:' || c.character_id::text, 'active',
         jsonb_build_object('source_system', 'disney_opa', 'source_table', 'plm.opa_character', 'source_id', c.character_id::text, 'resolution_source_id', c.character_id::text, 'loaded_by', v_actor, 'issue', v_issue)
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'DY') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution('disney_opa', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'disney_opa'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null, true,
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

  -- self-checks
  select count(*) into v_expected
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'DY') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 DY: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 DY: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 DY: % characters lack a matched source resolution', v_n; end if;
end
$characters$;


-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor SW
-- (Lucasfilm (Star Wars)) from the authorized licensor portal scrape, one licensor per change
-- (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions (plm.source_resolution; the legacy plm.*_character resolution columns are
-- write-protected and read through it). Identity is licensor + source id (sec.4): code is
-- '<source_system>:<source id>' under SW. Each character also gets one
-- core.taxonomy_source_ref keyed on the exact source identity (licensor-stamped by its guard).
--
-- core.character holds no SW row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Withdraw before delete: mark this change's property_character_source_edge rows
-- not current (superseded_at, superseded_reason) and its associations retired, set each
-- resolution back to 'unresolved' through plm.set_source_resolution(), then delete the
-- taxonomy_source_ref rows and the characters whose metadata issue/source_system match.
--
-- OPA LICENSOR. OPA is multi-studio. The licensor comes from the canonical studio evidence
-- (plm.opa_property_studio_resolution, 'canonical') of the Properties OPA links the
-- character to: disney and pixar -> DY ("Disney (Pixar)", migration 20261007020907),
-- marvel -> MV, lucasfilm -> SW (three separate Licensors, ruling 2026-09-14). A character
-- whose evidence names more than one licensor, or none, is not promoted. Only OPA
-- lifecycle status 'active' is promoted.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'SW';
  if v_lic is null then raise exception '#5079 SW: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, btrim(c.character_name), 'disney_opa:' || c.character_id::text, 'active',
         jsonb_build_object('source_system', 'disney_opa', 'source_table', 'plm.opa_character', 'source_id', c.character_id::text, 'resolution_source_id', c.character_id::text, 'loaded_by', v_actor, 'issue', v_issue)
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'SW') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'disney_opa'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution('disney_opa', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'disney_opa'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- direct OPA Property links: only where OPA publishes the edge and the OPA Property is
  -- already resolved to a core.property of this same licensor. Never by name.
  insert into core.property_character_source_edge
    (property_id, character_id, licensor_id, source_system, source_id, source_evidence, evidence_kind,
     observation_count, confidence, is_current, metadata, created_by, updated_by)
  select distinct pr.entity_id, ch.id, v_lic, 'disney_opa',
         pc.licensed_property_id::text || ':' || pc.character_id::text,
         'plm.opa_property_character', 'direct_source_assertion'::core.relationship_evidence_kind, 0, null, true,
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

  -- self-checks
  select count(*) into v_expected
    from plm.opa_character c
    join (select pc.character_id
            from plm.opa_property_character pc
            join plm.opa_property_studio_resolution r
              on r.licensed_property_id = pc.licensed_property_id and r.resolution_status = 'canonical'
           where r.studio_code in ('disney', 'pixar', 'marvel', 'lucasfilm')
           group by pc.character_id
          having count(distinct case when r.studio_code in ('disney', 'pixar') then 'DY'
                                     when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 1
             and min(case when r.studio_code in ('disney', 'pixar') then 'DY'
                          when r.studio_code = 'marvel' then 'MV' else 'SW' end) = 'SW') a on a.character_id = c.character_id
   where c.status = 'active' and nullif(btrim(c.character_name), '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 SW: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 SW: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 SW: % characters lack a matched source resolution', v_n; end if;
end
$characters$;


-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor WB
-- (Warner Bros.) from the authorized licensor portal scrape (plm.wb_character_normalized), one licensor per
-- change (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions. Identity is licensor + source id (sec.4): code is 'warner_starlabs:<source id>'
-- under WB. Each character also gets one core.taxonomy_source_ref keyed on the exact
-- source identity (licensor-stamped by its guard). No Property link is written: this
-- source publishes no reviewed Property edge.
--
-- core.character holds no WB row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Set each resolution back to 'unresolved' through plm.set_source_resolution(),
-- then delete the taxonomy_source_ref rows and the characters whose metadata issue and
-- source_system match.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'WB';
  if v_lic is null then raise exception '#5079 WB: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, s.label, 'warner_starlabs:' || s.sid, 'active',
         jsonb_build_object('source_system', 'warner_starlabs', 'source_table', 'plm.wb_character_normalized', 'source_id', s.sid,
                            'resolution_source_system', s.rss, 'resolution_source_id', s.rsid,
                            'loaded_by', v_actor, 'issue', v_issue)
    from (select btrim(w.label) as label, w.source_namespace || ':' || coalesce(w.source_id, w.fallback_key) as sid, coalesce(w.source_id, w.fallback_key) as rsid, 'warner:' || w.source_namespace as rss
      from plm.wb_character_normalized w
     where w.status = 'active' and nullif(btrim(w.label), '') is not null and coalesce(w.source_id, w.fallback_key) is not null) s
   where nullif(s.label, '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'warner_starlabs'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution(ch.metadata ->> 'resolution_source_system', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'warner_starlabs'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- self-checks
  select count(*) into v_expected
    from (select btrim(w.label) as label, w.source_namespace || ':' || coalesce(w.source_id, w.fallback_key) as sid, coalesce(w.source_id, w.fallback_key) as rsid, 'warner:' || w.source_namespace as rss
      from plm.wb_character_normalized w
     where w.status = 'active' and nullif(btrim(w.label), '') is not null and coalesce(w.source_id, w.fallback_key) is not null) s
   where nullif(s.label, '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'warner_starlabs';
  if v_n <> v_expected then raise exception '#5079 WB: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'warner_starlabs'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 WB: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'warner_starlabs'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 WB: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor NB
-- (NBCUniversal) from the authorized licensor portal scrape (plm.nbcu_character), one licensor per
-- change (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions. Identity is licensor + source id (sec.4): code is 'nbcu_creative_asset_factory:<source id>'
-- under NB. Each character also gets one core.taxonomy_source_ref keyed on the exact
-- source identity (licensor-stamped by its guard). No Property link is written: this
-- source publishes no reviewed Property edge.
--
-- core.character holds no NB row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Set each resolution back to 'unresolved' through plm.set_source_resolution(),
-- then delete the taxonomy_source_ref rows and the characters whose metadata issue and
-- source_system match.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'NB';
  if v_lic is null then raise exception '#5079 NB: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, s.label, 'nbcu_creative_asset_factory:' || s.sid, 'active',
         jsonb_build_object('source_system', 'nbcu_creative_asset_factory', 'source_table', 'plm.nbcu_character', 'source_id', s.sid,
                            'resolution_source_system', s.rss, 'resolution_source_id', s.rsid,
                            'loaded_by', v_actor, 'issue', v_issue)
    from (select min(btrim(character_label)) as label, character_key as sid, character_key as rsid, 'nbcu' as rss
      from plm.nbcu_character where nullif(btrim(character_label), '') is not null group by character_key) s
   where nullif(s.label, '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'nbcu_creative_asset_factory'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution(ch.metadata ->> 'resolution_source_system', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'nbcu_creative_asset_factory'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- self-checks
  select count(*) into v_expected
    from (select min(btrim(character_label)) as label, character_key as sid, character_key as rsid, 'nbcu' as rss
      from plm.nbcu_character where nullif(btrim(character_label), '') is not null group by character_key) s
   where nullif(s.label, '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'nbcu_creative_asset_factory';
  if v_n <> v_expected then raise exception '#5079 NB: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'nbcu_creative_asset_factory'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 NB: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'nbcu_creative_asset_factory'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 NB: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor VM
-- (Paramount) from the authorized licensor portal scrape (plm.pmt_character), one licensor per
-- change (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions. Identity is licensor + source id (sec.4): code is 'paramount_creative_library:<source id>'
-- under VM. Each character also gets one core.taxonomy_source_ref keyed on the exact
-- source identity (licensor-stamped by its guard). No Property link is written: this
-- source publishes no reviewed Property edge.
--
-- core.character holds no VM row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Set each resolution back to 'unresolved' through plm.set_source_resolution(),
-- then delete the taxonomy_source_ref rows and the characters whose metadata issue and
-- source_system match.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'VM';
  if v_lic is null then raise exception '#5079 VM: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, s.label, 'paramount_creative_library:' || s.sid, 'active',
         jsonb_build_object('source_system', 'paramount_creative_library', 'source_table', 'plm.pmt_character', 'source_id', s.sid,
                            'resolution_source_system', s.rss, 'resolution_source_id', s.rsid,
                            'loaded_by', v_actor, 'issue', v_issue)
    from (select min(btrim(character_name)) as label, character_source_id::text as sid, character_source_id::text as rsid, 'paramount' as rss
      from plm.pmt_character where nullif(btrim(character_name), '') is not null group by character_source_id) s
   where nullif(s.label, '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'paramount_creative_library'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution(ch.metadata ->> 'resolution_source_system', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'paramount_creative_library'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- self-checks
  select count(*) into v_expected
    from (select min(btrim(character_name)) as label, character_source_id::text as sid, character_source_id::text as rsid, 'paramount' as rss
      from plm.pmt_character where nullif(btrim(character_name), '') is not null group by character_source_id) s
   where nullif(s.label, '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'paramount_creative_library';
  if v_n <> v_expected then raise exception '#5079 VM: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'paramount_creative_library'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 VM: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'paramount_creative_library'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 VM: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- Issue popcre/shared-db#5079 (claim #5103): canonical Characters for licensor SS
-- (WildBrain (Strawberry Shortcake)) from the authorized licensor portal scrape (plm.wildbrain_character), one licensor per
-- change (docs/core-character-backfill-source-decision-20260902.md sec.6 item 4).
--
-- Owner ruling, Albert Hazan, 2026-10-29 (verbatim): "forget the designflow character
-- lost, that was nonsense. licensor scrape is authoritative." No DesignFlow list is read.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.
--
-- PROMOTION CONTRACT (sec.3): each eligible source row is resolved to a new canonical
-- core.character through plm.set_source_resolution(), the only write path for source
-- resolutions. Identity is licensor + source id (sec.4): code is 'wildbrain_tenovos:<source id>'
-- under SS. Each character also gets one core.taxonomy_source_ref keyed on the exact
-- source identity (licensor-stamped by its guard). No Property link is written: this
-- source publishes no reviewed Property edge.
--
-- core.character holds no SS row from this source before this change, so every row is
-- a genuinely new row (owner-rulings 6.4); nothing existing is updated or deleted.
-- Idempotent: a rerun inserts and resolves nothing new.
--
-- RECOVERY. Set each resolution back to 'unresolved' through plm.set_source_resolution(),
-- then delete the taxonomy_source_ref rows and the characters whose metadata issue and
-- source_system match.

do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261030153101';
  v_lic uuid;
  v_n integer;
  v_expected integer;
begin
  select id into v_lic from core.licensor where code = 'SS';
  if v_lic is null then raise exception '#5079 SS: licensor missing'; end if;

  insert into core.character (licensor_id, name, code, status, metadata)
  select v_lic, s.label, 'wildbrain_tenovos:' || s.sid, 'active',
         jsonb_build_object('source_system', 'wildbrain_tenovos', 'source_table', 'plm.wildbrain_character', 'source_id', s.sid,
                            'resolution_source_system', s.rss, 'resolution_source_id', s.rsid,
                            'loaded_by', v_actor, 'issue', v_issue)
    from (select min(btrim(character_label)) as label, character_source_id::text as sid, character_source_id::text as rsid, 'wildbrain' as rss
      from plm.wildbrain_character where in_source_dictionary and nullif(btrim(character_label), '') is not null group by character_source_id) s
   where nullif(s.label, '') is not null
  on conflict do nothing;

  -- provenance
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
  select 'core', 'character', ch.id, ch.metadata ->> 'source_system', ch.metadata ->> 'source_table',
         ch.metadata ->> 'source_id', ch.name, 'verified', jsonb_build_object('loaded_by', v_actor, 'issue', v_issue)
    from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
     and ch.metadata ->> 'source_system' = 'wildbrain_tenovos'
  on conflict (source_system, source_table, source_id) do nothing;

  -- source resolution (durable home)
  perform plm.set_source_resolution(ch.metadata ->> 'resolution_source_system', 'character', ch.metadata ->> 'resolution_source_id', 'matched',
                                    null, ch.id, null, null, '#5079 licensor scrape promotion', null)
     from core.character ch
    where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue
      and ch.metadata ->> 'source_system' = 'wildbrain_tenovos'
      and not exists (select 1 from plm.source_resolution r
                       where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                         and r.source_id = ch.metadata ->> 'resolution_source_id'
                         and r.resolution_status = 'matched' and r.core_character_id = ch.id);

  -- self-checks
  select count(*) into v_expected
    from (select min(btrim(character_label)) as label, character_source_id::text as sid, character_source_id::text as rsid, 'wildbrain' as rss
      from plm.wildbrain_character where in_source_dictionary and nullif(btrim(character_label), '') is not null group by character_source_id) s
   where nullif(s.label, '') is not null;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'wildbrain_tenovos';
  if v_n <> v_expected then raise exception '#5079 SS: % characters loaded, % eligible', v_n, v_expected; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'wildbrain_tenovos'
     and not exists (select 1 from core.taxonomy_source_ref r
                      where r.entity_schema = 'core' and r.entity_table = 'character' and r.entity_id = ch.id
                        and r.source_licensor_id = v_lic);
  if v_n <> 0 then raise exception '#5079 SS: % characters lack licensor-stamped provenance', v_n; end if;

  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'wildbrain_tenovos'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = ch.metadata ->> 'resolution_source_system' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 SS: % characters lack a matched source resolution', v_n; end if;
end
$characters$;
