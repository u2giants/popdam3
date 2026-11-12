-- Claim and work issue #6128 (popcre/designflow-data-syncing #103).
-- Widen the two CHECK constraints on coldlion.merch_group_event_log so the
-- repair-plan journal/undo machinery and the stored off flag can write rows:
--   action 'journal'   — a journaled change entry (helpers/merchGroupJournal.js)
--   action 'undo'      — an undo marker for a run (helpers/merchGroupJournal.js)
--   action 'off-flag'  — the stored off flag set by the automatic check
--                        (helpers/merchGroupSwitch.js)
--   status 'off'       — stored off flag is set (helpers/merchGroupSwitch.js)
--   status 'on'        — stored off flag cleared (helpers/merchGroupSwitch.js)
-- Existing values are kept exactly; nothing else about the table changes.
-- Widening a CHECK is additive: every previously valid row and write stays
-- valid.
-- derived-from: 20261105234916

alter table coldlion.merch_group_event_log
  drop constraint if exists coldlion_merch_group_event_log_action_allowed;
alter table coldlion.merch_group_event_log
  drop constraint if exists coldlion_merch_group_event_log_status_allowed;

alter table coldlion.merch_group_event_log
  add constraint coldlion_merch_group_event_log_action_allowed
    check (action in (
      'created', 'updated', 'inactivated', 'reactivated', 'deleted',
      'journal', 'undo', 'off-flag'
    ));

alter table coldlion.merch_group_event_log
  add constraint coldlion_merch_group_event_log_status_allowed
    check (status in (
      'received', 'applied', 'ignored', 'held', 'record_only',
      'off', 'on'
    ));
