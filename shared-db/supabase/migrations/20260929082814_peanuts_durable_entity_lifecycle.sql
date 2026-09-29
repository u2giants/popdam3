-- Issue #3684 (successor 4 of #1275): durable Peanuts entity state beside the immutable
-- capture snapshots. Structure only: no licensed row, label or value is included, and
-- nothing here reads, rewrites or deletes an existing snapshot row.
--
-- Design (recorded on #3684):
--   * Stable identity. Assets keep the portal source object id. Vocabulary entities keep
--     the landing value_key (normalised label); source_value_id is never a key.
--   * Owner ruling 6.20. The art program is the property-shaped entity and takes normal
--     withdrawal. An initiative is a retailer- and period-bound tag: when it stops
--     appearing it is RETIRED, never withdrawn, and never counts toward the bulk-drop guard.
--   * Authenticated coverage boundary. Only a capture the table itself admits as complete
--     (deep paging partitioned, vocabularies loaded from source, no errors, no media,
--     captured + unreachable = portal total) AND with zero unreachable assets can publish.
--     Withdrawal also needs the same API endpoint and source customer account as the
--     baseline publication; a different account/endpoint publishes sightings only.
--   * Derivation compatibility. Every publication names its key contract; a different
--     contract never compares against an older baseline.
--   * Concurrent publication locking. One transaction-scoped advisory lock serializes
--     every publication, and chronology refuses an older or equal capture.
--   * A withdrawn row is marked, never deleted. Withdrawal needs the entity seen in the
--     baseline and absent from a comparable run. A bulk drop above the named threshold
--     is held, not applied.

create table plm.peanuts_lifecycle_publication (
  published_capture_id    uuid        not null primary key
                                      references plm.peanuts_capture(id) on delete restrict,
  baseline_capture_id     uuid            null
                                      references plm.peanuts_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  mode                    text        not null,
  derivation_contract     text        not null,
  scope_sha256            text        not null,
  source_captured_at      timestamptz not null,
  counts                  jsonb       not null default '{}'::jsonb,
  published_at            timestamptz not null default now(),
  constraint peanuts_lifecycle_publication_mode_chk
    check (mode in ('bootstrap', 'comparable', 'rebaseline', 'withdrawal_held')),
  constraint peanuts_lifecycle_publication_baseline_chk
    check ((mode = 'bootstrap') = (baseline_capture_id is null)
           and (baseline_capture_id is null or baseline_capture_id <> published_capture_id)),
  constraint peanuts_lifecycle_publication_scope_chk
    check (scope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint peanuts_lifecycle_publication_contract_chk
    check (btrim(derivation_contract) <> ''),
  constraint peanuts_lifecycle_publication_counts_chk
    check (jsonb_typeof(counts) = 'object')
);

comment on table plm.peanuts_lifecycle_publication is
  'One row per Peanuts capture published into durable entity state (#3684). mode records '
  'whether withdrawals were compared (comparable), skipped because the account/endpoint '
  'or key contract differed (rebaseline), or held by the bulk-drop guard. The key is '
  'published_capture_id, deliberately not capture_id: api.source_capture_inventory treats a '
  'peanuts_ table with a capture_id column as a latest-complete capture snapshot, and this '
  'mutable ledger must be reported as retained rows only.';

create table plm.peanuts_entity_lifecycle (
  entity_kind             text        not null,
  entity_key              text        not null,
  first_seen_capture_id   uuid        not null
                                      references plm.peanuts_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  first_seen_at           timestamptz not null,
  last_seen_capture_id    uuid        not null
                                      references plm.peanuts_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  last_seen_at            timestamptz not null,
  last_changed_capture_id uuid        not null
                                      references plm.peanuts_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  change_signal           text        not null,
  status                  text        not null default 'active',
  withdrawn_at            timestamptz     null,
  first_withdrawn_at      timestamptz     null,
  withdrawn_capture_id    uuid            null
                                      references plm.peanuts_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  retired_at              timestamptz     null,
  constraint peanuts_entity_lifecycle_pkey primary key (entity_kind, entity_key),
  constraint peanuts_entity_lifecycle_kind_chk
    check (entity_kind in ('asset', 'art_program', 'character', 'style_guide', 'initiative')),
  constraint peanuts_entity_lifecycle_key_chk check (btrim(entity_key) <> ''),
  constraint peanuts_entity_lifecycle_status_chk
    check (status in ('active', 'withdrawn', 'retired')
           and (status <> 'withdrawn' or entity_kind <> 'initiative')
           and (status <> 'retired' or entity_kind = 'initiative')),
  constraint peanuts_entity_lifecycle_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null)
           and (status = 'withdrawn') = (withdrawn_capture_id is not null)
           and (status = 'retired') = (retired_at is not null)),
  constraint peanuts_entity_lifecycle_history_chk
    check ((withdrawn_at is null or first_withdrawn_at is not null)
           and (first_withdrawn_at is null or withdrawn_at is null or first_withdrawn_at <= withdrawn_at)
           and first_seen_at <= last_seen_at)
);

