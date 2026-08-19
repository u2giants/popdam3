-- =====================================================================================
-- Issue #1184 — Coldlion raw landing layer, PHASE 1 of 6: THE SPINE.
--
-- Spec: docs/coldlion-raw-landing-schema-design.md (§2.4 and §5 step 1).
-- Companions: docs/coldlion-erp-api-reference.md, docs/coldlion-history-endpoints-shape.md.
--
-- WHAT THIS IS
-- ------------
-- The `coldlion` schema plus the three bookkeeping tables that every later feed table
-- hangs off. Nothing lands without them:
--
--   coldlion.sync_run       one row per pull from one Coldlion endpoint
--   coldlion.window_ledger  one row per 7-day window of the two capped history feeds
--   coldlion.change_log     one row per observed change to a current-state landing row
--
-- THIS MIGRATION CREATES NO FEED TABLES. Phases 2 to 6 add those, each in its own
-- migration, each referencing coldlion.sync_run(id).
--
-- WHAT THIS LAYER MUST NEVER BECOME (spec §1, owner direction 2026-08-18)
-- ----------------------------------------------------------------------
--   * NO foreign keys into core.* or any other curated table. There are none here and
--     none may be added later. This layer is evidence, not curation.
--   * NO resolution or matching columns (resolution_status, licensor_id, resolved_by).
--     Those belong to the staging layer (plm.erp_*) or to a future promotion step.
--   * NO grants to application roles. No application ever reads these tables. Read
--     access is for loaders (service_role), the DB admin tool, and audits.
--   * NO invented structure. Coldlion has no licensor-to-property link and no active
--     flag; nothing here models either.
--
-- THREE SOURCE RULES THE SPINE ENFORCES OR CARRIES FORWARD
-- -------------------------------------------------------
--   1. The complete original payload is kept in a `raw` jsonb column alongside typed
--      columns. On the spine, the payloads recorded are the before/after evidence in
--      coldlion.change_log (`previous_raw` / `new_raw`) and the request parameters in
--      coldlion.sync_run (`request_params`). Every one of them is a jsonb object and is
--      constrained as such.
--   2. `1900-01-01` is Coldlion's empty-date marker (owner-confirmed 2026-08-14). Typed
--      date columns store NULL and `raw` keeps the original. The spine has no source
--      date columns, but coldlion.window_ledger's request window is guarded against the
--      marker so it can never be pulled as if it were a real date.
--   3. Merch-group identity is four-part (company, division, mg_type_code, mg_code) and
--      `mgCode` collides across types inside one division (`1P` is both a licensor and a
--      property in CW001). coldlion.change_log therefore carries the natural key as a
--      jsonb OBJECT, not a concatenated string, so a four-part key is recorded whole and
--      `05` is never assumed to mean Licensor anywhere in this migration.
-- =====================================================================================

create schema if not exists coldlion;

comment on schema coldlion is
  'Raw landing layer for the Coldlion ERP API (issue #1184). A faithful, replayable copy of what the API returned: one table per grain, columns named after Coldlion field names, every row keeping its complete original payload in `raw`. No foreign keys into core.*, no resolution columns, no invented relationships, and NO GRANTS TO APPLICATION ROLES - no application ever reads this schema. DesignFlow PLM is not in this path (owner direction, 2026-08-18). Design: docs/coldlion-raw-landing-schema-design.md.';

-- -------------------------------------------------------------------------------------
-- 1. coldlion.sync_run - one row per pull (spec §2.4)
-- -------------------------------------------------------------------------------------
--
-- ingest.sync_run stays where it is and keeps serving other sources. Coldlion pulls use
-- this table instead because they need endpoint-specific request parameters - above all
-- the fromDate/toDate window of the two history feeds - and because a Coldlion refusal
-- has a shape no generic ledger can record honestly:
--
--   THE MALFORMED ERROR CONTRACT (verified 2026-08-17, history-shape doc §2). A refused
--   history request arrives as HTTP 400 ON THE WIRE while the JSON body says
--   "status": 500 / "error": "Internal Server Error". A loader that trusts the body
--   classifies a permanent, self-inflicted input error as a transient server fault and
--   retries it forever. Both numbers are recorded separately - `http_status` is the wire
--   status and is the one to branch on; `body_status` is what the body claimed and is
--   kept because it is evidence of their contract, not a fact about the request.

