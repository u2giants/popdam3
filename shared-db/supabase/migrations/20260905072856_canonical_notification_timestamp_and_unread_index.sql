-- Issue #2204 — DesignFlow notifications: canonical timestamp, linkage, and unread index.
--
-- Database package 3 of 3 for popcre/designflow-backend#81. Package 2 (#2202,
-- migration 20260904143518) already added `workflow_action_id`, `idempotency_key`,
-- the FK to dflow.item_workflow_action, and the per-recipient / per-key unique
-- indexes to app.user_notification. Two gaps remained, and this migration closes
-- exactly those two:
--
--   1. `app.user_notification.created_date` is `date`. Two notifications created on
--      the same day cannot be ordered against each other, so the newest-first list
--      the frontend renders is not deterministic.
--   2. The partial unread index added by 20260827132637 sits on the LEGACY
--      `dflow.user_notification` table. The backend maps notification reads to the
--      canonical `app.user_notification`, so the application's unread list/count
--      path is not accelerated at all.
--
-- Additive only (§4 rule 3). `created_date` is NOT altered, NOT retyped and NOT
-- dropped: every application, view and function that reads or writes it keeps
-- working unchanged, and existing task/mention/legacy rows and their read state are
-- untouched. The new `created_at` column carries the precision going forward.
--
-- The action link is already sufficient for the RFQ deep link: workflow_action_id ->
-- dflow.item_workflow_action.rfq_item_id is the immutable RFQ item identity the
-- frontend resolves. No price, customer-private text or note is copied into a
-- notification row, and none is added here.

-- ---------------------------------------------------------------------------------
-- 1. True timestamp precision for canonical notifications.
-- ---------------------------------------------------------------------------------

alter table app.user_notification
  add column if not exists created_at timestamptz;

-- Legacy backfill. A stored `date` carries no time-of-day, so every legacy row of a
-- given day is placed at the SAME instant — UTC midnight of its own date. That
-- preserves the day the row records and refuses to invent a within-day order that
-- the source data never held; same-day legacy rows tie, and the id tie-breaker in
-- the index below resolves them deterministically without pretending to know which
-- was really first.
--
-- A row with no `created_date` at all has no day to preserve. There were zero such
-- rows in production on 2026-09-05 (105,241 rows, 0 null dates, 2022-03-29 through
-- 2026-07-10), but the coalesce keeps this migration deterministic instead of
-- failing at SET NOT NULL: the epoch is an obviously synthetic floor that sorts
-- oldest and can never make an undated legacy row masquerade as recent.
update app.user_notification
   set created_at = coalesce(
         (created_date::timestamp at time zone 'UTC'),
         to_timestamp(0)
       )
 where created_at is null;

alter table app.user_notification
  alter column created_at set default now();

alter table app.user_notification
  alter column created_at set not null;

comment on column app.user_notification.created_at is
  'Canonical creation instant with true timestamp precision. New rows default to now(); legacy rows were backfilled to UTC midnight of created_date, which preserves the recorded day without inventing a within-day order. created_date is retained unchanged for existing readers.';

-- ---------------------------------------------------------------------------------
-- 2. The canonical unread index, on the table the application actually reads.
-- ---------------------------------------------------------------------------------
--
-- Partial on `unread = true` so read notifications stay out of the index entirely;
-- leading `user_id_fk` serves the per-user unread count and the mark-all path;
-- `created_at desc, id desc` serves a bounded newest-first list in index order with
-- no sort, and the trailing id makes same-instant rows (all backfilled legacy rows
-- of one day, or two rows written in the same transaction) deterministic.
create index if not exists user_notification_unread_user_created_idx
  on app.user_notification (user_id_fk, created_at desc, id desc)
  where unread = true;

comment on index app.user_notification_unread_user_created_idx is
  'Issue #2204: bounded newest-first per-user unread reads and counts on the canonical application notification table. The id tie-breaker keeps same-instant rows deterministically ordered.';
