-- Step 7A — FAULT 4: absence of a ColdLion record was a SILENT FAILURE.
-- Plan: plan_coldlion_licensor_property_accelerated_cutover.md, Step 7A items 3-4 and 6.
--
-- Forward correction of plm.promote_coldlion_source_owned only. 20260729230000,
-- 20260729234500 and 20260729235500 are all applied to preview rjyboqwcdzcocqgmsyel and are
-- therefore immutable (AGENTS.md §4 rule 4) — and editing them could not repair preview
-- anyway, because the ledger already records those versions and the CLI would never re-run
-- them. No table, index, policy, grant, trigger or other function changes here; this
-- migration reads and writes no data.
--
-- THE FAULT
-- ---------
-- present_this_cycle was computed as the bare comparison
--     (m.last_sync_run_id = v_snapshot_run_id)
-- which is NULL — not false — whenever a mirror row has a NULL last_sync_run_id. The
-- quarantine CASE then evaluated
--     when resolution_status = 'manually_matched' and not present_this_cycle
--          then 'missing_source_record'
-- as NULL rather than TRUE, so that arm never fired. Execution fell through every remaining
-- arm and produced NO quarantine reason at all, while the promotion filters (which require
-- `and present_this_cycle`) also excluded the row.
--
-- Net effect: an approved-linked record that ColdLion STOPPED SENDING was silently neither
-- promoted nor flagged. It simply disappeared from the cycle with no error, no alert and no
-- review item. Proven on preview 2026-07-29: nulling last_sync_run_id on one approved row
-- produced zero missing_source_record quarantines.
--
-- That is precisely the silent-failure class this repository treats as a first-class bug,
-- and it defeats one of the plan's locked decisions — "Absence from ColdLion never means
-- delete or inactive" only holds if absence is actually DETECTED. A missing record must
-- always surface as a review item.
--
-- THE FIX: coalesce the comparison to FALSE, so a NULL run id means "not present this
-- cycle" instead of "unknown". Found by the Step 7A fault-case rehearsal
-- (tools/rehearse-coldlion-recurring-cycles.mjs), before any production approval.

create or replace function plm.promote_coldlion_source_owned(
  p_expected jsonb,
  p_client_plan jsonb default null,
  p_is_drill boolean default false
)
returns table (
  sync_run_id            uuid,
  mode                   text,
  source_rows            integer,
  linked_rows            integer,
  promotions             integer,
  curated_name_changes   integer,
  provenance_refreshes   integer,
  unchanged_rows         integer,
  quarantined_rows       integer,
  protected_violations   integer
)
language plpgsql
security definer
set search_path = plm, ingest, core, app, extensions, public
as $$
declare
  v_run_id            uuid;
  v_snapshot_run_id   uuid;
  v_env               text := current_database();
  v_before_uuid       text;
  v_before_status     text;
  v_before_parent     text;
  v_after_uuid        text;
  v_after_status      text;
  v_after_parent      text;
  v_lic_before        bigint;
  v_prop_before       bigint;
  v_lic_after         bigint;
  v_prop_after        bigint;
  v_source_rows       integer := 0;
  v_linked_rows       integer := 0;
  v_promotions        integer := 0;
  v_name_changes      integer := 0;
  v_prov_refresh      integer := 0;
  v_unchanged         integer := 0;
  v_quarantined       integer := 0;
  v_violations        integer := 0;
  v_client_keys       text[];
  v_server_keys       text[];
