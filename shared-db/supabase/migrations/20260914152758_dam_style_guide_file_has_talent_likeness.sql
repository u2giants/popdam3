-- derived-from: none
--
-- Issue #2802 — record whether a style-guide file's source explicitly indicates
-- talent likeness.
--
-- Structure only. This intake authorizes NO data backfill: every existing row
-- stays NULL, which is the correct "the source exposed no determination" state.
-- The column must remain NULLABLE, because NULL is a distinct third answer and
-- not a stand-in for FALSE.
--
-- The value is never inferred from a filename or path. The raw source filename
-- and label continue to live separately in the existing columns (title,
-- relative_path, folder, metadata), which this migration does not touch.
--
-- Additive per AGENTS.md section 4 rule 3: adding a nullable column cannot
-- break any app already reading dam.style_guide_file.

alter table dam.style_guide_file
  add column has_talent_likeness boolean null;

comment on column dam.style_guide_file.has_talent_likeness is
  'Tri-state talent-likeness determination taken from the style-guide file source (issue #2802). TRUE = the source explicitly indicates talent likeness. FALSE = the source explicitly indicates no talent likeness. NULL = the source exposed no determination, and is never to be read as FALSE. Nullable by design. Never infer this value from a filename, path or title; the raw source filename/label is preserved separately in title, relative_path, folder and metadata.';
