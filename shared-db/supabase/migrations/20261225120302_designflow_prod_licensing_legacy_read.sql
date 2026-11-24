-- #4707 Lane G follow-up (claim #7078): the canonical read paths compare plm.*
-- against the live legacy rows in dflow_prod (designflow-tracking
-- helpers/plmLicensingReadPath.js readLegacy, designflow-backend
-- services/designflowItemRead.service.js loadLegacy, designflow-item-master
-- item_detail milestone ids). Those runtimes lacked SELECT on some of them.
-- The plm."licensingStatus"/"licensingMilestone"/"licensingFeedbackReply"
-- tables are stale snapshot copies with no row security; they get no grant.
-- Column-scoped SELECT only (unguarded, like 20261225090301).
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Tracking: readLegacy columns.
grant select (id, itemheader_id_fk, stage, milestone_date)
  on dflow_prod."licensingMilestone" to designflow_prod_tracking_grants;
grant select (id, licensing_status_id_fk, tagged_user_ids, attachments)
  on dflow_prod."licensingFeedbackReply" to designflow_prod_tracking_grants;
-- Item Master: milestone ids per item.
grant select (id, itemheader_id_fk)
  on dflow_prod."licensingMilestone" to designflow_prod_item_master_grants;
-- Backend: loadLegacy reads whole rows (select *), granted by name.
grant select (id, date, feedback, package, status, "from", moduser, itemheader_id_fk, attachments,
  assignor_id, assignee_id, tagged_group_id, pop_comments, assignee_ids)
  on dflow_prod."licensingStatus" to designflow_prod_backend_grants;
grant select (id, licensing_status_id_fk, comment, created_by, created_at, tagged_user_ids, attachments)
  on dflow_prod."licensingFeedbackReply" to designflow_prod_backend_grants;
grant select (id, itemheader_id_fk, stage, milestone_date, checked_by_user_id, checked_by_name,
  created_at, updated_at)
  on dflow_prod."licensingMilestone" to designflow_prod_backend_grants;
commit;
