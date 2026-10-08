-- Issue #2875: dflow_prod carries the complete current DesignFlow Tracking
-- sample surface, definitionally identical to canonical dflow apart from the
-- schema name, with no reference back to dflow and no copied rows.
--
-- The expected fingerprints below are md5 hashes of each canonical definition
-- (relation, column, constraint, index, trigger, view, function, ACL and
-- comment), read from the deployed dflow schema where every Tracking migration
-- 20260722221000..20260903083204 is applied, then normalised dflow -> dflow_prod.
-- They are embedded because the disposable CI database cannot rebuild canonical
-- dflow: 20260903083204 needs live rows to self-verify and does not replay
-- there, so comparing against that database's dflow would compare against a
-- stale copy.
begin;

create temporary table t2875_rel(name text primary key) on commit drop;
insert into t2875_rel values ('sample_approval_event'), ('sample_approval_current'), ('sample_balance_by_location'), ('sample_carrier'), ('sample_creation_batch'), ('sample_factory_visit'), ('sample_factory_visit_event'), ('sample_global_status'), ('sample_import_job'), ('sample_import_row'), ('sample_inventory_balance'), ('sample_inventory'), ('sample_in_transit'), ('sample_movement'), ('sample_open_stop_work'), ('sample_path_revision'), ('sample_piece_lineage'), ('sample_receipt_discrepancy'), ('sample_remote_request'), ('sample_remote_request_history'), ('sample_remote_request_item'), ('sample_reservation'), ('sample_shipment'), ('sample_shipment_line'), ('sample_stop_closeout'), ('sample_visit_plan'), ('sample_workflow');
-- Relations and sub-objects dflow_prod held before #2875 (read from production).
create temporary table t2875_prior_rel(name text primary key) on commit drop;
insert into t2875_prior_rel values ('sample'), ('sample_attachment'), ('sample_box'), ('sample_comments'), ('sample_event'), ('sample_factory_group'), ('sample_shipment_item');
create temporary table t2875_prior_sub(item text primary key) on commit drop;
insert into t2875_prior_sub values
  ('column sample.box_id_fk'),
  ('column sample.courier'),
  ('column sample.customer_id_fk'),
  ('column sample.direction'),
  ('column sample.factory_group_id_fk'),
  ('column sample.factory_id_fk'),
  ('column sample.final_destination'),
  ('column sample.fob_cost'),
  ('column sample.item_id_fk'),
  ('column sample.next_stop'),
  ('column sample.notes'),
  ('column sample.office_location'),
  ('column sample.origin'),
  ('column sample.prod_order_no_fk'),
  ('column sample.quantity'),
  ('column sample.retail_price'),
  ('column sample.sample_createdTime'),
  ('column sample.sample_createdUser'),
  ('column sample.sample_id_pk'),
  ('column sample.sample_modTime'),
  ('column sample.sample_modUser'),
  ('column sample.sample_name'),
  ('column sample.status'),
  ('column sample.tracking_number'),
  ('column sample_box.box_createdTime'),
  ('column sample_box.box_createdUser'),
  ('column sample_box.box_id_pk'),
  ('column sample_box.box_label'),
  ('column sample_box.box_modTime'),
  ('column sample_box.box_modUser'),
  ('column sample_box.dest_office'),
  ('column sample_box.direction'),
  ('column sample_box.final_destination'),
  ('column sample_box.notes'),
  ('column sample_box.origin_office'),
  ('column sample_box.shipped_date'),
  ('column sample_box.status'),
  ('column sample_box.tracking_number'),
  ('column sample_shipment_item.added_date'),
  ('column sample_shipment_item.added_user'),
  ('column sample_shipment_item.box_id_fk'),
  ('column sample_shipment_item.factory_group_id_fk'),
  ('column sample_shipment_item.leg_type'),
  ('column sample_shipment_item.sample_id_fk'),
  ('column sample_shipment_item.shipment_item_id_pk'),
  ('constraint sample.sample_box_id_fk_fkey'),
  ('constraint sample.sample_factory_group_id_fk_fkey'),
  ('constraint sample.sample_pkey'),
  ('constraint sample_box.sample_box_pkey'),
  ('constraint sample_shipment_item.sample_shipment_item_box_id_fk_fkey'),
  ('constraint sample_shipment_item.sample_shipment_item_pkey'),
  ('constraint sample_shipment_item.sample_shipment_item_sample_id_fk_fkey'),
  ('index sample.idx_sample_box_id_fk'),
  ('index sample.sample_pkey'),
  ('index sample_box.sample_box_pkey'),
  ('index sample_shipment_item.sample_shipment_item_pkey');
create temporary table t2875_fn(name text primary key) on commit drop;
insert into t2875_fn values ('apply_sample_factory_visit_event'), ('apply_sample_path_revision'), ('pack_sample_reservation'), ('post_sample_approval_event'), ('post_sample_movement'), ('post_sample_piece_split'), ('post_sample_remote_request_event'), ('prevent_sample_shipment_route_drift'), ('project_sample_inventory_movement'), ('reject_sample_approval_event_mutation'), ('reject_sample_factory_visit_event_mutation'), ('reject_sample_movement_mutation'), ('reject_sample_path_revision_mutation'), ('require_sample_factory_visit_event'), ('require_sample_path_revision'), ('reserve_sample_remote_request_item'), ('sample_movement_auto_office_inventory'), ('sample_movement_guard'), ('touch_sample_factory_visit_updated_at'), ('validate_sample_approval_event'), ('validate_sample_factory_visit'), ('validate_sample_factory_visit_event'), ('validate_sample_movement_shipment_identity'), ('validate_sample_path_revision'), ('validate_sample_piece_lineage'), ('validate_sample_shipment_line_header');

-- Tracking items added to tables that already existed in dflow_prod.
create temporary table t2875_delta(item text primary key) on commit drop;
insert into t2875_delta values
  ('sample.quantity_migration_state'), ('sample_box.owner_factory_id_fk'),
  ('sample_box.ownership_state'), ('sample_box.current_custody_type'),
  ('sample_box.current_custody_id'), ('sample_shipment_item.quantity_intended'),
  ('sample.sample_quantity_migration_state_check'), ('sample_box.sample_box_custody_pair_check'),
  ('sample_box.sample_box_ownership_state_check'), ('sample_box.sample_box_owner_factory_fkey'),
  ('sample_shipment_item.sample_shipment_item_quantity_positive'),
  ('sample_shipment_item.sample_shipment_item_sample_box_uniq'),
  ('sample.sample_quantity_migration_state_idx'), ('sample_box.sample_box_active_name_custody_uniq'),
  ('sample_box.sample_box_owner_factory_idx'), ('sample_shipment_item.sample_shipment_item_box_id_fk_idx'),
  ('sample_shipment_item.sample_shipment_item_sample_id_fk_idx');