create table if not exists coldlion.sync_run (
  id uuid primary key default gen_random_uuid(),

  -- The Coldlion path exactly as called, e.g. '/prodHistory', '/merchGroupDetails'.
  -- Deliberately not an enum: Coldlion has changed shape three times in a month and a
  -- new endpoint must be loggable the day it appears, not one migration later.
  endpoint text not null,
  company_code text,
  division_code text,

  -- The complete request as sent, including paging and every filter. This is the
  -- `raw` principle applied to the request side: a run can be reproduced from this
  -- column alone.
  request_params jsonb not null default '{}'::jsonb,

  -- Populated only for the two capped history endpoints. Both or neither.
  window_from date,
  window_to   date,

  status ingest.sync_status not null default 'pending',
  requested_by text not null,

  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,

  -- See the malformed-error note above.
  http_status integer,
  body_status integer,

  rows_fetched   integer,
  rows_inserted  integer not null default 0,
  rows_updated   integer not null default 0,
  rows_unchanged integer not null default 0,

  error_message text,
  notes text,
  created_at timestamptz not null default now(),

  constraint coldlion_sync_run_endpoint_not_blank
    check (length(btrim(endpoint)) > 0),
  constraint coldlion_sync_run_endpoint_is_path
    check (endpoint like '/%'),
  constraint coldlion_sync_run_requested_by_not_blank
    check (length(btrim(requested_by)) > 0),
  constraint coldlion_sync_run_request_params_is_object
    check (jsonb_typeof(request_params) = 'object'),

  -- A window is a pair or it is nothing. Half a window cannot be replayed.
  constraint coldlion_sync_run_window_is_a_pair
    check ((window_from is null) = (window_to is null)),
  constraint coldlion_sync_run_window_ordered
    check (window_from is null or window_to >= window_from),
  -- Coldlion's own hard cap since 2026-08-17: fromDate and toDate must be within
  -- 7 days INCLUSIVE. Anything wider is refused outright. Recording a wider window
  -- would be recording a request that cannot have succeeded.
  constraint coldlion_sync_run_window_within_seven_days
    check (window_from is null or (window_to - window_from) <= 6),
  -- 1900-01-01 is Coldlion's empty-date marker, never a real date to request.
  constraint coldlion_sync_run_window_not_empty_date_marker
    check (window_from is null or window_from > date '1900-01-01'),

  constraint coldlion_sync_run_counts_non_negative
    check (
      (rows_fetched is null or rows_fetched >= 0)
      and rows_inserted >= 0 and rows_updated >= 0 and rows_unchanged >= 0
    ),
  constraint coldlion_sync_run_duration_non_negative
    check (duration_ms is null or duration_ms >= 0),
  constraint coldlion_sync_run_finished_after_started
    check (finished_at is null or finished_at >= started_at),
  -- No silent failures: a failed run must say why.
  constraint coldlion_sync_run_failed_has_message
    check (status <> 'failed' or error_message is not null)
);

create index if not exists coldlion_sync_run_endpoint_started_idx
  on coldlion.sync_run (endpoint, started_at desc);

create index if not exists coldlion_sync_run_status_started_idx
  on coldlion.sync_run (status, started_at desc);

create index if not exists coldlion_sync_run_window_idx
  on coldlion.sync_run (endpoint, window_from, window_to)
  where window_from is not null;

comment on table coldlion.sync_run is
  'One row per pull from one Coldlion API endpoint: the path called, the complete request parameters, the 7-day window for the two history feeds, status, row counts, timings and error text. Every landing table in this schema references it, so any row can be traced back to the exact request that produced it. ingest.sync_run is unchanged and still serves other sources. Issue #1184 phase 1.';

