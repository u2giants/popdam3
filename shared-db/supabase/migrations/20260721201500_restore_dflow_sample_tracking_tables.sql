-- Restore the sample-tracking tables to the dflow (app-runtime) schema.
--
-- Root cause: the schema-segregation migration
-- (docs/designflow-master-data-migration/designflow-schema-segregation.md) moved
-- the sample-tracking tables into the new `plm` schema, but every running
-- DesignFlow service is still pinned to a single SCHEMA=dflow. That left
-- dflow.sample (and its five companions) missing, so Sample Tracking failed at
-- runtime with: relation "dflow.sample" does not exist.
--
-- This recreates the six tables in `dflow`, structurally identical to the `plm`
-- copies (which are empty — 0 rows), so the app finds them alongside every other
-- table it uses. It is additive (touches nothing that already works) and
-- reversible (DROP the six dflow tables).
--
-- One deliberate difference: the plm copy carries
--   sample_comments.user_id -> app.users(id)
-- but dflow's own `users` table has no primary-key constraint (legacy Sequelize
-- schema), so a foreign key cannot reference it. That FK is intentionally omitted;
-- user_id is enforced at the app layer from the verified JWT, matching how the
-- rest of the dflow schema already works. The five intra-cluster FKs are kept,
-- with the same ON UPDATE/DELETE rules as plm.

BEGIN;

-- Referenced tables first, then the sample table, then its children. LIKE does
-- not copy foreign keys, so creation order is not strictly required, but it keeps
-- the intent clear. INCLUDING ALL copies columns, GENERATED-AS-IDENTITY (each
-- table gets its own fresh sequence), primary keys, unique/check constraints and
-- indexes.
CREATE TABLE IF NOT EXISTS dflow.sample_box           (LIKE plm.sample_box           INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dflow.sample_factory_group (LIKE plm.sample_factory_group INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dflow.sample               (LIKE plm.sample               INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dflow.sample_event         (LIKE plm.sample_event         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dflow.sample_comments      (LIKE plm.sample_comments      INCLUDING ALL);
CREATE TABLE IF NOT EXISTS dflow.sample_attachment    (LIKE plm.sample_attachment    INCLUDING ALL);

-- Intra-cluster foreign keys (mirroring plm exactly).
ALTER TABLE dflow.sample
  ADD CONSTRAINT sample_box_id_fk_fkey
  FOREIGN KEY (box_id_fk) REFERENCES dflow.sample_box (box_id_pk)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE dflow.sample
  ADD CONSTRAINT sample_factory_group_id_fk_fkey
  FOREIGN KEY (factory_group_id_fk) REFERENCES dflow.sample_factory_group (factory_group_id_pk)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE dflow.sample_attachment
  ADD CONSTRAINT sample_attachment_sample_id_fk_fkey
  FOREIGN KEY (sample_id_fk) REFERENCES dflow.sample (sample_id_pk)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE dflow.sample_comments
  ADD CONSTRAINT sample_comments_sample_id_fk_fkey
  FOREIGN KEY (sample_id_fk) REFERENCES dflow.sample (sample_id_pk)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE dflow.sample_event
  ADD CONSTRAINT sample_event_sample_id_fk_fkey
  FOREIGN KEY (sample_id_fk) REFERENCES dflow.sample (sample_id_pk)
  ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
