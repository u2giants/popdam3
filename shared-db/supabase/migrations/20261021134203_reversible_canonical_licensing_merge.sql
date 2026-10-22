-- =====================================================================================
-- Reversible, hash-pinned canonical licensing merge.
--
-- Migration: 20261021134203_reversible_canonical_licensing_merge.sql
-- Issue:     popcre/shared-db #2358 (structural successor to #1090)
-- Claim:     popcre/shared-db #4536
--            function plm.plan_licensing_canonical_merge
--            function plm.apply_licensing_canonical_merge
--            table    plm.licensing_canonical_change_history
--            Nothing else.
-- derived-from: none
--
-- Depends on (exact 14-digit versions):
--   20260817124545  licensing_write_authority_guard -- plm.licensing_write_authorization
--                   (write_kind 'canonical_merge' is already in its CHECK) and the
--                   core.licensor / core.property guard this engine writes through.
--   20261009224453  hash_pinned_licensing_consolidation -- the hash-pinning, actor,
--                   advisory-lock and fail-closed grant conventions mirrored here.
--   20260731150000  core.property_alias (+ core.normalize_popsg_property_observation)
--                   -- the alias table a Property merge retains the duplicate name in.
--
-- LOADS NO DATA. No history row is inserted, no merge is executed and no curated row is
-- written by this file. SCHEMA IN GIT, DATA OUT OF GIT.
--
-- -------------------------------------------------------------------------------------
-- 1. WHAT THIS IS
--
-- Step 2.5 of the #1090 plan: repair a duplicate canonical Licensor or Property by
-- merging it into a survivor, reversibly.
--
--   plan  -- plm.plan_licensing_canonical_merge(kind, duplicate, survivor) builds a
--            deterministic plan body and pins it with SHA-256. The body carries:
--              * before-images of both entities;
--              * EVERY dependent foreign-key column, discovered from pg_constraint at
--                plan time (never a hard-coded list), with the primary-key ledger of
--                every row that currently references the duplicate;
--              * the alias/tombstone retention it will perform;
--              * every conflict found. A conflict refuses the plan (plan_status
--                'refused'); a refused plan is still recorded as an audit fact.
--            Conflicts include a TRIAL APPLY: the full repoint + alias + tombstone is
--            executed inside a subtransaction that is always rolled back, so every
--            unique index, partial/expression index, check constraint, composite FK
--            and trigger on every dependent table is consulted by the database itself
--            instead of being re-implemented here.
--   apply -- plm.apply_licensing_canonical_merge(plan_id, expected_hash) executes the
--            plan only when (a) the caller echoes the pinned hash, (b) the stored body
--            still hashes to it, and (c) re-planning against the live world yields the
--            SAME hash (stale-hash refusal). It records an immutable 'merge_applied'
--            history row that carries the exact inverse (rollback plan) and its own
--            rollback_hash.
--   rollback -- apply(plan_id, rollback_hash, p_rollback => true) executes that stored
--            inverse after re-verifying the post-merge state, and records a
--            'rollback_applied' row.
--   idempotency -- re-applying an applied plan (or re-rolling-back a rolled-back one)
--            returns the existing history row and writes nothing.
--
-- Retention: the duplicate is NEVER deleted. It becomes a tombstone (status 'archived',
-- metadata.canonical_merge = {merged_into, plan_id, plan_hash}). Its existing alias rows
-- are dependents and are repointed to the survivor. A Property merge additionally
-- records the duplicate's name as a core.property_alias of the survivor. A Licensor
-- merge does not insert a licensor alias: core.reject_shadowing_licensor_alias refuses
-- any alias equal to a live Licensor row's name, and the tombstone keeps that name, so
-- the tombstone itself (with merged_into) is the retained alias.
--
-- Protected writes (core.property.licensor_id when merging Licensors, and the tombstone
-- status change) go through transaction-bound plm.licensing_write_authorization rows of
-- write_kind 'canonical_merge', one per protected row, consumed by the Step 1.0 guard.
--
-- -------------------------------------------------------------------------------------
-- 2. WHY THE HISTORY TABLE HAS NO TRIGGER
--
-- The claim leases exactly three objects. A BEFORE UPDATE/DELETE trigger needs a trigger
-- function, which is a separate structural object the claim does not lease. The table
-- is therefore append-only BY PRIVILEGE: no role (including service_role) holds INSERT,
-- UPDATE or DELETE; the two SECURITY DEFINER functions only ever INSERT; every row is
-- self-verifying (apply recomputes the plan hash from the stored body and the rollback
-- hash from the stored inverse, and refuses on any difference). A trigger-based guard is
-- follow-up work under its own claim.
-- =====================================================================================


-- =====================================================================================
-- PART 1 -- plm.licensing_canonical_change_history
-- =====================================================================================

