-- =====================================================================================
-- Contract tests for migration 20260813020000 -- issue #862, pinning a non-mutable
-- search_path on five SECURITY DEFINER functions that PopDAM calls in production.
--
-- -------------------------------------------------------------------------------------
-- HOW THIS FILE IS RUN, AND WHAT ITS RESULT MEANS
--   CI executes it (`.github/workflows/database-contract-tests.yml`) against a THROWAWAY
--   local database built by replaying supabase/migrations from empty. IT IS WRITTEN TO
--   PASS FROM EMPTY and must stay that way -- it must never end up in
--   supabase/tests/ci-quarantine.txt. It seeds every row it needs, with invented
--   `ZZTEST-862` values only, and rolls all of them back.
--
--   It must run as the migration owner (postgres / supabase_admin). Section A proves the
--   objects exist BEFORE anything else runs, so a wrong connection fails once, clearly.
--
-- SIDE EFFECTS: NONE. Every write happens inside one transaction that ends in ROLLBACK,
--   and section F re-asserts that against committed state.
--
-- WHY THIS FILE IS LONGER THAN THE MIGRATION IT GUARDS
--   Asserting `proconfig` is now set proves the ALTER RAN. It does not prove the five
--   functions still WORK. Pinning a search_path is precisely the change that breaks a
--   body which was silently relying on an inherited path to resolve an unqualified name,
--   and all five of these have a live consumer in popdam3:
--     supabase/functions/agent-api/index.ts       -> claim_pdf_backfill_batch,
--                                                    count_pdf_backfill_remaining,
--                                                    bulk_insert_pdf_text_samples
--     supabase/functions/admin-api/index.ts       -> count_pdf_backfill_remaining
--     _shared/admin-handlers/ai-duplicate-handlers.ts -> find_ai_pdf_duplicates
--     _shared/admin-handlers/ai-sentinel-handlers.ts  -> get_ai_sentinel_stats
--   So sections B-E call each one the way its real caller calls it (same arguments, same
--   expected return shape) and assert the RESULTS, not the catalog.
--
-- THE ASSERTION THAT ACTUALLY PROVES THE SECURITY FIX (section E)
--   Every call in section E runs with the caller's own search_path set to the empty
--   string. Before the migration that would make these bodies fail to resolve `assets`
--   at all; after it, the pinned path makes the caller's path irrelevant. That is the
--   whole point of the fix, so it is asserted directly rather than inferred.
--
-- COUNT ASSERTIONS ARE DELTAS, NEVER ABSOLUTES. These functions count whole tables. A
--   from-empty database and a deployed one hold different totals, so every check
--   captures a baseline first and asserts the CHANGE. That keeps the file honest on
--   preview and production too, where it is expected to be run by hand.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. PRECONDITIONS + THE CATALOG FACT (necessary, and by itself not sufficient).
-- =====================================================================================
do $$
declare
  v_bad text;
  v_n   int;
  v_names text[] := array[
    'bulk_insert_pdf_text_samples',
    'claim_pdf_backfill_batch',
    'count_pdf_backfill_remaining',
    'find_ai_pdf_duplicates',
    'get_ai_sentinel_stats'];