comment on column coldlion.sync_run.request_params is
  'The complete request as sent, unmodified - the `raw` principle applied to the request side. A run can be reproduced from this column alone.';
comment on column coldlion.sync_run.http_status is
  'The status ON THE WIRE. Branch on this. A refused history window arrives as HTTP 400 on the wire while the body claims 500 (verified 2026-08-17); a loader that trusts the body retries a permanent input error forever.';
comment on column coldlion.sync_run.body_status is
  'The status the JSON body claimed. Evidence of Coldlion''s malformed error contract, never a fact about the request. Never branch on this.';
comment on column coldlion.sync_run.window_from is
  'fromDate for /prodHistory and /orderHistory only; NULL on every other endpoint. Constrained to a maximum 7-day inclusive span because Coldlion refuses anything wider, and constrained above 1900-01-01 because that value is Coldlion''s empty-date marker, not a date.';

-- -------------------------------------------------------------------------------------
-- 2. coldlion.window_ledger - one row per 7-day history window (spec §2.4)
-- -------------------------------------------------------------------------------------
--
-- /prodHistory and /orderHistory are NOT PAGED - they return a plain array and silently
-- ignore `page`/`size`, so a paging loop re-fetches the same rows forever. Chunking is by
-- date window only, and a window is all-or-nothing. This table is what makes a multi-year
-- backfill resumable and what proves no window was skipped or double-counted.
--
-- Windows advance by exactly 7 days: toDate = fromDate + 6. That is enforced as an
-- equality, not a maximum, so a short window cannot be recorded as if it covered a full
-- one and leave an invisible gap either side.
--
-- KNOWN LIMIT, STATED RATHER THAN HIDDEN: the unique key stops two rows sharing a start
-- date, and the exact width stops a ragged window, but two windows on DIFFERENT 7-day
-- grids (Jan 1-7 and Jan 3-9) would still overlap and double-count. Enforcing that in the
-- database needs a daterange EXCLUDE constraint, which needs the btree_gist extension -
-- an object outside this issue's claim. Until that is added, the loader must advance by
-- exactly 7 days from a single fixed start per endpoint, and the ledger is the record
-- that proves whether it did.
--
-- The backfill run itself is deliberately NOT part of this issue.

create table if not exists coldlion.window_ledger (
  id uuid primary key default gen_random_uuid(),

  -- Only the two capped history endpoints have windows at all. This list names
  -- endpoints, which are stable API paths - it is not a taxonomy code and carries none
  -- of the mg_type_code hazard.
  endpoint text not null,
  company_code text not null,

  window_from date not null,
  window_to   date not null,

  state text not null default 'pending',
  attempt_count integer not null default 0,

  last_run_id uuid references coldlion.sync_run(id) on delete set null,
  row_count integer,

  first_attempted_at timestamptz,
  loaded_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coldlion_window_ledger_endpoint_allowed
    check (endpoint in ('/prodHistory', '/orderHistory')),
  constraint coldlion_window_ledger_company_not_blank
    check (length(btrim(company_code)) > 0),
  constraint coldlion_window_ledger_state_allowed
    check (state in ('pending', 'running', 'loaded', 'failed')),

  -- Exactly seven days, inclusive. Not "at most".
  constraint coldlion_window_ledger_window_is_seven_days
    check (window_to = window_from + 6),
  constraint coldlion_window_ledger_window_not_empty_date_marker
    check (window_from > date '1900-01-01'),

  constraint coldlion_window_ledger_attempts_non_negative
    check (attempt_count >= 0),
  constraint coldlion_window_ledger_row_count_non_negative
    check (row_count is null or row_count >= 0),

  -- No silent failures, and no silent successes either.
  constraint coldlion_window_ledger_failed_has_error
    check (state <> 'failed' or last_error is not null),
  constraint coldlion_window_ledger_loaded_is_evidenced
    check (state <> 'loaded' or (row_count is not null and loaded_at is not null and last_run_id is not null)),

  constraint coldlion_window_ledger_identity_unique
    unique (endpoint, company_code, window_from)
);

