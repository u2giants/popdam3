-- Live acceptance canary for #3027 Step 1 (popcre/ai-devops#401): one fully
-- machine-qualified automatic production promotion. Work issue #3043, claim #3044.
-- Catalog-only: adds one nullable, default-less column to the no-op lane canary
-- table from #660, which no application reads or writes and whose privileges
-- are fully revoked. No data, grant, RLS, or application behaviour changes.
alter table plm.production_lane_canary add column step1_acceptance_note text;
