-- Promotable re-issue of the Fireflies transcript unique index + retry table.
-- Claim: popcrm-web issue #68, comment 7000445591 (the object's claim thread),
-- folded into popcre/shared-db#6820 (CRM audit fixes batch), comment
-- 7010998738 (2026-11-19). Version 20261225010106 reserved atomically
-- (refs/db-claims).
--
-- WHY A RE-ISSUE: 20261223010103 (PR #6818) was rehearsed on preview outside
-- the dispatch lane, so preview's ledger holds the version while NO dispatched
-- preview run exists for it; the historical-recovery gate can never prove it
-- and the never-reapply guard refuses a fresh preview apply (runs 44532807597,
-- 44533994147, 44535389768). Stranded-promotion repair: fix-forward under a
-- new version, scoped to this claim's own objects.
--
-- CONTENT: byte-identical re-issue of 20261223010103, which is already
-- idempotent (create unique index if not exists, create table if not exists,
-- comment/revoke/grant/alter statements safe to replay). Preview: no-op (the
-- index and table already exist there). Production: creates both. SCHEMA
-- ONLY, loads no data; rows arrive at runtime from the popcrm-web Fireflies
-- webhook/worker.
--
-- The index, table and comments below are written from scratch (IF NOT
-- EXISTS everywhere), so this file depends on no earlier rewrite and
-- declares no base.
-- derived-from: none

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