create index if not exists coldlion_window_ledger_state_idx
  on coldlion.window_ledger (endpoint, state, window_from);

create index if not exists coldlion_window_ledger_last_run_idx
  on coldlion.window_ledger (last_run_id);

comment on table coldlion.window_ledger is
  'One row per 7-day window per capped history endpoint (/prodHistory, /orderHistory), with its state: pending, running, loaded or failed. This is what makes a multi-year backfill resumable and what proves no window was skipped or double-counted. Those two endpoints are NOT paged - `page`/`size` are silently ignored, so chunking is by date window only and a window is all-or-nothing. Windows advance by exactly 7 days (toDate = fromDate + 6), enforced as an equality. LIMIT: two windows on different 7-day grids would still overlap; a daterange EXCLUDE constraint needs btree_gist, which is outside issue #1184''s object claim. Issue #1184 phase 1.';

comment on column coldlion.window_ledger.state is
  'pending -> running -> loaded or failed. A loaded window must carry its row count, its load time and the run that loaded it; a failed window must carry its error. Neither can be recorded silently.';

drop trigger if exists set_updated_at on coldlion.window_ledger;
create trigger set_updated_at
  before update on coldlion.window_ledger
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------------------------------
-- 3. coldlion.change_log - the change trail for current-state tables (spec §2.2)
-- -------------------------------------------------------------------------------------
--
-- Current-state (master) landing tables upsert on their natural key and bump
-- `last_seen_at`. That keeps the latest truth but would destroy the previous truth, so
-- every observed change writes a row here FIRST, carrying both complete payloads. A
-- dispute can then be settled against the original bytes on either side of the change.
--
-- WHY THE NATURAL KEY IS A JSONB OBJECT AND NOT A STRING. The keys of this schema are
-- not one shape: customers are two-part, merch-group details are FOUR-part
-- (company, division, mg_type_code, mg_code), item SKUs are five-part. Flattening any of
-- them into one text column loses which part is which, and the merch-group case is
-- exactly where that costs real money - `mgCode` collides across types inside one
-- division, so `1P` is both a licensor and a property in CW001. An object records the
-- whole key with each part named, and nothing in this schema ever has to assume that
-- `05` means Licensor.

create table if not exists coldlion.change_log (
  id uuid primary key default gen_random_uuid(),

  -- The current-state table the change was observed on, unqualified, e.g. 'customer'.
  table_name text not null,

  -- Every part of that table's natural key, named. See the note above.
  natural_key jsonb not null,

  change_kind text not null,

  -- SHA-256, lowercase hex, of the row's complete `raw` payload. This layer commits to
  -- one hash algorithm on purpose: a mix of md5 and sha256 across feeds makes an
  -- unchanged row indistinguishable from a differently-hashed one, which is a silent
  -- failure with no symptom. Phases 2 to 6 must use the same.
  previous_source_hash text,
  new_source_hash text not null,

  -- The complete original payloads, both sides of the change. The evidence.
  previous_raw jsonb,
  new_raw jsonb not null,

  run_id uuid not null references coldlion.sync_run(id),
  changed_at timestamptz not null default now(),

  constraint coldlion_change_log_table_not_blank
    check (length(btrim(table_name)) > 0),
  constraint coldlion_change_log_table_is_normalised
    check (table_name = lower(btrim(table_name))),

  constraint coldlion_change_log_natural_key_is_object
    check (jsonb_typeof(natural_key) = 'object'),
  constraint coldlion_change_log_natural_key_not_empty
    check (natural_key <> '{}'::jsonb),

  constraint coldlion_change_log_kind_allowed
    check (change_kind in ('inserted', 'updated')),

  constraint coldlion_change_log_new_raw_is_object
    check (jsonb_typeof(new_raw) = 'object'),
  constraint coldlion_change_log_previous_raw_is_object
    check (previous_raw is null or jsonb_typeof(previous_raw) = 'object'),

  constraint coldlion_change_log_new_hash_is_sha256
    check (new_source_hash ~ '^[0-9a-f]{64}$'),
  constraint coldlion_change_log_previous_hash_is_sha256
    check (previous_source_hash is null or previous_source_hash ~ '^[0-9a-f]{64}$'),

  -- A first sighting has no previous side; an update has one, and it must differ.
  -- A "change" whose hashes match is not a change and must not be recordable.
  constraint coldlion_change_log_inserted_has_no_previous
    check (change_kind <> 'inserted' or (previous_source_hash is null and previous_raw is null)),
  constraint coldlion_change_log_updated_has_previous
    check (
      change_kind <> 'updated'
      or (
        previous_source_hash is not null
        and previous_raw is not null
        and previous_source_hash <> new_source_hash
      )
    )
);