begin
  -- The five exist, in public.
  select count(*) into v_n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = any(v_names);

  if v_n <> 5 then
    raise exception 'A FAILED: expected exactly 5 functions in public named %, found %. '
      'A count ABOVE 5 means an OVERLOAD now exists that migration 20260813020000 does '
      'not alter, and an overload with a mutable search_path is the same vulnerability '
      'left open under a different signature.', v_names, v_n;
  end if;

  -- All five are still SECURITY DEFINER. If one were flipped to INVOKER the pin would
  -- be pointless AND the popdam3 service-role callers would change behaviour.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = any(v_names)
    and not p.prosecdef;
  if v_bad is not null then
    raise exception 'A FAILED: no longer SECURITY DEFINER: %', v_bad;
  end if;

  -- Every one carries the pinned path, exactly.
  select string_agg(format('%s -> %s', p.proname,
                           coalesce(array_to_string(p.proconfig, ' | '), '<none>')), ', ')
    into v_bad
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = any(v_names)
    and not coalesce(p.proconfig, '{}'::text[]) && array['search_path=pg_catalog, public'];
  if v_bad is not null then
    raise exception 'A FAILED: migration 20260813020000 did not pin search_path on: %', v_bad;
  end if;

  -- pg_temp must NOT be in a definer function's path -- that is the same escalation
  -- hole wearing a different hat.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = any(v_names)
    and array_to_string(p.proconfig, ',') like '%pg_temp%';
  if v_bad is not null then
    raise exception 'A FAILED: pg_temp appears in the pinned path of: %', v_bad;
  end if;

  -- The helper the two backfill functions call is schema-qualified in their bodies and
  -- must exist, or sections B/C would fail for an unrelated reason.
  if to_regprocedure('public.is_style_guide_source_pdf(text, text)') is null then
    raise exception 'A FAILED: public.is_style_guide_source_pdf(text,text) is absent.';
  end if;

  raise notice 'A OK: 5 functions, no overloads, all SECURITY DEFINER, all pinned to '
    'search_path=pg_catalog, public, none carrying pg_temp.';
end
$$;

begin;

-- =====================================================================================
-- FIXTURE. Four invented assets, all under a ZZTEST-862 path that cannot collide with
-- real DAM data. Only NOT NULL columns are given values.
--
--   A1  pdf, "ZZTEST-862 Licensing Sheet.pdf"  -> matches is_style_guide_source_pdf, no
--                                                 sample yet, so it is BACKFILL WORK
--   A2  pdf, "ZZTEST-862 Tech Pack.pdf"        -> same, second unit of backfill work
--   A3  ai , "ZZTEST-862 Duplicate.ai"         -> the AI-sentinel / duplicate subject
--   A4  pdf, "ZZTEST-862 Duplicate.pdf"        -> same folder + same base name as A3, so
--                                                 A3 becomes an AI/PDF duplicate. Its
--                                                 filename deliberately does NOT match
--                                                 the style-guide predicate, so it adds
--                                                 no backfill work and the two deltas
--                                                 stay independent.
-- =====================================================================================
create temporary table zztest_862_assets (label text primary key, id uuid) on commit drop;

-- BASELINE FIRST, before a single fixture row exists. Every later assertion is a delta
-- from this, so the file is equally valid on an empty CI database and on preview or
-- production, where these tables already hold millions of rows.
create temporary table zztest_862_baseline on commit drop as
select public.count_pdf_backfill_remaining() as backfill_remaining,
       public.get_ai_sentinel_stats()        as sentinel_stats;

insert into public.assets (filename, relative_path, file_type, quick_hash, modified_at)
values ('ZZTEST-862 Licensing Sheet.pdf', 'zztest-862/ZZTEST-862 Licensing Sheet.pdf',
        'pdf', 'zztest-862-hash-a1', now()),
       ('ZZTEST-862 Tech Pack.pdf',       'zztest-862/ZZTEST-862 Tech Pack.pdf',
        'pdf', 'zztest-862-hash-a2', now()),
       ('ZZTEST-862 Duplicate.ai',        'zztest-862/ZZTEST-862 Duplicate.ai',
        'ai',  'zztest-862-hash-a3', now()),
       ('ZZTEST-862 Duplicate.pdf',       'zztest-862/ZZTEST-862 Duplicate.pdf',
        'pdf', 'zztest-862-hash-a4', now());

insert into zztest_862_assets (label, id)
select case a.filename
         when 'ZZTEST-862 Licensing Sheet.pdf' then 'A1'
         when 'ZZTEST-862 Tech Pack.pdf'       then 'A2'
         when 'ZZTEST-862 Duplicate.ai'        then 'A3'
         when 'ZZTEST-862 Duplicate.pdf'       then 'A4'
       end,
       a.id
from public.assets a
where a.relative_path like 'zztest-862/%';

-- =====================================================================================
-- B. count_pdf_backfill_remaining()  and  claim_pdf_backfill_batch(p_limit)
--    Real callers: agent-api/index.ts  db.rpc("claim_pdf_backfill_batch", {p_limit: 25})
--                  and db.rpc("count_pdf_backfill_remaining") with no arguments;
--                  admin-api/index.ts reads the count for its progress total.
-- =====================================================================================
do $$
declare
  v_before  bigint;
  v_after   bigint;
  v_a1      uuid := (select id from zztest_862_assets where label = 'A1');
  v_a2      uuid := (select id from zztest_862_assets where label = 'A2');
  v_rows    int;
  v_needs   boolean;