comment on table plm.peanuts_entity_lifecycle is
  'Durable Peanuts entity state across captures (#3684). The capture snapshot tables stay '
  'the evidence; this table records first/last sighting, the opaque change signal, '
  'withdrawal, and initiative retirement (owner ruling 6.20: an initiative that stops '
  'appearing is retired, not withdrawn). Rows are written only by '
  'plm.peanuts_publish_lifecycle. change_signal is opaque: an asset hashes the portal '
  'update time, checksum, size and version; a vocabulary value hashes its label and raw record.';

-- Serving indexes (review of #3730). Every durable-state scan in the publish function
-- filters by entity_kind = <kind> [and status = 'active'] and last_seen_capture_id =
-- any(<eligible publications>); idx_peanuts_entity_lifecycle_last_seen leads with those
-- columns in that order, so the equality columns narrow before the array probe.
-- idx_peanuts_lifecycle_publication_latest serves the newest-publication pick
-- (source_captured_at, published_at, published_capture_id). The remaining four indexes are
-- NOT serving indexes: they back the on-delete-restrict FK checks, so deleting or
-- re-keying a publication never scans the child table.
create index idx_peanuts_entity_lifecycle_last_seen
  on plm.peanuts_entity_lifecycle (entity_kind, status, last_seen_capture_id);
create index idx_peanuts_entity_lifecycle_first_seen
  on plm.peanuts_entity_lifecycle (first_seen_capture_id);
create index idx_peanuts_entity_lifecycle_last_changed
  on plm.peanuts_entity_lifecycle (last_changed_capture_id);
create index idx_peanuts_entity_lifecycle_withdrawn_capture
  on plm.peanuts_entity_lifecycle (withdrawn_capture_id) where withdrawn_capture_id is not null;
create index idx_peanuts_lifecycle_publication_baseline
  on plm.peanuts_lifecycle_publication (baseline_capture_id) where baseline_capture_id is not null;
create index idx_peanuts_lifecycle_publication_latest
  on plm.peanuts_lifecycle_publication (source_captured_at desc, published_at desc, published_capture_id desc);

comment on column plm.peanuts_entity_lifecycle.first_withdrawn_at is
  'Immutable first confirmed withdrawal time, retained across every reactivation.';
comment on column plm.peanuts_entity_lifecycle.change_signal is
  'Opaque hash of the entity''s content fields in its latest sighting; compare for equality only.';
comment on column plm.peanuts_entity_lifecycle.status is
  'active, withdrawn (non-initiative, absent from a comparable run) or retired (initiative only). '
  'After an account/endpoint rebaseline, entities seen only under the old scope stay active '
  'until they reappear: withdrawal is never inferred across scopes.';
comment on column plm.peanuts_entity_lifecycle.last_changed_capture_id is
  'Capture in which change_signal last changed (content change only; reactivation and '
  'withdrawal do not advance it).';

alter table plm.peanuts_lifecycle_publication enable row level security;
alter table plm.peanuts_entity_lifecycle enable row level security;
revoke all on plm.peanuts_lifecycle_publication from public, anon, authenticated, service_role;
revoke all on plm.peanuts_entity_lifecycle from public, anon, authenticated, service_role;
grant select on plm.peanuts_lifecycle_publication to authenticated, service_role;
grant select on plm.peanuts_entity_lifecycle to authenticated, service_role;

create policy peanuts_lifecycle_publication_plm_read on plm.peanuts_lifecycle_publication
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
create policy peanuts_entity_lifecycle_plm_read on plm.peanuts_entity_lifecycle
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

create function plm.peanuts_publish_lifecycle(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c_contract constant text := 'peanuts-entity-keys-v1';
  v_cap        plm.peanuts_capture%rowtype;
  v_prev       plm.peanuts_lifecycle_publication%rowtype;
  v_scope      text;
  v_mode       text;
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.peanuts_publish_lifecycle', 0));

  select * into v_cap from plm.peanuts_capture where id = p_capture_id for share;
  if not found then
    raise exception 'peanuts_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  if v_cap.status <> 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary <> '[]'::jsonb or v_cap.media_downloaded <> 0
     or v_cap.deep_paging_partitioned is not true or v_cap.vocabularies_loaded_from_source is not true
     or v_cap.assets_unreachable <> 0
     or v_cap.assets_captured <> v_cap.portal_reported_asset_total then
    raise exception 'peanuts_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if (select pg_catalog.count(*) from plm.peanuts_asset a where a.capture_id = p_capture_id)
     <> v_cap.assets_captured then
    raise exception 'peanuts_publish_lifecycle: capture % asset rows do not equal its captured total', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.peanuts_lifecycle_publication where published_capture_id = p_capture_id) then
    raise exception 'peanuts_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.peanuts_lifecycle_publication
   order by source_captured_at desc, published_at desc, published_capture_id desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'peanuts_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.published_capture_id using errcode = '22023';
  end if;

  v_scope := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
               pg_catalog.jsonb_build_array(v_cap.api_endpoint, v_cap.source_customer_id)::text, 'UTF8')), 'hex');

  if v_prev.published_capture_id is null then
    v_mode := 'bootstrap';
  elsif v_prev.scope_sha256 = v_scope and v_prev.derivation_contract = c_contract then
    v_mode := 'comparable';
  else
    v_mode := 'rebaseline';
  end if;

  -- Withdrawal-eligible sightings: the baseline itself, plus -- across a run of held
  -- publications -- each held publication's own baseline. A held drop is therefore
  -- re-evaluated by the next comparable run instead of being orphaned.
  if v_prev.published_capture_id is not null then
    with recursive chain as (
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from plm.peanuts_lifecycle_publication p where p.published_capture_id = v_prev.published_capture_id
      union all
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.peanuts_lifecycle_publication p on p.published_capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.published_capture_id) into v_eligible from chain;
  end if;

  insert into plm.peanuts_lifecycle_publication
    (published_capture_id, baseline_capture_id, mode, derivation_contract, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.published_capture_id, v_mode, c_contract, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.peanuts_lifecycle_seen;
  create temporary table pg_temp.peanuts_lifecycle_seen (
    entity_kind text not null, entity_key text not null, change_signal text not null,
    primary key (entity_kind, entity_key)
  ) on commit drop;

  insert into peanuts_lifecycle_seen
  select 'asset', a.source_object_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
           a.source_updated_at, a.checksum, a.file_size_bytes, a.version_number)::text, 'UTF8')), 'hex')
    from plm.peanuts_asset a where a.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'art_program', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_art_program v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'character', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_character v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'style_guide', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_style_guide v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'initiative', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_initiative v where v.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row). Initiative retirement is exempt.
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','art_program','character','style_guide'] loop
      select pg_catalog.count(*) into v_base from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.last_seen_capture_id = any(v_eligible);
      select pg_catalog.count(*) into v_drop from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.peanuts_lifecycle_publication set mode = v_mode where published_capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','art_program','character','style_guide','initiative'] loop
    select pg_catalog.count(*) into v_seen from peanuts_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from peanuts_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.peanuts_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from peanuts_lifecycle_seen s join plm.peanuts_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from peanuts_lifecycle_seen s join plm.peanuts_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status <> 'active';
    v_drop := 0;
    if v_mode in ('comparable', 'withdrawal_held') and (v_mode = 'comparable' or v_kind = 'initiative') then
      select pg_catalog.count(*) into v_drop from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back,
      case when v_kind = 'initiative' then 'retired' else 'withdrawn' end, v_drop));
  end loop;

  -- Initiative retirement is ordinary seasonal behaviour and is never held.
  if v_mode in ('comparable', 'withdrawal_held') then
    update plm.peanuts_entity_lifecycle l
       set status = 'retired', retired_at = v_cap.source_captured_at
     where l.entity_kind = 'initiative' and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;
  if v_mode = 'comparable' then
    update plm.peanuts_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where l.entity_kind <> 'initiative' and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.peanuts_entity_lifecycle as l
    (entity_kind, entity_key, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from peanuts_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null, retired_at = null;

  update plm.peanuts_lifecycle_publication
     set counts = v_counts, published_at = now()
   where published_capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'baseline_capture_id', v_prev.published_capture_id, 'counts', v_counts);
end
$function$;

revoke all on function plm.peanuts_publish_lifecycle(uuid) from public, anon, authenticated;
grant execute on function plm.peanuts_publish_lifecycle(uuid) to service_role;

comment on function plm.peanuts_publish_lifecycle(uuid) is
  'Publishes one complete zero-failure Peanuts capture into plm.peanuts_entity_lifecycle '
  'under an advisory lock (#3684). Withdraws only baseline-seen entities absent from a run '
  'with the same account, endpoint and key contract; retires, never withdraws, initiatives; '
  'never deletes. Uses a transaction-local scratch table pg_temp.peanuts_lifecycle_seen '
  '(dropped if present, then created on commit drop) in the calling session.';
