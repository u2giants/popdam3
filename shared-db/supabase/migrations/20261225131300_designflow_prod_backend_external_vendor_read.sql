-- #4707 Lane G3 (claim #7123): the Backend item workspace read path
-- (designflow-backend services/designflowItemRead.service.js resolveVendorCodes)
-- maps a vendor user's email to vendor codes. The Backend runtime had no read
-- on dflow_prod."externalVendor", so every vendor request returned HTTP 500.
-- Column-scoped SELECT on exactly the two columns read; no write.
-- derived-from: none

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant select (email, "vendorCode") on dflow_prod."externalVendor" to designflow_prod_backend_grants;

commit;