begin
  select b.backfill_remaining into v_before from zztest_862_baseline b;
  v_after := public.count_pdf_backfill_remaining();

  -- EXACTLY two units of new work. Not "at least" -- A1 and A2 match the style-guide
  -- predicate, A3 is not a pdf and A4 is a pdf with a non-matching name, so a delta of
  -- anything other than 2 means the predicate or the NOT EXISTS stopped resolving.
  if v_after <> v_before + 2 then
    raise exception 'B FAILED: count_pdf_backfill_remaining() went % -> % after adding '
      'exactly 2 qualifying assets. Expected % .', v_before, v_after, v_before + 2;
  end if;

  -- Both fixture rows are claimable, and each carries needs_thumbnail = true because
  -- neither has a thumbnail_url. agent-api reads exactly these four columns.
  select count(*) into v_rows
  from public.claim_pdf_backfill_batch(1000) c
  where c.id in (v_a1, v_a2);
  if v_rows <> 2 then
    raise exception 'B FAILED: claim_pdf_backfill_batch(1000) returned % of the 2 '
      'fixture assets. Expected both.', v_rows;
  end if;

  select bool_and(c.needs_thumbnail) into v_needs
  from public.claim_pdf_backfill_batch(1000) c
  where c.id in (v_a1, v_a2);
  if v_needs is not true then
    raise exception 'B FAILED: needs_thumbnail was not true for assets with a NULL '
      'thumbnail_url. The agent uses this flag to decide whether to render one.';
  end if;

  -- A4 is a pdf but not a licensing sheet / tech pack, so the predicate must exclude it.
  if exists (select 1 from public.claim_pdf_backfill_batch(1000) c
             where c.id = (select id from zztest_862_assets where label = 'A4')) then
    raise exception 'B FAILED: a non-style-guide pdf was claimed as backfill work. '
      'public.is_style_guide_source_pdf is no longer being applied.';
  end if;

  -- p_limit is honoured (the caller passes 25 and depends on a bounded batch).
  select count(*) into v_rows from public.claim_pdf_backfill_batch(1) c;
  if v_rows <> 1 then
    raise exception 'B FAILED: claim_pdf_backfill_batch(1) returned % rows, expected 1.', v_rows;
  end if;

  raise notice 'B OK: backfill count % -> % (exactly +2); claim returns both, flags '
    'thumbnails, excludes non-style-guide pdfs and honours p_limit.', v_before, v_after;
end
$$;

-- =====================================================================================
-- C. bulk_insert_pdf_text_samples(p_rows jsonb)
--    Real caller: agent-api/index.ts db.rpc("bulk_insert_pdf_text_samples", {p_rows}),
--    where each element carries asset_id, filename, relative_path, extraction_method,
--    extracted_text, page_count, char_count and thumbnail_url. It returns a row count.
--    This is the only one of the five that WRITES, and the only plpgsql body -- it is
--    also the one that sets a custom GUC and fires triggers, so it is the most exposed
--    to a search_path change.
-- =====================================================================================
do $$
declare
  v_a1        uuid := (select id from zztest_862_assets where label = 'A1');
  v_inserted  int;
  v_reupsert  int;
  v_text      text;
  v_remaining bigint;
