-- Issue #2357: caller-safe candidate APIs. Schema only; no curated row writes.
-- derived-from: none

begin;

set local lock_timeout = '2s';
set local statement_timeout = '60s';

-- PL/pgSQL is intentional: unlike an inline SQL subquery, the protected query is
-- planned only after caller privilege checks. No definer identity or RLS bypass.
-- Set-returning and called ONCE per view query (materialized CTE below), never per
-- candidate row: it picks the latest complete capture once, then aggregates that one
-- capture by property. The capture scan is served by the capture_id-leading unique key
-- of plm.opa_property_character_capture, so cost is bounded by one capture's size and
-- does not grow with the number of candidates (#2357 review M2/M4). The small
-- plm.opa_capture root table is read once per query. Its tie-break deliberately mirrors
-- plm.begin_opa_capture; a change there must be mirrored here (review L10).
-- Result: one sentinel row (licensed_property_id NULL) carrying readability, plus one
-- row per observed property when readable.
-- M5: parallel safe dropped — the body calls has_table_privilege/row_security_active
-- and reads RLS-enabled tables; worker safety is not established. M2: idempotent DDL
-- via create-or-replace; the predecessor version 20260920151046 was never applied to
-- preview or production (ledger-verified 2026-09-20, see contract assumptions).
create or replace function plm.licensing_opa_observation_count()
returns table(evidence_readable boolean, licensed_property_id bigint, observation_count bigint)
language plpgsql stable security invoker set search_path = '' as $function$
declare
  v_capture_id uuid;
begin
  if not has_table_privilege(current_user, 'plm.opa_capture', 'SELECT')
     or not has_table_privilege(current_user, 'plm.opa_property_character_capture', 'SELECT')
     -- A filtered slice cannot prove a complete capture count. Do not turn RLS
     -- invisibility into a false zero, even if a future grant permits SELECT.
     or row_security_active('plm.opa_capture'::regclass)
     or row_security_active('plm.opa_property_character_capture'::regclass) then
    return query select false, null::bigint, null::bigint;
    return;
  end if;
  select c.id into v_capture_id from plm.opa_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc limit 1;
  if v_capture_id is null then
    return query select false, null::bigint, null::bigint;
    return;
  end if;
  return query
    select true, null::bigint, null::bigint
    union all
    select true, o.licensed_property_id, count(*)
      from plm.opa_property_character_capture o
      where o.capture_id = v_capture_id
      group by o.licensed_property_id;
end
$function$;
revoke all on function plm.licensing_opa_observation_count() from public, anon;
grant execute on function plm.licensing_opa_observation_count() to authenticated, service_role;

-- Supporting indexes for the queue hot paths and the helper root lookup.
-- H3: entity queue filters plm.source_resolution.resolution_status; the PK leads
-- with (source_system, entity_kind, source_id) and cannot serve that predicate.
-- H2: relationship queue filters licensing_relationship_resolution.resolution_status;
-- the existing index leads with (licensor_id, relationship_kind, resolution_status)
-- and cannot serve an unconstrained status-only predicate.
-- L4: the helper orders by (source_captured_at desc, load_completed_at desc, id desc)
-- filtered on status='complete'; house style for capture roots is (status, source_captured_at).
create index if not exists source_resolution_open_status_idx
  on plm.source_resolution (resolution_status)
  where resolution_status in ('unresolved', 'ambiguous', 'deferred');

create index if not exists licensing_relationship_resolution_open_status_idx
  on plm.licensing_relationship_resolution (resolution_status)
  where resolution_status in ('unresolved', 'ambiguous', 'deferred');

create index if not exists opa_capture_status_captured_idx
  on plm.opa_capture (status, source_captured_at desc);

-- ---------------------------------------------------------------------------
-- 1. Entity candidates -- one row per source entity decision, with the scope
--    authority that governs it and latest-complete OPA corroboration evidence.
-- ---------------------------------------------------------------------------

-- M2: idempotent via drop-if-exists then create (create-or-replace cannot add columns).
drop view if exists api.licensing_entity_candidates;
create view api.licensing_entity_candidates
with (security_invoker = true) as
with opa as materialized (
  select * from plm.licensing_opa_observation_count()
), opa_state as (
  select coalesce(bool_or(o.evidence_readable) filter (where o.licensed_property_id is null), false) as readable
  from opa o
), candidate as (
  select sr.*,
    -- 19 digits covers the full positive bigint range and the full negative range
    -- with a leading minus; longer or malformed ids abstain instead of erroring (L2).
    case when sr.source_system = 'disney_opa' and sr.entity_kind = 'property'
              and sr.source_id ~ '^-?[0-9]{1,19}$'
              and (sr.source_id::numeric between -9223372036854775808 and 9223372036854775807)
         then sr.source_id::bigint end as opa_property_id
  from plm.source_resolution sr
)
select
  c.source_system,
  c.entity_kind,
  c.source_id,
  c.resolution_status,
  (c.resolution_reason is not null) as has_resolution_reason,
  -- Which canonical target the decision points at, if any. Exactly one is non-null for a
  -- matched row (enforced by source_resolution_matched_target_chk); all are null otherwise.
  c.core_property_id,
  c.core_character_id,
  c.core_style_guide_id,
  c.core_licensor_id,
  c.core_franchise_id,
  c.dam_asset_id,
  -- is_open matches api.licensing_resolution_queue's backlog definition exactly:
  -- unresolved, ambiguous, or deferred (H1). needs_decision is the actionable subset
  -- (unresolved or ambiguous) — deferred is open but not yet ready for a decision.
  (c.resolution_status in ('unresolved', 'ambiguous', 'deferred')) as is_open,
  (c.resolution_status in ('unresolved', 'ambiguous')) as needs_decision,
  (c.resolution_status = 'ambiguous')                  as is_ambiguous,
  -- Scope configuration remains explicitly licensor-qualified. It does not
  -- establish which licensor owns this unresolved entity.
  scope.source_scope_by_licensor,
  -- OPA corroboration. Readable only by a caller with unfiltered rights on the capture
  -- tables; a browser role sees false/NULL rather than a misleading zero.
  (c.opa_property_id is not null and s.readable) as opa_evidence_readable,
  case when c.opa_property_id is not null and s.readable
       then coalesce(o.observation_count, 0) end as opa_observation_count,
  c.resolved_at,
  -- resolved_by is the audit actor already exposed to authenticated by
  -- api.source_resolution; it is deliberately kept (review L9). created_by is not exposed.
  c.resolved_by,
  c.created_at,
  c.updated_at
from candidate c
cross join opa_state s
left join opa o on o.licensed_property_id = c.opa_property_id
left join lateral (
  -- A source resolution has no owning-licensor field for most entity kinds.
  -- Report configuration per licensor, never a cross-licensor permission boolean.
  select coalesce(jsonb_agg(jsonb_build_object(
    'licensor_id', lss.licensor_id,
    'source_purpose', lss.source_purpose,
    'authorized', lss.authorized_at is not null and lss.authorized_by is not null
  ) order by lss.licensor_id, lss.source_purpose), '[]'::jsonb) as source_scope_by_licensor
  from plm.licensing_source_scope lss
  where lss.source_system = c.source_system and lss.scope_axis = 'entity'
    and lss.permitted_kind = c.entity_kind
) scope on true;

comment on view api.licensing_entity_candidates is
  'Browser-safe entity resolution candidates: one row per plm.source_resolution decision with '
  'its ambiguity state, the canonical target it points at, and the licensing scope authority '
  'configuration per licensor for that source and kind, never inferred entity ownership. Invoker security preserves the existing '
  'source_resolution and licensing_source_scope read policies. OPA corroboration is a bounded '
  'count guarded by opa_evidence_readable: a caller without rights on the capture tables sees '
  'false and NULL, never a zero that would misstate the source data. No licensed row value, '
  'property or character name, capture identity, source hash or authentication evidence appears here. '
  'Open-status vocabulary: is_open matches the resolution queue backlog (unresolved, ambiguous, deferred); '
  'needs_decision is the actionable subset (unresolved, ambiguous).';

comment on column api.licensing_entity_candidates.opa_evidence_readable is
  'False when the caller lacks unfiltered SELECT on the OPA capture tables, OR when there is no '
  'OPA evidence for this row (non-disney_opa source, non-property kind, or unparseable source_id). '
  'A consumer branching on "not opa_evidence_readable" cannot distinguish withheld from not-applicable; '
  'check opa_observation_count IS NULL for the not-applicable case.';

comment on column api.licensing_entity_candidates.opa_observation_count is
  'Count of OPA property-character observations for this property in the latest complete capture. '
  'NULL means no evidence is visible to this caller (withheld or not applicable). 0 means evidence '
  'is visible and the property has zero observations in the latest complete capture.';

revoke all on api.licensing_entity_candidates from public, anon;
grant select on api.licensing_entity_candidates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Relationship candidates -- one row per relationship decision, with its evidence
--    strength and the scope authority permitting that relationship kind.
-- ---------------------------------------------------------------------------

drop view if exists api.licensing_relationship_candidates;
create view api.licensing_relationship_candidates
with (security_invoker = true) as
select
  lrr.licensor_id,
  lrr.source_system,
  lrr.relationship_kind,
  lrr.source_left_id,
  lrr.source_right_id,
  lrr.resolution_status,
  (lrr.resolution_reason is not null) as has_resolution_reason,
  lrr.evidence_kind,
  lrr.is_direct_source_relationship,
  (lrr.source_evidence is not null) as has_source_evidence,
  lrr.core_property_id,
  lrr.core_character_id,
  lrr.core_style_guide_id,
  lrr.core_franchise_id,
  lrr.dam_asset_id,
  -- is_open matches api.licensing_resolution_queue's backlog definition exactly (H1).
  (lrr.resolution_status in ('unresolved', 'ambiguous', 'deferred')) as is_open,
  (lrr.resolution_status in ('unresolved', 'ambiguous')) as needs_decision,
  (lrr.resolution_status = 'ambiguous')                  as is_ambiguous,
  -- A relationship can only reach 'matched' on direct_source_assertion evidence
  -- (licensing_relationship_resolution's own check constraint). Surfacing that as a column
  -- tells a reviewer why an otherwise-complete row is not eligible to be matched.
  (lrr.evidence_kind = 'direct_source_assertion'
    and coalesce(scope.relationship_evidence_permitted, false)) as eligible_for_match,
  scope.scope_row_count,
  scope.relationship_evidence_permitted,
  scope.source_purposes,
  lrr.resolved_at,
  lrr.resolved_by,
  lrr.created_at,
  lrr.updated_at
from plm.licensing_relationship_resolution lrr
left join lateral (
  select
    -- Every configured scope row for this kind, authority or not (renamed from
    -- authority_count, review L6); relationship_evidence_permitted is the authority test.
    count(*)                                              as scope_row_count,
    coalesce(bool_or(lss.source_purpose = 'relationship_evidence' and lss.authorized_at is not null and lss.authorized_by is not null), false) as relationship_evidence_permitted,
    coalesce(array_agg(distinct lss.source_purpose order by lss.source_purpose), '{}'::text[]) as source_purposes
  from plm.licensing_source_scope lss
  where lss.licensor_id    = lrr.licensor_id
    and lss.source_system  = lrr.source_system
    and lss.scope_axis     = 'relationship'
    and lss.permitted_kind = lrr.relationship_kind
) scope on true;

comment on view api.licensing_relationship_candidates is
  'Browser-safe relationship resolution candidates: one row per plm.licensing_relationship_resolution '
  'decision with its evidence kind, whether it is eligible to be matched (direct source assertion only), '
  'and the licensing scope authority permitting that relationship kind for the licensor and source system. '
  'Invoker security preserves the existing read policies. Source-side identifiers are the opaque source '
  'ids already carried by the resolution table; no licensed name, capture row or source hash appears here. '
  'Open-status vocabulary: is_open matches the resolution queue backlog (unresolved, ambiguous, deferred); '
  'needs_decision is the actionable subset (unresolved, ambiguous). '
  'L5: the scope lateral join filters (licensor_id, source_system, scope_axis, permitted_kind) and is '
  'served by the (licensor_id, source_system) prefix of the licensing_source_scope PK; the remaining '
  'predicates degrade to filters because source_purpose is unconstrained.';

revoke all on api.licensing_relationship_candidates from public, anon;
grant select on api.licensing_relationship_candidates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Resolution queue -- the audited backlog across both axes, one row per
--    (axis, source_system, kind, status) bucket. Counts only; no row content.
-- ---------------------------------------------------------------------------

drop view if exists api.licensing_resolution_queue;
create view api.licensing_resolution_queue
with (security_invoker = true) as
with entity_queue as (
  select
    'entity'::text        as scope_axis,
    null::uuid           as licensor_id,
    sr.source_system,
    sr.entity_kind        as item_kind,
    sr.resolution_status,
    count(*)              as item_count,
    min(sr.created_at)    as oldest_created_at,
    max(sr.updated_at)    as latest_updated_at
  from plm.source_resolution sr
  -- Open-status predicate is served by source_resolution_open_status_idx (H3).
  where sr.resolution_status in ('unresolved', 'ambiguous', 'deferred')
  group by 1, 2, 3, 4, 5
),
relationship_queue as (
  select
    'relationship'::text   as scope_axis,
    lrr.licensor_id,
    lrr.source_system,
    lrr.relationship_kind  as item_kind,
    lrr.resolution_status,
    count(*)               as item_count,
    min(lrr.created_at)    as oldest_created_at,
    max(lrr.updated_at)    as latest_updated_at
  from plm.licensing_relationship_resolution lrr
  -- Open-status predicate is served by licensing_relationship_resolution_open_status_idx (H2).
  where lrr.resolution_status in ('unresolved', 'ambiguous', 'deferred')
  group by 1, 2, 3, 4, 5
)
select
  q.scope_axis,
  q.licensor_id,
  q.source_system,
  q.item_kind,
  q.resolution_status,
  q.item_count,
  (q.resolution_status = 'ambiguous') as is_ambiguous,
  q.oldest_created_at,
  q.latest_updated_at
from (
  -- L3: explicit column lists, not select *, so a column added to one CTE at a
  -- different position cannot silently mismap through the union.
  select scope_axis, licensor_id, source_system, item_kind, resolution_status,
         item_count, oldest_created_at, latest_updated_at
    from entity_queue
  union all
  select scope_axis, licensor_id, source_system, item_kind, resolution_status,
         item_count, oldest_created_at, latest_updated_at
    from relationship_queue
) q;

comment on view api.licensing_resolution_queue is
  'Audited licensing resolution backlog: counts of open decisions (unresolved, ambiguous, deferred) '
  'bucketed by axis, licensor (NULL for unassigned entities), source system, item kind and status, with the age of the oldest open item. '
  'Aggregate only -- it exposes no source identifier and no row content, so it stays readable '
  'without widening access to any licensed value. Invoker security preserves the existing read '
  'policies, so the counts a caller sees are the counts that caller is entitled to see. '
  'Open-status vocabulary (H1): this queue and the is_open column on both candidate views use '
  'the same definition — unresolved, ambiguous, or deferred. needs_decision on the candidate '
  'views is the actionable subset (unresolved or ambiguous only).';

revoke all on api.licensing_resolution_queue from public, anon;
grant select on api.licensing_resolution_queue to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Post-create verification. Positive AND negative controls, from the authoritative
--    catalog (pg_class.relacl / has_table_privilege), never information_schema.
--    Each control is written so it CAN fail -- an assertion nothing can falsify is
--    furniture, not a check.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_view text;
  v_exposed text;
  v_missing text;
  v_bad_type text;
  v_extra text;
begin
  -- M4: authenticated must hold USAGE on schema api, not just table SELECT.
  if not has_schema_privilege('authenticated', 'api', 'USAGE') then
    raise exception '#2357 VERIFY FAILED: authenticated lacks USAGE on schema api';
  end if;

  -- M5: parallel safe was dropped; assert the marker is not 's' (unsafe or restricted).
  if not exists (
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=to_regprocedure('plm.licensing_opa_observation_count()')
      and not p.prosecdef and p.provolatile='s' and p.proparallel <> 's' and p.proretset
      and l.lanname='plpgsql'
      and 'search_path=""'=any(coalesce(p.proconfig,'{}'))
      and pg_get_function_result(p.oid)='TABLE(evidence_readable boolean, licensed_property_id bigint, observation_count bigint)'
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE')
  ) then
    raise exception '#2357 VERIFY FAILED: helper must be non-inlined stable SECURITY INVOKER (not parallel safe)';
  end if;

  -- M3: exact column set AND types per view. A missing column, a silently gained
  -- column, or a wrong type is a failure.
  -- Entity candidates: 21 columns.
  select string_agg(format('%s.%s', r.view_name, r.col), ', ')
    into v_missing
  from (values
    ('licensing_entity_candidates','source_system'),('licensing_entity_candidates','entity_kind'),
    ('licensing_entity_candidates','source_id'),('licensing_entity_candidates','resolution_status'),
    ('licensing_entity_candidates','has_resolution_reason'),('licensing_entity_candidates','core_property_id'),
    ('licensing_entity_candidates','core_character_id'),('licensing_entity_candidates','core_style_guide_id'),
    ('licensing_entity_candidates','core_licensor_id'),('licensing_entity_candidates','core_franchise_id'),
    ('licensing_entity_candidates','dam_asset_id'),('licensing_entity_candidates','is_open'),
    ('licensing_entity_candidates','needs_decision'),('licensing_entity_candidates','is_ambiguous'),
    ('licensing_entity_candidates','source_scope_by_licensor'),('licensing_entity_candidates','opa_evidence_readable'),
    ('licensing_entity_candidates','opa_observation_count'),('licensing_entity_candidates','resolved_at'),
    ('licensing_entity_candidates','resolved_by'),('licensing_entity_candidates','created_at'),
    ('licensing_entity_candidates','updated_at'),
    ('licensing_relationship_candidates','licensor_id'),('licensing_relationship_candidates','source_system'),
    ('licensing_relationship_candidates','relationship_kind'),('licensing_relationship_candidates','source_left_id'),
    ('licensing_relationship_candidates','source_right_id'),('licensing_relationship_candidates','resolution_status'),
    ('licensing_relationship_candidates','has_resolution_reason'),('licensing_relationship_candidates','evidence_kind'),
    ('licensing_relationship_candidates','is_direct_source_relationship'),('licensing_relationship_candidates','has_source_evidence'),
    ('licensing_relationship_candidates','core_property_id'),('licensing_relationship_candidates','core_character_id'),
    ('licensing_relationship_candidates','core_style_guide_id'),('licensing_relationship_candidates','core_franchise_id'),
    ('licensing_relationship_candidates','dam_asset_id'),('licensing_relationship_candidates','is_open'),
    ('licensing_relationship_candidates','needs_decision'),('licensing_relationship_candidates','is_ambiguous'),
    ('licensing_relationship_candidates','eligible_for_match'),('licensing_relationship_candidates','scope_row_count'),
    ('licensing_relationship_candidates','relationship_evidence_permitted'),('licensing_relationship_candidates','source_purposes'),
    ('licensing_relationship_candidates','resolved_at'),('licensing_relationship_candidates','resolved_by'),
    ('licensing_relationship_candidates','created_at'),('licensing_relationship_candidates','updated_at'),
    ('licensing_resolution_queue','scope_axis'),('licensing_resolution_queue','licensor_id'),
    ('licensing_resolution_queue','source_system'),('licensing_resolution_queue','item_kind'),
    ('licensing_resolution_queue','resolution_status'),('licensing_resolution_queue','item_count'),
    ('licensing_resolution_queue','is_ambiguous'),('licensing_resolution_queue','oldest_created_at'),
    ('licensing_resolution_queue','latest_updated_at')
  ) r(view_name, col)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('api.' || r.view_name) and a.attname = r.col
      and a.attnum > 0 and not a.attisdropped
  );
  if v_missing is not null then
    raise exception '#2357 VERIFY FAILED: required column missing: %', v_missing;
  end if;

  -- No unexpected columns: the column count must match exactly.
  select string_agg(format('%s(%s actual, expected %s)', v.relname,
      (select count(*) from pg_attribute a where a.attrelid=v.oid and a.attnum>0 and not a.attisdropped),
      e.expected), ', ')
    into v_extra
  from (values
    ('licensing_entity_candidates', 21::bigint),
    ('licensing_relationship_candidates', 26::bigint),
    ('licensing_resolution_queue', 9::bigint)
  ) e(view_name, expected)
  join pg_class v on v.relname = e.view_name
  join pg_namespace n on n.oid = v.relnamespace and n.nspname = 'api'
  where (select count(*) from pg_attribute a where a.attrelid=v.oid and a.attnum>0 and not a.attisdropped) <> e.expected;
  if v_extra is not null then
    raise exception '#2357 VERIFY FAILED: exact column count mismatch: %', v_extra;
  end if;

  -- Exact types on gating columns (M3): the columns whose type changes consumer behavior.
  select string_agg(format('%s.%s is %s, expected %s', t.view_name, t.col, a.actual, t.expected), ', ')
    into v_bad_type
  from (values
    ('licensing_entity_candidates','is_open','boolean'),
    ('licensing_entity_candidates','needs_decision','boolean'),
    ('licensing_entity_candidates','is_ambiguous','boolean'),
    ('licensing_entity_candidates','opa_evidence_readable','boolean'),
    ('licensing_entity_candidates','opa_observation_count','bigint'),
    ('licensing_entity_candidates','source_scope_by_licensor','jsonb'),
    ('licensing_entity_candidates','core_property_id','uuid'),
    ('licensing_relationship_candidates','is_open','boolean'),
    ('licensing_relationship_candidates','needs_decision','boolean'),
    ('licensing_relationship_candidates','is_ambiguous','boolean'),
    ('licensing_relationship_candidates','eligible_for_match','boolean'),
    ('licensing_relationship_candidates','scope_row_count','bigint'),
    ('licensing_relationship_candidates','relationship_evidence_permitted','boolean'),
    ('licensing_relationship_candidates','source_purposes','text[]'),
    ('licensing_relationship_candidates','has_source_evidence','boolean'),
    ('licensing_resolution_queue','item_count','bigint'),
    ('licensing_resolution_queue','is_ambiguous','boolean'),
    ('licensing_resolution_queue','oldest_created_at','timestamp with time zone'),
    ('licensing_resolution_queue','latest_updated_at','timestamp with time zone')
  ) t(view_name, col, expected)
  cross join lateral (
    select format_type(a.atttypid, a.atttypmod) as actual
    from pg_attribute a
    where a.attrelid = to_regclass('api.' || t.view_name) and a.attname = t.col
      and a.attnum > 0 and not a.attisdropped
  ) a
  where a.actual <> t.expected;
  if v_bad_type is not null then
    raise exception '#2357 VERIFY FAILED: column type mismatch: %', v_bad_type;
  end if;

  -- Catalog dependency proof (review L4): each view's rewrite rule depends on the base
  -- tables it claims to read under invoker security.
  select string_agg(format('%s->%s', d.view_name, d.base), ', ')
    into v_missing
  from (values
    ('api.licensing_entity_candidates','plm.source_resolution'),
    ('api.licensing_entity_candidates','plm.licensing_source_scope'),
    ('api.licensing_relationship_candidates','plm.licensing_relationship_resolution'),
    ('api.licensing_relationship_candidates','plm.licensing_source_scope'),
    ('api.licensing_resolution_queue','plm.source_resolution'),
    ('api.licensing_resolution_queue','plm.licensing_relationship_resolution')
  ) d(view_name, base)
  where not exists (
    select 1 from pg_rewrite rw join pg_depend dep
      on dep.classid='pg_rewrite'::regclass and dep.objid=rw.oid
    where rw.ev_class = to_regclass(d.view_name)
      and dep.refclassid='pg_class'::regclass and dep.refobjid = to_regclass(d.base)
  );
  if v_missing is not null then
    raise exception '#2357 VERIFY FAILED: view dependency missing: %', v_missing;
  end if;

  foreach v_view in array array[
    'api.licensing_entity_candidates',
    'api.licensing_relationship_candidates',
    'api.licensing_resolution_queue'
  ] loop
    -- Exists, and is a view.
    if to_regclass(v_view) is null then
      raise exception '#2357 VERIFY FAILED: % was not created', v_view;
    end if;

    -- security_invoker must be ON. This is the control that keeps RLS in force; without it
    -- the views would read with the definer's rights and bypass every base-table policy.
    if not exists (
      select 1 from pg_class c
      where c.oid = to_regclass(v_view) and c.relkind = 'v'
        and 'security_invoker=true' = any(coalesce(c.reloptions, '{}'))
    ) then
      raise exception '#2357 VERIFY FAILED: % is not security_invoker', v_view;
    end if;

    -- POSITIVE control: the browser role must be able to read it.
    if not has_table_privilege('authenticated', v_view, 'SELECT') then
      raise exception '#2357 VERIFY FAILED: browser role authenticated cannot read %', v_view;
    end if;
    if not has_table_privilege('service_role', v_view, 'SELECT') then
      raise exception '#2357 VERIFY FAILED: service_role cannot read %', v_view;
    end if;

    -- NEGATIVE control: the unauthenticated role must NOT. If this never fires, the grant
    -- above is not doing what it claims; it fires today if `revoke ... from anon` is dropped.
    if has_table_privilege('anon', v_view, 'SELECT') then
      raise exception '#2357 VERIFY FAILED: unauthorized role anon can read %', v_view;
    end if;

    -- PUBLIC must not hold a residual grant either.
    if exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a where c.oid=to_regclass(v_view) and a.grantee=0 and a.privilege_type='SELECT') then
      raise exception '#2357 VERIFY FAILED: PUBLIC can read %', v_view;
    end if;
  end loop;

  -- Positive control on the controls themselves: prove the privilege probe can return
  -- both answers, so a green run above means "checked", not "always true".
  if has_table_privilege('anon', 'plm.opa_property_character_capture', 'SELECT') then
    raise exception '#2357 VERIFY FAILED: anon unexpectedly holds SELECT on the OPA capture table';
  end if;
  if not has_table_privilege('authenticated', 'plm.source_resolution', 'SELECT') then
    raise exception '#2357 VERIFY FAILED: expected authenticated SELECT on plm.source_resolution is absent';
  end if;

  -- No licensed or capture-identity column may appear in any of the three views. Checked
  -- against the catalog rather than by reading the SQL above.
  select string_agg(format('%s.%s', c.relname, a.attname), ', ')
    into v_exposed
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'api'
    and c.relname in ('licensing_entity_candidates','licensing_relationship_candidates','licensing_resolution_queue')
    and a.attname in (
      'property_name','character_name','licensed_property_id','brand_property_id',
      'option_source_id','source_row_sha256','chunk_sha256','source_manifest_sha256',
      'source_commit_sha','capture_key','created_by','source_evidence','resolution_reason'
    );
  if v_exposed is not null then
    raise exception '#2357 VERIFY FAILED: licensed or capture-identity column exposed: %', v_exposed;
  end if;

  -- Exact-object index pinning (review finding 2): each index must exist on the
  -- right table with the right key columns and predicate. A same-name leftover
  -- with a different definition would make CREATE INDEX IF NOT EXISTS a no-op.
  if not exists (
    select 1 from pg_index i join pg_class ic on ic.oid = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    where ic.relname = 'source_resolution_open_status_idx'
      and tn.nspname = 'plm' and tc.relname = 'source_resolution'
      and pg_get_indexdef(i.indexrelid) like '%(resolution_status)%'
      and pg_get_indexdef(i.indexrelid) like '%WHERE%'
  ) then
    raise exception '#2357 VERIFY FAILED: source_resolution_open_status_idx missing or wrong definition';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class ic on ic.oid = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    where ic.relname = 'licensing_relationship_resolution_open_status_idx'
      and tn.nspname = 'plm' and tc.relname = 'licensing_relationship_resolution'
      and pg_get_indexdef(i.indexrelid) like '%(resolution_status)%'
      and pg_get_indexdef(i.indexrelid) like '%WHERE%'
  ) then
    raise exception '#2357 VERIFY FAILED: licensing_relationship_resolution_open_status_idx missing or wrong definition';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class ic on ic.oid = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    where ic.relname = 'opa_capture_status_captured_idx'
      and tn.nspname = 'plm' and tc.relname = 'opa_capture'
      and pg_get_indexdef(i.indexrelid) like '%(status, source_captured_at DESC)%'
  ) then
    raise exception '#2357 VERIFY FAILED: opa_capture_status_captured_idx missing or wrong definition';
  end if;
end
$verify$;

commit;
