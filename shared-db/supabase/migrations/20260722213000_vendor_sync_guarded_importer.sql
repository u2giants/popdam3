-- Phase A of the recurring Coldlion vendor sync — the GUARDED importer + its tables.
-- Full design + review: fix_vendor_sync.md, .ai/reviews/vendor-sync-plan-glm-2026-07-22.md.
--
-- Why this exists
-- ---------------
-- core.factory is the shared, human-curated vendor/factory hub. It is fed from Coldlion
-- /vendors. A naive recurring pull would silently erode curation (reactivate inactive,
-- re-add purged service-providers, re-split merged duplicates, insert nameless rows).
-- This migration installs a guarded importer that CANNOT do any of those, plus the two
-- durable tables it consults. It supersedes plm.import_coldlion_vendors, which force-set
-- status='active' on matched rows (curation-clobbering) — that function is dropped here.
--
-- This is additive (new tables/functions) except the deliberate DROP of the old importer.
-- Nothing reads the new objects yet; the actual API pull + call is an operational step
-- run separately (Phase A one-off, Phase B scheduled Edge Function). Migrations never call
-- the external API.
--
-- GUARANTEES (see fix_vendor_sync.md §2/§3/§3a/§9):
--   * Guard 1 — a blank/nameless vendorDesc is NEVER inserted into core.factory; it is
--     quarantined loudly (plm.vendor_quarantine + rows_failed). Bronze still keeps the row.
--   * Guard 2 — plm.vendor_exclusion is consulted every run; an excluded code never touches
--     core.factory. Status is app-owned: set ONLY on INSERT of a brand-new factory, never
--     overwritten on a match.
--   * Upsert by (source_system, source_table, source_id) — a merged survivor holding both
--     codes resolves to one row (no re-split); purged codes (seeded into vendor_exclusion)
--     are never re-added.
--   * Snapshot semantics — upstream removal / active='N' never deletes or inactivates a
--     curated core.factory row. The mirror reflects the snapshot; gold is only ADDED to or
--     have non-status fields refreshed.
--   * Empty-payload + concurrency guards live INSIDE the function (a direct '[]' call cannot
--     wipe the mirror; overlapping runs serialize on an advisory lock).

-- =====================================================================================
-- 1. Durable tables
-- =====================================================================================

-- 1a. "Excluded" codes: the sync's gold-touching logic skips these. "Excluded" means
--     "already removed / ruled out; re-review before re-admitting" — NOT necessarily
--     "not a factory" (some purged codes were real factories Coldlion dropped). A human
--     removes a row here to let the sync manage that code again.
create table plm.vendor_exclusion (
  source_system text not null default 'coldlion',
  source_table  text not null default 'vendors',
  source_id     text not null,               -- Coldlion vendorCode, e.g. 'ANT001'
  reason        text not null,
  excluded_by   text not null default 'curation',
  created_at    timestamptz not null default now(),
  primary key (source_system, source_table, source_id)
);

comment on table plm.vendor_exclusion is
  'Codes the guarded vendor importer must NOT auto-manage in core.factory (Guard 2). Seeded with ANT001 (curated inactive) and the codes purged from core.factory on 2026-07-22 (absent from the corrected Coldlion feed). "Excluded" = skip gold-touching + never auto-re-add; remove a row to let the sync manage that code again.';

-- 1b. Loud quarantine for rejected rows (Guard 1): blank/nameless or unusable records.
create table plm.vendor_quarantine (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid references ingest.sync_run(id) on delete set null,
  source_id     text,                        -- vendorCode if present, else NULL
  reason        text not null,               -- e.g. 'blank vendorDesc', 'missing vendorCode'
  payload       jsonb not null,
  created_at    timestamptz not null default now()
);

comment on table plm.vendor_quarantine is
  'Loud landing for vendor rows the guarded importer refused to promote to core.factory (Guard 1): blank vendorDesc, missing vendorCode, etc. rows_failed on the sync_run also counts these. Bronze ingest.raw_record still holds the original payload (except missing-vendorCode rows, which have no natural key for bronze and live only here).';

-- RLS + grants: admin-read, service-role write (mirror plm.erp_* pattern).
alter table plm.vendor_exclusion  enable row level security;
alter table plm.vendor_quarantine enable row level security;

create policy plm_vendor_exclusion_admin_only on plm.vendor_exclusion
  for all to authenticated
  using (app.has_role('administrator')) with check (app.has_role('administrator'));