begin
  v_inserted := public.bulk_insert_pdf_text_samples(
    jsonb_build_array(jsonb_build_object(
      'asset_id',          v_a1::text,
      'filename',          'ZZTEST-862 Licensing Sheet.pdf',
      'relative_path',     'zztest-862/ZZTEST-862 Licensing Sheet.pdf',
      'extraction_method', 'zztest-862-method',
      'extracted_text',    'ZZTEST-862 extracted body text.',
      'page_count',        2,
      'char_count',        31,
      'thumbnail_url',     null
    )));

  if v_inserted <> 1 then
    raise exception 'C FAILED: bulk_insert_pdf_text_samples returned %, expected 1.', v_inserted;
  end if;

  select pts.extracted_text into v_text
  from public.pdf_text_samples pts where pts.asset_id = v_a1;
  if v_text is distinct from 'ZZTEST-862 extracted body text.' then
    raise exception 'C FAILED: the row was not written as sent (extracted_text = %).',
      coalesce(v_text, '<null>');
  end if;

  -- The upsert path (ON CONFLICT (asset_id)) still works -- the agent re-sends a sample
  -- whenever a file is re-extracted.
  v_reupsert := public.bulk_insert_pdf_text_samples(
    jsonb_build_array(jsonb_build_object(
      'asset_id',          v_a1::text,
      'filename',          'ZZTEST-862 Licensing Sheet.pdf',
      'relative_path',     'zztest-862/ZZTEST-862 Licensing Sheet.pdf',
      'extraction_method', 'zztest-862-method-v2',
      'extracted_text',    'ZZTEST-862 re-extracted body text.',
      'page_count',        3,
      'char_count',        34,
      'thumbnail_url',     null
    )));

  if v_reupsert <> 1 then
    raise exception 'C FAILED: the upsert re-send returned %, expected 1.', v_reupsert;
  end if;

  if (select count(*) from public.pdf_text_samples pts where pts.asset_id = v_a1) <> 1 then
    raise exception 'C FAILED: the re-send duplicated the row instead of upserting it.';
  end if;

  select pts.extracted_text into v_text
  from public.pdf_text_samples pts where pts.asset_id = v_a1;
  if v_text is distinct from 'ZZTEST-862 re-extracted body text.' then
    raise exception 'C FAILED: the upsert did not overwrite extracted_text (got %).',
      coalesce(v_text, '<null>');
  end if;

  -- The two functions agree with each other: sampling A1 removes exactly one unit of
  -- outstanding backfill work. This is the invariant admin-api's progress bar rests on.
  v_remaining := public.count_pdf_backfill_remaining();
  if v_remaining <> (select b.backfill_remaining + 1 from zztest_862_baseline b) then
    raise exception 'C FAILED: after sampling one of the two fixture assets the '
      'remaining count is %, expected baseline + 1 = %.',
      v_remaining, (select b.backfill_remaining + 1 from zztest_862_baseline b);
  end if;
  if exists (select 1 from public.claim_pdf_backfill_batch(1000) c where c.id = v_a1) then
    raise exception 'C FAILED: A1 is still claimable after it was sampled -- the '
      'NOT EXISTS predicate against public.pdf_text_samples is not resolving.';
  end if;

  raise notice 'C OK: insert -> 1, upsert -> 1 and overwrote, A1 left the backfill '
    'queue (remaining now %).', v_remaining;
end
$$;

-- =====================================================================================
-- D. find_ai_pdf_duplicates()  and  get_ai_sentinel_stats()
--    Real callers: ai-duplicate-handlers.ts db.rpc("find_ai_pdf_duplicates") -- no
--    arguments, reads id/filename/relative_path/thumbnail_url/style_group_id -- and
--    ai-sentinel-handlers.ts db.rpc("get_ai_sentinel_stats"), which returns one jsonb
--    object with five integer keys.
-- =====================================================================================
do $$
declare
  v_a3        uuid := (select id from zztest_862_assets where label = 'A3');
  v_a4        uuid := (select id from zztest_862_assets where label = 'A4');
  v_row       record;
  v_stats     jsonb;
  v_stats2    jsonb;
  v_stats3    jsonb;
  v_sentinel  text := 'This is an Adobe' || chr(174) || ' Illustrator' || chr(174)
                      || ' File that was saved without PDF Content.';
