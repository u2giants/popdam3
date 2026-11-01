-- Issue popcre/shared-db#5079 (claim #5323): restore the Disney (MV/DY/SW) curated
-- Characters on the shared preview database, and their matched plm.source_resolution
-- rows. Migration 20261030153101 applied cleanly to preview on 2026-10-30 but its
-- Disney sections loaded zero rows: their eligibility join reads the canonical studio
-- evidence in plm.opa_property_studio_resolution, which the licensed landing put on
-- production only, so eligible was 0 and the self-checks passed vacuously (0 = 0).
-- The landing rule was amended the same day (owner ruling, Albert Hazan, 2026-11-01,
-- verbatim: "change the rule and see if that fixes the problem") and the studio
-- evidence was landed on preview; this migration re-runs the three Disney sections.
--
-- PROVENANCE AND LINK ROWS ARE DEFERRED: core.taxonomy_source_ref,
-- core.property_character_source_edge and core.property_character_associations were
-- claimed by two other in-flight changes on this issue when this claim was taken.
-- Follow-up claims on this issue restore those rows; the verification bar for this
-- change is per-section character counts plus zero unmatched resolutions.
--
-- Idempotent on production: every write is conflict-guarded and the post-state checks
-- pass unchanged there. Self-checks require eligible > 0 so an empty eligibility
-- source can never pass vacuously again.
-- NO LICENSED VALUES ARE IN THIS FILE: every name is read from plm.* at apply time.


-- MV (Disney OPA bucket MV)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261101125528 (restore of 20261030153101)';
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
  if v_expected = 0 then raise exception '#5079 restore MV: eligibility source is empty; refusing a vacuous pass'; end if;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 MV: % characters loaded, % eligible', v_n, v_expected; end if;
  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 MV: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- DY (Disney OPA bucket DY)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261101125528 (restore of 20261030153101)';
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
  if v_expected = 0 then raise exception '#5079 restore DY: eligibility source is empty; refusing a vacuous pass'; end if;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 DY: % characters loaded, % eligible', v_n, v_expected; end if;
  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 DY: % characters lack a matched source resolution', v_n; end if;
end
$characters$;

-- SW (Disney OPA bucket SW)
do $characters$
declare
  v_issue constant text := 'popcre/shared-db#5079';
  v_actor constant text := 'shared-db migration 20261101125528 (restore of 20261030153101)';
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
  if v_expected = 0 then raise exception '#5079 restore SW: eligibility source is empty; refusing a vacuous pass'; end if;
  select count(*) into v_n from core.character
   where licensor_id = v_lic and metadata ->> 'issue' = v_issue and metadata ->> 'source_system' = 'disney_opa';
  if v_n <> v_expected then raise exception '#5079 SW: % characters loaded, % eligible', v_n, v_expected; end if;
  select count(*) into v_n from core.character ch
   where ch.licensor_id = v_lic and ch.metadata ->> 'issue' = v_issue and ch.metadata ->> 'source_system' = 'disney_opa'
     and not exists (select 1 from plm.source_resolution r
                      where r.source_system = 'disney_opa' and r.entity_kind = 'character'
                        and r.source_id = ch.metadata ->> 'resolution_source_id'
                        and r.resolution_status = 'matched' and r.core_character_id = ch.id);
  if v_n <> 0 then raise exception '#5079 SW: % characters lack a matched source resolution', v_n; end if;
end
$characters$;
