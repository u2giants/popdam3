-- Issue #3685 (successor 5 of #1275): durable WildBrain entity state beside the immutable
-- capture snapshots. Structure only: no licensed row, label or value is included, and
-- nothing here reads, rewrites or deletes an existing snapshot row.
--
-- Design (recorded on #3685):
--   * Stable identity. Asset, era, creative group and character keep their portal source
--     ids; characters are never merged by name. Guides keep the landing guide_key.
--   * Owner ruling 6.20. Era and creative group are orthogonal entities and both take the
--     lifecycle. Guides are INFERRED records (rule_version); they are compared only when
--     the baseline was derived by the exact same rule-version set, otherwise guide
--     sightings are recorded and no guide is withdrawn.
--   * Authenticated coverage boundary. Only a capture the table admits as complete
--     (pagination verified, no truncated child list, no errors, no media) whose asset rows
--     equal the portal-reported total can publish. Withdrawal also needs the same portal
--     base URL as the baseline publication; a different portal publishes sightings only.
--   * Concurrent publication locking. One transaction-scoped advisory lock serializes
--     every publication, and chronology refuses an older or equal capture.
--   * A withdrawn row is marked, never deleted. Withdrawal needs the entity seen in the
--     baseline and absent from a comparable run. A bulk drop above the named threshold
--     is held, not applied.

create table plm.wildbrain_lifecycle_publication (
  capture_id              uuid        not null primary key
                                      references plm.wildbrain_capture(id) on delete restrict,
  baseline_capture_id     uuid            null
                                      references plm.wildbrain_lifecycle_publication(capture_id)
                                      on delete restrict,
  mode                    text        not null,
  derivation_contract     text        not null,
  guide_rule_versions     text        not null,
  scope_sha256            text        not null,
  source_captured_at      timestamptz not null,
  counts                  jsonb       not null default '{}'::jsonb,
  published_at            timestamptz not null default now(),
  constraint wildbrain_lifecycle_publication_mode_chk
    check (mode in ('bootstrap', 'comparable', 'rebaseline', 'withdrawal_held')),
  constraint wildbrain_lifecycle_publication_baseline_chk
    check ((mode = 'bootstrap') = (baseline_capture_id is null)
           and (baseline_capture_id is null or baseline_capture_id <> capture_id)),
  constraint wildbrain_lifecycle_publication_scope_chk
    check (scope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint wildbrain_lifecycle_publication_contract_chk
    check (btrim(derivation_contract) <> ''),
  constraint wildbrain_lifecycle_publication_counts_chk
    check (jsonb_typeof(counts) = 'object')
);

comment on table plm.wildbrain_lifecycle_publication is
  'One row per WildBrain capture published into durable entity state (#3685). mode records '
  'whether withdrawals were compared (comparable), skipped because the portal or key '
  'contract differed (rebaseline), or held by the bulk-drop guard. guide_rule_versions is '
  'the inferred-guide rule-version set; guides compare only when it matches the baseline.';

create table plm.wildbrain_entity_lifecycle (
  entity_kind             text        not null,
  entity_key              text        not null,
  first_seen_capture_id   uuid        not null
                                      references plm.wildbrain_lifecycle_publication(capture_id)
                                      on delete restrict,
  first_seen_at           timestamptz not null,
  last_seen_capture_id    uuid        not null
                                      references plm.wildbrain_lifecycle_publication(capture_id)
                                      on delete restrict,
  last_seen_at            timestamptz not null,
  last_changed_capture_id uuid        not null
                                      references plm.wildbrain_lifecycle_publication(capture_id)
                                      on delete restrict,
  change_signal           text        not null,
  status                  text        not null default 'active',
  withdrawn_at            timestamptz     null,
  first_withdrawn_at      timestamptz     null,
  withdrawn_capture_id    uuid            null
                                      references plm.wildbrain_lifecycle_publication(capture_id)
                                      on delete restrict,
  constraint wildbrain_entity_lifecycle_pkey primary key (entity_kind, entity_key),
  constraint wildbrain_entity_lifecycle_kind_chk
    check (entity_kind in ('asset', 'era', 'creative_group', 'character', 'guide')),
  constraint wildbrain_entity_lifecycle_key_chk check (btrim(entity_key) <> ''),
  constraint wildbrain_entity_lifecycle_status_chk
    check (status in ('active', 'withdrawn')),
  constraint wildbrain_entity_lifecycle_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null)
           and (status = 'withdrawn') = (withdrawn_capture_id is not null)),
  constraint wildbrain_entity_lifecycle_history_chk
    check ((withdrawn_at is null or first_withdrawn_at is not null)
           and (first_withdrawn_at is null or withdrawn_at is null or first_withdrawn_at <= withdrawn_at)
           and first_seen_at <= last_seen_at)
);