begin
  -- The .ai file with a same-named .pdf beside it is reported...
  select * into v_row from public.find_ai_pdf_duplicates() d where d.id = v_a3;
  if not found then
    raise exception 'D FAILED: find_ai_pdf_duplicates() did not report A3, which has a '
      'same-folder, same-base-name .pdf sibling.';
  end if;
  if v_row.filename is distinct from 'ZZTEST-862 Duplicate.ai'
     or v_row.relative_path is distinct from 'zztest-862/ZZTEST-862 Duplicate.ai' then
    raise exception 'D FAILED: the duplicate row came back with the wrong columns '
      '(filename %, relative_path %).', v_row.filename, v_row.relative_path;
  end if;

  -- ...and the .pdf sibling itself is NOT (the function returns .ai files only).
  if exists (select 1 from public.find_ai_pdf_duplicates() d where d.id = v_a4) then
    raise exception 'D FAILED: a .pdf asset was returned by find_ai_pdf_duplicates().';
  end if;

  -- get_ai_sentinel_stats: assert the DELTAS the fixture is responsible for.
  v_stats := public.get_ai_sentinel_stats();
  if v_stats is null or jsonb_typeof(v_stats) <> 'object' then
    raise exception 'D FAILED: get_ai_sentinel_stats() did not return a jsonb object.';
  end if;
  if not (v_stats ? 'total_ai' and v_stats ? 'sampled' and v_stats ? 'sentinel_pending'
          and v_stats ? 'cleaned_up' and v_stats ? 'no_replacement_found') then
    raise exception 'D FAILED: the stats object is missing a key the PopDAM admin UI '
      'renders. Got keys: %', (select string_agg(k, ', ') from jsonb_object_keys(v_stats) k);
  end if;

  -- A3 is the only .ai asset the fixture adds, so total_ai must be exactly one above
  -- the pre-fixture baseline.
  if (v_stats->>'total_ai')::bigint
     <> (select (b.sentinel_stats->>'total_ai')::bigint + 1 from zztest_862_baseline b) then
    raise exception 'D FAILED: total_ai is % but the pre-fixture baseline plus the one '
      'fixture .ai asset is %.', v_stats->>'total_ai',
      (select (b.sentinel_stats->>'total_ai')::bigint + 1 from zztest_862_baseline b);
  end if;

  -- Sample it with the exact
  -- sentinel text and it must become sentinel_pending.
  perform public.bulk_insert_pdf_text_samples(
    jsonb_build_array(jsonb_build_object(
      'asset_id',          v_a3::text,
      'filename',          'ZZTEST-862 Duplicate.ai',
      'relative_path',     'zztest-862/ZZTEST-862 Duplicate.ai',
      'extraction_method', 'zztest-862-method',
      'extracted_text',    v_sentinel,
      'page_count',        1,
      'char_count',        length(v_sentinel),
      'thumbnail_url',     null
    )));

  v_stats2 := public.get_ai_sentinel_stats();

  if (v_stats2->>'sampled')::bigint <> (v_stats->>'sampled')::bigint + 1 then
    raise exception 'D FAILED: sampled did not rise by 1 after sampling the .ai asset '
      '(% -> %).', v_stats->>'sampled', v_stats2->>'sampled';
  end if;
  if (v_stats2->>'sentinel_pending')::bigint <> (v_stats->>'sentinel_pending')::bigint + 1 then
    raise exception 'D FAILED: sentinel_pending did not rise by 1 for a sample holding '
      'the exact sentinel text (% -> %). This is the exact-match comparison from '
      'migration 20260702220336.', v_stats->>'sentinel_pending', v_stats2->>'sentinel_pending';
  end if;
  if (v_stats2->>'total_ai')::bigint <> (v_stats->>'total_ai')::bigint then
    raise exception 'D FAILED: total_ai changed when only a sample was added.';
  end if;

  -- Logging a cleanup with no replacement moves it out of pending and into both
  -- cleaned_up and no_replacement_found.
  insert into public.ai_sentinel_cleanup_log (ai_asset_id, ai_filename, ai_relative_path)
  values (v_a3, 'ZZTEST-862 Duplicate.ai', 'zztest-862/ZZTEST-862 Duplicate.ai');

  v_stats3 := public.get_ai_sentinel_stats();

  if (v_stats3->>'sentinel_pending')::bigint <> (v_stats->>'sentinel_pending')::bigint then
    raise exception 'D FAILED: sentinel_pending did not fall back to the baseline after '
      'a cleanup row was logged (% vs baseline %).',
      v_stats3->>'sentinel_pending', v_stats->>'sentinel_pending';
  end if;
  if (v_stats3->>'cleaned_up')::bigint <> (v_stats->>'cleaned_up')::bigint + 1 then
    raise exception 'D FAILED: cleaned_up did not rise by 1 (% -> %).',
      v_stats->>'cleaned_up', v_stats3->>'cleaned_up';
  end if;
  if (v_stats3->>'no_replacement_found')::bigint
     <> (v_stats->>'no_replacement_found')::bigint + 1 then
    raise exception 'D FAILED: no_replacement_found did not rise by 1 (% -> %).',
      v_stats->>'no_replacement_found', v_stats3->>'no_replacement_found';
  end if;

  raise notice 'D OK: duplicates reported .ai only; sentinel stats moved sampled +1, '
    'pending +1 then back, cleaned_up +1, no_replacement_found +1.';
