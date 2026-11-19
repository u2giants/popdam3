-- Fireflies meeting-note transcript uniqueness + worker retry parking.
-- Claim: popcrm-web issue #68, comment 7000445591 (2026-11-19).
-- Objects: new unique partial index crm_meeting_note_fireflies_transcript_uidx
--          on crm.meeting_note(fireflies_transcript_id);
--          new table crm.fireflies_retry (worker-private).
--
-- (a) The Fireflies webhook can redeliver a transcript. The ingest path is
-- idempotent on meeting id today but nothing stops two meeting_note rows from
-- sharing one fireflies_transcript_id, which shows up as duplicated meetings
-- or a silent lost update. Production verified read-only 2026-11-19: 28 rows
-- with a transcript id, ZERO duplicate values, so the unique index creates
-- itself without conflict. Partial (where not null): legacy rows without a
-- transcript id stay legal.
--
-- (b) A transcript that fails to fetch/parse is currently dropped on the
-- floor. crm.fireflies_retry parks the raw webhook payload so the worker can
-- retry with backoff and keep the failure visible (attempts, last_error).
-- Worker-private, the crm.worker_delta_cursor pattern (20260812010000): RLS
-- enabled AND forced with ZERO policies, every browser-role grant revoked.
-- Unlike worker_delta_cursor there is no RPC layer (yet): the worker is the
-- only reader/writer, so it keeps direct table privileges through its
-- service_role key, which the crm default ACL already grants a new table --
-- re-issued explicitly below so the contract does not depend on the default
-- ACL. service_role has BYPASSRLS (verified 2026-08-11, worker_delta_cursor
-- notes), so RLS does not block it; browser roles are stopped by BOTH the
-- empty policy set and the revokes.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA. Rows arrive at runtime from the
-- popcrm-web Fireflies webhook/worker.
-- derived-from: none
-- (the security pattern follows 20260812010000).

-- (a) One meeting note per Fireflies transcript, forever.
create unique index if not exists crm_meeting_note_fireflies_transcript_uidx
  on crm.meeting_note (fireflies_transcript_id)
  where fireflies_transcript_id is not null;

-- (b) Retry parking for failed Fireflies transcript fetches.
create table if not exists crm.fireflies_retry (
  meeting_id text primary key,
  payload jsonb not null,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table crm.fireflies_retry is
'Fireflies webhook retry parking: one row per meeting_id whose transcript fetch/parse failed, holding the raw payload for the popcrm-web worker to retry with backoff. Worker-private: RLS enabled and FORCED with zero policies; public/anon/authenticated fully revoked; only the worker (service_role) reads and writes it directly.';

comment on column crm.fireflies_retry.meeting_id is
'Fireflies meeting id from the webhook. Primary key: one retry entry per meeting, redeliveries upsert.';
comment on column crm.fireflies_retry.payload is
'The raw webhook payload exactly as received, retried verbatim. Never parsed here.';
comment on column crm.fireflies_retry.attempts is
'How many retry attempts have been made. Monotonic; the worker owns the increment.';
comment on column crm.fireflies_retry.last_error is
'Last failure reason, truncated by the worker. Diagnostic only.';

revoke all on crm.fireflies_retry from public;
revoke all on crm.fireflies_retry from anon;
revoke all on crm.fireflies_retry from authenticated;
revoke all on crm.fireflies_retry from service_role;
grant select, insert, update, delete on crm.fireflies_retry to service_role;

-- Deny-everything for every role without BYPASSRLS; owner included.
alter table crm.fireflies_retry enable row level security;
alter table crm.fireflies_retry force row level security;
