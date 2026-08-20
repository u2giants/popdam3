-- catalog-verification: no-op moves two rows to new ids and copies two rows between existing tables, creating no catalog object
--
-- Give `dflow.art_piece` ids 1024 and 1025 back to the real Batman artwork, and move the two
-- test records that are squatting on them to fresh ids.
--
-- OWNER DECISION
-- --------------
-- Albert Hazan, 2026-08-20, answering #1326 with **option B** — renumber the test records
-- rather than leave them (A) or delete them (C). B keeps everything and puts the artwork back
-- where its image links already point.
--
-- WHAT WENT WRONG IN THE FIRST PLACE
-- ----------------------------------
-- `dflow.art_piece` and the leftover `designflow.art_piece` were split from a common ancestor
-- and the id sequence was never advanced. On 2026-07-29 the live app issued ids 1024 and 1025
-- to two test records, while those same ids in the frozen copy are real Batman artwork:
--
--     id    dflow.art_piece (live)              designflow.art_piece (frozen)
--     1024  "Testing Art Piece"                 "Batman and Catwoman in a dynamic..."
--     1025  "Testing again for autocomplete"    "Batman running in a dynamic pose..."
--
-- Four rows in `plm.art_piece_attachment` point at 1024/1025. They were captured from the
-- frozen copy, so they were always meant for the Batman artwork; today they resolve to test
-- records. After this migration they resolve to the artwork, which is the point of option B.
--
-- `20260820133058` already advanced the sequence to 10000 so this cannot recur. It
-- deliberately did NOT renumber these two rows, because silently renumbering live rows from
-- inside a schema migration is exactly the invisible change this repository exists to prevent.
-- This file does it as a visible, owner-approved, reviewed change instead.
--
-- THE FINDING THAT SHAPES THIS MIGRATION: art_number ENCODES THE ID
-- ----------------------------------------------------------------
-- `art_number` is not free text. Measured on production 2026-08-20 across ALL 1,114 rows of
-- `dflow.art_piece`: **zero nulls, and zero rows whose art_number does not end in
-- `-<5-digit zero-padded id>`** (`PDCBM-01023` for id 1023). It is a strict invariant today.
--
-- So renumbering a row without correcting its art_number would BREAK an invariant that
-- currently holds universally, and would do so silently. This migration therefore updates the
-- suffix and leaves the prefix — which appears to carry licensor/property meaning — untouched.
--
-- The incoming Batman rows need no such treatment: their art_numbers are already
-- `PDCBM-01024` and `PDCBM-01025`, which satisfy the invariant at their restored ids.
--
-- PRECONDITIONS, ALL MEASURED ON PRODUCTION BEFORE THIS WAS WRITTEN
-- ----------------------------------------------------------------
--   * `dflow.art_piece_attachment` rows pointing at 1024 or 1025: **0**. So renumbering the
--     test records cannot orphan a live attachment. This was the main risk and it is absent.
--   * `plm.art_piece_attachment` has **no foreign key** to `art_piece` — only companyCode and
--     divisionCode. Its 4 rows follow the ids numerically, which is why this works at all.
--   * `PDCBM-01024` and `PDCBM-01025` do not exist in `dflow.art_piece`: **0 collisions**
--     against the unique constraint `art_piece_art_number_key`.
--   * ids 10001 and 10002 are unused. New ids are nonetheless allocated with `nextval`, not
--     hard-coded, so the sequence hands them out and no future insert can collide with them.
--
-- ORDER MATTERS AND IS ENFORCED BY STATEMENT ORDER
-- ------------------------------------------------
-- The test records must vacate 1024/1025 before the Batman rows can occupy them, or the
-- insert violates the primary key. Both statements run in one per-file transaction, so a
-- failure at either point leaves the table exactly as it was.
--
-- WHAT THIS DOES NOT DO
--   * It does not touch the 133 rows backfilled by `20260820145950`, or any other id.
--   * It does not move or drop `plm.art_piece_attachment` — that is #1327.
--   * It does not delete anything. Option C was available and was not chosen.

-- 1. Move the two test records off 1024/1025, taking fresh ids from the sequence and
--    correcting the art_number suffix so the id-encoding invariant still holds.
--    `regexp_replace` rewrites only the trailing `-<digits>` group; the prefix is preserved.
--    MATERIALIZED is deliberate and load-bearing: `nextval` is volatile, and an inlined CTE
--    could evaluate it more than once per row. Materialising pins each row to exactly one new
--    id. Which of the two test records receives which id is not specified and does not matter.
with moved as materialized (
  select
    id                                as old_id,
    nextval('dflow.art_piece_id_seq') as new_id
  from dflow.art_piece
  where id in (1024, 1025)
)
update dflow.art_piece a
   set id         = m.new_id,
       art_number = regexp_replace(a.art_number, '-[0-9]+$', '-' || lpad(m.new_id::text, 5, '0'))
  from moved m
 where a.id = m.old_id;

-- 2. Restore the Batman artwork to the ids it holds in the frozen copy. Every column is named
--    on both sides, in the same order, so a physical-order difference between the tables
--    cannot transpose anything and a name error is a loud `undefined column`.
insert into dflow.art_piece (
  id, art_description, art_display_description, licensor_id, property_id, style_guide_id,
  big_theme_id, little_theme_id, art_type_id, art_source_id, artist_id, season_code_id,
  age_group_id, divisioncode_id, created_at, created_by, updated_at, updated_by,
  is_active, tags, art_number
)
select
  id, art_description, art_display_description, licensor_id, property_id, style_guide_id,
  big_theme_id, little_theme_id, art_type_id, art_source_id, artist_id, season_code_id,
  age_group_id, divisioncode_id, created_at, created_by, updated_at, updated_by,
  is_active, tags, art_number
from designflow.art_piece
where id in (1024, 1025)
on conflict (id) do nothing;
