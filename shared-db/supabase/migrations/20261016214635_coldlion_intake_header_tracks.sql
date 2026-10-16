-- ColdLion /orderHistory gained createdFrom/createdTo and modifiedFrom/modifiedTo
-- (sales order header timestamps, ColdLion 2026-10-16). The order-intake poll adds two
-- tracks that use them: 'created' and 'modified'. Each run records one bookkeeping row
-- per header track whose from_date/to_date are the HEADER filter range (at most 7 days
-- inclusive, so the existing span checks on this table and coldlion.sync_run hold); the
-- wide start-date window the vendor still requires is kept in sync_run.request_params.

alter table coldlion.intake_window_state
  drop constraint coldlion_intake_window_state_track_domain;

alter table coldlion.intake_window_state
  add constraint coldlion_intake_window_state_track_domain
  check (track in ('trailing', 'forward', 'created', 'modified'));

comment on table coldlion.intake_window_state is
  'Unsealed per-window bookkeeping for the ColdLion order-intake poll (issue #3679). One row per scanned 7-day grid window per start-date track (trailing, forward), plus one row per run per header track (created, modified; issue #4405) keyed by the header created/modified filter range, at most 7 days inclusive. Deliberately NOT the sealed window_ledger: it never locks a window, and the current/open week is scanned repeatedly. Forward-track stop rule: two consecutive from_date-months staging zero new rows (Settled 2026-09-17), bounded by the 18-month hard cap that is this plan''s own decision, not part of the ruling.';