create temporary table t2875_expected(k text, nm text, h text, primary key (k, nm)) on commit drop;
insert into t2875_expected values
  ('column', 'sample.quantity_migration_state', '779cc066cb87ebe58d83a26c4df44f5a'),
  ('column', 'sample_approval_current.actor_role', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.actor_user', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.approval_state', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.approval_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.created_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_approval_current.destination_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.destination_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.idempotency_key', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.qc_required', '187bae50993eb091f222648666144718'),
  ('column', 'sample_approval_current.reason', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.request_hash', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_current.sample_approval_event_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_approval_current.sample_attachment_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_approval_current.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_approval_event.actor_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.actor_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.approval_state', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.approval_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_approval_event.destination_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_event.destination_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_event.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.qc_required', '4d8d7365b161ed20569d0478514a0c75'),
  ('column', 'sample_approval_event.reason', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_approval_event.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_approval_event.sample_approval_event_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_approval_event.sample_attachment_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_approval_event.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_balance_by_location.location_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_balance_by_location.location_label', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_balance_by_location.location_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_balance_by_location.quantity', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_balance_by_location.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_box.current_custody_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_box.current_custody_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_box.owner_factory_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_box.ownership_state', '76e078f25ed41a07e840f15b86647f6b'),
  ('column', 'sample_carrier.carrier_code', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_carrier.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_carrier.display_name', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_carrier.is_active', '1d89bc92cfcde0ae94a17ea660a151f6'),
  ('column', 'sample_carrier.sample_carrier_id', '49b04b95a4de9ff6f795f1093a33920b'),
  ('column', 'sample_carrier.tracking_url_template', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_creation_batch.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_creation_batch.created_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_creation_batch.created_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_creation_batch.creation_batch_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_creation_batch.entry_method', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_creation_batch.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_creation_batch.mode', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_creation_batch.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.closed_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_factory_visit.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_factory_visit.factory_id', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_factory_visit.factory_received_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_factory_visit.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.outbound_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_factory_visit.provenance', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.requested_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.requested_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit.return_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_factory_visit.returned_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_factory_visit.sample_factory_visit_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_factory_visit.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_factory_visit.shipped_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_factory_visit.state', 'ffd96597bfd9f67f8e63d0f222ec5d25'),
  ('column', 'sample_factory_visit.updated_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_factory_visit.visit_order', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_factory_visit_event.changed_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_factory_visit_event.changed_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit_event.changed_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit_event.event_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit_event.from_factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_factory_visit_event.from_state', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_factory_visit_event.from_visit_order', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_factory_visit_event.reason', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_factory_visit_event.revision', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_factory_visit_event.sample_factory_visit_event_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_factory_visit_event.sample_factory_visit_id', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_factory_visit_event.sample_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_factory_visit_event.to_factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_factory_visit_event.to_state', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_factory_visit_event.to_visit_order', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_global_status.derived_status', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_global_status.sample_id_pk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_import_job.box_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_job.confirmation_idempotency_key', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_import_job.confirmation_request_hash', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_import_job.content_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_import_job.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_import_job.error_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_job.failure_details', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_import_job.import_job_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_import_job.photo_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_job.private_object_key', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_import_job.row_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_job.sample_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_job.source_filename', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_import_job.state', '3ceaca05eb52707f382dea1489ecab20'),
  ('column', 'sample_import_job.template_version', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_import_job.updated_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_import_job.uploader_factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_import_job.uploader_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_import_job.uploader_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_import_job.warning_count', '1db1e65ee91e0970eba74ed222c69837'),
  ('column', 'sample_import_row.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_import_row.image_object_key', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_import_row.image_state', '285c2464e098159851fa2812af108568'),
  ('column', 'sample_import_row.import_job_id', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_import_row.import_row_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_import_row.normalized_values', 'd132e3d3afbeb988b0458f539e09b84d'),
  ('column', 'sample_import_row.resolution', '4d21148c3781723bffd9503b9a9afc3d'),
  ('column', 'sample_import_row.resulting_box_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_import_row.resulting_sample_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_import_row.row_number', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_import_row.validation_errors', 'fd21a84e24ca5ff48f2f607417aa2d93'),
  ('column', 'sample_import_row.validation_warnings', 'fd21a84e24ca5ff48f2f607417aa2d93'),
  ('column', 'sample_in_transit.box_id_pk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_in_transit.box_label', '5805468d246e9c25fa795b491460c81d'),
  ('column', 'sample_in_transit.direction', 'adf7e9a6b7f9806c85c6a5211b1a846c'),
  ('column', 'sample_in_transit.quantity', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_in_transit.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_in_transit.shipped_date', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_in_transit.tracking_number', '5805468d246e9c25fa795b491460c81d'),
  ('column', 'sample_inventory.available_since', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_inventory.ineligibility_reason', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_inventory.is_boxed', '187bae50993eb091f222648666144718'),
  ('column', 'sample_inventory.is_eligible', '187bae50993eb091f222648666144718'),
  ('column', 'sample_inventory.is_in_transit', '187bae50993eb091f222648666144718'),
  ('column', 'sample_inventory.location_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_inventory.product_location_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_inventory.product_location_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_inventory.quantity', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_inventory.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_inventory_balance.available_since', 'ac985e2408b1d3f6bb82fab1f353753b'),
  ('column', 'sample_inventory_balance.location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_inventory_balance.location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_inventory_balance.quantity', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_inventory_balance.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_movement.actor_factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_movement.actor_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.actor_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.box_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_movement.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_movement.discrepancy_code', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.discrepancy_details', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.from_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.from_location_label', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.from_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.lifecycle_action', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.movement_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_movement.occurred_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_movement.prior_status', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.quantity', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_movement.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.resulting_status', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.reversal_of_movement_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_movement.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_movement.sample_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_movement.shipment_line_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_movement.to_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_movement.to_location_label', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_movement.to_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_open_stop_work.location_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_open_stop_work.location_label', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_open_stop_work.location_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_open_stop_work.quantity', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_open_stop_work.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_path_revision.business_path', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_path_revision.changed_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_path_revision.changed_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_path_revision.reason', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_path_revision.revision', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_path_revision.sample_path_revision_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_path_revision.sample_workflow_id', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_piece_lineage.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_piece_lineage.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_piece_lineage.parent_sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_piece_lineage.piece_quantity', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_piece_lineage.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_piece_lineage.root_sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_piece_lineage.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_piece_lineage.sample_piece_lineage_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_piece_lineage.split_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_piece_lineage.split_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_piece_lineage.split_reason', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_receipt_discrepancy.box_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_receipt_discrepancy.quantity_intended', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_receipt_discrepancy.quantity_received', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_receipt_discrepancy.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_receipt_discrepancy.shipment_line_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_receipt_discrepancy.variance', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_remote_request.business_path', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_remote_request.destination_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.destination_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.request_source', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.requested_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.requested_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request.sample_remote_request_id', 'd9778e49680daa275c1d59b537b3a3fe'),
  ('column', 'sample_remote_request_history.actor_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_history.actor_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_history.event_payload', 'd132e3d3afbeb988b0458f539e09b84d'),
  ('column', 'sample_remote_request_history.from_state', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_remote_request_history.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_history.note', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_remote_request_history.occurred_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_remote_request_history.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_history.sample_remote_request_history_id', '3ed0911450f4fbfbf8f4eb7d9df2068e'),
  ('column', 'sample_remote_request_history.sample_remote_request_item_id', '18af71d8087480579d459f6803ad9968'),
  ('column', 'sample_remote_request_history.to_state', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.business_path', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_remote_request_item.created_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.created_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.current_state', 'f841301ef2ff5cfcd4ff0ff32822c804'),
  ('column', 'sample_remote_request_item.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_remote_request_item.sample_remote_request_id', '18af71d8087480579d459f6803ad9968'),
  ('column', 'sample_remote_request_item.sample_remote_request_item_id', 'd9778e49680daa275c1d59b537b3a3fe'),
  ('column', 'sample_remote_request_item.source_reference', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_remote_request_item.source_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_remote_request_item.updated_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_remote_request_item.workflow_id', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_reservation.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_reservation.open_sample_id', 'b517430f37661301b934a7410f9d5f14'),
  ('column', 'sample_reservation.packed_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_reservation.packed_box_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_reservation.packed_by_user', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_reservation.packed_shipment_line_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_reservation.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_reservation.reservation_state', 'ffec34b7845cf0167c5a4751bdd15588'),
  ('column', 'sample_reservation.reserved_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_reservation.reserved_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_reservation.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_reservation.sample_remote_request_item_id', '18af71d8087480579d459f6803ad9968'),
  ('column', 'sample_reservation.sample_reservation_id', 'd9778e49680daa275c1d59b537b3a3fe'),
  ('column', 'sample_shipment.actor_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.actor_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.carrier_id', '352b52274f014f3ccab697f70c8e7cc1'),
  ('column', 'sample_shipment.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_shipment.destination_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.destination_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.origin_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.origin_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.received_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_shipment.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment.sample_shipment_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_shipment.shipped_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_shipment.state', '3d76bd5b24363d6d20a87e53000e4c11'),
  ('column', 'sample_shipment.tracking_number', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_shipment.updated_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_shipment_item.quantity_intended', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_shipment_line.box_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_shipment_line.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_shipment_line.created_by_factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_shipment_line.created_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.created_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.destination_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.destination_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.idempotency_key', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.origin_location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.origin_location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.quantity_intended', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_shipment_line.request_hash', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.route_leg', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_shipment_line.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_shipment_line.sample_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_shipment_line.shipment_line_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_shipment_line.state', '78f3ba7823cd2f3295c8141442a5e802'),
  ('column', 'sample_stop_closeout.closed_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_stop_closeout.closed_by_role', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_stop_closeout.closed_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_stop_closeout.closeout_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_stop_closeout.location_id', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_stop_closeout.location_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_stop_closeout.movement_watermark', '22825b6f555fe1800eb036152d09a8a3'),
  ('column', 'sample_stop_closeout.note', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_stop_closeout.reopens_closeout_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_stop_closeout.revision', '3e51a86ef329b9bed3f4e71e3b7083c6'),
  ('column', 'sample_stop_closeout.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_stop_closeout.state', '1a360e622a736a044e766f81929876ea'),
  ('column', 'sample_visit_plan.active_visit_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.closed_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.completed_visit_count', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.created_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.current_custody_id', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.current_custody_since', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.current_custody_type', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.factory_id', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_visit_plan.factory_name', '71580f47558b6a696f1f275bdb3f8b2e'),
  ('column', 'sample_visit_plan.factory_nickname', '71580f47558b6a696f1f275bdb3f8b2e'),
  ('column', 'sample_visit_plan.factory_received_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.outbound_carrier_id', '352b52274f014f3ccab697f70c8e7cc1'),
  ('column', 'sample_visit_plan.outbound_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.outbound_tracking_number', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.parent_sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_visit_plan.piece_count', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.provenance', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.remaining_visit_count', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.requested_by_role', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.requested_by_user', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.return_carrier_id', '352b52274f014f3ccab697f70c8e7cc1'),
  ('column', 'sample_visit_plan.return_shipment_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.return_tracking_number', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.returned_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.root_sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_visit_plan.sample_factory_visit_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_visit_plan.sample_id_fk', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_visit_plan.shipped_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.state', '6d322fedc281ac7d7de09cd7f03423ed'),
  ('column', 'sample_visit_plan.updated_at', '136aae96ddb38f5cd3a56a2c31d77c80'),
  ('column', 'sample_visit_plan.visit_order', 'ba89a469f195a7d54afd8dfab8ca8f7a'),
  ('column', 'sample_workflow.business_path', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_workflow.contract_version', 'd468f561d42ccbfb472552506ac2bb96'),
  ('column', 'sample_workflow.created_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_workflow.created_by_user', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('column', 'sample_workflow.creation_batch_id', 'bd17b5c26857247c06981c9db78ac605'),
  ('column', 'sample_workflow.sample_id_fk', '68679c5659d92045cf860a9d42b93252'),
  ('column', 'sample_workflow.sample_workflow_id', '43b888e45663810d1756ae8e1efd267d'),
  ('column', 'sample_workflow.updated_at', 'f85e627ec3d8cd1e82a925d1cfea9fb4'),
  ('column', 'sample_workflow.workflow_state', '3d76bd5b24363d6d20a87e53000e4c11'),
  ('column', 'sample_workflow.workflow_type', '9eeb88b2fc82f474b164edc0028edeb7'),
  ('constraint', 'sample.sample_quantity_migration_state_check', '480781cd2c42a7370445c8face65fa03'),
  ('constraint', 'sample_approval_event.sample_approval_attachment_type_check', '1f317c8ff9357193de772d621f187a6e'),
  ('constraint', 'sample_approval_event.sample_approval_destination_pair_check', '3c0016dc32fccaf3a42746b57550e040'),
  ('constraint', 'sample_approval_event.sample_approval_event_actor_role_check', 'c31e2feec6b4b8550637da429ac99f68'),
  ('constraint', 'sample_approval_event.sample_approval_event_actor_user_check', 'e7be1493d878eca86637b7ecdc8df4e3'),
  ('constraint', 'sample_approval_event.sample_approval_event_approval_state_check', 'b11644fff81a9b934fbc767b677caef0'),
  ('constraint', 'sample_approval_event.sample_approval_event_approval_type_check', '41987a38b408b724497216fba181c61c'),
  ('constraint', 'sample_approval_event.sample_approval_event_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_approval_event.sample_approval_event_pkey', 'b831ca9d2a3494d64afcfbde6d362e08'),
  ('constraint', 'sample_approval_event.sample_approval_event_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_approval_event.sample_approval_event_sample_attachment_id_fkey', '674a5d47925b283cf1f5ea45a44d26d2'),
  ('constraint', 'sample_approval_event.sample_approval_event_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_approval_event.sample_approval_event_sample_id_fk_idempotency_key_key', '51ea4ac902fea71b6c692d72631f5618'),
  ('constraint', 'sample_approval_event.sample_approval_rejection_reason_check', '544485885aa56f50e37af3df869812cd'),
  ('constraint', 'sample_box.sample_box_custody_pair_check', 'ff14c37ba29e89bc35198ef4ecd58f73'),
  ('constraint', 'sample_box.sample_box_owner_factory_fkey', '743c00d1a95f4bbb1c0866a1e8e4d700'),
  ('constraint', 'sample_box.sample_box_ownership_state_check', 'e4a254e1c429800412b4174014850af0'),
  ('constraint', 'sample_carrier.sample_carrier_carrier_code_check', 'd176b32b21574d11e662db924b616429'),
  ('constraint', 'sample_carrier.sample_carrier_carrier_code_key', '332e1b7108526faa849858124e2d9534'),
  ('constraint', 'sample_carrier.sample_carrier_display_name_check', '0cd9fc74755b26edf47fbb27834b5317'),
  ('constraint', 'sample_carrier.sample_carrier_display_name_key', '79f491cdcbeddc58c5f64dcc63f6a719'),
  ('constraint', 'sample_carrier.sample_carrier_pkey', 'b85447ee0cabb7126aeecee724ca54e7'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_created_by_role_check', 'f765f1542ef32b0c6aa1c73c95c44c69'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_created_by_user_check', '50672d8f397554850372df352171ab53'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_created_by_user_idempotency_key_key', '96df2bbd8da12eee8c813e71ca326e4e'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_entry_method_check', 'fb9dd2a19e2ad69423b2f077e52977a2'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_mode_check', 'be74cbd9d8f855d439a11213e018931d'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_pkey', 'b5840930bc1eb9c7efa1cf83b6288a1b'),
  ('constraint', 'sample_creation_batch.sample_creation_batch_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_closed_matches_state', 'e51820b23a3c50fc40c4027f00c2cfe1'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_factory_id_fkey', 'f21ad91bbb088604190900431598a8a5'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_outbound_shipment_id_fkey', 'e6985f2c59492e29c6d9bc73b04da095'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_pkey', '4cdc0828f46bfdf8b89acb0e4929fd79'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_provenance_check', '376c8a05f398eb8dd0762e91213918d8'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_receipt_after_ship', 'e6e574495962859b49b030c24c8d0a18'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_requested_by_role_check', 'af278718d3f6c52e674f3375df016c0f'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_requested_by_user_check', 'c5fa8e6692561d031ab90fa2ffa90eec'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_requested_by_user_idempotency_key_key', '0a941103b234962534fe8fe494da2693'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_return_shipment_id_fkey', 'e387cea6d6b2979d813f6c967f7f6d1c'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_returned_needs_return', '9c2de38a045752e5b5befa25f3627e98'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_shipped_needs_outbound', '9ddd65cf89d58ebc926cc787fb558ccc'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_shipped_needs_time', '21e7a650739f172de89d2bd0d598b76b'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_state_check', 'd5b13b6cefd6cb5d28935c58cb13bd16'),
  ('constraint', 'sample_factory_visit.sample_factory_visit_visit_order_check', '7d50057e7613dced0654261361b9cd5a'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_changed_by_role_check', 'fbacf9f1a31ba8fe27476dbb6035d10a'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_changed_by_user_check', 'fd56196d9c24f3aee15f098c01fcf58b'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_event_type_check', 'ba47d9ee170448ab45e8323c7371fdef'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_pkey', 'c0cf581af4fb15f9710ef651cdfeebe0'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_reason_check', 'd315fea8a4b9c18c27cf9bd0e278c8d9'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_revision_check', 'e666563bc8ab355827469faa7a064d8b'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_sample_factory_visit_id_fkey', '55381e9dea0d0f33dfb6018915c2c3cf'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_sample_factory_visit_id_revision_key', '7152128c847fd03d3ce605d6492022fe'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_sample_shipment_id_fkey', '33181523348adcf7f69f92de0eb3e717'),
  ('constraint', 'sample_factory_visit_event.sample_factory_visit_event_to_factory_id_fkey', '532dbf3c41b114d0f287a80e38d96a57'),
  ('constraint', 'sample_import_job.sample_import_job_box_count_check', '62ce1c443c524f3f0bdf7a7aa80f0b91'),
  ('constraint', 'sample_import_job.sample_import_job_check', '360b671f536e23003a1d1ab1971354c0'),
  ('constraint', 'sample_import_job.sample_import_job_confirmation_idempotency_key_key', '40aacfba77898e41f8f3144ecc9825fd'),
  ('constraint', 'sample_import_job.sample_import_job_content_hash_check', '073d491bdefccc4e8c0202c978f74cde'),
  ('constraint', 'sample_import_job.sample_import_job_error_count_check', '13d5d999504a82ffa57f7df436c63bc3'),
  ('constraint', 'sample_import_job.sample_import_job_photo_count_check', '82a564457a627198eddc1c5ed6fcdd46'),
  ('constraint', 'sample_import_job.sample_import_job_pkey', 'ae1ebc4fd8d2528fd07b2fd184cd63a2'),
  ('constraint', 'sample_import_job.sample_import_job_row_count_check', '6c16e4b5fb8775d4a364adcd5dcc9c17'),
  ('constraint', 'sample_import_job.sample_import_job_sample_count_check', '1140e7680cbe15cf9e18dc34d79c0293'),
  ('constraint', 'sample_import_job.sample_import_job_state_check', '9aa237fa9a903763b3a0ae8049a82528'),
  ('constraint', 'sample_import_job.sample_import_job_uploader_user_content_hash_key', 'ea237285bc3a79a83c95cf68dd96a970'),
  ('constraint', 'sample_import_job.sample_import_job_warning_count_check', '6d33cf6cc5596534df307538c917eb81'),
  ('constraint', 'sample_import_row.sample_import_row_image_state_check', 'bff8f64123d19d3d18118731912c4baa'),
  ('constraint', 'sample_import_row.sample_import_row_import_job_id_fkey', '8e32a78d6e32725b16dbe2789c8d7746'),
  ('constraint', 'sample_import_row.sample_import_row_import_job_id_row_number_key', '0d83fc64b86f53457fb598439ca16f73'),
  ('constraint', 'sample_import_row.sample_import_row_json_shapes_check', '8bf78e8334dee326b62838fd17ff57c9'),
  ('constraint', 'sample_import_row.sample_import_row_pkey', 'f8be443bc3e0290b5102f1913c0becaa'),
  ('constraint', 'sample_import_row.sample_import_row_resulting_box_id_fkey', 'a07fb7d0edca07f18811f28619005fa0'),
  ('constraint', 'sample_import_row.sample_import_row_resulting_sample_id_fkey', '6959568eb67cbfa73ef1860042608851'),
  ('constraint', 'sample_import_row.sample_import_row_row_number_check', '69973476e9f99b547c015d8a62974787'),
  ('constraint', 'sample_inventory_balance.sample_inventory_balance_pkey', '25d19e989e420f8478f706dbb4339119'),
  ('constraint', 'sample_inventory_balance.sample_inventory_balance_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_movement.sample_movement_actor_role_check', 'c31e2feec6b4b8550637da429ac99f68'),
  ('constraint', 'sample_movement.sample_movement_actor_user_check', 'e7be1493d878eca86637b7ecdc8df4e3'),
  ('constraint', 'sample_movement.sample_movement_box_id_fk_fkey', '84a690a3c380018bb135be766fcf645a'),
  ('constraint', 'sample_movement.sample_movement_check', '709ac8636baf410fe4e806ab2b366d96'),
  ('constraint', 'sample_movement.sample_movement_check1', '48f1a6fec05491f05e1623779ba65686'),
  ('constraint', 'sample_movement.sample_movement_check2', '604bf0a10e960e0dad6d0a21697372aa'),
  ('constraint', 'sample_movement.sample_movement_discrepancy_code_check', 'e881457b973a9c49f38eda18c7c6ab0b'),
  ('constraint', 'sample_movement.sample_movement_discrepancy_details_check', 'a7f8dc94f392f3fc74d82f090883e5ec'),
  ('constraint', 'sample_movement.sample_movement_from_location_id_check', 'b4d071ed10697b2fcffbccdfe6bc7e2a'),
  ('constraint', 'sample_movement.sample_movement_from_location_type_check', '12e15e5c485baf488f750f207b68b9c2'),
  ('constraint', 'sample_movement.sample_movement_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_movement.sample_movement_lifecycle_action_check', 'c332f7fc90dedb8207c0e000e5e0fed3'),
  ('constraint', 'sample_movement.sample_movement_pkey', '51cbd146bfce92c7a0ba9e80b5301a54'),
  ('constraint', 'sample_movement.sample_movement_quantity_check', 'bcccf9a19bbdad500a9ac8bb3e85892f'),
  ('constraint', 'sample_movement.sample_movement_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_movement.sample_movement_reversal_of_movement_id_fkey', '3cdf5f52826e26649eb2e452a5e3a7e8'),
  ('constraint', 'sample_movement.sample_movement_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_movement.sample_movement_sample_id_fk_idempotency_key_key', '51ea4ac902fea71b6c692d72631f5618'),
  ('constraint', 'sample_movement.sample_movement_sample_shipment_id_fkey', '33181523348adcf7f69f92de0eb3e717'),
  ('constraint', 'sample_movement.sample_movement_shipment_line_id_fkey', '41303bc4b52ed80d59f8aa68d621bc05'),
  ('constraint', 'sample_movement.sample_movement_to_location_id_check', 'ea39ee404a1e97dcfa4618af15070c63'),
  ('constraint', 'sample_movement.sample_movement_to_location_type_check', '8a71a779ab45b7ae5448ff27901a3573'),
  ('constraint', 'sample_movement.sample_movement_transit_identity_check', 'cfa25966b0e2d023cadcdc07a2acdd25'),
  ('constraint', 'sample_movement.sample_movement_transit_location_identity_check', 'da6da26afa0e5309bf089965f0757dfd'),
  ('constraint', 'sample_path_revision.sample_path_revision_business_path_check', 'a5ef35bc3aab8849bfcb2ee69e568a9e'),
  ('constraint', 'sample_path_revision.sample_path_revision_changed_by_user_check', 'fd56196d9c24f3aee15f098c01fcf58b'),
  ('constraint', 'sample_path_revision.sample_path_revision_pkey', '2dc1585a2495817ba60d40e08a5cd8ec'),
  ('constraint', 'sample_path_revision.sample_path_revision_reason_check', 'd315fea8a4b9c18c27cf9bd0e278c8d9'),
  ('constraint', 'sample_path_revision.sample_path_revision_revision_check', 'e666563bc8ab355827469faa7a064d8b'),
  ('constraint', 'sample_path_revision.sample_path_revision_sample_workflow_id_fkey', '73d6a8977c35701c9df2ab7f93793ad6'),
  ('constraint', 'sample_path_revision.sample_path_revision_sample_workflow_id_revision_key', 'fe69e323b0b8e090027c66da0edbce4b'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_not_own_parent', 'b2cd007d5a242111dec3b05a8b4f3f28'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_not_own_root', 'f786d19404a12c2fac173b507e0f791c'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_parent_sample_id_fk_fkey', '87afbcf68042eca9dfa70ec3bd0bffda'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_piece_quantity_check', 'ca2238ec14bdfee89df4788ef3a8c5cc'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_pkey', 'bd99f20c07735910663b304c010c702c'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_root_sample_id_fk_fkey', '1e74675562eaa4ed3eb07a95ea71e555'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_sample_id_fk_key', '162b37520112079761417ca01ecb7675'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_split_by_role_check', '3b7f6ec0a1b4388ce0a637fe618f142a'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_split_by_user_check', '43e031f870cff72051f994c5f28b6de7'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_split_by_user_idempotency_key_key', '7c9a088cb98f24940507b8e96aadd2c5'),
  ('constraint', 'sample_piece_lineage.sample_piece_lineage_split_reason_check', 'a61ec79131ad2ab2dbb2330f5d4be04f'),
  ('constraint', 'sample_remote_request.sample_remote_request_business_path_check', 'e9490a023b60fc7a57fcc2be37642c9a'),
  ('constraint', 'sample_remote_request.sample_remote_request_destination_id_check', '4eba35c11bdef5ef3ab609d2b38c2184'),
  ('constraint', 'sample_remote_request.sample_remote_request_destination_type_check', 'd9a8515263d4e8b142db1923a335eeee'),
  ('constraint', 'sample_remote_request.sample_remote_request_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_remote_request.sample_remote_request_idempotency_key_key', 'd79241790e3ae5633cdc72bff0909bc0'),
  ('constraint', 'sample_remote_request.sample_remote_request_pkey', '2d32dac91d3f7827036c0012a7a8e195'),
  ('constraint', 'sample_remote_request.sample_remote_request_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_remote_request.sample_remote_request_request_source_check', '48bf5f1951358fa170c6d64ea5bbdd5d'),
  ('constraint', 'sample_remote_request.sample_remote_request_requested_by_role_check', 'e524bed1506ee2ec990fe688ac189c14'),
  ('constraint', 'sample_remote_request.sample_remote_request_requested_by_user_check', 'c5fa8e6692561d031ab90fa2ffa90eec'),
  ('constraint', 'sample_remote_request.sample_remote_request_source_path_check', 'e6e68fbfe9f7da95932bbdc0d916a508'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_actor_role_check', 'ac3f4bced61c241fd724027b3bb55ff6'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_actor_user_check', 'e7be1493d878eca86637b7ecdc8df4e3'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_event_payload_check', '1216995997b34562bb25a9c4962902da'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_pkey', 'a129eea2e876d424efdb080d9295abd0'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_sample_remote_request_item_i_fkey', '8d5fda2842177ca561249f6856b75160'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_sample_remote_request_item_id_key', 'faf77b69f58041ff4b5b0b2d6e0a6b38'),
  ('constraint', 'sample_remote_request_history.sample_remote_request_history_to_state_check', 'fb72e3824872172713ad304557d26f81'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_business_path_check', '41643533b2f700401a26e4a9bbd5483f'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_check', '3aaefe3ebfc2774261631a8240939046'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_check1', '1ba44c26e4549f27681ec541dd6bfe84'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_created_by_role_check', '79126f4ab0cea3b9507fadd3fbea9a0c'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_created_by_user_check', '50672d8f397554850372df352171ab53'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_current_state_check', 'b75abce1c9d5757f8fa9a1d8b2447f1b'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_pkey', '707810bc11efd0672002278de48973d6'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_sample_remote_request_id_fkey', '4d7cc2ad6d33da41dec25ff2b5f1824c'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_sample_remote_request_id_idempot_key', '163ff9905bfca6f7b7156d1a41dfb7d0'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_source_reference_check', '8436b8887604d2f52b746a29b25e472e'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_source_type_check', 'd6cb94a4430fefe44148e15eefad953d'),
  ('constraint', 'sample_remote_request_item.sample_remote_request_item_workflow_id_fkey', '64a44429fa6ff32950347ad40539995c'),
  ('constraint', 'sample_reservation.sample_reservation_check', '5755b0e4e57065b3117b6888e4150ee4'),
  ('constraint', 'sample_reservation.sample_reservation_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_reservation.sample_reservation_idempotency_key_key', 'd79241790e3ae5633cdc72bff0909bc0'),
  ('constraint', 'sample_reservation.sample_reservation_open_sample_id_key', 'c69ce548caf345cb93a9a6fc06630c3c'),
  ('constraint', 'sample_reservation.sample_reservation_packed_box_id_fkey', '407dbd9ebe78083f87acfa0e324ce7ad'),
  ('constraint', 'sample_reservation.sample_reservation_packed_shipment_line_id_fkey', 'c5bb70cf49d7385f6a1951164f9f6c74'),
  ('constraint', 'sample_reservation.sample_reservation_pkey', '0b83324bc2a21f0b75469b3a995bb7c7'),
  ('constraint', 'sample_reservation.sample_reservation_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_reservation.sample_reservation_reservation_state_check', 'd185839938a2b59390048be3b1868bda'),
  ('constraint', 'sample_reservation.sample_reservation_reserved_by_user_check', '7c84038e390976164eee85b41e37952e'),
  ('constraint', 'sample_reservation.sample_reservation_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_reservation.sample_reservation_sample_remote_request_item_id_fkey', '8d5fda2842177ca561249f6856b75160'),
  ('constraint', 'sample_shipment.sample_shipment_actor_role_check', 'c31e2feec6b4b8550637da429ac99f68'),
  ('constraint', 'sample_shipment.sample_shipment_actor_user_check', 'e7be1493d878eca86637b7ecdc8df4e3'),
  ('constraint', 'sample_shipment.sample_shipment_carrier_id_fkey', '043b24a70b7bdcc95039753140884c48'),
  ('constraint', 'sample_shipment.sample_shipment_check', 'cdcf5389e78707a8474fb1339515719e'),
  ('constraint', 'sample_shipment.sample_shipment_check1', 'ae5d2657f7681c7aa10d866ecc8a13e9'),
  ('constraint', 'sample_shipment.sample_shipment_check2', '6b3bb18910fc8d7a97634a943cf4849c'),
  ('constraint', 'sample_shipment.sample_shipment_check3', '55ad38226ec8d7d5ea7f4686839c9edd'),
  ('constraint', 'sample_shipment.sample_shipment_destination_location_id_check', '199a6654fc38be92108f181c03e6488a'),
  ('constraint', 'sample_shipment.sample_shipment_destination_location_type_check', 'f97e6419843321585eee54b979a41d19'),
  ('constraint', 'sample_shipment.sample_shipment_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_shipment.sample_shipment_idempotency_key_key', 'd79241790e3ae5633cdc72bff0909bc0'),
  ('constraint', 'sample_shipment.sample_shipment_origin_location_id_check', '48cf2d05dd325987fda0d4d9c6ab7946'),
  ('constraint', 'sample_shipment.sample_shipment_origin_location_type_check', '7467204408191b5b2c471021ab6de274'),
  ('constraint', 'sample_shipment.sample_shipment_pkey', '31f5aba188cee672d7bec47571979b09'),
  ('constraint', 'sample_shipment.sample_shipment_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_shipment.sample_shipment_state_check', '2ab9f78d5c15c31b8c214ddde8cc5041'),
  ('constraint', 'sample_shipment.sample_shipment_tracking_number_check', '6956401571baf7428912a5f7f87bd602'),
  ('constraint', 'sample_shipment_item.sample_shipment_item_quantity_positive', '9e416ab8e4d731d74cb8521adcb88aa9'),
  ('constraint', 'sample_shipment_item.sample_shipment_item_sample_box_uniq', 'ba843c658216e41e40d42f81094839f9'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_box_id_fk_fkey', '84a690a3c380018bb135be766fcf645a'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_box_or_header_check', '43b91b371355818ec1c921cb8c8d92fc'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_check', 'cdcf5389e78707a8474fb1339515719e'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_destination_location_id_check', '199a6654fc38be92108f181c03e6488a'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_destination_location_type_check', 'f97e6419843321585eee54b979a41d19'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_idempotency_key_check', '2432fc06aa938b71022cec2a7dd6b73f'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_origin_location_id_check', '48cf2d05dd325987fda0d4d9c6ab7946'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_origin_location_type_check', 'c923a177f8b42eb87b30b1851f031ba4'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_pkey', 'f9b29a1e7a622e4aaaec9fabf81cb7ae'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_quantity_intended_check', 'ce79fc33e1c0418821755a1d9718a112'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_request_hash_check', '9b49fa77dc8d11817cb6f1efc64e6776'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_route_leg_check', '12981daa4b7d0fde725cb203ae62c210'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_sample_id_fk_idempotency_key_key', '51ea4ac902fea71b6c692d72631f5618'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_sample_shipment_id_fkey', '33181523348adcf7f69f92de0eb3e717'),
  ('constraint', 'sample_shipment_line.sample_shipment_line_state_check', '682d8799b84ca372b6e21cb251eeb661'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_location_id_check', '266153b6e60abe5dff1a539a2334a52c'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_location_type_check', '26b55206afc52acaa74b3408bc14d466'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_movement_watermark_fkey', 'ed76eaf89b37f8b40c04bff5d7270a80'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_pkey', '65a3f602b108d4110687cf14bfbbb768'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_reopens_closeout_id_fkey', '598e31c4fde1d10fa4e735e4eb3471bf'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_revision_check', 'e666563bc8ab355827469faa7a064d8b'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_sample_id_fk_location_type_location_id_key', '9b1e9c8db3ab377f4ab22f18d62951b5'),
  ('constraint', 'sample_stop_closeout.sample_stop_closeout_state_check', '455fa3a144a15239d9b22b9ab325d9eb'),
  ('constraint', 'sample_workflow.sample_workflow_business_path_check', 'a5ef35bc3aab8849bfcb2ee69e568a9e'),
  ('constraint', 'sample_workflow.sample_workflow_contract_version_check', 'ab98c9c7066c82d03bea907b3bb1a756'),
  ('constraint', 'sample_workflow.sample_workflow_created_by_user_check', '50672d8f397554850372df352171ab53'),
  ('constraint', 'sample_workflow.sample_workflow_creation_batch_id_fkey', 'e4a5ce8e3e25c6a74b04967b12417459'),
  ('constraint', 'sample_workflow.sample_workflow_pkey', 'f332f0a8e1adf402037a1b1095ced55d'),
  ('constraint', 'sample_workflow.sample_workflow_sample_id_fk_fkey', '27b8aac885f8ce4209a15bf89d2702a5'),
  ('constraint', 'sample_workflow.sample_workflow_sample_id_fk_key', '162b37520112079761417ca01ecb7675'),
  ('constraint', 'sample_workflow.sample_workflow_valid_flow_path', 'b795ea6bf3a32722a3fbb7014a2c761a'),
  ('constraint', 'sample_workflow.sample_workflow_workflow_state_check', '310998b7240e44ea3755b9711d426bd1'),
  ('constraint', 'sample_workflow.sample_workflow_workflow_type_check', 'e007660d85402537a019d4e454527141'),
  ('function', 'apply_sample_factory_visit_event()', 'febdede425db5d8f4b4800af92ba0658'),
  ('function', 'apply_sample_path_revision()', 'fe0dd277145a8e3cd174e7c055f8e907'),
  ('function', 'pack_sample_reservation(p_reservation_id uuid, p_box_id integer, p_sample_shipment_id bigint, p_origin_location_id text, p_destination_type text, p_destination_id text, p_route_leg text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)', '67f39b890c04b08654f77cb8ce9a22a5'),
  ('function', 'post_sample_approval_event(p_sample_id integer, p_approval_type text, p_approval_state text, p_qc_required boolean, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_sample_attachment_id integer, p_destination_type text, p_destination_id text, p_reason text)', '1deae473e1dc5d456e6d4623f875d331'),
  ('function', 'post_sample_movement(p_sample_id integer, p_quantity integer, p_from_type text, p_from_id text, p_to_type text, p_to_id text, p_action text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_box_id integer, p_shipment_line_id bigint, p_actor_factory_id integer, p_discrepancy_code text, p_discrepancy_details text, p_reversal_of bigint, p_from_label text, p_to_label text)', '5aa35e894b9967370567e555029afbd6'),
  ('function', 'post_sample_piece_split(p_parent_sample_id integer, p_children jsonb, p_source_location_type text, p_source_location_id text, p_split_reason text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)', '5a7fc1ab166238290e06a8d94a3e6d38'),
  ('function', 'post_sample_remote_request_event(p_item_id uuid, p_to_state text, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text, p_note text, p_event_payload jsonb)', '012d9a4a6a93ccd708c8b365d05187bb'),
  ('function', 'prevent_sample_shipment_route_drift()', '9ad0c2227513d27b3fb68f8814e11451'),
  ('function', 'project_sample_inventory_movement()', 'ce66bdf4ec4b784d22ec8a38cd676b8a'),
  ('function', 'reject_sample_approval_event_mutation()', 'e46b63e683fc422389cb9ccfb05e12e9'),
  ('function', 'reject_sample_factory_visit_event_mutation()', '49ff324cbddcffe43ee8921ff4cdad2e'),
  ('function', 'reject_sample_movement_mutation()', 'e4a881f2392305d6e579ee65ddb3f2dd'),
  ('function', 'reject_sample_path_revision_mutation()', '77405bccbc8415e70e04d30b2dc324cb'),
  ('function', 'require_sample_factory_visit_event()', '921c87aa6b26fb63e50b53124534c469'),
  ('function', 'require_sample_path_revision()', '9f9a6634ed0cf603d280e1278fc9500f'),
  ('function', 'reserve_sample_remote_request_item(p_item_id uuid, p_actor_user text, p_actor_role text, p_idempotency_key text, p_request_hash text)', 'aa138ba9fafadc3f253b2db0b86407c0'),
  ('function', 'sample_movement_auto_office_inventory()', '67f6267e53c5f8050908fcb33d2320cc'),
  ('function', 'sample_movement_guard()', '88d8afbb0640fc633984ab41460bc025'),
  ('function', 'touch_sample_factory_visit_updated_at()', '45801eb058b1123b385e0affcbc00b5d'),
  ('function', 'validate_sample_approval_event()', '8825508dcaff51f6f4c74a6547399696'),
  ('function', 'validate_sample_factory_visit()', 'b71ce67b041d56f5b4f0d80e08e96ae4'),
  ('function', 'validate_sample_factory_visit_event()', '55850974f066901bce6e5bcbb1b74363'),
  ('function', 'validate_sample_movement_shipment_identity()', '645653fc7f3703c0595f0e50b71823a9'),
  ('function', 'validate_sample_path_revision()', '5d6d328abec8ba0744b3b04657af1f68'),
  ('function', 'validate_sample_piece_lineage()', '6c80ffbe6343f064e03e81b19dabff89'),
  ('function', 'validate_sample_shipment_line_header()', '0d57588d79c5d499731fa6cf6fd3a64c'),
  ('index', 'sample.sample_quantity_migration_state_idx', 'a22f551290367a3a3a49e8ed6674e557'),
  ('index', 'sample_approval_event.sample_approval_event_latest_idx', 'a162c54e403951f16aef29e497ae8da0'),
  ('index', 'sample_approval_event.sample_approval_event_pkey', '315a566322dd48557b53462ea16b4549'),
  ('index', 'sample_approval_event.sample_approval_event_sample_id_fk_idempotency_key_key', '87cf3063bc465865eca4632e829f52c4'),
  ('index', 'sample_box.sample_box_active_name_custody_uniq', '2cf61b8b49fd8b4adf044106291b5a01'),
  ('index', 'sample_box.sample_box_owner_factory_idx', 'bc373b926b742be26bba874f1721a7ff'),
  ('index', 'sample_carrier.sample_carrier_carrier_code_key', 'c43edc1dc3bac3f6dc502783738f5297'),
  ('index', 'sample_carrier.sample_carrier_display_name_key', '2eb92d69515d14e81f78bbe66622b018'),
  ('index', 'sample_carrier.sample_carrier_pkey', '2c26422cb4fc7dc8313f905bd5dd46f7'),
  ('index', 'sample_creation_batch.sample_creation_batch_created_by_user_idempotency_key_key', '2fac0d654a1c1c18da742861f4b1fab8'),
  ('index', 'sample_creation_batch.sample_creation_batch_pkey', '96b76840c57ba47f80cd238b7c0cf769'),
  ('index', 'sample_factory_visit.sample_factory_visit_factory_queue_idx', 'fbd9871948be7b458cb989296d47439f'),
  ('index', 'sample_factory_visit.sample_factory_visit_one_active_uniq', 'de7276dbf55e8d3fe945da61ba624b40'),
  ('index', 'sample_factory_visit.sample_factory_visit_order_uniq', '78b9659f2cb2b3c977e6271f5898bdea'),
  ('index', 'sample_factory_visit.sample_factory_visit_pkey', '289e6ac31441a6901e8a9921bfcc75fb'),
  ('index', 'sample_factory_visit.sample_factory_visit_requested_by_user_idempotency_key_key', 'f6cdfc19b817e472a58725b161d0e30f'),
  ('index', 'sample_factory_visit.sample_factory_visit_sample_state_idx', 'b7b19bc2bb42a4fbd36cd913c20640aa'),
  ('index', 'sample_factory_visit_event.sample_factory_visit_event_pkey', '6374797277f88f78af9233d41200ca12'),
  ('index', 'sample_factory_visit_event.sample_factory_visit_event_sample_factory_visit_id_revision_key', '9ba56b5cfd459c820e05e4ab174b175d'),
  ('index', 'sample_factory_visit_event.sample_factory_visit_event_visit_idx', '9eda819da24a9f34388540a99c8669cc'),
  ('index', 'sample_import_job.sample_import_job_confirmation_idempotency_key_key', 'b4d675612cacc3c44aa1308306fe0280'),
  ('index', 'sample_import_job.sample_import_job_pkey', '63a68ccb574b3d4a097ff88fa1840f3f'),
  ('index', 'sample_import_job.sample_import_job_state_idx', 'd8678b3546524ff23cb0976284ae97ef'),
  ('index', 'sample_import_job.sample_import_job_uploader_user_content_hash_key', '04d335b79f06c861c92d46759e552a7b'),
  ('index', 'sample_import_row.sample_import_row_import_job_id_row_number_key', '40df762fbe671803999fb58b1514164b'),
  ('index', 'sample_import_row.sample_import_row_job_idx', 'be19116ec8125a81c8686cfbca6d21d8'),
  ('index', 'sample_import_row.sample_import_row_pkey', '0b27f48f11d37f4772e677ae307e92d4'),
  ('index', 'sample_inventory_balance.sample_inventory_balance_pkey', '3819e651eb31358145521b1dd426ebc2'),
  ('index', 'sample_inventory_balance.sample_inventory_balance_screen_idx', '49a65e80861b26c63862edc602825eb8'),
  ('index', 'sample_movement.sample_movement_box_idx', 'd0d5cd20584f9e737c63e50baef84b8c'),
  ('index', 'sample_movement.sample_movement_destination_idx', '209b92fc852fc376b96e7fde78586dc8'),
  ('index', 'sample_movement.sample_movement_inventory_idx', '32da3accaaa2432f0faaad8f16968205'),
  ('index', 'sample_movement.sample_movement_pkey', '4730adbe0edbc830d3caed8c4229f461'),
  ('index', 'sample_movement.sample_movement_sample_id_fk_idempotency_key_key', 'e881de99c05b4bf498129d2c0e620317'),
  ('index', 'sample_movement.sample_movement_sample_time_idx', 'a8cdb79ee5ed786a22acbbb194dcfe43'),
  ('index', 'sample_movement.sample_movement_source_idx', '05ebe6afca4ab71c2a7256e5ddc40c51'),
  ('index', 'sample_path_revision.sample_path_revision_pkey', 'aa45e757e7466315be8c5caf5183538b'),
  ('index', 'sample_path_revision.sample_path_revision_sample_workflow_id_revision_key', '49ad2fea61a5ab87fcc10eaeecceb3f0'),
  ('index', 'sample_piece_lineage.sample_piece_lineage_parent_idx', '542a3e425d9f4c03d9e39acd63292cec'),
  ('index', 'sample_piece_lineage.sample_piece_lineage_pkey', '2ccf56569f1af0e2622f7b19616228c8'),
  ('index', 'sample_piece_lineage.sample_piece_lineage_root_idx', 'ab87bb40cb0ec977053cce755c48bae9'),
  ('index', 'sample_piece_lineage.sample_piece_lineage_sample_id_fk_key', '15d2cd0f6ebf426e20fcf121d3f4cb3b'),
  ('index', 'sample_piece_lineage.sample_piece_lineage_split_by_user_idempotency_key_key', '03f5d5a5c577b51722b4e4f936df812b'),
  ('index', 'sample_remote_request.sample_remote_request_idempotency_key_key', '5fb554fd092290b10ca30784cd130723'),
  ('index', 'sample_remote_request.sample_remote_request_pkey', 'c8f16610d7927fec34a9198879c9874b'),
  ('index', 'sample_remote_request_history.sample_remote_request_history_pkey', '9443a2aa1df33bf82116ad8e8baec6cd'),
  ('index', 'sample_remote_request_history.sample_remote_request_history_sample_remote_request_item_id_key', 'aaf22e3e6b79ed1540fd975d436587e7'),
  ('index', 'sample_remote_request_item.sample_remote_request_item_pkey', '2beb54421582bc075f53e3fdb3223958'),
  ('index', 'sample_remote_request_item.sample_remote_request_item_sample_remote_request_id_idempot_key', 'dbf8eb2e9e50d290b17ac18b201ebd35'),
  ('index', 'sample_reservation.sample_reservation_idempotency_key_key', 'c6d3a46d3cb4bf39167160ee4bbee473'),
  ('index', 'sample_reservation.sample_reservation_open_sample_id_key', '997e3981db4d42adba7dad34a35c053f'),
  ('index', 'sample_reservation.sample_reservation_pkey', '49cd018f64fef2661b1b2c4b9f585caf'),
  ('index', 'sample_shipment.sample_shipment_active_tracking_uniq', '9022dba3b23f44798c272c7fc5f89896'),
  ('index', 'sample_shipment.sample_shipment_idempotency_key_key', 'b7bc6aa31e8894d40076d021d27fa498'),
  ('index', 'sample_shipment.sample_shipment_pkey', '997941fb82ea736af35a8ded1e4bba81'),
  ('index', 'sample_shipment_item.sample_shipment_item_box_id_fk_idx', 'e39c631ec83e8d6eef3bd35e331baa92'),
  ('index', 'sample_shipment_item.sample_shipment_item_sample_box_uniq', '6311011acbf6c8a91684282c123881d0'),
  ('index', 'sample_shipment_item.sample_shipment_item_sample_id_fk_idx', '08f65b15200d2039afc5deb53a088e1f'),
  ('index', 'sample_shipment_line.sample_shipment_line_box_idx', '1812d11eef4dafbebbe74983131c83cd'),
  ('index', 'sample_shipment_line.sample_shipment_line_header_idx', '5a086ea73ff2e9a9f740689ba6a55405'),
  ('index', 'sample_shipment_line.sample_shipment_line_pkey', '75c88910242f85045a5f454291b75c37'),
  ('index', 'sample_shipment_line.sample_shipment_line_sample_id_fk_idempotency_key_key', '00ce345846869646c24bb2ae1a110cd0'),
  ('index', 'sample_shipment_line.sample_shipment_line_sample_idx', '4cb1e4917f6c78d69a39017510f78e18'),
  ('index', 'sample_stop_closeout.sample_stop_closeout_open_idx', '9d9d315df151df11c544e30256711ddf'),
  ('index', 'sample_stop_closeout.sample_stop_closeout_pkey', 'e7243ef82b7408bb225cff973d2045f0'),
  ('index', 'sample_stop_closeout.sample_stop_closeout_sample_id_fk_location_type_location_id_key', '3578d71f366b1554c37bfce73fa3ad5e'),
  ('index', 'sample_workflow.sample_workflow_pkey', '582ae0f8ff1f19ed47bb12a5c806d807'),
  ('index', 'sample_workflow.sample_workflow_queue_idx', '3e92e2ddbb452c81b170748e85146daa'),
  ('index', 'sample_workflow.sample_workflow_sample_id_fk_key', '551449c53aefdc818b75e2a1be2ea972'),
  ('relation', 'sample_approval_current', '63a1d84e54923a790a4cf4d30f8622dc'),
  ('relation', 'sample_approval_event', '95fbee6887d0865cb0370a49a833b494'),
  ('relation', 'sample_balance_by_location', 'aeba90a523967eb2f817457077be8c6f'),
  ('relation', 'sample_carrier', '5be6328a17f4ff066ce74f1cf09d2c8e'),
  ('relation', 'sample_creation_batch', 'e70a70a3d1354b78e81b458285ddf24e'),
  ('relation', 'sample_factory_visit', 'e0eeb6a4ac3da0f509f4c34a00dc3f86'),
  ('relation', 'sample_factory_visit_event', '2724010fb4d2b0bd63fe87495a175062'),
  ('relation', 'sample_global_status', '30d72538eac32ea4be0157e5f12552bd'),
  ('relation', 'sample_import_job', '157f7e9a6237cedc9226ff16cd7b107c'),
  ('relation', 'sample_import_row', '157f7e9a6237cedc9226ff16cd7b107c'),
  ('relation', 'sample_in_transit', 'aeba90a523967eb2f817457077be8c6f'),
  ('relation', 'sample_inventory', '2e4bcdeca6fec708fe5fc72378298948'),
  ('relation', 'sample_inventory_balance', 'e2d30238c889134abacd184e2ee95daf'),
  ('relation', 'sample_movement', 'db470d9717b5cd62eac20e00ea8139ea'),
  ('relation', 'sample_open_stop_work', 'aeba90a523967eb2f817457077be8c6f'),
  ('relation', 'sample_path_revision', '354fbbfd6f799870f5e7e0fb689f6a8d'),
  ('relation', 'sample_piece_lineage', 'c5cc599d35d08ad01ca226c6f0c02621'),
  ('relation', 'sample_receipt_discrepancy', 'aeba90a523967eb2f817457077be8c6f'),
  ('relation', 'sample_remote_request', 'efd8f458d18946a4e230b54e28aedf4d'),
  ('relation', 'sample_remote_request_history', '839b87358e7c2eef0295eabba35e82dd'),
  ('relation', 'sample_remote_request_item', 'efd8f458d18946a4e230b54e28aedf4d'),
  ('relation', 'sample_reservation', 'fdb437c04017c579fd3e4c3cf87b3ade'),
  ('relation', 'sample_shipment', 'd16591211f7952e49cf024e00214ad26'),
  ('relation', 'sample_shipment_line', 'c6dfd7a5b178954d14ad07f813ccdaa2'),
  ('relation', 'sample_stop_closeout', '157f7e9a6237cedc9226ff16cd7b107c'),
  ('relation', 'sample_visit_plan', '729ffdad730311b6ceed10579b256eef'),
  ('relation', 'sample_workflow', '94d01777bfa009fedf36e71af36a5ec6'),
  ('trigger', 'sample_approval_event.sample_approval_event_immutable', 'b1a39f83d152a8b57437b216f840cc6c'),
  ('trigger', 'sample_approval_event.sample_approval_event_validate', '152eabb419cb1893335d4cb9fb66bdd4'),
  ('trigger', 'sample_factory_visit.sample_factory_visit_event_required', '23b98f2be4f76fe1c63608c0b8203486'),
  ('trigger', 'sample_factory_visit.sample_factory_visit_touch', '7cc0b314f3ed0a355de2b6fba3a3027a'),
  ('trigger', 'sample_factory_visit.sample_factory_visit_validate', 'ed31f0ba8c3fba0ee4bd2bcf51fbcfc7'),
  ('trigger', 'sample_factory_visit_event.sample_factory_visit_event_apply', 'fd3a923628de2cb7c3fa6a210b4ea991'),
  ('trigger', 'sample_factory_visit_event.sample_factory_visit_event_immutable', '2d6c3d77af1818980793e5e51c4ff4e8'),
  ('trigger', 'sample_factory_visit_event.sample_factory_visit_event_validate', '805daf76b1309f3412a018128422e841'),
  ('trigger', 'sample_movement.sample_movement_auto_office_inventory_trigger', 'd885bf0b3e11d54a169d2e7673cdca37'),
  ('trigger', 'sample_movement.sample_movement_guard_trigger', '147f46276521e924da8219778cfafe01'),
  ('trigger', 'sample_movement.sample_movement_immutable_trigger', '0bbd5f47d6c2bfbc409168d76b028ff0'),
  ('trigger', 'sample_movement.sample_movement_project_inventory', 'f23ce358d70733c5aa24419c1275dcd5'),
  ('trigger', 'sample_movement.sample_movement_shipment_identity', '00de1cc0b82da41b30d15394006cc39d'),
  ('trigger', 'sample_path_revision.sample_path_revision_apply', 'ef2624ff6af9dffd4b568d5842ece220'),
  ('trigger', 'sample_path_revision.sample_path_revision_immutable', '6cd2b0e2569037acbe651b5bb27f0883'),
  ('trigger', 'sample_path_revision.sample_path_revision_validate', '55eb5fe8b0b888c3b4a6cfb5ed2cd20d'),
  ('trigger', 'sample_piece_lineage.sample_piece_lineage_validate', 'b0c088cfde310297f94dcec1a5f53043'),
  ('trigger', 'sample_shipment.sample_shipment_route_immutable_after_lines', '6289d587f28ce08e7e8378dc1f38f5d5'),
  ('trigger', 'sample_shipment_line.sample_shipment_line_header_route', 'e9dc8133f3b73fd416b6d001286374ce'),
  ('trigger', 'sample_shipment_line.sample_shipment_line_identity_immutable_after_movement', 'e0e3419d9414181526d3cc31c788cabe'),
  ('trigger', 'sample_workflow.sample_workflow_path_revision_required', 'be69259d1823a2581a2952f275e762bc'),
  ('view', 'sample_approval_current', '67f3220ad48ad073a4e17787ccf276f4'),
  ('view', 'sample_balance_by_location', '147329582bfcf165e0264aa624530cc2'),
  ('view', 'sample_global_status', '5f103ab80118271f30215ace9d280730'),
  ('view', 'sample_in_transit', 'e89c023264f6ce5f85757b667dd3a5ab'),
  ('view', 'sample_inventory', 'b50a75616a917bb0c0a8c8178067b956'),
  ('view', 'sample_open_stop_work', '5bd516efb33f6cba160857c533e832e4'),
  ('view', 'sample_receipt_discrepancy', '647cc3134efc38a6bc337ff2b80980c2'),
  ('view', 'sample_visit_plan', '0dadcc8f2dcf641dc2308b40a65abb50');

-- #2873: the designflow_prod_<service>_grants roles legitimately hold privileges on these
-- objects. Parity is about the canonical definition, so the fingerprint drops only those
-- ACL entries. A GRANT materializes a previously NULL ACL into the owner default, which
-- is indistinguishable from an explicit owner-only ACL, so t2875_bad() accepts an object
-- when either reading ('-' or the explicit default) matches its canonical fingerprint.
create function pg_temp.t2875_acl(p_acl aclitem[], p_default aclitem[]) returns text
language sql stable as $acl$
  select case when p_acl is null then '-'
              when cardinality(f.a) = 0 then '-'
              when f.a = coalesce(p_default, '{}'::aclitem[])
                   and current_setting('t2875.acl_mode', true) = 'collapse' then '-'
              else f.a::text end
  from (select array(select x from unnest(p_acl) with ordinality u(x, o)
                     where x::text !~ '^designflow_prod_[a-z_]+_grants=' order by o) a) f
$acl$;

create temporary view t2875_all as
with rel as (
  select n.nspname s, c.oid, c.relname, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('dflow', 'dflow_prod')
    and (c.relname in (select name from t2875_rel)
         or c.relname in ('sample', 'sample_box', 'sample_shipment_item'))
), fn as (
  select n.nspname s, p.oid, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('dflow', 'dflow_prod') and p.proname in (select name from t2875_fn)
)
select s::text s, 'relation'::text k, relname::text nm, relkind::text || ' acl=' || (select pg_temp.t2875_acl(relacl, acldefault('r', relowner)) from pg_class where oid = rel.oid)
       || ' rls=' || (select relrowsecurity::text from pg_class where oid = rel.oid)
       || ' opts=' || coalesce((select reloptions::text from pg_class where oid = rel.oid), '-')
       || ' cmt=' || coalesce(obj_description(oid, 'pg_class'), '-') d
from rel where relname in (select name from t2875_rel)
union all
select r.s, 'column', r.relname || '.' || a.attname,
       format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text
       || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' acl=' || pg_temp.t2875_acl(a.attacl, null)
       || ' cmt=' || coalesce(col_description(r.oid, a.attnum), '-')
from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
where r.relkind in ('r', 'v')
union all
select r.s, 'constraint', r.relname || '.' || co.conname,
       pg_get_constraintdef(co.oid) || ' cmt=' || coalesce(obj_description(co.oid, 'pg_constraint'), '-')
from rel r join pg_constraint co on co.conrelid = r.oid and co.contype <> 'n'
union all
select r.s, 'index', r.relname || '.' || i.relname,
       pg_get_indexdef(i.oid) || ' cmt=' || coalesce(obj_description(i.oid, 'pg_class'), '-')
from rel r join pg_index x on x.indrelid = r.oid join pg_class i on i.oid = x.indexrelid
union all
select r.s, 'trigger', r.relname || '.' || t.tgname,
       pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text || ' cmt=' || coalesce(obj_description(t.oid, 'pg_trigger'), '-')
from rel r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
union all
select r.s, 'view', r.relname, pg_get_viewdef(r.oid)
from rel r where r.relkind = 'v'
union all
select f.s, 'function', f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
       pg_get_functiondef(f.oid) || ' acl=' || (select pg_temp.t2875_acl(proacl, acldefault('f', proowner)) from pg_proc where oid = f.oid)
       || ' cmt=' || coalesce(obj_description(f.oid, 'pg_proc'), '-')
from fn f;

create temporary view t2875_def as
select * from t2875_all
where k in ('relation', 'view', 'function')
   or split_part(nm, '.', 1) in (select name from t2875_rel)
   or nm in (select item from t2875_delta);

create function pg_temp.t2875_bad() returns table(k text, nm text)
language plpgsql as $bad$
begin
  drop table if exists pg_temp.t2875_bad_collapse, pg_temp.t2875_bad_explicit;
  perform set_config('t2875.acl_mode', 'collapse', true);
  create temporary table t2875_bad_collapse as
    select e.k, e.nm from t2875_expected e
    left join t2875_def a on a.s = 'dflow_prod' and a.k = e.k and a.nm = e.nm
    where a.d is null or md5(a.d) <> e.h;
  perform set_config('t2875.acl_mode', 'explicit', true);
  create temporary table t2875_bad_explicit as
    select e.k, e.nm from t2875_expected e
    left join t2875_def a on a.s = 'dflow_prod' and a.k = e.k and a.nm = e.nm
    where a.d is null or md5(a.d) <> e.h;
  return query select c.k, c.nm from t2875_bad_collapse c
               intersect select x.k, x.nm from t2875_bad_explicit x;
end
$bad$;

do $test$
declare
  v_missing text;
  v_extra text;
  v_count integer;
begin
  -- Every expected object exists in dflow_prod as the right kind of object.
  select string_agg(name, ', ') into v_missing from t2875_rel r
  where not exists (select 1 from pg_class c where c.relnamespace = 'dflow_prod'::regnamespace
                    and c.relname = r.name and c.relkind in ('r', 'v'));
  if v_missing is not null then raise exception '#2875 missing dflow_prod relations: %', v_missing; end if;
  select string_agg(name, ', ') into v_missing from t2875_fn f
  where (select count(*) from pg_proc p where p.pronamespace = 'dflow_prod'::regnamespace and p.proname = f.name) <> 1;
  if v_missing is not null then raise exception '#2875 dflow_prod functions missing or overloaded: %', v_missing; end if;

  -- The surface is closed: no other sample relation or function in dflow_prod,
  -- and nothing on sample, sample_box or sample_shipment_item beyond what was
  -- there before #2875 plus the named Tracking additions.
  select string_agg(c.relname, ', ') into v_extra
  from pg_class c
  where c.relnamespace = 'dflow_prod'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and c.relname like 'sample%'
    and c.relname not in (select name from t2875_rel)
    and c.relname not in (select name from t2875_prior_rel)
    -- Separately proved by dflow_prod_notice_factory_time_parity_contracts.sql.
    and c.relname not in ('sample_shipment_notice', 'sample_shipment_notice_recipient');
  if v_extra is not null then raise exception '#2875 unexpected dflow_prod sample relations: %', v_extra; end if;
  select string_agg(distinct p.proname, ', ') into v_extra
  from pg_proc p
  where p.pronamespace = 'dflow_prod'::regnamespace and p.proname like '%sample%'
    and p.proname not in (select name from t2875_fn)
    -- Only the three exact canonical #3737 functions are outside #2875.
    and p.proname not in ('claim_sample_shipment_notice',
      'prevent_sample_shipment_notice_snapshot_mutation',
      'prevent_sample_shipment_notice_recipient_snapshot_mutation');
  if v_extra is not null then raise exception '#2875 unexpected dflow_prod sample functions: %', v_extra; end if;
  select string_agg(x.item, ', ' order by x.item) into v_extra
  from (
    select 'constraint ' || c.relname || '.' || co.conname item
    from pg_constraint co join pg_class c on c.oid = co.conrelid
    where c.relnamespace = 'dflow_prod'::regnamespace and c.relname in ('sample', 'sample_box', 'sample_shipment_item')
      and co.contype <> 'n'
    union all
    select 'index ' || c.relname || '.' || i.relname
    from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid
    where c.relnamespace = 'dflow_prod'::regnamespace and c.relname in ('sample', 'sample_box', 'sample_shipment_item')
    union all
    select 'trigger ' || c.relname || '.' || t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'dflow_prod'::regnamespace
      and c.relname in ('sample', 'sample_box', 'sample_shipment_item')
    union all
    select 'column ' || c.relname || '.' || a.attname
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where a.attnum > 0 and not a.attisdropped and c.relnamespace = 'dflow_prod'::regnamespace
      and c.relname in ('sample', 'sample_box', 'sample_shipment_item')
  ) x
  where x.item not in (select item from t2875_prior_sub)
    and split_part(x.item, ' ', 2) not in (select item from t2875_delta);
  if v_extra is not null then raise exception '#2875 unexpected additions to existing dflow_prod sample tables: %', v_extra; end if;

  -- Definitional parity: every canonical definition has an identical dflow_prod
  -- twin, and dflow_prod has no Tracking definition canonical dflow lacks.
  select count(*) into v_count from t2875_expected;
  if v_count <> 707 then raise exception '#2875 expected 707 canonical fingerprints, found %', v_count; end if;
  select string_agg(e.k || ' ' || e.nm, ', ' order by e.k, e.nm) into v_missing
  from pg_temp.t2875_bad() e;
  if v_missing is not null then
    raise exception '#2875 dflow_prod differs from canonical dflow (missing or different): %', v_missing;
  end if;
  select string_agg(a.k || ' ' || a.nm, ', ' order by a.k, a.nm) into v_extra
  from t2875_def a
  where a.s = 'dflow_prod'
    and not exists (select 1 from t2875_expected e where e.k = a.k and e.nm = a.nm);
  if v_extra is not null then
    raise exception '#2875 dflow_prod has Tracking definitions canonical dflow lacks: %', v_extra;
  end if;

  -- Nothing in the new surface refers back to dflow.
  if exists (select 1 from t2875_def where s = 'dflow_prod'
             and d ~ '(^|[^A-Za-z0-9_."])dflow\.') then
    raise exception '#2875 a dflow_prod Tracking object references schema dflow';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'dflow_prod'::regnamespace
             and p.proname in (select name from t2875_fn)
             and array_to_string(p.proconfig, ',') ~ '(^|[=, ])dflow($|,)') then
    raise exception '#2875 a dflow_prod Tracking function pins search_path to dflow';
  end if;

  -- Negative control: the parity comparison must notice a changed body.
  begin
    create or replace function dflow_prod.sample_movement_guard() returns trigger
      language plpgsql as $neg$ begin return new; end $neg$;
    select count(*) into v_count from pg_temp.t2875_bad();
    if v_count <> 1 then
      raise exception '#2875 negative control: tampered guard produced % mismatches, expected 1', v_count;
    end if;
    raise exception using errcode = 'P0001', message = 't2875_negative_control_ok';
  exception when raise_exception then
    if sqlerrm <> 't2875_negative_control_ok' then raise; end if;
  end;

  -- No application rows copied: only the four canonical carrier rows exist.
  select count(*) into v_count from dflow_prod.sample_movement;
  if v_count <> 0 then raise exception '#2875 dflow_prod.sample_movement must start empty, found %', v_count; end if;
  select count(*) into v_count from dflow_prod.sample_carrier;
  if v_count <> 4 then raise exception '#2875 expected exactly 4 canonical carriers, found %', v_count; end if;
end
$test$;

rollback;
