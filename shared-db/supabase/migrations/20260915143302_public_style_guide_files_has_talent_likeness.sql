-- derived-from: none
--
-- Issue #2911 - expose the nullable has_talent_likeness contract on
-- public.style_guide_files, the live table PopDAM/PopSG crawls upsert into.
--
-- Same semantics as dam.style_guide_file.has_talent_likeness (issue #2802):
-- TRUE = the source explicitly indicates talent likeness, FALSE = the source
-- explicitly indicates no talent likeness, NULL = no determination.
--
-- Structure only. No default and no backfill: every existing row stays NULL.
-- Nullable by design; NULL is a distinct third answer, never FALSE. Existing
-- grants and RLS policies are table-level and are left unchanged.
--
-- Semantics are recorded here rather than in a column COMMENT so the change
-- touches exactly the admitted object, table public.style_guide_files.
--
-- Additive per AGENTS.md section 4 rule 3.

alter table public.style_guide_files
  add column has_talent_likeness boolean null;