end
$$;

-- =====================================================================================
-- E. *** THE SECURITY ASSERTION. *** Call all five with the caller's search_path set to
--    the EMPTY STRING. Nothing unqualified could resolve from an inherited path, so if
--    any body were still depending on one it fails here. Passing proves the functions
--    resolve entirely from their own pinned `pg_catalog, public`.
--
--    Every statement in this block is schema-qualified, because this block has no path
--    of its own either.
-- =====================================================================================
do $$
declare
  v_a2    uuid;
  v_n     bigint;
  v_rows  int;
  v_stats jsonb;
  v_ins   int;
begin
  select id into v_a2 from zztest_862_assets where label = 'A2';

  set local search_path = '';

  v_n := public.count_pdf_backfill_remaining();
  if v_n is null then
    raise exception 'E FAILED: count_pdf_backfill_remaining() returned NULL under an '
      'empty caller search_path.';
  end if;

  select count(*) into v_rows from public.claim_pdf_backfill_batch(1000) c where c.id = v_a2;
  if v_rows <> 1 then
    raise exception 'E FAILED: claim_pdf_backfill_batch did not return A2 under an '
      'empty caller search_path (got % rows).', v_rows;
  end if;

  select count(*) into v_rows from public.find_ai_pdf_duplicates() d;
  if v_rows < 1 then
    raise exception 'E FAILED: find_ai_pdf_duplicates() returned nothing under an empty '
      'caller search_path, though the A3/A4 pair exists.';
  end if;

  v_stats := public.get_ai_sentinel_stats();
  if v_stats is null or pg_catalog.jsonb_typeof(v_stats) <> 'object' then
    raise exception 'E FAILED: get_ai_sentinel_stats() did not return an object under an '
      'empty caller search_path.';
  end if;

  v_ins := public.bulk_insert_pdf_text_samples(
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'asset_id',          v_a2::text,
      'filename',          'ZZTEST-862 Tech Pack.pdf',
      'relative_path',     'zztest-862/ZZTEST-862 Tech Pack.pdf',
      'extraction_method', 'zztest-862-method',
      'extracted_text',    'ZZTEST-862 tech pack text.',
      'page_count',        1,
      'char_count',        26,
      'thumbnail_url',     null
    )));
  if v_ins <> 1 then
    raise exception 'E FAILED: bulk_insert_pdf_text_samples returned % under an empty '
      'caller search_path, expected 1. This is the plpgsql body -- it also fires the '
      'pdf_text_samples triggers, so an inherited-path dependency would surface here.', v_ins;
  end if;

  raise notice 'E OK: all five behave correctly with the CALLER search_path set to '''' '
    '-- they resolve only through their own pinned path.';
end
$$;

rollback;

-- =====================================================================================
-- F. NO SURVIVING TEST DATA, asserted against committed state.
-- =====================================================================================
do $$
declare
  v_assets int;
  v_samples int;
  v_log int;
begin
  select count(*) into v_assets  from public.assets a
    where a.relative_path like 'zztest-862/%';
  select count(*) into v_samples from public.pdf_text_samples pts
    where pts.relative_path like 'zztest-862/%';
  select count(*) into v_log     from public.ai_sentinel_cleanup_log l
    where l.ai_relative_path like 'zztest-862/%';

  if v_assets + v_samples + v_log <> 0 then
    raise exception 'F FAILED: fixture data survived the rollback (assets %, samples %, '
      'cleanup log %).', v_assets, v_samples, v_log;
  end if;

  raise notice 'F OK: nothing committed.';
end
$$;