create policy plm_vendor_quarantine_admin_only on plm.vendor_quarantine
  for all to authenticated
  using (app.has_role('administrator')) with check (app.has_role('administrator'));

grant select on plm.vendor_exclusion, plm.vendor_quarantine to authenticated;
grant all    on plm.vendor_exclusion, plm.vendor_quarantine to service_role;

-- =====================================================================================
-- 2. Seed exclusions (GLM S1 — make "no re-add of purged rows" durable)
-- =====================================================================================
-- The 434 codes purged from core.factory on 2026-07-22 (present in bronze raw_record, absent
-- from the corrected 97-code feed, and not currently linked to any live core.factory) are
-- seeded so a future re-pull can never silently re-add them. Computed from raw_record so no
-- 434-code literal is baked in; idempotent (on conflict do nothing). Plus ANT001 (curated
-- inactive). The 6 borderline vendors (Buildasign, May Group Deco Sign, Floor Gardens/FLGDS,
-- TUFKO/INTUF, Royal Packers, Royal Union) are VALID FACTORIES per Albert 2026-07-22 and are
-- deliberately NOT excluded.
do $$
declare
  v_correct text[] := array[
    'ANT001','CACAR','CBPHO','CBYJA','CNASW','CNBCH','CNBEL','CNBTO','CNCHC','CNCHF','CNCKA',
    'CNCXC','CNDCF','CNDHE','CNDWG','CNEVR','CNFEN','CNFER','CNFLW','CNFLY','CNFTH','CNFUJ',
    'CNFUZH','CNGCH','CNHAP','CNHDL','CNHFU','CNHQP','CNHUS','CNINT','CNJAM','CNJDF','CNJHC',
    'CNJHY','CNJJA','CNJNC','CNJTS','CNLTL','CNMHA','CNMUC','CNNBH','CNNDC','CNNEW','CNNHX',
    'CNNMP','CNNTY','CNQJM','CNQMS','CNQUE','CNRPH','CNRUC','CNSFN','CNSHAO','CNTFA','CNTMWA',
    'CNTMZ','CNTNG','CNTTY','CNTXC','CNTZS','CNUNQ','CNWAH','CNWAT','CNWEM','CNWJT','CNWLH',
    'CNXFA','CNXJM','CNXJY','CNXKA','CNXYZ','CNYDE','CNYIC','CNYIH','CNYKE','CNYSC','CNZAK',
    'CNZBJ','CNZCH','CNZHO','CNZJNA','CNZTA','COCO','FLGDS','IKN001','INBABU','INDSM','INHDW',
    'INKAN','INRYP','INTUF','INUCF','INVCW','SKPHL','SKPNP','SKSMB','USDEC'
  ];
begin
  insert into plm.vendor_exclusion (source_system, source_table, source_id, reason, excluded_by)
  select distinct 'coldlion', 'vendors', rr.source_id,
         'purged from core.factory 2026-07-22 (absent from corrected Coldlion /vendors feed); re-review before re-admitting',
         'reconcile-2026-07-22'
  from ingest.raw_record rr
  where rr.source_system = 'coldlion'
    and rr.source_table  = 'vendors'
    and rr.source_id <> all (v_correct)
    and not exists (
      select 1 from core.factory_source_ref r
      where r.source_system = 'coldlion' and r.source_id = rr.source_id)
  on conflict (source_system, source_table, source_id) do nothing;

  -- ANT001: in the corrected feed and a live core.factory (inactive), but curated
  -- not-a-factory, so exclude it too (belt-and-suspenders over status-set-on-INSERT-only).
  insert into plm.vendor_exclusion (source_system, source_table, source_id, reason, excluded_by)
  values ('coldlion', 'vendors', 'ANT001',
          'ANTHONY''S WAREHOUSE & DISTRIBUTION — warehouse/distributor, not a manufacturer (Albert 2026-07-22)',
          'curation')
  on conflict (source_system, source_table, source_id) do nothing;
end $$;

