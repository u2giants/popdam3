-- Step 7A item 4 — the additive schema the RECURRING ColdLion licensor/property feed needs.
-- Plan: plan_coldlion_licensor_property_accelerated_cutover.md, Step 7A.
--
-- WHY A NEW MIGRATION IS NEEDED AT ALL
-- ------------------------------------
-- Step 7A item 4 permits exactly one new additive migration, and ONLY IF the existing
-- schema cannot record source-owned descriptive values plus their promotion audit without
-- overloading the curated display name. It cannot:
--
--   * plm.erp_licensor.name / plm.erp_property.name already hold ColdLion's descriptive
--     value for the MIRROR, and core.taxonomy_source_ref.source_name already holds it in
--     the provenance layer. Those parts are fine and are reused unchanged.
--   * There is NO table anywhere that records a PROMOTION DECISION: which rule fired, what
--     the curated value was before, what it became, who/what run decided, and — critically —
--     the decisions that were REFUSED. Without that, the only place a name change could be
--     recorded is core.licensor.name itself, i.e. overloading the curated display name with
--     provenance it cannot carry.
--   * There is NO durable quarantine for the recurring feed's review cases (new, missing,
--     ambiguous, cross-typed, colliding, re-keyed, parentless, diverged). plm.erp_*.
--     resolution_status is a single-value match state on the mirror row; it cannot hold a
--     per-cycle history of why a row was held back, and overwriting it each cycle would
--     destroy exactly the evidence a reviewer needs.
--
-- So this migration adds two append-only tables, one normalization function, one promotion
-- function (plus its granted wrapper), and extends the breaker watchdog. It uses explicit
-- typed columns throughout — no JSON bags for structured fields, no EAV (AGENTS.md §4.1).
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
--   * It does not edit ANY applied migration. plm.sync_coldlion_licensors_properties keeps
--     its exact modes (mirror_only, link_approved); promotion is a NEW, separate function.
--   * It never creates, deletes, activates, or inactivates a canonical row.
--   * It never writes core.licensor.status, core.property.status, core.property.licensor_id,
--     core.licensor.code, core.property.code, or any canonical id.
--   * It does not enable anything on production. It is schema only.
--
-- THE PROTECTED/OWNED SPLIT THIS ENFORCES IN THE DATABASE
-- ------------------------------------------------------
--   ColdLion owns : source identity (company, division, mg_type_code, mg_code), source code,
--                   source descriptive value.
--   Supabase owns : canonical UUIDs, core.property.licensor_id, lifecycle status.
-- ColdLion's API supplies neither the parent edge nor any active/inactive flag, so it can
-- never be their author. Absence from ColdLion is never delete and never inactivate;
-- presence is never activate.

-- =====================================================================================
-- 1. Name normalization — MUST match tools/coldlion-recurring-promotion.mjs exactly
-- =====================================================================================
-- The runner computes a promotion plan in JavaScript; this function lets the database
-- recompute the same decisions independently and abort on ANY disagreement. Two
-- implementations that must agree are only safe if their character tables are identical,
-- which is why the accent map is spelled out here instead of using `unaccent` (that
-- extension is not installed in this database) or a Unicode-derived fold (not reproducible
-- in SQL). tools/coldlion-recurring-promotion.test.mjs asserts both literals appear here.