create table if not exists plm.licensing_canonical_change_history (
  id uuid primary key default gen_random_uuid(),

  -- merge_planned    one hash-pinned plan (preview or refused)
  -- merge_applied    that plan was executed; body = the rollback plan
  -- rollback_applied the rollback plan of an applied merge was executed
  event_kind text not null,
  constraint licensing_canonical_change_history_event_kind_chk
    check (event_kind in ('merge_planned', 'merge_applied', 'rollback_applied')),

  -- Applied and rollback rows point at the plan row they act on.
  plan_id uuid null
    references plm.licensing_canonical_change_history(id) on delete restrict,
  constraint licensing_canonical_change_history_plan_ref_chk
    check ((event_kind = 'merge_planned') = (plan_id is null)),

  entity_kind text not null,
  constraint licensing_canonical_change_history_entity_kind_chk
    check (entity_kind in ('licensor', 'property')),
  duplicate_id uuid not null,
  survivor_id  uuid not null,
  constraint licensing_canonical_change_history_distinct_chk
    check (duplicate_id <> survivor_id),

  -- merge_planned / merge_applied: the plan hash. rollback_applied: the rollback hash.
  plan_hash text not null,
  constraint licensing_canonical_change_history_hash_chk
    check (plan_hash ~ '^[0-9a-f]{64}$'),

  plan_status text null,
  constraint licensing_canonical_change_history_status_chk
    check ((event_kind = 'merge_planned') = (plan_status is not null)
           and (plan_status is null or plan_status in ('preview', 'refused'))),
  refusal_reason text null,
  constraint licensing_canonical_change_history_refusal_chk
    check ((refusal_reason is null or btrim(refusal_reason) <> '')
           and (plan_status is distinct from 'refused' or refusal_reason is not null)),

  body jsonb not null,
  constraint licensing_canonical_change_history_body_chk
    check (jsonb_typeof(body) = 'object'),
  result jsonb not null default '{}'::jsonb,
  constraint licensing_canonical_change_history_result_chk
    check (jsonb_typeof(result) = 'object'),

  -- Only a merge_applied row carries a rollback plan, pinned by this hash.
  rollback_hash text null,
  constraint licensing_canonical_change_history_rollback_hash_chk
    check ((event_kind = 'merge_applied') = (rollback_hash is not null)
           and (rollback_hash is null or rollback_hash ~ '^[0-9a-f]{64}$')),

  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null,
  constraint licensing_canonical_change_history_recorded_by_chk
    check (btrim(recorded_by) <> ''),

  -- One apply and one rollback per plan.
  constraint licensing_canonical_change_history_event_once_uq
    unique (event_kind, plan_id),
  -- Re-planning identical state returns the existing plan row.
  constraint licensing_canonical_change_history_identity_uq
    unique (event_kind, entity_kind, duplicate_id, survivor_id, plan_hash)
);

comment on table plm.licensing_canonical_change_history is
  'Immutable change history for reversible canonical licensing merges (issue #2358). '
  'merge_planned rows are hash-pinned plans (dependent FK ledgers, alias/tombstone '
  'retention, conflicts); merge_applied rows carry the rollback plan and rollback_hash; '
  'rollback_applied rows record its execution. Append-only by privilege: no role may '
  'insert, update or delete directly -- only the SECURITY DEFINER plan/apply functions, '
  'which only insert. Rows self-verify by hash at apply time.';

alter table plm.licensing_canonical_change_history enable row level security;
revoke all on table plm.licensing_canonical_change_history
  from public, anon, authenticated, service_role;
grant select on table plm.licensing_canonical_change_history to service_role;


-- =====================================================================================
-- PART 2 -- the plan function
-- =====================================================================================

create or replace function plm.plan_licensing_canonical_merge(
  p_entity_kind text,
  p_duplicate_id uuid,
  p_survivor_id uuid
)
returns plm.licensing_canonical_change_history
language plpgsql
security definer
set search_path to pg_catalog
as $function$
declare
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
  v_kind text := lower(btrim(coalesce(p_entity_kind, '')));
  v_table regclass;
  v_dup jsonb;
  v_surv jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_deps jsonb := '[]'::jsonb;
  v_dep record;
  v_fk record;
  v_col text;
  v_pk text[];
  v_keys text[];
  v_keyexpr text;
  v_rows jsonb;
  v_count bigint;
  v_alias jsonb := 'null'::jsonb;
  v_norm text;
  v_owner uuid;
  v_tomb jsonb;
  v_prior integer;
  v_body jsonb;
  v_hash text;
  v_row plm.licensing_canonical_change_history%rowtype;
  v_phase text;
  v_state text;
  v_msg text;
  v_constraint text;
  v_err_schema text;
  v_err_table text;
  v_n integer;
  v_trial_hash text := encode(extensions.digest('licensing_canonical_merge_trial', 'sha256'), 'hex');
