-- Issue #4570. Version reserved by migration-author claim #4571.
-- DesignFlow Production Tracking / Licensing Tracking Archive and Unarchive
-- (application PR popcre/designflow-frontend#352).
--
-- Owner ruling (Albert, chat, verbatim): "an archived order disappears only
-- from those two tracking screens and stays unchanged everywhere else." and
-- "everything archived anywhere in the system must be restorable with
-- Unarchive."
--
-- A side table, not a flag on the order/item tables: archiving changes no
-- existing row, so every other query in the system is unaffected. Only the two
-- tracking grid queries anti-join this table. Unarchive deletes the row.
--   grid_type 'prod_tracking'      -> row_id = production order header id
--   grid_type 'licensing_tracking' -> row_id = itemHeader item_id_pk
-- row_id is deliberately NOT a foreign key: the tracking service reads those
-- tables through its table-schema map (schema differs by environment).
-- Archived is distinct from Closed; no status logic changes.
--
-- No GRANT/RLS: dflow is not PostgREST-exposed; the backend connects as the
-- owning role, matching every other dflow.* table (precedent 20261021150012).
-- Rollback: drop table dflow.tracking_grid_archive.

set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists dflow.tracking_grid_archive (
  grid_type text not null
    check (grid_type in ('prod_tracking', 'licensing_tracking')),
  row_id bigint not null,
  archived_at timestamptz not null default clock_timestamp(),
  archived_by_user_id integer,
  primary key (grid_type, row_id)
);

comment on table dflow.tracking_grid_archive is
  'Rows hidden from the Production/Licensing Tracking grids by Archive; delete the row to Unarchive (#4570).';
