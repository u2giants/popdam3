-- Widen dflow.comments.comment from VARCHAR(50) to VARCHAR(500).
--
-- The legacy PLM `dflow.comments` table stores item-detail comments as Quill
-- HTML (spaces encoded as &nbsp;), so even a short two-line comment overflowed
-- the 50-char column and the insert failed with a 500. The Sequelize model
-- (designflow-backend) and the API validation both already expect 500; this
-- aligns the shared database to that contract.
--
-- Safe/idempotent: ALTER TABLE IF EXISTS skips cleanly if the dflow schema is
-- absent (e.g. on a preview branch that has not run the app's legacy migrations),
-- and widening an already-500 column is a no-op. Additive (a widen), so no app
-- that reads this column can break.
alter table if exists dflow."comments"
  alter column comment type varchar(500);
