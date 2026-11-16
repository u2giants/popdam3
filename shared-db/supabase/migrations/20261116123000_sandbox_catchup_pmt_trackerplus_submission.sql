-- #6356 sandbox catch-up batch 1, table-ACL companion to 20261115133704: DesignFlow sandbox
-- (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Restores the source migration's table privilege block (20260910155753 lines 337-346) that the
-- batch-1 port dropped (review finding #6359 finding 1). The tables, loaders and their function
-- ACLs stay in 20261115133704 (the merged #6357/#6362 copy, unmodified); this version carries
-- only the append-only table ACLs, so it applies after that version whether that version already
-- ran or not. Re-versioned off 20261115133704 because a duplicate 14-digit stamp silently skips
-- one of the two files (standing fact 4).
-- derived-from: 20261115133704

revoke all on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from public, anon;
grant select on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property to authenticated;
grant select, insert on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property to service_role;
revoke update, delete, truncate on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from service_role, authenticated;
revoke insert on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from authenticated;