begin
  -- ---------------------------------------------------------------------------------
  -- 5.1 The breaker must be closed. A tripped breaker refuses promotion outright.
  -- ---------------------------------------------------------------------------------
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    perform plm.trip_taxonomy_circuit_breaker(
      'promote_source_owned attempted while the breaker was already tripped',
      'breaker_open', 'coldlion_licensor_property', null, v_env, session_user, p_is_drill,
      jsonb_build_object('mode', 'promote_source_owned'));
    raise exception
      'ColdLion promotion refused: the circuit breaker for lane coldlion_licensor_property is TRIPPED. Promotion stays disabled until an explicitly authorized reset after a green preview evaluation.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.2 Promotion may only ever operate over the human-approved link set. The pins are
  --     the same Phase 4 approval Albert signed off: 542 rows / 271 distinct canonical.
  --     A caller cannot widen the scope by inventing a contract.
  -- ---------------------------------------------------------------------------------
  if p_expected is null or jsonb_typeof(p_expected) <> 'object'
     or lower(btrim(coalesce(p_expected ->> 'hash', ''))) <> '1230f5a12d0f2a3029f1d3df17fc5b5f'
     or btrim(coalesce(p_expected ->> 'count', '')) <> '542'
     or btrim(coalesce(p_expected ->> 'distinct_canonical', '')) <> '271' then
    raise exception
      'promote_source_owned rejected: the expected contract must be exactly the approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271 — Albert Hazan approval). Promotion can never operate over an unapproved link scope.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.3 Protected hashes + canonical row counts BEFORE any write.
  -- ---------------------------------------------------------------------------------
  select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_before_uuid
  from (select id from core.licensor union all select id from core.property) u;
  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), '')) into v_before_status
  from (select id, status::text from core.licensor union all select id, status::text from core.property) s;
  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), '')) into v_before_parent
  from core.property;
  select count(*) into v_lic_before from core.licensor;
  select count(*) into v_prop_before from core.property;

  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_licensors_properties_promote_source_owned', 'running', now(),
          jsonb_build_object('mode', 'promote_source_owned',
                             'rule_id', 'coldlion_source_name_normalized_equivalent_v1',
                             'is_drill', p_is_drill,
                             'protected_hashes_before',
                             jsonb_build_object('uuid', v_before_uuid,
                                                'status', v_before_status,
                                                'parent_edge', v_before_parent)))
  returning id into v_run_id;

  -- ---------------------------------------------------------------------------------
  -- 5.4 Which ColdLion snapshot is this cycle promoting? The most recent SUCCESSFUL
  --     mirror_only run. Mirror rows stamped with that run are "present this cycle";
  --     approved-linked rows NOT stamped with it are absent, i.e. review items.
  -- ---------------------------------------------------------------------------------
  select id into v_snapshot_run_id
  from ingest.sync_run
  where source_name = 'coldlion_licensors_properties_api' and status = 'succeeded'
  order by started_at desc nulls last
  limit 1;

  if v_snapshot_run_id is null then
    update ingest.sync_run set status = 'failed', finished_at = now(),
           error = 'no successful ColdLion mirror_only snapshot to promote'
     where id = v_run_id;
    raise exception
      'ColdLion promotion refused: there is no successful mirror_only snapshot to promote. The recurring lane runs the snapshot first, on purpose — promoting stale mirror rows would present old ERP truth as current.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.5 Build the decision set, resolving EVERY row by the full typed key
  --     (company_code, division_code, mg_type_code, mg_code) — never mg_code alone.
  --     `FR` is a licensor here and a property in ColdLion; codes are unique only
  --     within (division, mg_type_code). Matching on code alone corrupts the taxonomy.
  -- ---------------------------------------------------------------------------------
  create temporary table coldlion_promote_rows on commit drop as
  with mirror as (
    select 'licensor'::text as entity_type, company_code, division_code, mg_type_code, mg_code,
           name as source_name, licensor_id as canonical_id, resolution_status, last_sync_run_id
    from plm.erp_licensor
    union all
    select 'property'::text, company_code, division_code, mg_type_code, mg_code,
           name, property_id, resolution_status, last_sync_run_id
    from plm.erp_property
  ),
  joined as (
    select m.*,
           -- FIX 4: coalesce to FALSE. A NULL last_sync_run_id made present_this_cycle NULL,
           -- so `not present_this_cycle` evaluated to NULL and the missing_source_record arm
           -- never fired: a record ColdLion stopped sending was SILENTLY neither promoted nor
           -- quarantined. Absence must always be visible as a review item.
           coalesce(m.last_sync_run_id = v_snapshot_run_id, false) as present_this_cycle,
           c.canonical_name, c.canonical_code, c.canonical_status, c.canonical_licensor_id,
           r.id as source_ref_id, r.source_name as ref_source_name, r.source_code as ref_source_code
    from mirror m
    left join lateral (
      select l.name as canonical_name, l.code as canonical_code,
             l.status::text as canonical_status, null::uuid as canonical_licensor_id
      from core.licensor l where m.entity_type = 'licensor' and l.id = m.canonical_id
      union all
      select p.name, p.code, p.status::text, p.licensor_id
      from core.property p where m.entity_type = 'property' and p.id = m.canonical_id
    ) c on true
    left join core.taxonomy_source_ref r
      on r.source_system = 'coldlion'
     and r.source_id = m.company_code || '/' || m.division_code || '/' || m.mg_type_code || '/' || m.mg_code
    -- FIX 1: the select-list alias present_this_cycle is NOT visible in WHERE, so the
    -- expression is repeated here. The original raised 42703 on every call.
    where m.resolution_status = 'manually_matched'
       or m.last_sync_run_id = v_snapshot_run_id
  ),
  -- FIX 2 — WHAT IS AND IS NOT A COLLISION.
  -- The original rule treated ANY canonical row reachable from more than one typed key as a
  -- collision. Rehearsed against preview on 2026-07-29 it quarantined 542 of 542 rows, i.e.
  -- the ENTIRE feed, because multi-key fan-in is the APPROVED DESIGN: Albert's approved
  -- Phase 4 mapping deliberately points 542 ColdLion source rows at 271 canonical rows (the
  -- same property legitimately exists under both CW001 and SP001, and both keys mean the
  -- same canonical entity).
  -- Fan-in is therefore NOT a fault. The real hazard is fan-in where the source rows
  -- DISAGREE about the name, because promotion would then have to pick a winner — and
  -- picking a winner silently is exactly the corruption this lane exists to prevent.
  -- DO NOT 'simplify' this back to key_count > 1; that disables the whole feed.
  collisions as (
    select canonical_id,
           count(distinct company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code) as key_count,
           count(distinct division_code) as division_count,
           count(distinct company_code || '/' || mg_type_code || '/' || mg_code) as keys_without_division,
           count(distinct plm.coldlion_normalize_name(source_name))
             filter (where present_this_cycle) as distinct_proposed_names
    from joined
    where canonical_id is not null and resolution_status = 'manually_matched'
    group by canonical_id
  )
  select j.entity_type, j.company_code, j.division_code, j.mg_type_code, j.mg_code,
         j.source_name, j.canonical_id, j.canonical_name, j.canonical_code,
         j.canonical_status, j.canonical_licensor_id, j.resolution_status,
         j.present_this_cycle, j.source_ref_id, j.ref_source_name,
         case
           when j.mg_type_code !~ '^[0-9]{2}$'
             or btrim(coalesce(j.company_code, '')) = ''
             or btrim(coalesce(j.division_code, '')) = ''
             or btrim(coalesce(j.mg_code, '')) = ''
             then 'wrong_type'
           when j.resolution_status <> 'manually_matched' and j.present_this_cycle
             then 'new_source_record'
           when j.resolution_status = 'manually_matched' and not j.present_this_cycle
             then 'missing_source_record'
           when j.canonical_id is null
             then 'ambiguous_match'
           when j.canonical_name is null
             then 'cross_typed'
           when col.key_count > 1 and col.distinct_proposed_names > 1
                and col.keys_without_division = 1 and col.division_count > 1
             then 'cross_division_collision'
           when col.key_count > 1 and col.distinct_proposed_names > 1
             then 'code_collision'
           when coalesce(j.canonical_code, '') <> j.mg_code
             then 'rekeyed_record'
           when j.entity_type = 'property' and j.canonical_licensor_id is null
             then 'parentless_record'
           when btrim(coalesce(j.source_name, '')) = ''
             then 'source_name_divergence'
           when plm.coldlion_normalize_name(j.source_name) <> plm.coldlion_normalize_name(j.canonical_name)
             then 'source_name_divergence'
           else null
         end as quarantine_reason
  from joined j
  left join collisions col on col.canonical_id = j.canonical_id;

  select count(*) into v_source_rows from coldlion_promote_rows where present_this_cycle;
  select count(*) into v_linked_rows from coldlion_promote_rows where resolution_status = 'manually_matched';

  -- ---------------------------------------------------------------------------------
  -- 5.6 Cross-check the runner's plan. Disagreement is fail-closed, never "trust one".
  -- ---------------------------------------------------------------------------------
  if p_client_plan is not null then
    if jsonb_typeof(p_client_plan) <> 'object'
       or coalesce(p_client_plan ->> 'rule', '') <> 'coldlion_source_name_normalized_equivalent_v1' then
      update ingest.sync_run set status = 'failed', finished_at = now(),
             error = 'client plan malformed or authored by a different rule' where id = v_run_id;
      raise exception
        'ColdLion promotion refused: the runner plan is malformed or was produced by a different rule than coldlion_source_name_normalized_equivalent_v1.'
        using errcode = 'P0001';
    end if;

    select coalesce(array_agg(k order by k), '{}') into v_client_keys
    from jsonb_array_elements(coalesce(p_client_plan -> 'promotions', '[]'::jsonb)) e,
         lateral (select e ->> 'key' as k) x;

    select coalesce(array_agg(k order by k), '{}') into v_server_keys
    from coldlion_promote_rows,
         lateral (select company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code as k) x
    where quarantine_reason is null
      and resolution_status = 'manually_matched'
      and present_this_cycle
      and (plm.coldlion_normalize_name(source_name) = plm.coldlion_normalize_name(canonical_name)
           and (source_name <> canonical_name or coalesce(ref_source_name, '') <> coalesce(source_name, '')));

    if v_client_keys <> v_server_keys then
      update ingest.sync_run set status = 'failed', finished_at = now(),
             error = 'runner plan disagrees with the database recomputation' where id = v_run_id;
      raise exception
        'ColdLion promotion refused: the runner plan and the database recomputation disagree on which rows may be promoted. Runner=%, database=%. Two independent computations that disagree mean one of them is wrong, so nothing is promoted.',
        v_client_keys, v_server_keys
        using errcode = 'P0001';
    end if;
  end if;

  -- ---------------------------------------------------------------------------------
  -- 5.7 Record every quarantine (append-only). The canonical layer is untouched here.
  -- ---------------------------------------------------------------------------------
  insert into plm.coldlion_promotion_quarantine (
    sync_run_id, entity_type, company_code, division_code, mg_type_code, mg_code,
    canonical_id, canonical_name, source_name, reason, detail, environment, is_drill)
  select v_run_id, entity_type, company_code, division_code, mg_type_code, mg_code,
         canonical_id, canonical_name, source_name, quarantine_reason,
         case quarantine_reason
           when 'new_source_record' then 'ColdLion sent a record with no approved canonical link; canonical rows are never auto-created'
           when 'missing_source_record' then 'an approved-linked record was absent from this ColdLion snapshot; absence never deletes, inactivates, or unlinks a canonical row'
           when 'ambiguous_match' then 'the typed key does not resolve to exactly one canonical row'
           when 'cross_typed' then 'the approved link points at a canonical row of the other entity type'
           when 'code_collision' then 'the canonical row is reachable from more than one typed key'
           when 'cross_division_collision' then 'the same company/type/code appears in more than one division for one canonical row'
           when 'wrong_type' then 'incomplete or malformed typed key, or the (division, mg_type_code) header does not denote a licensed entity'
           when 'rekeyed_record' then 'the canonical code no longer equals the ColdLion mg_code'
           when 'parentless_record' then 'canonical property has no licensor parent; the parent edge is Supabase-curated'
           when 'source_name_divergence' then 'ColdLion''s descriptive value is not a presentation variant of the curated name; a human must confirm this is a rename and not a re-pointed code'
         end,
         v_env, p_is_drill
  from coldlion_promote_rows
  where quarantine_reason is not null;
  v_quarantined := coalesce((select count(*) from coldlion_promote_rows where quarantine_reason is not null), 0);

  -- Audit the held decisions too, so a reviewer sees the refused name change explicitly.
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         canonical_id, company_code, division_code, mg_type_code, mg_code,
         case entity_type when 'licensor' then 'core.licensor.name' else 'core.property.name' end,
         canonical_name, source_name, 'held_for_review', quarantine_reason, v_env, p_is_drill
  from coldlion_promote_rows
  where quarantine_reason = 'source_name_divergence' and canonical_id is not null;

  -- ---------------------------------------------------------------------------------
  -- 5.8 Refresh the PROVENANCE layer for every valid linked row. This is where
  --     ColdLion's current descriptive truth always lands, even when the curated
  --     display name is held for review — so nothing upstream is ever lost.
  -- ---------------------------------------------------------------------------------
  with refreshed as (
    update core.taxonomy_source_ref r
       set source_name = p.source_name,
           source_code = p.mg_code
      from coldlion_promote_rows p
     where r.id = p.source_ref_id
       and p.source_ref_id is not null
       and p.resolution_status = 'manually_matched'
       and p.present_this_cycle
       and p.quarantine_reason is distinct from 'wrong_type'
       and (coalesce(r.source_name, '') <> coalesce(p.source_name, '')
            or coalesce(r.source_code, '') <> p.mg_code)
    returning r.id, p.entity_type, p.company_code, p.division_code, p.mg_type_code,
              p.mg_code, p.canonical_id, p.source_name
  )
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         canonical_id, company_code, division_code, mg_type_code, mg_code,
         'core.taxonomy_source_ref.source_name', null, source_name, 'applied',
         'provenance refresh: ColdLion owns its source descriptive value unconditionally',
         v_env, p_is_drill
  from refreshed;
  -- FIX 3: qualify the table. sync_run_id is BOTH a RETURNS TABLE output column of this
  -- function and a column of the audit table, so an unqualified reference is ambiguous (42702).
  v_prov_refresh := coalesce((select count(*) from plm.coldlion_promotion_audit a
                              where a.sync_run_id = v_run_id
                                and a.field_name = 'core.taxonomy_source_ref.source_name'
                                and a.decision = 'applied'), 0);

  -- ---------------------------------------------------------------------------------
  -- 5.9 The ONE approved deterministic curated-name rule.
  --     Apply the ColdLion name over the curated display name ONLY when the two are the
  --     same name presented differently (normalized-equivalent). A normalized-DIFFERENT
  --     name already quarantined in 5.7 and is not reachable here.
  -- ---------------------------------------------------------------------------------
  with eligible as (
    select * from coldlion_promote_rows
    where quarantine_reason is null
      and resolution_status = 'manually_matched'
      and present_this_cycle
      and canonical_id is not null
      and source_name is distinct from canonical_name
      and plm.coldlion_normalize_name(source_name) = plm.coldlion_normalize_name(canonical_name)
  ),
  lic as (
    update core.licensor l
       set name = e.source_name, updated_at = now()
      from eligible e
     where e.entity_type = 'licensor' and l.id = e.canonical_id
    returning l.id, e.entity_type, e.company_code, e.division_code, e.mg_type_code,
              e.mg_code, e.canonical_name as old_name, e.source_name as new_name
  ),
  prop as (
    update core.property p
       set name = e.source_name, updated_at = now()
      from eligible e
     where e.entity_type = 'property' and p.id = e.canonical_id
    returning p.id, e.entity_type, e.company_code, e.division_code, e.mg_type_code,
              e.mg_code, e.canonical_name as old_name, e.source_name as new_name
  ),
  changed as (select * from lic union all select * from prop)
  insert into plm.coldlion_promotion_audit (
    sync_run_id, rule_id, entity_type, entity_table, entity_id,
    company_code, division_code, mg_type_code, mg_code,
    field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
  select v_run_id, 'coldlion_source_name_normalized_equivalent_v1', entity_type,
         case entity_type when 'licensor' then 'core.licensor' else 'core.property' end,
         id, company_code, division_code, mg_type_code, mg_code,
         case entity_type when 'licensor' then 'core.licensor.name' else 'core.property.name' end,
         old_name, new_name, 'applied',
         'normalized-equivalent presentation change (same name, different casing/spacing/punctuation)',
         v_env, p_is_drill
  from changed;

  select count(*) into v_name_changes
  from plm.coldlion_promotion_audit a
  where a.sync_run_id = v_run_id and a.decision = 'applied'
    and a.field_name in ('core.licensor.name', 'core.property.name');

  v_promotions := v_prov_refresh + v_name_changes;

  select count(*) into v_unchanged
  from coldlion_promote_rows
  where quarantine_reason is null and resolution_status = 'manually_matched' and present_this_cycle
    and source_name = canonical_name
    and coalesce(ref_source_name, '') = coalesce(source_name, '');

  -- ---------------------------------------------------------------------------------
  -- 5.10 PROTECTED-INVARIANT GUARD. Nothing above may have changed a canonical UUID,
  --      a lifecycle status, a Property parent edge, or the canonical row counts.
  --      A mismatch raises, which rolls the whole cycle back — the canonical layer is
  --      never left partially promoted.
  -- ---------------------------------------------------------------------------------
  select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) into v_after_uuid
  from (select id from core.licensor union all select id from core.property) u;
  select md5(coalesce(string_agg(id::text || '|' || status::text, '|' order by id::text), '')) into v_after_status
  from (select id, status::text from core.licensor union all select id, status::text from core.property) s;
  select md5(coalesce(string_agg(id::text || '|' || licensor_id::text, '|' order by id::text), '')) into v_after_parent
  from core.property;
  select count(*) into v_lic_after from core.licensor;
  select count(*) into v_prop_after from core.property;

  if v_after_uuid <> v_before_uuid or v_after_status <> v_before_status
     or v_after_parent <> v_before_parent
     or v_lic_after <> v_lic_before or v_prop_after <> v_prop_before then
    v_violations := 1;
    insert into plm.coldlion_promotion_audit (
      sync_run_id, rule_id, entity_type, entity_table, entity_id,
      company_code, division_code, mg_type_code, mg_code,
      field_name, old_value, new_value, decision, decision_detail, environment, is_drill)
    values (v_run_id, 'coldlion_source_name_normalized_equivalent_v1', 'licensor', 'core.licensor',
            '00000000-0000-0000-0000-000000000000', 'n/a', 'n/a', '00', 'n/a',
            'core.licensor.name', v_before_uuid, v_after_uuid, 'refused',
            'protected-invariant violation: canonical UUID/status/parent-edge hash or row count changed inside the promotion transaction',
            v_env, p_is_drill);
    raise exception
      'ColdLion promotion ABORTED on a protected invariant: canonical UUID/status/parent hashes or row counts changed inside the transaction (uuid %/%, status %/%, parent %/%, licensor %/%, property %/%). ColdLion never owns UUIDs, lifecycle status, or Property parents. Nothing was promoted.',
      v_before_uuid, v_after_uuid, v_before_status, v_after_status,
      v_before_parent, v_after_parent, v_lic_before, v_lic_after, v_prop_before, v_prop_after
      using errcode = 'P0001';
  end if;

  update ingest.sync_run
     set status = 'succeeded', finished_at = now(),
         metadata = metadata || jsonb_build_object(
           'snapshot_run_id', v_snapshot_run_id,
           'source_rows', v_source_rows,
           'linked_rows', v_linked_rows,
           'promotions', v_promotions,
           'curated_name_changes', v_name_changes,
           'provenance_refreshes', v_prov_refresh,
           'unchanged_rows', v_unchanged,
           'quarantined_rows', v_quarantined,
           'protected_hashes_after', jsonb_build_object(
             'uuid', v_after_uuid, 'status', v_after_status, 'parent_edge', v_after_parent),
           'protected_hashes_unchanged', true)
   where id = v_run_id;

  return query select v_run_id, 'promote_source_owned'::text, v_source_rows, v_linked_rows,
                      v_promotions, v_name_changes, v_prov_refresh, v_unchanged,
                      v_quarantined, v_violations;

exception
  when others then
    if v_run_id is not null then
      begin
        update ingest.sync_run
           set status = 'failed', finished_at = now(), error = sqlerrm,
               metadata = metadata || jsonb_build_object('stage', 'failed', 'mode', 'promote_source_owned')
         where id = v_run_id;
      exception when others then null;
      end;
    end if;
    raise;
end;
$$;