begin
  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'canonical licensing merge planning requires an authenticated actor';
  end if;
  if v_kind not in ('licensor', 'property') then
    raise exception using errcode = '22023',
      message = 'plan_licensing_canonical_merge entity_kind must be licensor or property';
  end if;
  if p_duplicate_id is null or p_survivor_id is null then
    raise exception using errcode = '22023',
      message = 'plan_licensing_canonical_merge requires a duplicate_id and a survivor_id';
  end if;
  if p_duplicate_id = p_survivor_id then
    raise exception using errcode = '22023',
      message = 'a canonical licensing entity cannot be merged into itself';
  end if;

  -- Serialize every planner/applier of this unordered pair, so A->B and B->A queue.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(chr(31), 'licensing_canonical_merge', v_kind,
      least(p_duplicate_id::text, p_survivor_id::text),
      greatest(p_duplicate_id::text, p_survivor_id::text)), 0));

  if v_kind = 'licensor' then
    v_table := 'core.licensor'::regclass;
    select jsonb_build_object('id', l.id, 'name', l.name, 'code', l.code,
             'status', l.status::text, 'licensor_id', null, 'metadata', l.metadata)
      into v_dup from core.licensor l where l.id = p_duplicate_id;
    select jsonb_build_object('id', l.id, 'name', l.name, 'code', l.code,
             'status', l.status::text, 'licensor_id', null, 'metadata', l.metadata)
      into v_surv from core.licensor l where l.id = p_survivor_id;
  else
    v_table := 'core.property'::regclass;
    select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code,
             'status', p.status::text, 'licensor_id', p.licensor_id, 'metadata', p.metadata)
      into v_dup from core.property p where p.id = p_duplicate_id;
    select jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code,
             'status', p.status::text, 'licensor_id', p.licensor_id, 'metadata', p.metadata)
      into v_surv from core.property p where p.id = p_survivor_id;
  end if;

  if v_dup is null or v_surv is null then
    raise exception using errcode = 'P0002',
      message = 'canonical licensing merge refused: duplicate or survivor does not exist';
  end if;

  -- -----------------------------------------------------------------------
  -- Entity-level conflicts.
  -- -----------------------------------------------------------------------
  if v_surv->>'status' in ('archived', 'deleted') then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('code', 'survivor_not_live'));
  end if;
  if (v_surv->'metadata') ? 'canonical_merge' then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('code', 'survivor_is_merge_tombstone'));
  end if;
  if (v_dup->'metadata') ? 'canonical_merge' then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('code', 'duplicate_already_merged'));
  end if;
  if v_kind = 'property' and (v_dup->'licensor_id') is distinct from (v_surv->'licensor_id') then
    -- Merging Properties across Licensors changes royalty ownership; it is not a
    -- duplicate repair and is refused.
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('code', 'cross_licensor_property_merge'));
  end if;

  -- Composite FKs (e.g. (property_id, licensor_id) -> core.property(id, licensor_id))
  -- stay valid only if every referenced column other than id is equal on both sides.
  for v_fk in
    select c.conrelid::regclass::text as tbl, c.conname::text as conname,
           array(select a.attname::text
                   from unnest(c.confkey) as k(attnum)
                   join pg_catalog.pg_attribute a on a.attrelid = v_table and a.attnum = k.attnum
                  where a.attname <> 'id') as other_cols
      from pg_catalog.pg_constraint c
     where c.contype = 'f' and c.confrelid = v_table and cardinality(c.conkey) > 1
     order by 1, 2
  loop
    foreach v_col in array v_fk.other_cols loop
      if not (v_dup ? v_col) or (v_dup->v_col) is distinct from (v_surv->v_col) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', 'composite_foreign_key_parent_mismatch',
          'table', v_fk.tbl, 'constraint', v_fk.conname));
      end if;
    end loop;
  end loop;

  -- -----------------------------------------------------------------------
  -- Dependents, discovered from the catalog: every column of every FK that maps to
  -- the entity table's id. Tables that are themselves the parent of a composite FK
  -- through that column (core.property when merging Licensors) go first, so an
  -- ON UPDATE CASCADE child is never repointed before its parent.
  -- -----------------------------------------------------------------------
  for v_dep in
    with fk as (
      select c.conrelid, c.conname, c.conkey, c.confkey
        from pg_catalog.pg_constraint c
       where c.contype = 'f' and c.confrelid = v_table
    ), cols as (
      select distinct fk.conrelid, a.attname::text as col
        from fk
        cross join lateral unnest(fk.conkey, fk.confkey) as k(src, dst)
        join pg_catalog.pg_attribute ra
          on ra.attrelid = v_table and ra.attnum = k.dst and ra.attname = 'id'
        join pg_catalog.pg_attribute a
          on a.attrelid = fk.conrelid and a.attnum = k.src
    )
    select cols.conrelid as relid, cols.conrelid::regclass::text as tbl, cols.col,
           case when exists (
             select 1
               from pg_catalog.pg_constraint c2
               cross join lateral unnest(c2.confkey) as k2(attnum)
               join pg_catalog.pg_attribute a2
                 on a2.attrelid = cols.conrelid and a2.attnum = k2.attnum
              where c2.contype = 'f' and c2.confrelid = cols.conrelid
                and cardinality(c2.conkey) > 1 and a2.attname = cols.col
           ) then 0 else 1 end as ord
      from cols
     order by 4, 2, 3
  loop
    select array(
             select a.attname::text
               from pg_catalog.pg_index i
               cross join lateral unnest(i.indkey) with ordinality as k(attnum, o)
               join pg_catalog.pg_attribute a
                 on a.attrelid = i.indrelid and a.attnum = k.attnum
              where i.indrelid = v_dep.relid and i.indisprimary
              order by k.o)
      into v_pk;

    if cardinality(coalesce(v_pk, '{}')) = 0 then
      execute format('select count(*) from %s where %I = $1', v_dep.relid::regclass, v_dep.col)
        into v_count using p_duplicate_id;
      if v_count > 0 then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', 'dependent_without_primary_key', 'table', v_dep.tbl, 'column', v_dep.col));
      end if;
      continue;
    end if;

    -- The ledger identifies each row by its primary key minus the repointed column,
    -- which stays a unique identity on either side of the repoint.
    v_keys := array(select x from unnest(v_pk) with ordinality as u(x, o)
                     where x <> v_dep.col order by o);
    select 'jsonb_build_array(' || coalesce(string_agg(quote_ident(x), ', ' order by o), '') || ')'
      into v_keyexpr
      from unnest(v_keys) with ordinality as u(x, o);

    execute format(
      'select coalesce(jsonb_agg(k order by k), ''[]''::jsonb) from (select %s as k from %s where %I = $1) s',
      v_keyexpr, v_dep.relid::regclass, v_dep.col)
      into v_rows using p_duplicate_id;

    v_deps := v_deps || jsonb_build_array(jsonb_build_object(
      'table', v_dep.tbl,
      'column', v_dep.col,
      'key_columns', to_jsonb(v_keys),
      'guarded', (v_dep.relid = 'core.property'::regclass and v_dep.col = 'licensor_id'),
      'rows', v_rows));
  end loop;

  -- -----------------------------------------------------------------------
  -- Alias retention.
  -- -----------------------------------------------------------------------
  if v_kind = 'property' then
    if to_regclass('core.property_alias') is null
       or to_regprocedure('core.normalize_popsg_property_observation(text)') is null then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('code', 'alias_surface_missing'));
    else
      v_norm := core.normalize_popsg_property_observation(v_dup->>'name');
      if coalesce(v_norm, '') = ''
         or v_norm = core.normalize_popsg_property_observation(v_surv->>'name')
         or v_norm = core.normalize_popsg_property_observation(coalesce(v_surv->>'code', '')) then
        v_alias := jsonb_build_object('table', 'core.property_alias', 'action', 'skip',
                     'reason', 'duplicate name already resolves to the survivor');
      else
        select pa.property_id into v_owner
          from core.property_alias pa
         where pa.licensor_id = (v_surv->>'licensor_id')::uuid
           and pa.normalized_alias = v_norm
         limit 1;
        if v_owner is null then
          v_alias := jsonb_build_object('table', 'core.property_alias', 'action', 'insert',
                       'alias', v_dup->>'name');
        elsif v_owner in (p_duplicate_id, p_survivor_id) then
          v_alias := jsonb_build_object('table', 'core.property_alias', 'action', 'skip',
                       'reason', 'alias already recorded for the merged pair');
        else
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'code', 'alias_owned_by_other_entity', 'table', 'core.property_alias'));
        end if;
      end if;
    end if;
  else
    v_alias := jsonb_build_object('table', 'core.licensor', 'action', 'tombstone',
                 'reason', 'the archived duplicate row keeps its name with metadata.canonical_merge.merged_into; '
                           || 'existing licensor aliases are repointed as dependents');
  end if;

  v_tomb := jsonb_build_object('status_before', v_dup->>'status', 'status_after', 'archived',
              'metadata_key', 'canonical_merge');

  -- -----------------------------------------------------------------------
  -- TRIAL APPLY. Always rolled back. Lets every constraint and trigger on every
  -- dependent table vote before anyone reviews the plan.
  -- -----------------------------------------------------------------------
  if jsonb_array_length(v_conflicts) = 0 then
    begin
      for v_dep in
        select e.elem from jsonb_array_elements(v_deps) with ordinality as e(elem, o) order by e.o
      loop
        v_n := jsonb_array_length(v_dep.elem->'rows');
        continue when v_n = 0;
        v_phase := 'dependent:' || (v_dep.elem->>'table') || '.' || (v_dep.elem->>'column');
        if (v_dep.elem->>'guarded')::boolean then
          insert into plm.licensing_write_authorization (
            backend_pid, transaction_id, target_table, write_kind,
            plan_id, plan_hash, actor, protected_columns, expires_at)
          select pg_backend_pid(), txid_current(), (v_dep.elem->>'table')::regclass, 'canonical_merge',
                 gen_random_uuid(), v_trial_hash, v_actor, array[v_dep.elem->>'column'],
                 clock_timestamp() + interval '5 minutes'
            from generate_series(1, v_n);
        end if;
        execute format('update %s set %I = $2 where %I = $1',
                       (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_dep.elem->>'column')
          using p_duplicate_id, p_survivor_id;
      end loop;

      if v_alias->>'action' = 'insert' then
        v_phase := 'alias:core.property_alias';
        insert into core.property_alias (property_id, licensor_id, alias, source_system, evidence_notes)
        values (p_survivor_id, (v_surv->>'licensor_id')::uuid, v_alias->>'alias',
                'canonical_merge', 'trial');
      end if;

      v_phase := 'tombstone:' || v_table::text;
      if v_dup->>'status' <> 'archived' then
        insert into plm.licensing_write_authorization (
          backend_pid, transaction_id, target_table, write_kind,
          plan_id, plan_hash, actor, protected_columns, expires_at)
        values (pg_backend_pid(), txid_current(), v_table, 'canonical_merge',
                gen_random_uuid(), v_trial_hash, v_actor, array['status'],
                clock_timestamp() + interval '5 minutes');
      end if;
      execute format('update %s set status = ''archived'', metadata = metadata || $2 where id = $1', v_table)
        using p_duplicate_id,
              jsonb_build_object('canonical_merge', jsonb_build_object('merged_into', p_survivor_id));

      raise exception using errcode = 'P0001', message = 'licensing_canonical_merge_trial_complete';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text,
                              v_constraint = constraint_name,
                              v_err_schema = schema_name, v_err_table = table_name;
      if not (v_state = 'P0001' and v_msg = 'licensing_canonical_merge_trial_complete') then
        -- Record only the sqlstate, constraint and phase: messages can carry licensed
        -- names, and this table is never a place for row values beyond the plan body.
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', 'trial_apply_refused',
          'phase', v_phase,
          'sqlstate', v_state,
          'constraint', nullif(v_constraint, ''),
          'table', nullif(concat_ws('.', nullif(v_err_schema, ''), nullif(v_err_table, '')), '')));
      end if;
    end;
  end if;

  select count(*) into v_prior
    from plm.licensing_canonical_change_history h
   where h.event_kind = 'rollback_applied'
     and h.entity_kind = v_kind
     and h.duplicate_id = p_duplicate_id
     and h.survivor_id = p_survivor_id;

  v_body := pg_catalog.jsonb_build_object(
    'contract', 'licensing_canonical_merge/1',
    'entity_kind', v_kind,
    'duplicate_id', p_duplicate_id,
    'survivor_id', p_survivor_id,
    -- A merge that was rolled back and is merged again is a new plan, not a no-op.
    'prior_rollbacks', v_prior,
    'duplicate', v_dup,
    'survivor', v_surv - 'metadata',
    'dependents', v_deps,
    'alias', v_alias,
    'tombstone', v_tomb,
    'conflicts', v_conflicts
  );
  v_hash := encode(extensions.digest(v_body::text, 'sha256'), 'hex');

  select * into v_row
    from plm.licensing_canonical_change_history h
   where h.event_kind = 'merge_planned'
     and h.entity_kind = v_kind
     and h.duplicate_id = p_duplicate_id
     and h.survivor_id = p_survivor_id
     and h.plan_hash = v_hash;
  if found then
    return v_row;
  end if;

  insert into plm.licensing_canonical_change_history (
    event_kind, plan_id, entity_kind, duplicate_id, survivor_id, plan_hash,
    plan_status, refusal_reason, body, recorded_by
  ) values (
    'merge_planned', null, v_kind, p_duplicate_id, p_survivor_id, v_hash,
    case when jsonb_array_length(v_conflicts) = 0 then 'preview' else 'refused' end,
    case when jsonb_array_length(v_conflicts) = 0 then null
         else 'conflict refusal: ' || (select string_agg(distinct c->>'code', ', ')
                                         from jsonb_array_elements(v_conflicts) c) end,
    v_body, v_actor
  )
  returning * into v_row;
  return v_row;
