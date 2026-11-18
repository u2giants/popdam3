-- Store the author account independently of its display name.
-- Existing notes retain NULL when their original author cannot be verified.
ALTER TABLE plm.grid_cell_notes
  ADD COLUMN IF NOT EXISTS note_author_user_id integer;

ALTER TABLE IF EXISTS dflow_prod.grid_cell_notes
  ADD COLUMN IF NOT EXISTS note_author_user_id integer;
