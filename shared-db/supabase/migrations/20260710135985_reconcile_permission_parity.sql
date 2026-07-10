-- Keep preview/production service_role permissions aligned after the broad
-- reconciliation grant above. Production does not currently grant service_role
-- blanket access to api objects or the style-tracker bridge tables in plm.

revoke execute on all functions in schema api from service_role;
grant execute on function api.crm_customer_logo_url(jsonb, text) to service_role;

revoke all privileges on table
  api.art_piece_library,
  api.crm_contact_segment_counts,
  api.crm_contact_segment_list,
  api.crm_customer_list,
  api.crm_customer_overview,
  api.crm_ingested_domain_list,
  api.pm_product_board
from service_role;

revoke all privileges on table
  plm.style_tracker_item_bridge,
  plm.style_tracker_value_resolution
from service_role;
