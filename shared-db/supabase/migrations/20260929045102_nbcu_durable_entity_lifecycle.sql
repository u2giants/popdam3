-- Issue #3683 (successor 3 of #1275): durable NBCU entity state beside the immutable
-- capture snapshots. Structure only: no licensed row, label, path or value is included,
-- and nothing here reads, rewrites or deletes an existing snapshot row.
--
-- Design (recorded on #3683):
--   * Stable identity. Each entity kind keeps the landing key rule, with one qualified
--     fallback: an asset key is its DAM path with the portal details-viewer prefix
--     removed, so one DAM object seen through a different viewer is one identity.
--   * Authenticated coverage boundary. Only a capture that finalize_nbcu_capture marked
--     complete can publish. This function re-checks every scope terminal, no missing
--     paging offset and zero failures; every expected count met is enforced by
--     plm.finalize_nbcu_capture before it sets status 'complete' (current body: 20260825130924). Withdrawal needs the SAME licensed scope set as
--     the baseline publication; a different set publishes sightings only.
--   * Derivation compatibility. Every publication names the key-derivation contract; a
--     different contract never compares against an older baseline.
--   * Concurrent publication locking. One transaction-scoped advisory lock serializes
--     every publication, and chronology refuses an older or equal capture. Refusing an
--     equal source_captured_at is an intentional technical rule (orchestrator sign-off,
--     #3695 round 4): equal source timestamps give an ambiguous order, so refusing is the
--     safe default and the second capture is never merged. Recovery is a fresh capture,
--     which always carries a later source_captured_at; nothing is edited or deleted.
--   * A withdrawn row is marked, never deleted. Withdrawal needs the entity seen in the
--     baseline and absent from a comparable run. A bulk drop above the named threshold
--     is held, not applied; the held publication records how many withdrawals it held.

create table plm.nbcu_lifecycle_publication (
  published_capture_id    uuid        not null primary key
                                      references plm.nbcu_capture(id) on delete restrict,
  baseline_capture_id     uuid            null
                                      references plm.nbcu_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  mode                    text        not null,
  derivation_contract     text        not null,
  scope_sha256            text        not null,
  source_captured_at      timestamptz not null,
  counts                  jsonb       not null default '{}'::jsonb,
  published_at            timestamptz not null default now(),
  constraint nbcu_lifecycle_publication_mode_chk
    check (mode in ('bootstrap', 'comparable', 'rebaseline', 'withdrawal_held')),
  constraint nbcu_lifecycle_publication_baseline_chk
    check ((mode = 'bootstrap') = (baseline_capture_id is null)
           and (baseline_capture_id is null or baseline_capture_id <> published_capture_id)),
  constraint nbcu_lifecycle_publication_scope_chk
    check (scope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint nbcu_lifecycle_publication_contract_chk
    check (btrim(derivation_contract) <> ''),
  constraint nbcu_lifecycle_publication_counts_chk
    check (jsonb_typeof(counts) = 'object')
);

comment on table plm.nbcu_lifecycle_publication is
  'One row per NBCU capture published into durable entity state (#3683). Its key is '
  'published_capture_id, deliberately not capture_id: api.source_capture_inventory treats an '
  'nbcu_ table with a capture_id column as a latest-complete capture snapshot, and this '
  'mutable ledger must be reported as retained rows only. mode records '
  'whether withdrawals were compared (comparable), skipped because the licensed scope '
  'set or derivation contract differed (rebaseline), or held by the bulk-drop guard.';

create table plm.nbcu_entity_lifecycle (
  entity_kind             text        not null,
  entity_key              text        not null,
  identity_basis          text        not null,
  first_seen_capture_id   uuid        not null
                                      references plm.nbcu_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  first_seen_at           timestamptz not null,
  last_seen_capture_id    uuid        not null
                                      references plm.nbcu_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  last_seen_at            timestamptz not null,
  last_changed_capture_id uuid        not null
                                      references plm.nbcu_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  change_signal           text        not null,
  status                  text        not null default 'active',
  withdrawn_at            timestamptz     null,
  first_withdrawn_at      timestamptz     null,
  withdrawn_capture_id    uuid            null
                                      references plm.nbcu_lifecycle_publication(published_capture_id)
                                      on delete restrict,
  constraint nbcu_entity_lifecycle_pkey primary key (entity_kind, entity_key),
  constraint nbcu_entity_lifecycle_kind_chk
    check (entity_kind in ('asset', 'property', 'character', 'style_guide', 'ip_family')),
  constraint nbcu_entity_lifecycle_basis_chk
    check (identity_basis in ('dam_path', 'source_id', 'label_sha256', 'id_fallback', 'folder_path')),
  constraint nbcu_entity_lifecycle_key_chk check (btrim(entity_key) <> ''),
  constraint nbcu_entity_lifecycle_status_chk check (status in ('active', 'withdrawn')),
  constraint nbcu_entity_lifecycle_withdrawn_at_chk
    check ((status = 'withdrawn') = (withdrawn_at is not null)
           and (status = 'withdrawn') = (withdrawn_capture_id is not null)),
  constraint nbcu_entity_lifecycle_history_chk
    check ((withdrawn_at is null or first_withdrawn_at is not null)
           and (first_withdrawn_at is null or withdrawn_at is null or first_withdrawn_at <= withdrawn_at)
           and first_seen_at <= last_seen_at)
);

comment on table plm.nbcu_entity_lifecycle is
  'Durable NBCU entity state across captures (#3683). The capture snapshot tables stay '
  'the evidence; this table records first/last sighting, the opaque change signal and '
  'withdrawal. Rows are written only by plm.nbcu_publish_lifecycle. change_signal is '
  'opaque: an asset hashes the portal display_modified and display_size; every other '
  'kind hashes its retained raw source record.';

-- Serving indexes (#3695 review). The function's two lookups:
--   * nbcu_entity_lifecycle_kind_last_seen_idx leads with last_seen_capture_id, the column
--     every withdrawal statement constrains (= any(eligible)); the per-kind guard and
--     count statements add entity_kind and status, and the kind-less withdrawal UPDATE
--     still uses the leading column. It is also the referenced-side index for the
--     last_seen_capture_id foreign key.
--   * nbcu_lifecycle_publication_latest_idx serves the latest-publication lookup.
-- Foreign-key support only (no function predicate uses them): first_seen, last_changed,
-- withdrawn_capture and baseline indexes keep a publication-row RESTRICT check from
-- scanning the child table.
create index nbcu_entity_lifecycle_kind_last_seen_idx
  on plm.nbcu_entity_lifecycle (last_seen_capture_id, entity_kind, status);
create index nbcu_entity_lifecycle_first_seen_idx
  on plm.nbcu_entity_lifecycle (first_seen_capture_id);
create index nbcu_entity_lifecycle_last_changed_idx
  on plm.nbcu_entity_lifecycle (last_changed_capture_id);
create index nbcu_entity_lifecycle_withdrawn_capture_idx
  on plm.nbcu_entity_lifecycle (withdrawn_capture_id) where withdrawn_capture_id is not null;
create index nbcu_lifecycle_publication_latest_idx
  on plm.nbcu_lifecycle_publication (source_captured_at desc, published_at desc);
create index nbcu_lifecycle_publication_baseline_idx
  on plm.nbcu_lifecycle_publication (baseline_capture_id) where baseline_capture_id is not null;

alter table plm.nbcu_lifecycle_publication enable row level security;
alter table plm.nbcu_entity_lifecycle enable row level security;
revoke all on plm.nbcu_lifecycle_publication from public, anon, authenticated, service_role;
revoke all on plm.nbcu_entity_lifecycle from public, anon, authenticated, service_role;
grant select on plm.nbcu_lifecycle_publication to authenticated, service_role;
grant select on plm.nbcu_entity_lifecycle to authenticated, service_role;

create policy nbcu_lifecycle_publication_plm_read on plm.nbcu_lifecycle_publication
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));
create policy nbcu_entity_lifecycle_plm_read on plm.nbcu_entity_lifecycle
  for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
         or app.has_any_role(array['sales', 'licensing']::app.app_role[]));

create function plm.nbcu_publish_lifecycle(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c_contract constant text := 'nbcu-entity-keys-v1';
  v_cap        plm.nbcu_capture%rowtype;
  v_prev       plm.nbcu_lifecycle_publication%rowtype;
  v_scope      text;
  v_mode       text;
  v_now        timestamptz := now();
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.nbcu_publish_lifecycle', 0));

  select * into v_cap from plm.nbcu_capture where id = p_capture_id for share;
  if not found then
    raise exception 'nbcu_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  -- NULL-safe by construction: every arm is IS DISTINCT FROM / IS NULL, so a NULL can
  -- never make the refusal condition NULL and let a capture through.
  if v_cap.status is distinct from 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary is distinct from '[]'::jsonb or v_cap.media_downloaded is distinct from 0 then
    raise exception 'nbcu_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.nbcu_scope s where s.capture_id = p_capture_id
             and (s.terminal is not true or pg_catalog.cardinality(s.missing_offsets) is distinct from 0))
     or not exists (select 1 from plm.nbcu_scope s where s.capture_id = p_capture_id) then
    raise exception 'nbcu_publish_lifecycle: capture % has no complete licensed scope coverage', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.nbcu_lifecycle_publication where published_capture_id = p_capture_id) then
    raise exception 'nbcu_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.nbcu_lifecycle_publication
   order by source_captured_at desc, published_at desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'nbcu_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.published_capture_id using errcode = '22023';
  end if;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           pg_catalog.string_agg(s.scope_key, E'\n' order by s.scope_key), 'UTF8')), 'hex')
    into v_scope from plm.nbcu_scope s where s.capture_id = p_capture_id;

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
        from plm.nbcu_lifecycle_publication p where p.published_capture_id = v_prev.published_capture_id
      union all
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.nbcu_lifecycle_publication p on p.published_capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.published_capture_id) into v_eligible from chain;
  end if;

  insert into plm.nbcu_lifecycle_publication
    (published_capture_id, baseline_capture_id, mode, derivation_contract, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.published_capture_id, v_mode, c_contract, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.nbcu_lifecycle_seen;
  create temporary table pg_temp.nbcu_lifecycle_seen (
    entity_kind text not null, entity_key text not null, identity_basis text not null,
    change_signal text not null, primary key (entity_kind, entity_key)
  ) on commit drop;

  -- One DAM object reached through two viewer URLs in one capture is one identity; the
  -- lexically first path supplies the signal so the choice is deterministic.
  insert into pg_temp.nbcu_lifecycle_seen
  select distinct on (k.dam_path) 'asset', k.dam_path, 'dam_path',
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(k.display_modified, k.display_size)::text, 'UTF8')), 'hex')
    from (select pg_catalog.regexp_replace(a.asset_path, '^/content/asset-share-commons/en/details/[^/]+[.]html(?=/content/dam/)', '') as dam_path,
                 a.asset_path, a.display_modified, a.display_size
            from plm.nbcu_asset a where a.capture_id = p_capture_id) k
   order by k.dam_path, k.asset_path;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'property', p.property_key,
         case when p.property_source_id is not null then 'source_id' else 'label_sha256' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_property p where p.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'character', c.character_key,
         case when c.character_source_id is not null then 'source_id' else 'id_fallback' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_character c where c.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'style_guide', g.style_guide_key,
         case when g.style_guide_source_id is not null then 'source_id' else 'folder_path' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(g.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_style_guide g where g.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'ip_family', f.ip_family_key, 'label_sha256',
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_ip_family f where f.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row).
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','property','character','style_guide','ip_family'] loop
      select pg_catalog.count(*) into v_base from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.last_seen_capture_id = any(v_eligible);
      select pg_catalog.count(*) into v_drop from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.nbcu_lifecycle_publication set mode = v_mode where published_capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','property','character','style_guide','ip_family'] loop
    select pg_catalog.count(*) into v_seen from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.nbcu_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from pg_temp.nbcu_lifecycle_seen s join plm.nbcu_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from pg_temp.nbcu_lifecycle_seen s join plm.nbcu_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status = 'withdrawn';
    v_drop := 0;
    if v_mode in ('comparable', 'withdrawal_held') then
      select pg_catalog.count(*) into v_drop from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back,
      'withdrawn', case when v_mode = 'comparable' then v_drop else 0 end,
      'withdrawal_held', case when v_mode = 'withdrawal_held' then v_drop else 0 end));
  end loop;

  if v_mode = 'comparable' then
    update plm.nbcu_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.nbcu_entity_lifecycle as l
    (entity_kind, entity_key, identity_basis, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, s.identity_basis, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from pg_temp.nbcu_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set identity_basis = excluded.identity_basis,
         last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null;

  update plm.nbcu_lifecycle_publication
     set counts = v_counts, published_at = v_now
   where published_capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'baseline_capture_id', v_prev.published_capture_id, 'counts', v_counts);
end
$function$;

revoke all on function plm.nbcu_publish_lifecycle(uuid) from public, anon, authenticated;
grant execute on function plm.nbcu_publish_lifecycle(uuid) to service_role;

comment on function plm.nbcu_publish_lifecycle(uuid) is
  'Publishes one complete NBCU capture into plm.nbcu_entity_lifecycle under an advisory '
  'lock (#3683). Withdraws only entities seen in the baseline and absent from a run with '
  'the same licensed scope set and key contract; never deletes.';