end;
$function$;

comment on function plm.plan_licensing_canonical_merge(text, uuid, uuid) is
  'Hash-pinned canonical licensing merge plan (issue #2358). Discovers every dependent '
  'FK column of core.licensor/core.property from the catalog, ledgers each referencing '
  'row by primary key, plans alias/tombstone retention, and refuses conflicts (entity '
  'state, composite FK parents, alias collisions, and a rolled-back trial apply that '
  'consults every constraint and trigger). Re-planning identical state returns the same '
  'row. Writes only a history row. Service-role only.';

revoke all on function plm.plan_licensing_canonical_merge(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function plm.plan_licensing_canonical_merge(text, uuid, uuid)
  to service_role;


-- =====================================================================================
-- PART 3 -- the apply function (merge and rollback)
-- =====================================================================================

create or replace function plm.apply_licensing_canonical_merge(
  p_plan_id uuid,
  p_expected_hash text,
  p_rollback boolean default false
)
returns plm.licensing_canonical_change_history
language plpgsql
security definer
set search_path to pg_catalog
as $function$
declare
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
  v_plan plm.licensing_canonical_change_history%rowtype;
  v_applied plm.licensing_canonical_change_history%rowtype;
  v_done plm.licensing_canonical_change_history%rowtype;
  v_fresh plm.licensing_canonical_change_history%rowtype;
  v_body jsonb;
  v_kind text;
  v_dup uuid;
  v_surv uuid;
  v_table regclass;
  v_dep record;
  v_n integer;
  v_cnt bigint;
  v_keyexpr text;
  v_moved jsonb := '[]'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_alias_id uuid;
  v_alias jsonb := 'null'::jsonb;
  v_meta_after jsonb;
  v_status_now text;
  v_meta_now jsonb;
  v_rb jsonb;
  v_rb_hash text;
  v_from uuid;
  v_to uuid;
begin
  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'canonical licensing merge apply requires an authenticated actor';
  end if;
  if p_plan_id is null or btrim(coalesce(p_expected_hash, '')) = '' then
    raise exception using errcode = '22023',
      message = 'apply_licensing_canonical_merge requires a plan_id and an expected_hash';
  end if;
  if p_expected_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'expected_hash must be 64 lowercase hex characters';
  end if;

  select * into v_plan
    from plm.licensing_canonical_change_history
   where id = p_plan_id and event_kind = 'merge_planned';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'canonical licensing merge plan does not exist';
  end if;

  v_body := v_plan.body;
  v_kind := v_plan.entity_kind;
  v_dup := v_plan.duplicate_id;
  v_surv := v_plan.survivor_id;
  v_table := case v_kind when 'licensor' then 'core.licensor'::regclass else 'core.property'::regclass end;

  -- Same pair lock as the planner.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(chr(31), 'licensing_canonical_merge', v_kind,
      least(v_dup::text, v_surv::text), greatest(v_dup::text, v_surv::text)), 0));

  if not coalesce(p_rollback, false) then
    -- ---------------------------------------------------------------------
    -- MERGE
    -- ---------------------------------------------------------------------
    if v_plan.plan_hash <> p_expected_hash then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge plan hash mismatch; reload the plan and re-review',
        detail = format('stored %s, expected %s', v_plan.plan_hash, p_expected_hash);
    end if;
    if encode(extensions.digest(v_body::text, 'sha256'), 'hex') <> v_plan.plan_hash then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge plan content does not match its pinned hash; refusing to apply';
    end if;

    -- IDEMPOTENCY: an applied plan is a successful no-op returning the same row.
    select * into v_done
      from plm.licensing_canonical_change_history
     where event_kind = 'merge_applied' and plan_id = v_plan.id;
    if found then
      return v_done;
    end if;

    if v_plan.plan_status <> 'preview' then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge plan was refused at planning and cannot be applied',
        detail = coalesce(v_plan.refusal_reason, 'no reason recorded');
    end if;

    -- Freeze both entities, then prove the live world still yields this exact plan.
    execute format('select 1 from %s where id = any($1) for update', v_table)
      using array[v_dup, v_surv];
    v_fresh := plm.plan_licensing_canonical_merge(v_kind, v_dup, v_surv);
    if v_fresh.plan_hash <> v_plan.plan_hash then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge refused: stale plan hash; live state changed since planning, re-plan and re-review',
        detail = format('pinned %s, live %s', v_plan.plan_hash, v_fresh.plan_hash);
    end if;

    -- Repoint every ledgered dependent row, parents of composite FKs first.
    for v_dep in
      select e.elem from jsonb_array_elements(v_body->'dependents') with ordinality as e(elem, o) order by e.o
    loop
      v_n := jsonb_array_length(v_dep.elem->'rows');
      continue when v_n = 0;
      select 'jsonb_build_array(' || coalesce(string_agg(quote_ident(x), ', ' order by o), '') || ')'
        into v_keyexpr
        from jsonb_array_elements_text(v_dep.elem->'key_columns') with ordinality as u(x, o);

      if (v_dep.elem->>'guarded')::boolean then
        insert into plm.licensing_write_authorization (
          backend_pid, transaction_id, target_table, write_kind,
          plan_id, plan_hash, actor, protected_columns, expires_at)
        select pg_backend_pid(), txid_current(), (v_dep.elem->>'table')::regclass, 'canonical_merge',
               gen_random_uuid(), v_plan.plan_hash, v_actor, array[v_dep.elem->>'column'],
               clock_timestamp() + interval '5 minutes'
          from generate_series(1, v_n);
      end if;

      execute format('update %s set %I = $2 where %I = $1 and %s in (select jsonb_array_elements($3))',
                     (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_dep.elem->>'column', v_keyexpr)
        using v_dup, v_surv, v_dep.elem->'rows';
      -- A cascade from an earlier parent may already have moved some rows; what
      -- matters is that every ledgered row now references the survivor.
      execute format('select count(*) from %s where %I = $1 and %s in (select jsonb_array_elements($2))',
                     (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_keyexpr)
        into v_cnt using v_surv, v_dep.elem->'rows';
      if v_cnt <> v_n then
        raise exception using errcode = '40001',
          message = 'canonical licensing merge refused: repoint verification failed for '
                    || (v_dep.elem->>'table') || '.' || (v_dep.elem->>'column');
      end if;

      v_moved := v_moved || jsonb_build_array(jsonb_build_object(
        'table', v_dep.elem->>'table', 'column', v_dep.elem->>'column', 'rows', v_n));
      v_ledger := v_ledger || jsonb_build_array(v_dep.elem);
    end loop;

    -- Nothing may still reference the duplicate through a planned dependent.
    for v_dep in
      select e.elem from jsonb_array_elements(v_body->'dependents') as e(elem)
    loop
      execute format('select count(*) from %s where %I = $1',
                     (v_dep.elem->>'table')::regclass, v_dep.elem->>'column')
        into v_cnt using v_dup;
      if v_cnt <> 0 then
        raise exception using errcode = '40001',
          message = 'canonical licensing merge refused: rows still reference the duplicate in '
                    || (v_dep.elem->>'table') || '.' || (v_dep.elem->>'column');
      end if;
    end loop;

    -- Alias retention.
    if v_body->'alias'->>'action' = 'insert' then
      insert into core.property_alias (property_id, licensor_id, alias, source_system, evidence_notes)
      values (v_surv, (v_body->'survivor'->>'licensor_id')::uuid, v_body->'alias'->>'alias',
              'canonical_merge',
              'retained from merged duplicate ' || v_dup::text || ' by canonical merge plan ' || v_plan.id::text)
      returning id into v_alias_id;
      v_alias := jsonb_build_object('table', 'core.property_alias', 'id', v_alias_id,
                   'alias', v_body->'alias'->>'alias');
    end if;

    -- Tombstone. Never a delete.
    v_meta_after := (v_body->'duplicate'->'metadata')
                    || jsonb_build_object('canonical_merge', jsonb_build_object(
                         'merged_into', v_surv, 'plan_id', v_plan.id, 'plan_hash', v_plan.plan_hash));
    if v_body->'duplicate'->>'status' <> 'archived' then
      insert into plm.licensing_write_authorization (
        backend_pid, transaction_id, target_table, write_kind,
        plan_id, plan_hash, actor, protected_columns, expires_at)
      values (pg_backend_pid(), txid_current(), v_table, 'canonical_merge',
              gen_random_uuid(), v_plan.plan_hash, v_actor, array['status'],
              clock_timestamp() + interval '5 minutes');
    end if;
    execute format('update %s set status = ''archived'', metadata = $2 where id = $1', v_table)
      using v_dup, v_meta_after;

    -- The exact inverse, pinned now so a later crash cannot lose the way back.
    v_rb := pg_catalog.jsonb_build_object(
      'contract', 'licensing_canonical_merge_rollback/1',
      'plan_id', v_plan.id,
      'plan_hash', v_plan.plan_hash,
      'entity_kind', v_kind,
      'duplicate_id', v_dup,
      'survivor_id', v_surv,
      'dependents', v_ledger,
      'alias', v_alias,
      'duplicate_restore', jsonb_build_object(
        'status', v_body->'duplicate'->>'status',
        'metadata', v_body->'duplicate'->'metadata'),
      'duplicate_after', jsonb_build_object('status', 'archived', 'metadata', v_meta_after)
    );
    v_rb_hash := encode(extensions.digest(v_rb::text, 'sha256'), 'hex');

    insert into plm.licensing_canonical_change_history (
      event_kind, plan_id, entity_kind, duplicate_id, survivor_id, plan_hash,
      body, result, rollback_hash, recorded_by
    ) values (
      'merge_applied', v_plan.id, v_kind, v_dup, v_surv, v_plan.plan_hash,
      v_rb,
      jsonb_build_object('moved', v_moved, 'alias', v_alias,
                         'tombstone', jsonb_build_object('status_before', v_body->'duplicate'->>'status',
                                                         'status_after', 'archived')),
      v_rb_hash, v_actor
    )
    returning * into v_done;
    return v_done;
  end if;

  -- -----------------------------------------------------------------------
  -- ROLLBACK
  -- -----------------------------------------------------------------------
  select * into v_applied
    from plm.licensing_canonical_change_history
   where event_kind = 'merge_applied' and plan_id = v_plan.id;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'canonical licensing merge plan has not been applied; nothing to roll back';
  end if;
  if v_applied.rollback_hash <> p_expected_hash then
    raise exception using errcode = '40001',
      message = 'canonical licensing merge rollback hash mismatch; reload the applied row and re-review',
      detail = format('stored %s, expected %s', v_applied.rollback_hash, p_expected_hash);
  end if;
  v_rb := v_applied.body;
  if encode(extensions.digest(v_rb::text, 'sha256'), 'hex') <> v_applied.rollback_hash then
    raise exception using errcode = '40001',
      message = 'canonical licensing merge rollback plan does not match its pinned hash; refusing to roll back';
  end if;

  select * into v_done
    from plm.licensing_canonical_change_history
   where event_kind = 'rollback_applied' and plan_id = v_plan.id;
  if found then
    return v_done;
  end if;

  execute format('select 1 from %s where id = any($1) for update', v_table)
    using array[v_dup, v_surv];

  -- The tombstone must be exactly what the merge left.
  execute format('select status::text, metadata from %s where id = $1', v_table)
    into v_status_now, v_meta_now using v_dup;
  if v_status_now is distinct from (v_rb->'duplicate_after'->>'status')
     or v_meta_now is distinct from (v_rb->'duplicate_after'->'metadata') then
    raise exception using errcode = '40001',
      message = 'canonical licensing merge rollback refused: the duplicate tombstone changed since the merge';
  end if;

  if jsonb_typeof(v_rb->'alias') = 'object' then
    perform 1 from core.property_alias pa
     where pa.id = (v_rb->'alias'->>'id')::uuid
       and pa.property_id = v_surv
       and pa.alias = v_rb->'alias'->>'alias';
    if not found then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge rollback refused: the retained alias changed since the merge';
    end if;
  end if;

  -- Every moved row must still reference the survivor before anything moves back.
  for v_dep in
    select e.elem from jsonb_array_elements(v_rb->'dependents') as e(elem)
  loop
    select 'jsonb_build_array(' || coalesce(string_agg(quote_ident(x), ', ' order by o), '') || ')'
      into v_keyexpr
      from jsonb_array_elements_text(v_dep.elem->'key_columns') with ordinality as u(x, o);
    execute format('select count(*) from %s where %I = $1 and %s in (select jsonb_array_elements($2))',
                   (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_keyexpr)
      into v_cnt using v_surv, v_dep.elem->'rows';
    if v_cnt <> jsonb_array_length(v_dep.elem->'rows') then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge rollback refused: moved rows changed since the merge in '
                  || (v_dep.elem->>'table') || '.' || (v_dep.elem->>'column');
    end if;
  end loop;

  -- Move back, parents first (same order as the merge).
  for v_dep in
    select e.elem from jsonb_array_elements(v_rb->'dependents') with ordinality as e(elem, o) order by e.o
  loop
    v_n := jsonb_array_length(v_dep.elem->'rows');
    select 'jsonb_build_array(' || coalesce(string_agg(quote_ident(x), ', ' order by o), '') || ')'
      into v_keyexpr
      from jsonb_array_elements_text(v_dep.elem->'key_columns') with ordinality as u(x, o);

    if (v_dep.elem->>'guarded')::boolean then
      insert into plm.licensing_write_authorization (
        backend_pid, transaction_id, target_table, write_kind,
        plan_id, plan_hash, actor, protected_columns, expires_at)
      select pg_backend_pid(), txid_current(), (v_dep.elem->>'table')::regclass, 'canonical_merge',
             gen_random_uuid(), v_applied.rollback_hash, v_actor, array[v_dep.elem->>'column'],
             clock_timestamp() + interval '5 minutes'
        from generate_series(1, v_n);
    end if;

    execute format('update %s set %I = $2 where %I = $1 and %s in (select jsonb_array_elements($3))',
                   (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_dep.elem->>'column', v_keyexpr)
      using v_surv, v_dup, v_dep.elem->'rows';
    execute format('select count(*) from %s where %I = $1 and %s in (select jsonb_array_elements($2))',
                   (v_dep.elem->>'table')::regclass, v_dep.elem->>'column', v_keyexpr)
      into v_cnt using v_dup, v_dep.elem->'rows';
    if v_cnt <> v_n then
      raise exception using errcode = '40001',
        message = 'canonical licensing merge rollback refused: move-back verification failed for '
                  || (v_dep.elem->>'table') || '.' || (v_dep.elem->>'column');
    end if;
    v_moved := v_moved || jsonb_build_array(jsonb_build_object(
      'table', v_dep.elem->>'table', 'column', v_dep.elem->>'column', 'rows', v_n));
  end loop;

  -- Remove only the alias row this merge created.
  if jsonb_typeof(v_rb->'alias') = 'object' then
    delete from core.property_alias where id = (v_rb->'alias'->>'id')::uuid;
  end if;

  -- Restore the duplicate exactly.
  if (v_rb->'duplicate_restore'->>'status') <> 'archived' then
    insert into plm.licensing_write_authorization (
      backend_pid, transaction_id, target_table, write_kind,
      plan_id, plan_hash, actor, protected_columns, expires_at)
    values (pg_backend_pid(), txid_current(), v_table, 'canonical_merge',
            gen_random_uuid(), v_applied.rollback_hash, v_actor, array['status'],
            clock_timestamp() + interval '5 minutes');
  end if;
  execute format('update %s set status = $2::app.entity_status, metadata = $3 where id = $1', v_table)
    using v_dup, v_rb->'duplicate_restore'->>'status', v_rb->'duplicate_restore'->'metadata';

  insert into plm.licensing_canonical_change_history (
    event_kind, plan_id, entity_kind, duplicate_id, survivor_id, plan_hash,
    body, result, recorded_by
  ) values (
    'rollback_applied', v_plan.id, v_kind, v_dup, v_surv, v_applied.rollback_hash,
    jsonb_build_object('rollback_of_applied', v_applied.id),
    jsonb_build_object('moved', v_moved, 'alias_removed', v_rb->'alias'),
    v_actor
  )
  returning * into v_done;
  return v_done;
end;
$function$;

comment on function plm.apply_licensing_canonical_merge(uuid, text, boolean) is
  'Hash-pinned canonical licensing merge apply and rollback (issue #2358). Merge: requires '
  'the pinned plan hash, re-derives it from stored content and from the live world (stale '
  'hash refusal), repoints every ledgered dependent row, retains aliases, tombstones the '
  'duplicate (never deletes) through transaction-bound canonical_merge authorizations, '
  'and records a merge_applied row carrying the rollback plan and rollback_hash. '
  'p_rollback => true with that rollback_hash re-verifies the post-merge state and '
  'executes the inverse, recording rollback_applied. Idempotent both ways. Service-role only.';

revoke all on function plm.apply_licensing_canonical_merge(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function plm.apply_licensing_canonical_merge(uuid, text, boolean)
  to service_role;


-- =====================================================================================
-- POST-APPLY VERIFICATION (catalog only)
-- =====================================================================================
do $verify$
declare
  v_count integer;
  v_t regclass := to_regclass('plm.licensing_canonical_change_history');
  v_plan regprocedure := to_regprocedure('plm.plan_licensing_canonical_merge(text,uuid,uuid)');
  v_apply regprocedure := to_regprocedure('plm.apply_licensing_canonical_merge(uuid,text,boolean)');
begin
  if v_t is null then
    raise exception 'plm.licensing_canonical_change_history was not created';
  end if;
  if v_plan is null or v_apply is null then
    raise exception 'canonical merge plan/apply functions were not created';
  end if;

  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (v_plan, v_apply)
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog'];
  if v_count <> 2 then
    raise exception 'both canonical merge functions must be security definer with pinned search_path (found %)', v_count;
  end if;

  if has_function_privilege('anon', v_plan, 'execute')
     or has_function_privilege('authenticated', v_plan, 'execute')
     or has_function_privilege('anon', v_apply, 'execute')
     or has_function_privilege('authenticated', v_apply, 'execute') then
    raise exception 'anon and authenticated must not execute the canonical merge functions';
  end if;
  if not has_function_privilege('service_role', v_plan, 'execute')
     or not has_function_privilege('service_role', v_apply, 'execute') then
    raise exception 'service_role must be able to execute the canonical merge functions';
  end if;

  if has_table_privilege('service_role', v_t, 'insert')
     or has_table_privilege('service_role', v_t, 'update')
     or has_table_privilege('service_role', v_t, 'delete')
     or has_table_privilege('authenticated', v_t, 'select')
     or has_table_privilege('authenticated', v_t, 'insert')
     or has_table_privilege('anon', v_t, 'select') then
    raise exception 'plm.licensing_canonical_change_history must be append-only by privilege and unreadable by browser roles';
  end if;

  select count(*) into v_count from pg_catalog.pg_class c where c.oid = v_t and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'plm.licensing_canonical_change_history must have row level security enabled';
  end if;

  select count(*) into v_count
    from pg_catalog.pg_constraint
   where conrelid = v_t
     and conname in ('licensing_canonical_change_history_hash_chk',
                     'licensing_canonical_change_history_event_once_uq',
                     'licensing_canonical_change_history_identity_uq');
  if v_count <> 3 then
    raise exception 'canonical change history hash/once/identity constraints are missing';
  end if;

  raise notice 'reversible canonical licensing merge verified: history table, two service-role functions';
end;
$verify$;