-- =====================================================================================
-- 3. The guarded importer
-- =====================================================================================
create or replace function plm.sync_coldlion_vendors(vendors_payload jsonb)
returns table (
  sync_run_id     uuid,
  rows_seen       integer,
  rows_inserted   integer,   -- brand-new core.factory rows
  rows_updated    integer,   -- matched core.factory rows (non-status refresh only)
  rows_failed     integer,   -- quarantined (blank / missing code)
  rows_skipped    integer,   -- excluded codes (Guard 2), mirror-only
  rows_deleted    integer    -- silver rows removed (absent from this snapshot)
)
language plpgsql
security definer
set search_path = app, core, ingest, plm, extensions, public
as $$
declare
  sync_id       uuid;
  vrow          jsonb;
  v_code        text;
  v_name        text;
  v_active      boolean;
  v_country     text;
  v_address     jsonb;
  v_factory_id  uuid;
  v_excluded    boolean;
  v_seen        integer := 0;
  v_ins         integer := 0;
  v_upd         integer := 0;
  v_fail        integer := 0;
  v_skip        integer := 0;
  v_del         integer := 0;
  v_codes       text[] := array[]::text[];
begin
  if jsonb_typeof(coalesce(vendors_payload, 'null'::jsonb)) <> 'array' then
    raise exception 'vendors_payload must be a JSON array';
  end if;
  -- S8: empty-payload guard lives INSIDE the function. A direct '[]' call must not be able
  -- to fall through to the post-loop mirror delete and wipe plm.erp_vendor.
  if jsonb_array_length(vendors_payload) = 0 then
    raise exception 'refusing to run on an empty /vendors payload (would erase the mirror)';
  end if;
  -- S7: serialize overlapping runs (manual trigger racing the schedule, double-fire, etc.)
  perform pg_advisory_xact_lock(hashtext('plm.sync_coldlion_vendors')::bigint);

  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_vendors_api', 'running', now(),
          jsonb_build_object('endpoint', '/vendors', 'company_code', 'EDGEHOME', 'mode', 'guarded_sync'))
  returning id into sync_id;

  for vrow in select value from jsonb_array_elements(vendors_payload)
  loop
    v_code := nullif(vrow ->> 'vendorCode', '');

    -- Missing natural key: cannot land bronze (source_id is NOT NULL). Quarantine loudly.
    if v_code is null then
      insert into plm.vendor_quarantine (sync_run_id, source_id, reason, payload)
      values (sync_id, null, 'missing vendorCode', vrow);
      v_fail := v_fail + 1;
      continue;
    end if;

    v_seen  := v_seen + 1;
    v_codes := v_codes || v_code;
    v_name    := nullif(vrow ->> 'vendorDesc', '');
    v_active  := upper(coalesce(vrow ->> 'active', '')) = 'Y';
    v_country := nullif(vrow ->> 'countryCode', '');
    v_address := jsonb_strip_nulls(jsonb_build_object(
      'address1', nullif(vrow ->> 'address1', ''),
      'address2', nullif(vrow ->> 'address2', ''),
      'address3', nullif(vrow ->> 'address3', ''),
      'city',     nullif(vrow ->> 'city', ''),
      'state',    nullif(vrow ->> 'state', ''),
      'zip',      nullif(vrow ->> 'zipCode', ''),
      'country',  v_country));

    -- Bronze: always land the raw row (nothing is ever lost).
    insert into ingest.raw_record (sync_run_id, source_system, source_table, source_id, record_hash, payload, imported_at)
    values (sync_id, 'coldlion', 'vendors', v_code, md5(vrow::text), vrow, now())
    on conflict (source_system, source_table, source_id) do update
    set sync_run_id = excluded.sync_run_id, record_hash = excluded.record_hash,
        payload = excluded.payload, imported_at = excluded.imported_at;

    v_factory_id := null;

    -- Guard 1: blank/nameless -> quarantine loudly, mirror only, never touch gold.
    if v_name is null then
      insert into plm.vendor_quarantine (sync_run_id, source_id, reason, payload)
      values (sync_id, v_code, 'blank vendorDesc', vrow);
      v_fail := v_fail + 1;
    else
      -- Guard 2: excluded code -> skip gold entirely (mirror only).
      select exists (
        select 1 from plm.vendor_exclusion e
        where e.source_system = 'coldlion' and e.source_table = 'vendors' and e.source_id = v_code
      ) into v_excluded;

      if v_excluded then
        v_skip := v_skip + 1;
      else
        -- Resolve canonical: (a) by source ref, else (b) by normalized name.
        select r.factory_id into v_factory_id
        from core.factory_source_ref r
        where r.source_system = 'coldlion' and r.source_table = 'vendors' and r.source_id = v_code;

        if v_factory_id is null then
          select f.id into v_factory_id
          from core.factory f
          where lower(regexp_replace(f.name, '\s+', ' ', 'g')) = lower(regexp_replace(v_name, '\s+', ' ', 'g'))
          order by f.created_at
          limit 1;
        end if;

        if v_factory_id is not null then
          -- MATCH: refresh non-status fields ONLY. Never status/name/display_name (app-owned).
          -- M1: core.factory has NO address column — refresh country + metadata only.
          update core.factory
          set country  = coalesce(country, v_country),
              metadata = metadata || jsonb_build_object('coldlion_vendor_code', v_code, 'coldlion_import_source', 'coldlion')
          where id = v_factory_id;
          v_upd := v_upd + 1;
        else
          -- NEW factory: status defaulted to 'active' on INSERT only. M2: code must be set,
          -- or the 2nd NULL-code insert in a run violates unique-nulls-not-distinct(code).
          begin
            insert into core.factory (name, code, status, country, metadata)
            values (v_name, v_code, 'active'::app.entity_status, v_country,
                    jsonb_build_object('coldlion_vendor_code', v_code, 'coldlion_import_source', 'coldlion'))
            returning id into v_factory_id;
            v_ins := v_ins + 1;
          exception when unique_violation then
            -- A row already carries this code — treat as a match (no re-split, no re-add).
            select f.id into v_factory_id from core.factory f where f.code = v_code limit 1;
            v_upd := v_upd + 1;
          end;
        end if;

        -- Provenance upsert (after we have the factory id; factory_id is NOT NULL).
        insert into core.factory_source_ref (factory_id, source_system, source_table, source_id, source_code, confidence, raw)
        values (v_factory_id, 'coldlion', 'vendors', v_code, v_code, 'verified', vrow)
        on conflict (source_system, source_table, source_id) do update
        set factory_id = excluded.factory_id, source_code = excluded.source_code,
            confidence = excluded.confidence, raw = excluded.raw;
      end if;
    end if;

    -- Silver mirror: faithful replica of every pulled row. factory_id = resolved id, and
    -- coalesce guarantees we NEVER null an existing curated link (e.g. ANT001's).
    insert into plm.erp_vendor (
      vendor_code, company_code, factory_id, name, active, address, phone, fax, email,
      country_code, pay_term_code, gl_code, separate_check, erp_created_at, erp_updated_at, raw, imported_at)
    values (
      v_code, nullif(vrow ->> 'companyCode', ''), v_factory_id, coalesce(v_name, v_code), v_active, v_address,
      nullif(vrow ->> 'phoneNo', ''), nullif(vrow ->> 'faxNo', ''), nullif(vrow ->> 'email', ''),
      v_country, nullif(vrow ->> 'payTermCode', ''), nullif(vrow ->> 'glCode', ''),
      nullif(vrow ->> 'separateCheck', ''), nullif(vrow ->> 'createdTime', '')::timestamptz,
      nullif(vrow ->> 'modTime', '')::timestamptz, vrow, now())
    on conflict (vendor_code) do update
    set company_code = excluded.company_code,
        factory_id   = coalesce(excluded.factory_id, plm.erp_vendor.factory_id),
        name = excluded.name, active = excluded.active, address = excluded.address,
        phone = excluded.phone, fax = excluded.fax, email = excluded.email,
        country_code = excluded.country_code, pay_term_code = excluded.pay_term_code,
        gl_code = excluded.gl_code, separate_check = excluded.separate_check,
        erp_created_at = excluded.erp_created_at, erp_updated_at = excluded.erp_updated_at,
        raw = excluded.raw, imported_at = excluded.imported_at;
  end loop;

  -- Snapshot reconciliation of SILVER only: drop mirror rows absent from this snapshot.
  -- Guaranteed safe — the empty-payload guard above means v_codes has >= 1 element, and
  -- gold (core.factory) is never touched here.
  delete from plm.erp_vendor where vendor_code <> all (v_codes);
  get diagnostics v_del = row_count;

  update ingest.sync_run
  set status = 'succeeded', finished_at = now(),
      rows_seen = v_seen, rows_inserted = v_ins, rows_updated = v_upd, rows_failed = v_fail,
      metadata = metadata || jsonb_build_object(
        'rows_inserted', v_ins, 'rows_updated', v_upd, 'rows_failed', v_fail,
        'rows_skipped_excluded', v_skip, 'rows_mirror_deleted', v_del)
  where id = sync_id;

  return query select sync_id, v_seen, v_ins, v_upd, v_fail, v_skip, v_del;
exception when others then
  -- NOTE: this rolls back with the aborted transaction (that is the PR #107 root cause).
  -- Durable failure recording is the CALLER's job via public.record_failed_sync_run().
  if sync_id is not null then
    update ingest.sync_run set status = 'failed', finished_at = now(), error = sqlerrm where id = sync_id;
  end if;
  raise;
end;
$$;

comment on function plm.sync_coldlion_vendors(jsonb) is
  'Guarded recurring importer for Coldlion /vendors -> core.factory. Enforces: Guard 1 (blank/nameless -> quarantine, never gold), Guard 2 (plm.vendor_exclusion -> skip gold), status-set-on-INSERT-only, upsert-by-source-id (no re-split/re-add), snapshot-safe (gold never deleted/inactivated by the feed), and in-function empty-payload + advisory-lock guards. Supersedes plm.import_coldlion_vendors.';

-- =====================================================================================
-- 4. public wrappers (AGENTS §8.1) — so a serverless caller needs the service-role key,
--    NOT a raw production DB password. plm/ingest are not PostgREST-exposed.
-- =====================================================================================
create or replace function public.sync_coldlion_vendors(vendors_payload jsonb)
returns table (
  sync_run_id uuid, rows_seen integer, rows_inserted integer, rows_updated integer,
  rows_failed integer, rows_skipped integer, rows_deleted integer)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_coldlion_vendors(vendors_payload);
end;
$$;

-- Durable-failure path (PR #107): a committed failed sync_run row in ITS OWN transaction,
-- reachable without exposing the ingest schema. The caller invokes this on any error.
create or replace function public.record_failed_sync_run(p_source_name text, p_error text, p_stage text)
returns uuid
language plpgsql
security definer
set search_path = public, ingest
as $$
declare v_id uuid;
begin
  insert into ingest.sync_run (source_system, source_name, status, started_at, finished_at, error, metadata)
  values ('coldlion', coalesce(p_source_name, 'coldlion_vendors_api'), 'failed', now(), now(),
          left(coalesce(p_error, ''), 4000),
          jsonb_build_object('recorded_by', 'record_failed_sync_run', 'stage', coalesce(p_stage, 'unknown')))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.sync_coldlion_vendors(jsonb)               from public;
revoke all on function public.record_failed_sync_run(text, text, text)  from public;
revoke all on function plm.sync_coldlion_vendors(jsonb)                  from public;
grant execute on function public.sync_coldlion_vendors(jsonb)              to service_role;
grant execute on function public.record_failed_sync_run(text, text, text) to service_role;
grant execute on function plm.sync_coldlion_vendors(jsonb)                 to service_role;

-- =====================================================================================
-- 5. api read functions (S6) — surface quarantine / exclusions / recent runs to the admin
--    app (plm + ingest are not PostgREST-exposed). Admin-gated SECURITY DEFINER.
-- =====================================================================================
create or replace function api.vendor_quarantine_list()
returns setof plm.vendor_quarantine
language sql stable security definer
set search_path = api, plm, app
as $$
  select * from plm.vendor_quarantine
  where app.has_role('administrator')
  order by created_at desc;
$$;

create or replace function api.vendor_exclusion_list()
returns setof plm.vendor_exclusion
language sql stable security definer
set search_path = api, plm, app
as $$
  select * from plm.vendor_exclusion
  where app.has_role('administrator')
  order by source_id;
$$;

create or replace function api.vendor_sync_run_list(p_limit integer default 50)
returns setof ingest.sync_run
language sql stable security definer
set search_path = api, ingest, app
as $$
  select * from ingest.sync_run
  where app.has_role('administrator')
    and source_name = 'coldlion_vendors_api'
  order by started_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function api.vendor_quarantine_list()      from public;
revoke all on function api.vendor_exclusion_list()       from public;
revoke all on function api.vendor_sync_run_list(integer) from public;
grant execute on function api.vendor_quarantine_list()      to authenticated, service_role;
grant execute on function api.vendor_exclusion_list()       to authenticated, service_role;
grant execute on function api.vendor_sync_run_list(integer) to authenticated, service_role;

-- =====================================================================================
-- 6. Retire the curation-clobbering importer so nobody calls it by mistake.
-- =====================================================================================
drop function if exists plm.import_coldlion_vendors(jsonb);
