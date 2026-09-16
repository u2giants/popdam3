-- Live acceptance canary for #3027 Step 6 (popcre/ai-devops#401): one governed
-- migration train; each entry comes from its own merged authoring PR.
-- Work issue #3074, claim #3089. Train entry b.
-- Catalog-only: adds one nullable, default-less column to the no-op lane canary
-- table from #660, which no application reads or writes and whose privileges
-- are fully revoked. No data, grant, RLS, or application behaviour changes.
alter table plm.production_lane_canary add column step6_train_note_b text;