create index if not exists coldlion_change_log_table_changed_idx
  on coldlion.change_log (table_name, changed_at desc);

create index if not exists coldlion_change_log_run_idx
  on coldlion.change_log (run_id);

create index if not exists coldlion_change_log_natural_key_idx
  on coldlion.change_log using gin (natural_key jsonb_path_ops);

comment on table coldlion.change_log is
  'One row per observed change to a current-state (master) landing row in this schema, carrying the complete payload on BOTH sides of the change. Current-state tables upsert on their natural key, which would otherwise destroy the previous truth. `natural_key` is a jsonb OBJECT because the keys here are two-, four- and five-part - merch-group identity is four-part (company, division, mg_type_code, mg_code) and mgCode collides across types inside one division, so a flattened key would lose exactly the part that disambiguates it. `05` is never assumed to mean Licensor. Hashes are SHA-256 lowercase hex throughout. Issue #1184 phase 1.';

comment on column coldlion.change_log.natural_key is
  'Every part of the source table''s natural key, named, as a jsonb object - e.g. {"company_code":"EDGEHOME","division_code":"CW001","mg_type_code":"05","mg_code":"1P"}. Never a concatenated string.';
comment on column coldlion.change_log.new_source_hash is
  'SHA-256 (lowercase hex) of the complete `raw` payload. One algorithm across the whole schema on purpose: mixing hash algorithms makes an unchanged row indistinguishable from a differently-hashed one, and that failure has no symptom.';

-- -------------------------------------------------------------------------------------
-- 4. Access - loaders and audits only, never an application
-- -------------------------------------------------------------------------------------
--
-- Owner direction 2026-08-18: no application ever reads these tables. RLS is enabled with
-- NO POLICIES, so every non-bypassing role sees nothing even if a grant is ever added by
-- accident; the grants are revoked as well, so both halves say the same thing. anon and
-- authenticated are the application roles and are named explicitly rather than being left
-- to inherit from PUBLIC.
--
-- Default privileges are set on the schema too. Section 10.2 of AGENTS.md and issue #649
-- are the reason: a schema whose DEFAULT privileges are open re-opens itself on the next
-- table somebody creates, and nobody notices because the tables that exist today are
-- correct.

revoke all on schema coldlion from public;
revoke all on schema coldlion from anon, authenticated;
grant usage on schema coldlion to service_role;

alter table coldlion.sync_run      enable row level security;
alter table coldlion.window_ledger enable row level security;
alter table coldlion.change_log    enable row level security;

revoke all on table coldlion.sync_run      from public, anon, authenticated;
revoke all on table coldlion.window_ledger from public, anon, authenticated;
revoke all on table coldlion.change_log    from public, anon, authenticated;

grant all on table coldlion.sync_run      to service_role;
grant all on table coldlion.window_ledger to service_role;
grant all on table coldlion.change_log    to service_role;

alter default privileges in schema coldlion revoke all on tables    from public;
alter default privileges in schema coldlion revoke all on tables    from anon, authenticated;
alter default privileges in schema coldlion revoke all on sequences from public;
alter default privileges in schema coldlion revoke all on sequences from anon, authenticated;
alter default privileges in schema coldlion revoke all on functions from public;
alter default privileges in schema coldlion revoke all on functions from anon, authenticated;