comment on table plm.wildbrain_entity_lifecycle is
  'Durable WildBrain entity state across captures (#3685). The capture snapshot tables stay '
  'the evidence; this table records first/last sighting, the opaque change signal and '
  'withdrawal. Rows are written only by plm.wildbrain_publish_lifecycle. change_signal is '
  'opaque: an asset uses its retained source hash; every other kind hashes its label '
  '(and, for an inferred guide, its derivation fields) with its raw record.';

-- Serving indexes (review of PR #3731). The publish path finds the latest publication by
-- source time, and scans durable state by (last_seen_capture_id, entity_kind) for the
-- bulk-drop guard, the withdrawal counts and the withdrawal itself; the same index serves
-- the last_seen foreign key. The other foreign-key child columns get their own index so a
-- publication-row check never scans the whole durable-state table.
create index wildbrain_lifecycle_publication_latest_idx
  on plm.wildbrain_lifecycle_publication (source_captured_at desc, published_at desc);
create index wildbrain_lifecycle_publication_baseline_idx
  on plm.wildbrain_lifecycle_publication (baseline_capture_id) where baseline_capture_id is not null;
create index wildbrain_entity_lifecycle_last_seen_idx
  on plm.wildbrain_entity_lifecycle (last_seen_capture_id, entity_kind);
create index wildbrain_entity_lifecycle_first_seen_idx
  on plm.wildbrain_entity_lifecycle (first_seen_capture_id);
create index wildbrain_entity_lifecycle_last_changed_idx
  on plm.wildbrain_entity_lifecycle (last_changed_capture_id);
create index wildbrain_entity_lifecycle_withdrawn_idx
  on plm.wildbrain_entity_lifecycle (withdrawn_capture_id) where withdrawn_capture_id is not null;

alter table plm.wildbrain_lifecycle_publication enable row level security;
alter table plm.wildbrain_entity_lifecycle enable row level security;
revoke all on plm.wildbrain_lifecycle_publication from public, anon, authenticated, service_role;
revoke all on plm.wildbrain_entity_lifecycle from public, anon, authenticated, service_role;
grant select on plm.wildbrain_lifecycle_publication to authenticated, service_role;
grant select on plm.wildbrain_entity_lifecycle to authenticated, service_role;

create policy wildbrain_lifecycle_publication_plm_read on plm.wildbrain_lifecycle_publication
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
create policy wildbrain_entity_lifecycle_plm_read on plm.wildbrain_entity_lifecycle
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

create function plm.wildbrain_publish_lifecycle(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c_contract constant text := 'wildbrain-entity-keys-v1';
  v_cap        plm.wildbrain_capture%rowtype;
  v_prev       plm.wildbrain_lifecycle_publication%rowtype;
  v_scope      text;
  v_rules      text;
  v_mode       text;
  v_guides     boolean;
  v_counts     jsonb := '{}'::jsonb;
  v_kind       text;
  v_seen       bigint;
  v_added      bigint;
  v_changed    bigint;
  v_back       bigint;
  v_base       bigint;
  v_drop       bigint;
  v_limit      bigint;
  v_held       boolean := false;
  v_eligible   uuid[] := '{}';
begin
  -- Concurrent publication locking: every publication for this licensor is serial.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.wildbrain_publish_lifecycle', 0));

  select * into v_cap from plm.wildbrain_capture where id = p_capture_id for share;
  if not found then
    raise exception 'wildbrain_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  if v_cap.status <> 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary <> '[]'::jsonb or v_cap.media_downloaded <> 0
     or v_cap.pagination_verified is not true or v_cap.truncated_child_lists <> 0
     or v_cap.reported_total is null
     or (select pg_catalog.count(*) from plm.wildbrain_asset a where a.capture_id = p_capture_id)
        <> v_cap.reported_total then
    raise exception 'wildbrain_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.wildbrain_lifecycle_publication where capture_id = p_capture_id) then
    raise exception 'wildbrain_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.wildbrain_lifecycle_publication
   order by source_captured_at desc, published_at desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'wildbrain_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.capture_id using errcode = '22023';
  end if;

  v_scope := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_cap.portal_base_url, 'UTF8')), 'hex');
  select coalesce(pg_catalog.string_agg(distinct g.rule_version, ',' order by g.rule_version), '')
    into v_rules from plm.wildbrain_guide g where g.capture_id = p_capture_id;

  if v_prev.capture_id is null then
    v_mode := 'bootstrap';
  elsif v_prev.scope_sha256 = v_scope and v_prev.derivation_contract = c_contract then
    v_mode := 'comparable';
  else
    v_mode := 'rebaseline';
  end if;
  -- Inferred guides compare only against a baseline derived by the same rule versions.
  v_guides := v_mode = 'comparable' and v_prev.guide_rule_versions = v_rules;

  -- Withdrawal-eligible sightings: the baseline itself, plus -- across a run of held
  -- publications -- each held publication's own baseline. A held drop is therefore
  -- re-evaluated by the next comparable run instead of being orphaned.
  if v_prev.capture_id is not null then
    with recursive chain as (
      select p.capture_id, p.baseline_capture_id, p.mode
        from plm.wildbrain_lifecycle_publication p where p.capture_id = v_prev.capture_id
      union all
      select p.capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.wildbrain_lifecycle_publication p on p.capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.capture_id) into v_eligible from chain;
  end if;

  insert into plm.wildbrain_lifecycle_publication
    (capture_id, baseline_capture_id, mode, derivation_contract, guide_rule_versions, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.capture_id, v_mode, c_contract, v_rules, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.wildbrain_lifecycle_seen;
  create temporary table pg_temp.wildbrain_lifecycle_seen (
    entity_kind text not null, entity_key text not null, change_signal text not null,
    primary key (entity_kind, entity_key)
  ) on commit drop;

  insert into pg_temp.wildbrain_lifecycle_seen
  select 'asset', a.asset_source_id, a.source_hash
    from plm.wildbrain_asset a where a.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'era', v.era_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.era_label, v.parent_era_source_id, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_era v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'creative_group', v.creative_group_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.creative_group_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_creative_group v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'character', v.character_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.character_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_character v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'guide', v.guide_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
           v.guide_label, v.derivation_method, v.rule_version, v.relationship_truth, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_guide v where v.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row).
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','era','creative_group','character','guide'] loop
      continue when v_kind = 'guide' and not v_guides;
      select pg_catalog.count(*) into v_base from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id));
      select pg_catalog.count(*) into v_drop from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
         and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.wildbrain_lifecycle_publication set mode = v_mode where capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','era','creative_group','character','guide'] loop
    select pg_catalog.count(*) into v_seen from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.wildbrain_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from pg_temp.wildbrain_lifecycle_seen s join plm.wildbrain_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from pg_temp.wildbrain_lifecycle_seen s join plm.wildbrain_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status = 'withdrawn';
    v_drop := 0;
    if v_mode = 'comparable' and (v_kind <> 'guide' or v_guides) then
      select pg_catalog.count(*) into v_drop from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
         and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back, 'withdrawn', v_drop));
  end loop;

  if v_mode = 'comparable' then
    update plm.wildbrain_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where (l.entity_kind <> 'guide' or v_guides)
       and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
       and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.wildbrain_entity_lifecycle as l
    (entity_kind, entity_key, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from pg_temp.wildbrain_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null;

  update plm.wildbrain_lifecycle_publication
     set counts = v_counts, published_at = now()
   where capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'guides_compared', v_guides, 'baseline_capture_id', v_prev.capture_id, 'counts', v_counts);
end
$function$;

revoke all on function plm.wildbrain_publish_lifecycle(uuid) from public, anon, authenticated;
grant execute on function plm.wildbrain_publish_lifecycle(uuid) to service_role;

comment on function plm.wildbrain_publish_lifecycle(uuid) is
  'Publishes one complete WildBrain capture into plm.wildbrain_entity_lifecycle under an '
  'advisory lock (#3685). Withdraws only baseline-seen entities absent from a run with the '
  'same portal and key contract; inferred guides only when the rule-version set matches; '
  'never deletes.';
