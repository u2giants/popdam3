-- shared-db issue #6239 - drop the empty leftover landing schema dflow_prod_old.
-- Owner authorization (Albert Hazan, chat 2026-11-13, verbatim: "drop the empty shelf").
-- Evidence: popcre/designflow-data-syncing#126 - zero readers; 127 empty tables, 0 rows,
-- measured 2026-11-13 through the pooler as postgres.qsllyeztdwjgirsysgai.
-- Backup: gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_prod_old_schema.dump
--
-- CASCADE is required and safe here: RESTRICT refuses to drop a schema that still
-- CONTAINS objects (the 127 empty tables), and CASCADE can only reach outside
-- dependents - the 2026-11-13 audit on designflow-data-syncing#126 proved there
-- are none (no view, function, trigger, foreign key or API exposure references
-- this schema). Review finding #6241 caught the RESTRICT mistake.

drop schema if exists dflow_prod_old cascade;
