-- Advance dflow.art_piece_id_seq past EVERY art_piece id space in play.
--
-- WHY (live bug, reported 2026-08-20, evidence re-measured against production the same day)
-- ---------------------------------------------------------------------------------------
-- `dflow.art_piece` and the leftover `designflow.art_piece` were split from a common
-- ancestor and the sequence was never advanced. Measured on production
-- qsllyeztdwjgirsysgai on 2026-08-20:
--
--     dflow.art_piece                 981 rows, ids 1..1025, sequence last_value = 1025
--     designflow.art_piece           1114 rows, ids 1..1163      (orphan, frozen 2026-07-10)
--     Cloud SQL designflow.art_piece 1408 rows, ids 1..1465      (LIVE DesignFlow production)
--
-- So dflow re-issues ids that already mean something else. It has already happened: the
-- live app created ids 1024 and 1025 on 2026-07-29 -- "Testing Art Piece" and "Testing
-- again for autocomplete" -- while those same ids in `designflow.art_piece` are real
-- Batman artwork with attachments in `plm.art_piece_attachment` pointing at them. Real
-- image links now resolve to unrelated test records. Every further art piece keeps
-- colliding until the counter clears the highest id ever issued anywhere.
--
-- WHY 10000 AND NOT 1164
-- ----------------------
-- The obvious floor is `max(designflow.art_piece.id) + 1 = 1164`. That is NOT enough, and
-- the difference is the whole point of this migration.
--
--   * The original report proposed 1114. That is the ROW COUNT of designflow.art_piece,
--     not its maximum id (1163). Stopping at 1114 would leave ids 1115..1163 colliding.
--   * Stopping at 1164 would clear the orphan but NOT Cloud SQL, whose live production
--     table is at 1465 and grew by 16 ids in the nine days to 2026-08-20. Issue #770
--     plans to move exactly that data into this database. A sequence set to 1164 today
--     re-creates this identical bug, larger, on the day that migration lands.
--
-- 10000 clears all three id spaces with several years of headroom at the observed rate,
-- and it costs nothing: the column is `integer` (ceiling 2147483647) and the sequence
-- increments by 1, so ~2.1 billion values remain.
--
-- It also buys a diagnostic that a tight number would not: after this migration, an
-- `art_piece.id` below 10000 came from a pre-split copy, and one at or above 10000 was
-- issued by dflow afterwards. That boundary makes the #770 reconciliation unambiguous.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
--   * It does not backfill the 133 art pieces that `designflow.art_piece` has and
--     `dflow.art_piece` does not. That is a business decision (backfill or write off) and
--     is not a structural change.
--   * It does not move the 270 `plm.art_piece_attachment` rows, and does not drop that
--     table. The PLM side owns that once the ids are safe (#778).
--   * It does not touch ids 1024 and 1025, which are already wrong. Re-pointing or
--     renumbering existing rows is a data decision with application consequences, and
--     silently renumbering a live table from a schema migration would be exactly the kind
--     of invisible change this repository exists to prevent. Advancing the sequence stops
--     the bleeding; it does not pretend to heal what already bled.
--
-- SAFETY
-- ------
--   * The sequence is only ever moved FORWARD. If it is already at or past the target the
--     migration leaves it untouched and says so. Moving a sequence backwards would hand
--     out ids that are already taken, which is worse than the bug being fixed.
--   * The target is `greatest(10000, max(dflow.art_piece.id))`, so it can never be set
--     below a value the table has already used, even if rows arrive between authoring and
--     apply.
--   * Every object is resolved through `to_regclass`, so a from-empty replay or any
--     database without `dflow` is a clean no-op rather than an abort (#1258).
--   * Apply-time data reads, in full: `max(id)` over `dflow.art_piece` in each of the two
--     blocks, plus a guarded `max(id)` over `designflow.art_piece` in the verify block
--     where that orphan exists -- THREE, each a backward B-tree descent on a primary key
--     rather than a scan, alongside the sequence state read and the to_regclass lookups.
--     Nothing here scales with production volume, which is the failure mode that made
--     20260819151536 unappliable.

do $$
declare
  v_floor    bigint := 10000;
  v_target   bigint;
  v_current  bigint;
  v_max_id   bigint;
  v_is_called boolean;
  v_next     bigint;
begin
  if to_regclass('dflow.art_piece_id_seq') is null then
    raise notice 'dflow.art_piece_id_seq is absent; nothing to advance (from-empty replay).';
    return;
  end if;

  if to_regclass('dflow.art_piece') is null then
    v_max_id := 0;
  else
    execute 'select coalesce(max(id), 0) from dflow.art_piece' into v_max_id;
  end if;

  -- is_called matters: when it is false, nextval returns last_value ITSELF, not
  -- last_value + 1. Reading only last_value would make both the skip decision and the
  -- reported next id off by one. That state is unreachable from the measured production
  -- state, but `setval(seq, max(id), false)` would reach it and would still issue a
  -- colliding id, so it is handled rather than assumed away.
  execute 'select last_value, is_called from dflow.art_piece_id_seq' into v_current, v_is_called;
  v_next := case when v_is_called then v_current + 1 else v_current end;

  -- Never below what the table has already issued, never below the floor.
  v_target := greatest(v_floor, v_max_id);

  if v_next > v_target then
    raise notice 'dflow.art_piece_id_seq would next issue % (target %); left unchanged. Sequences are never moved backwards.',
      v_next, v_target;
    return;
  end if;

  perform setval('dflow.art_piece_id_seq', v_target, true);

  raise notice 'dflow.art_piece_id_seq advanced from % to %; next id will be %.',
    v_current, v_target, v_target + 1;
end $$;

-- Verification. Catalogue and sequence state only; the data reads are max(id) over a
-- primary key, in each case a backward B-tree descent rather than a scan.
-- Cloud SQL is NOT asserted and cannot be: it is a different database this migration has
-- no connection to. Its ceiling is why 10000 was chosen and is recorded in the header.
-- designflow.art_piece IS asserted, guarded by to_regclass, so the check runs where the
-- orphan exists and skips where it does not.
do $$
declare
  v_current    bigint;
  v_max_id     bigint;
  v_orphan_max bigint;
begin
  if to_regclass('dflow.art_piece_id_seq') is null then
    raise notice 'verification skipped: dflow.art_piece_id_seq absent.';
    return;
  end if;

  execute 'select last_value from dflow.art_piece_id_seq' into v_current;

  if to_regclass('dflow.art_piece') is null then
    v_max_id := 0;
  else
    execute 'select coalesce(max(id), 0) from dflow.art_piece' into v_max_id;
  end if;

  if v_current < 10000 then
    raise exception 'dflow_art_piece_seq_below_floor: sequence is at %, expected at least 10000. The id-collision fix did not take effect.',
      v_current;
  end if;

  if v_current < v_max_id then
    raise exception 'dflow_art_piece_seq_below_max_id: sequence is at % but the table already uses id %. The next insert would collide.',
      v_current, v_max_id;
  end if;

  -- The orphan ceiling, asserted where the orphan EXISTS and skipped where it does not.
  -- An earlier draft skipped this entirely, arguing that an assertion which cannot run
  -- everywhere is not a guard. Review (#1313) correctly called that out as conflating
  -- "cannot run" with "must be unconditional": a to_regclass-guarded assert runs
  -- everywhere -- asserting where the object is present, skipping where it is absent --
  -- and this same file already uses that idiom for dflow.art_piece. Cloud SQL genuinely
  -- cannot be asserted from here, because it is a different database; that exclusion
  -- stands and is recorded in the header instead.
  if to_regclass('designflow.art_piece') is not null then
    execute 'select coalesce(max(id), 0) from designflow.art_piece' into v_orphan_max;
    if v_current < v_orphan_max then
      raise exception 'dflow_art_piece_seq_below_orphan_max: sequence is at % but designflow.art_piece uses id %. New ids would collide with the leftover copy.',
        v_current, v_orphan_max;
    end if;
    raise notice 'orphan ceiling checked: designflow.art_piece max id = %, cleared.', v_orphan_max;
  else
    raise notice 'orphan ceiling not checked: designflow.art_piece is absent here (expected on preview and on a from-empty replay).';
  end if;

  raise notice 'VERIFIED: dflow.art_piece_id_seq = %, table max id = %, next id = %. Clears dflow (1025), the designflow orphan (1163) and Cloud SQL production (1465 on 2026-08-20).',
    v_current, v_max_id, v_current + 1;
end $$;