create or replace function plm.coldlion_normalize_name(p_value text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      replace(
        lower(
          translate(
            coalesce(p_value, ''),
            'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ',
            'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzsOoUuAaIiOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYy'
          )
        ),
        '&', ' and '
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$;

comment on function plm.coldlion_normalize_name(text) is
  'Equivalence normalizer for the ColdLion recurring promotion rule: casefold, explicit accent fold, "&"->"and", collapse every other character run to a single space, trim. Used ONLY to answer "is this the same name presented differently?" — never as a matching key and never stored as a name. Must stay character-for-character identical to normalizeName() in tools/coldlion-recurring-promotion.mjs; the promotion function fails closed if the runner plan and this recomputation disagree.';

-- =====================================================================================
-- 2. Append-only promotion audit
-- =====================================================================================
-- One row per FIELD DECISION per cycle, including decisions that were refused or held.
-- Append-only on purpose: a later green cycle must never be able to erase the record of an
-- earlier divergence. This is the table that makes "we changed a curated name" auditable
-- without overloading core.licensor.name.

create table if not exists plm.coldlion_promotion_audit (
  id                uuid primary key default gen_random_uuid(),
  sync_run_id       uuid references ingest.sync_run(id) on delete set null,
  decided_at        timestamptz not null default now(),
  decided_by        text not null default session_user,
  rule_id           text not null,
  entity_type       text not null check (entity_type in ('licensor', 'property')),
  entity_table      text not null check (entity_table in ('core.licensor', 'core.property')),
  entity_id         uuid not null,
  company_code      text not null,
  division_code     text not null,
  mg_type_code      text not null check (mg_type_code ~ '^[0-9]{2}$'),
  mg_code           text not null check (btrim(mg_code) <> ''),
  field_name        text not null,
  old_value         text,
  new_value         text,
  decision          text not null check (decision in ('applied', 'unchanged', 'held_for_review', 'refused')),
  decision_detail   text,
  environment       text,
  is_drill          boolean not null default false,
  constraint plm_coldlion_promotion_audit_field_ck check (
    field_name in (
      'core.taxonomy_source_ref.source_name',
      'core.taxonomy_source_ref.source_code',
      'core.licensor.name',
      'core.property.name'
    )
  ),
  -- A curated-name change must always carry the rule that authorized it and both values.
  constraint plm_coldlion_promotion_audit_applied_ck check (
    decision <> 'applied'
    or field_name not in ('core.licensor.name', 'core.property.name')
    or (btrim(coalesce(new_value, '')) <> '' and btrim(coalesce(rule_id, '')) <> '')
  )
);

comment on table plm.coldlion_promotion_audit is
  'APPEND-ONLY audit of every ColdLion source-owned field decision in the recurring feed: applied, unchanged, held_for_review, or refused. Records the authorizing rule, both values, the typed source key, the canonical row, and the run. Never updated and never pruned — a later successful cycle must not be able to erase an earlier divergence or refusal. This table is why a curated display name change is auditable WITHOUT overloading core.licensor.name / core.property.name with provenance.';
comment on column plm.coldlion_promotion_audit.field_name is
  'The single source-owned field this decision concerns. Constrained to the four promotable fields; ColdLion can never be recorded as the author of a canonical id, status, parent edge, or code.';
comment on column plm.coldlion_promotion_audit.decision is
  'applied = the curated/provenance value was changed under rule_id. unchanged = source already equalled canonical. held_for_review = quarantined, canonical untouched. refused = a protected-invariant violation aborted the cycle.';

create index if not exists plm_coldlion_promotion_audit_entity_idx
  on plm.coldlion_promotion_audit (entity_table, entity_id, decided_at desc);
create index if not exists plm_coldlion_promotion_audit_key_idx
  on plm.coldlion_promotion_audit (company_code, division_code, mg_type_code, mg_code, decided_at desc);
create index if not exists plm_coldlion_promotion_audit_run_idx
  on plm.coldlion_promotion_audit (sync_run_id);
create index if not exists plm_coldlion_promotion_audit_applied_idx
  on plm.coldlion_promotion_audit (decided_at desc) where decision = 'applied';

-- =====================================================================================
-- 3. Append-only quarantine
-- =====================================================================================
-- Every review case the recurring feed can produce. Append-only for the same reason as the
-- audit: the mirror's single resolution_status cannot hold per-cycle history, and
-- overwriting it each cycle would destroy the evidence a reviewer needs.

create table if not exists plm.coldlion_promotion_quarantine (
  id                uuid primary key default gen_random_uuid(),
  sync_run_id       uuid references ingest.sync_run(id) on delete set null,
  detected_at       timestamptz not null default now(),
  entity_type       text check (entity_type in ('licensor', 'property')),
  company_code      text not null,
  division_code     text not null,
  mg_type_code      text not null,
  mg_code           text not null,
  canonical_id      uuid,
  canonical_name    text,
  source_name       text,
  reason            text not null,
  detail            text,
  environment       text,
  is_drill          boolean not null default false,
  resolved_at       timestamptz,
  resolved_by       text,
  resolution_note   text,
  constraint plm_coldlion_promotion_quarantine_reason_ck check (
    reason in (
      'new_source_record',
      'missing_source_record',
      'ambiguous_match',
      'cross_typed',
      'code_collision',
      'cross_division_collision',
      'wrong_type',
      'rekeyed_record',
      'parentless_record',
      'source_name_divergence'
    )
  )
);

comment on table plm.coldlion_promotion_quarantine is
  'APPEND-ONLY quarantine for the recurring ColdLion feed. A quarantined row means the canonical layer was deliberately NOT changed and a human must decide. reason=new_source_record never auto-creates a canonical row; reason=missing_source_record never deletes, inactivates, or unlinks one — absence from ColdLion is not a business fact ColdLion is entitled to assert, because its API has no lifecycle flag. Rows are resolved by setting resolved_at/resolved_by, never by deletion.';
comment on column plm.coldlion_promotion_quarantine.reason is
  'new_source_record | missing_source_record | ambiguous_match | cross_typed | code_collision | cross_division_collision | wrong_type | rekeyed_record | parentless_record | source_name_divergence. Every reason leaves the canonical layer untouched.';

create index if not exists plm_coldlion_promotion_quarantine_open_idx
  on plm.coldlion_promotion_quarantine (detected_at desc) where resolved_at is null;
create index if not exists plm_coldlion_promotion_quarantine_key_idx
  on plm.coldlion_promotion_quarantine (company_code, division_code, mg_type_code, mg_code, detected_at desc);
create index if not exists plm_coldlion_promotion_quarantine_reason_idx
  on plm.coldlion_promotion_quarantine (reason, detected_at desc);

-- --- RLS + grants: admin read only from the browser; no authenticated writes -----------
alter table plm.coldlion_promotion_audit enable row level security;
alter table plm.coldlion_promotion_quarantine enable row level security;

drop policy if exists plm_coldlion_promotion_audit_admin_select on plm.coldlion_promotion_audit;
create policy plm_coldlion_promotion_audit_admin_select
  on plm.coldlion_promotion_audit
  for select
  to authenticated
  using (app.has_role('administrator'));

drop policy if exists plm_coldlion_promotion_quarantine_admin_select on plm.coldlion_promotion_quarantine;
create policy plm_coldlion_promotion_quarantine_admin_select
  on plm.coldlion_promotion_quarantine
  for select
  to authenticated
  using (app.has_role('administrator'));

grant select on plm.coldlion_promotion_audit, plm.coldlion_promotion_quarantine to authenticated;
grant all on plm.coldlion_promotion_audit, plm.coldlion_promotion_quarantine to service_role;

-- =====================================================================================
-- 4. Append-only enforcement — these two tables are evidence, not working state
-- =====================================================================================
-- An UPDATE or DELETE on the audit, or a DELETE on the quarantine, would let a later cycle
-- erase an earlier failure. Only the quarantine's resolution columns may ever be updated.

create or replace function plm.guard_coldlion_promotion_evidence_append_only()
returns trigger
language plpgsql
security definer
set search_path = plm, public
as $$
begin
  if tg_table_name = 'coldlion_promotion_audit' then
    raise exception
      'plm.coldlion_promotion_audit is APPEND-ONLY: % is refused. A promotion decision — especially a refusal or a held divergence — must never be editable by a later cycle.',
      tg_op
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'plm.coldlion_promotion_quarantine is APPEND-ONLY: DELETE is refused. Resolve a quarantined row by setting resolved_at/resolved_by, never by deleting the evidence.'
      using errcode = 'P0001';
  end if;

  -- UPDATE on the quarantine: only the resolution columns may change.
  if new.id is distinct from old.id
     or new.sync_run_id is distinct from old.sync_run_id
     or new.detected_at is distinct from old.detected_at
     or new.entity_type is distinct from old.entity_type
     or new.company_code is distinct from old.company_code
     or new.division_code is distinct from old.division_code
     or new.mg_type_code is distinct from old.mg_type_code
     or new.mg_code is distinct from old.mg_code
     or new.canonical_id is distinct from old.canonical_id
     or new.canonical_name is distinct from old.canonical_name
     or new.source_name is distinct from old.source_name
     or new.reason is distinct from old.reason
     or new.detail is distinct from old.detail
     or new.environment is distinct from old.environment
     or new.is_drill is distinct from old.is_drill then
    raise exception
      'plm.coldlion_promotion_quarantine is APPEND-ONLY except for resolved_at/resolved_by/resolution_note. Refusing an edit to the recorded evidence.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists coldlion_promotion_audit_append_only_guard on plm.coldlion_promotion_audit;
create trigger coldlion_promotion_audit_append_only_guard
  before update or delete on plm.coldlion_promotion_audit
  for each row execute function plm.guard_coldlion_promotion_evidence_append_only();

drop trigger if exists coldlion_promotion_quarantine_append_only_guard on plm.coldlion_promotion_quarantine;
create trigger coldlion_promotion_quarantine_append_only_guard
  before update or delete on plm.coldlion_promotion_quarantine
  for each row execute function plm.guard_coldlion_promotion_evidence_append_only();

-- =====================================================================================
-- 5. The guarded recurring promotion
-- =====================================================================================
-- The runner sends its own computed plan. This function does NOT trust it: it recomputes
-- every decision from the database (typed mirror + approved links + canonical rows) and
-- aborts on any disagreement. The runner's plan is a cross-check, never an instruction.
--
-- Atomicity is the whole point of the design: a protected-invariant failure raises, so the
-- transaction rolls back and the canonical layer can never be left half-promoted. Making
-- the breaker trip DURABLE after such a rollback is the runner's job, exactly like the
-- established PR #107 durable-failure pattern — it records a critical alert in a SEPARATE
-- transaction, and the existing coldlion_autotrip_on_critical_alert trigger trips the
-- breaker from there.

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
           (m.last_sync_run_id = v_snapshot_run_id) as present_this_cycle,
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
    where m.resolution_status = 'manually_matched'
       or m.present_this_cycle
  ),
  -- A canonical row reachable from more than one typed key is a collision. We never guess
  -- which key the canonical row "really" means; both sides quarantine.
  collisions as (
    select canonical_id,
           count(distinct company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code) as key_count,
           count(distinct division_code) as division_count,
           count(distinct company_code || '/' || mg_type_code || '/' || mg_code) as keys_without_division
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
           when col.key_count > 1 and col.keys_without_division = 1 and col.division_count > 1
             then 'cross_division_collision'
           when col.key_count > 1
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
  v_prov_refresh := coalesce((select count(*) from plm.coldlion_promotion_audit
                              where sync_run_id = v_run_id
                                and field_name = 'core.taxonomy_source_ref.source_name'
                                and decision = 'applied'), 0);

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
  from plm.coldlion_promotion_audit
  where sync_run_id = v_run_id and decision = 'applied'
    and field_name in ('core.licensor.name', 'core.property.name');

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

comment on function plm.promote_coldlion_source_owned(jsonb, jsonb, boolean) is
  'GUARDED RECURRING PROMOTION for the ColdLion licensor/property feed (accelerated plan Step 7A item 3). Operates ONLY over the pinned approved Phase 4 link set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, 542 rows, 271 distinct canonical). Resolves every row by the full typed key (company_code, division_code, mg_type_code, mg_code) — never mg_code alone. Refreshes core.taxonomy_source_ref.source_name/source_code for every valid linked row, and updates core.licensor.name / core.property.name ONLY under the single approved deterministic rule coldlion_source_name_normalized_equivalent_v1 (normalized-equivalent presentation change), always with an append-only audit row. Quarantines new, missing, ambiguous, cross-typed, colliding, cross-division-colliding, wrong-typed, re-keyed, parentless, and name-divergent records. NEVER creates or deletes a canonical row, never writes status, never writes core.property.licensor_id, never writes a canonical id or code, never auto-inactivates a row absent from ColdLion. Independently recomputes the runner plan and aborts on disagreement. Refuses to run while the circuit breaker is tripped. Atomic: a protected-invariant failure raises and rolls the whole cycle back, so the canonical layer can never be left partially promoted.';

-- The ONLY granted promotion path. p_expected is caller-supplied but pinned inside, so a
-- service-role caller cannot widen the approved scope.
create or replace function public.promote_coldlion_source_owned(
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
language sql
security definer
set search_path = public, plm
as $$
  select * from plm.promote_coldlion_source_owned(p_expected, p_client_plan, p_is_drill);
$$;

comment on function public.promote_coldlion_source_owned(jsonb, jsonb, boolean) is
  'Thin SECURITY DEFINER wrapper so the recurring feed runner reaches the guarded promotion without a raw DB password. All guards live in plm.promote_coldlion_source_owned.';

revoke all on function plm.promote_coldlion_source_owned(jsonb, jsonb, boolean) from public;
revoke all on function public.promote_coldlion_source_owned(jsonb, jsonb, boolean) from public;
revoke all on function public.promote_coldlion_source_owned(jsonb, jsonb, boolean) from anon, authenticated;
grant execute on function public.promote_coldlion_source_owned(jsonb, jsonb, boolean) to service_role;

revoke all on function plm.coldlion_normalize_name(text) from public;
grant execute on function plm.coldlion_normalize_name(text) to service_role;

-- =====================================================================================
-- 6. Read-only admin surface for the two new evidence tables
-- =====================================================================================
-- plm is not PostgREST-exposed (AGENTS.md §8.1), so DB Data Admin reads these through api.*.

create or replace function api.coldlion_promotion_audit_list(p_limit integer default 100)
returns setof plm.coldlion_promotion_audit
language sql
stable
security definer
set search_path = api, plm, app, public
as $$
  select * from plm.coldlion_promotion_audit
  where app.has_role('administrator')
  order by decided_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

comment on function api.coldlion_promotion_audit_list(integer) is
  'Read-only, admin-gated list of ColdLion recurring-promotion decisions (applied / unchanged / held_for_review / refused). plm is not PostgREST-exposed, so this is the admin read path.';

create or replace function api.coldlion_promotion_quarantine_list(p_limit integer default 100)
returns setof plm.coldlion_promotion_quarantine
language sql
stable
security definer
set search_path = api, plm, app, public
as $$
  select * from plm.coldlion_promotion_quarantine
  where app.has_role('administrator')
  order by detected_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

comment on function api.coldlion_promotion_quarantine_list(integer) is
  'Read-only, admin-gated list of ColdLion recurring-feed quarantines. Every row means the canonical layer was deliberately NOT changed and a human must decide.';

revoke all on function api.coldlion_promotion_audit_list(integer) from public;
revoke all on function api.coldlion_promotion_quarantine_list(integer) from public;
revoke all on function api.coldlion_promotion_audit_list(integer) from anon;
revoke all on function api.coldlion_promotion_quarantine_list(integer) from anon;
grant execute on function api.coldlion_promotion_audit_list(integer) to authenticated, service_role;
grant execute on function api.coldlion_promotion_quarantine_list(integer) to authenticated, service_role;

-- =====================================================================================
-- 7. Extend the breaker enforcement watchdog to cover the two new guards
-- =====================================================================================
-- A dropped or disabled trigger silently removes protection, and readiness blocks on
-- all_enforced = false. The two new append-only guards must be watched too, or the
-- evidence tables could be quietly made editable.

create or replace function plm.taxonomy_breaker_enforcement_status()
returns jsonb
language sql
stable
security definer
set search_path = plm, core, public
as $$
  with expected(trigger_name, table_ident) as (values
    ('coldlion_source_ref_breaker_guard', 'core.taxonomy_source_ref'),
    ('coldlion_source_ref_delete_breaker_guard', 'core.taxonomy_source_ref'),
    ('coldlion_erp_licensor_breaker_guard', 'plm.erp_licensor'),
    ('coldlion_erp_property_breaker_guard', 'plm.erp_property'),
    ('coldlion_erp_licensor_insert_breaker_guard', 'plm.erp_licensor'),
    ('coldlion_erp_property_insert_breaker_guard', 'plm.erp_property'),
    ('coldlion_autotrip_on_critical_alert', 'plm.taxonomy_sync_alert'),
    ('coldlion_autotrip_on_failed_observation', 'plm.taxonomy_parallel_observation'),
    ('coldlion_breaker_state_guard', 'plm.taxonomy_circuit_breaker'),
    -- Added 20260729230000 for the recurring feed's append-only evidence.
    ('coldlion_promotion_audit_append_only_guard', 'plm.coldlion_promotion_audit'),
    ('coldlion_promotion_quarantine_append_only_guard', 'plm.coldlion_promotion_quarantine')
  ),
  actual as (
    select e.trigger_name, e.table_ident,
           t.tgname is not null as installed,
           coalesce(t.tgenabled, 'D') <> 'D' as enabled
    from expected e
    left join pg_trigger t
      on t.tgname = e.trigger_name
     and t.tgrelid = e.table_ident::regclass
     and not t.tgisinternal
  )
  select jsonb_build_object(
    'expected_count', (select count(*) from expected),
    'installed_count', (select count(*) from actual where installed),
    'enabled_count', (select count(*) from actual where installed and enabled),
    'all_enforced', (select bool_and(installed and enabled) from actual),
    'missing_or_disabled', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trigger', trigger_name, 'table', table_ident,
               'installed', installed, 'enabled', enabled) order by trigger_name), '[]'::jsonb)
      from actual where not (installed and enabled)));
$$;

comment on function plm.taxonomy_breaker_enforcement_status() is
  'Watchdog: confirms every ColdLion breaker AND append-only evidence trigger is still installed AND enabled (11 as of 20260729230000). A dropped or disabled trigger silently removes protection, so readiness blocks on all_enforced = false rather than reporting green on an unguarded database.';
