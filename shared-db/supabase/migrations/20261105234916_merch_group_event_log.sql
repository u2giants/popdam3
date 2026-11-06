-- Claim and work issue #5809 (popcre/designflow-data-syncing #117).
-- One row per merch-group change event ColdLion pushes to the data-syncing
-- endpoint POST /api/coldlion/merch-group-events. event_id is ColdLion's
-- eventId; a second delivery of the same eventId is a replay and is ignored
-- by the service. Follows the coldlion raw-landing spine (20260818232639):
-- service_role only, RLS enabled with no policies, no application grants.
-- derived-from: none
create table coldlion.merch_group_event_log (
  id uuid primary key default gen_random_uuid(),

  -- ColdLion's eventId, unique per event (idempotency key).
  event_id text not null unique,

  received_at timestamptz not null default now(),
  occurred_at timestamptz,

  action text not null,
  company text not null,
  division text not null,
  mg_type_code text not null,
  mg_code text not null,
  mg_category text not null default '',
  previous_key jsonb,

  -- The complete original event payload. The evidence.
  payload jsonb not null,

  -- received (accepted, not yet processed) -> applied | ignored | held;
  -- record_only when production runs record-only and writes nothing.
  status text not null,
  reason text,
  rows_touched jsonb,
  processed_at timestamptz,

  constraint coldlion_merch_group_event_log_action_allowed
    check (action in ('created','updated','inactivated','reactivated','deleted')),
  constraint coldlion_merch_group_event_log_status_allowed
    check (status in ('received','applied','ignored','held','record_only')),
  constraint coldlion_merch_group_event_log_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint coldlion_merch_group_event_log_previous_key_is_object
    check (previous_key is null or jsonb_typeof(previous_key) = 'object'),
  constraint coldlion_merch_group_event_log_rows_touched_is_array
    check (rows_touched is null or jsonb_typeof(rows_touched) = 'array')
);

comment on table coldlion.merch_group_event_log is
  'One row per merch-group change event ColdLion pushes to POST /api/coldlion/merch-group-events (designflow-data-syncing #117). event_id is ColdLion''s eventId; replays of the same eventId are ignored. status: received (accepted, not yet processed), applied, ignored (replay, out-of-order or no-op), held (safety rule stopped it), record_only (record-only mode computed the outcome but wrote nothing). rows_touched lists merchGroup mg_id values the event changed.';

-- Staff question "what did ColdLion change for code X": key lookup, newest first.
create index merch_group_event_log_key_idx
  on coldlion.merch_group_event_log (division, mg_type_code, mg_code, mg_category, received_at desc);
-- Missed-call detection and retention checks walk by arrival time.
create index merch_group_event_log_received_at_idx
  on coldlion.merch_group_event_log (received_at desc);

alter table coldlion.merch_group_event_log enable row level security;

revoke all on table coldlion.merch_group_event_log from anon, authenticated;
grant all on table coldlion.merch_group_event_log to service_role;
