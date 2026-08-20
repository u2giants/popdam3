-- catalog-verification: no-op copies 133 existing rows between two existing tables and creates no catalog object
--
-- Backfill the 133 art pieces that `designflow.art_piece` holds and `dflow.art_piece` does
-- not, so the 266 stranded image links in `plm.art_piece_attachment` have real parents.
--
-- OWNER DECISION
-- --------------
-- Albert Hazan approved this on 2026-08-20 (#1314): "backfill the 133 now". The decision
-- was taken after muse-spark-1.2-contributor argued against holding for #770, on the
-- grounds that waiting ties three small reversible cleanups to one large migration with no
-- schedule -- #770 is gated behind #771, which cannot run at all today.
--
-- WHY A FULL COPY AND NOT PROVISIONAL STUBS
-- -----------------------------------------
-- The reviewer proposed copying id + name only, as provisional stubs, fearing the rows had
-- gone stale since the source froze on 2026-07-10 and a full copy would put six-week-old
-- data into the live schema.
--
-- Measured on 2026-08-20 instead of assumed: all 16 business columns, md5 per row, compared
-- between `designflow.art_piece` and LIVE Cloud SQL DesignFlow production for all 133 ids:
--
--     supabase rows: 133   cloudsql rows: 133   IDENTICAL: 133   DIFFERING: 0
--
-- Not one row has been edited in Cloud SQL since the copy froze. A full copy is therefore
-- not stale -- it is byte-equal to what live production holds right now, so #770 will later
-- find these rows already correct rather than needing to overwrite them. The stub
-- complexity would have bought nothing and left provisional state to clean up.
--
-- PRECONDITIONS, ALL MEASURED ON PRODUCTION 2026-08-20 BEFORE THIS WAS WRITTEN
-- ---------------------------------------------------------------------------
--   * The 133 ids are exactly `designflow.art_piece.id > 1025`. `dflow.art_piece` holds
--     every id up to 1025; the leftover copy simply continued past where dflow stopped.
--   * Column shape is IDENTICAL between the two tables -- a full outer join of
--     information_schema.columns on name and data_type returns no rows.
--   * All THIRTEEN foreign keys on `dflow.art_piece` are satisfied by all 133 rows. This
--     needed checking rather than assuming, because dflow's parents are NOT the ones the
--     source table references: dflow points at `dflow."merchGroup"`, `dflow.users`,
--     `dflow."divisionCode"` and `dflow."SeasonCode"`, whereas `designflow.art_piece`
--     points at `core."merchGroup"`, `app.users`, `plm.divisionCode` and `plm.SeasonCode`.
--     Violations found, per column: licensor_id 0, property_id 0, style_guide_id 0,
--     big_theme_id 0, little_theme_id 0, art_type_id 0, art_source_id 0, artist_id 0,
--     age_group_id 0, season_code_id 0, divisioncode_id 0, created_by 0, updated_by 0.
--     Those thirteen constraints remain live during this apply and will refuse any row
--     that violates them, so referential integrity is enforced by the database, not by a
--     hand-written check in this file.
--   * `art_number` is UNIQUE on `dflow.art_piece`. Collisions between the 133 and existing
--     dflow rows: 0. That constraint also stays live.
--
-- ORDERING -- ALREADY GUARANTEED, WHICH IS WHY THERE IS NO GUARD FOR IT HERE
-- --------------------------------------------------------------------------
-- Inserting ids 1026..1163 while `dflow.art_piece_id_seq` still sat at 1025 would let the
-- live application re-issue the very ids this migration inserts -- the exact bug that made
-- this work necessary.
--
-- `20260820133058` advances that sequence to 10000 and is ALREADY APPLIED TO PRODUCTION
-- (verified by reading production's own ledger and `last_value` on 2026-08-20). Migrations
-- apply in version order, and 20260820133058 < 20260820145950, so no database can reach
-- this file with the sequence still unfixed.
--
-- An earlier draft of this migration re-checked that precondition in a `do $$` block. That
-- was removed for two reasons, and both are worth recording. First, it was redundant with
-- the ordering the ledger already enforces. Second, a `do $$` block is not a data statement,
-- so its presence correctly disqualifies the pure-data declaration on line 1 -- the guard
-- re-lexes the file and refuses a declaration that disagrees with its statements, which it
-- did to this file. The guard was right and the block was the thing that had to go.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   * It does not move the `plm.art_piece_attachment` rows. The PLM side owns that once the
--     parents exist (#778); this migration only makes it possible.
--   * It does not drop `plm.art_piece_attachment` or the leftover `designflow` schema.
--   * It does not touch ids 1024 and 1025, which already collided before the sequence was
--     fixed. Those stay on #778.
--   * `on conflict (id) do nothing` is deliberate and is NOT `do update`: if a row already
--     exists in dflow under one of these ids it belongs to the live application, and this
--     migration has no business overwriting live data with a frozen copy.

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
where id > 1025
on conflict (id) do nothing;
