-- =====================================================================================
-- WildBrain and Sega landing gates -- close the raw-cast wedge and the deletable-CHECK
-- one-root gate.
--
-- Issues u2giants/shared-db #1221 and #1222, claim #1232.
-- Amends:  20260819014639_wildbrain_dam_source_landing.sql  (plm.finalize_wildbrain_capture)
--          20260819015333_sega_dsi_source_landing.sql       (plm.finalize_sega_capture)
--
-- OBJECTS WRITTEN BY THIS MIGRATION -- and nothing else:
--   function plm.finalize_wildbrain_capture(uuid, jsonb, jsonb)
--   function plm.finalize_sega_capture(uuid, jsonb, jsonb)
--
-- Both function bodies are reproduced in FULL below, because `create or replace function`
-- has no partial form. Everything not described here is byte-identical to the body that
-- shipped in the migration named above.
--
-- -------------------------------------------------------------------------------------
-- WHAT WAS WRONG (1): A WHOLE-NUMBER COUNT THAT IS NOT A BIGINT LITERAL WEDGED THE
--                     CAPTURE IN `loading` WITH A RAW CAST ERROR.
--
-- Both gates accepted a JSON number that is a mathematical integer and then did:
--
--     v_want := (v_exp ->> v_key)::bigint;
--
-- `->>` renders the JSON number as TEXT, and `::bigint` parses that text. Two whole,
-- non-negative numbers therefore pass every guard above and then RAISE:
--
--   * {"assets": 1.0}                    -> '1.0'::bigint  -> invalid input syntax for
--                                           type bigint. `1.0 = trunc(1.0)`, so the range
--                                           guard is satisfied. Any loader arithmetic that
--                                           yields a numeric rather than an integer emits
--                                           this shape; it is not exotic.
--   * {"assets": 9223372036854775808}    -> bigint out of range.
--     {"assets": 1e20}
--
-- The consequence is NOT a short publish -- it is the opposite failure direction, and it
-- is worse operationally than a refusal:
--
--   * the exception aborts finalize BEFORE the rejection row is written, so
--     `error_summary` is never persisted and `status` never leaves 'loading';
--   * a retry with the same stored JSON dies identically, so the capture is WEDGED;
--   * the operator gets a bare PostgreSQL cast error instead of the named refusal this
--     design promises everywhere else.
--
-- THE FIX, applied at every one of the four assignment sites (WildBrain expected;
-- Sega expected and Sega reported; plus the Sega extra-key sweep):
--
--   a. assign through numeric -- `(... ->> v_key)::numeric::bigint` -- so the value is
--      parsed as the NUMBER it is rather than as the text that renders it. After the
--      existing `trunc()` equality guard this conversion is exact, never rounding;
--   b. refuse a value larger than a bigint by NAME, before any cast that could raise:
--      `expected_count_out_of_range` / `reported_count_out_of_range`, each carrying the
--      offending value and the limit. A named refusal writes the rejection row, so the
--      capture becomes 'rejected' and the operator can read why.
--
-- The order of the branches is load-bearing and matches the reasoning already recorded in
-- the Sega body: the tests are SEPARATE `elsif` branches, never one `or`-ed predicate,
-- because SQL does not promise to short-circuit `or` and a combined test can evaluate the
-- very cast it is supposed to prevent.
--
-- -------------------------------------------------------------------------------------
-- WHAT WAS WRONG (2): THE WILDBRAIN "EXACTLY ONE ROOT" GATE CHECKED A DIFFERENT FACT
--                     FROM ITS OWN REACHABILITY WALK.
--
-- G2 counted `is_root`. G3 started its recursive walk from `parent_era_source_id is null`.
-- Those are the same set of rows ONLY while the table CHECK
-- `wildbrain_era_root_matches_parent_chk` (is_root = (parent_era_source_id is null)) is
-- present -- and the gate never re-asserted it. Drop that one CHECK, somewhere else
-- entirely, and this shape publishes as one licensed property:
--
--     R  is_root = true,  parent null          <- the real root
--     S  is_root = false, parent null          <- a second, disjoint tree
--     C  is_root = false, parent = S
--
-- G2 counts one `is_root` and is satisfied. G3 seeds from BOTH parent-null rows, reaches
-- all three eras, and is satisfied. Two disjoint era trees publish as one property.
--
-- That is the same defect shape as the two Highs already fixed on #1197 and as #1219: a
-- guard that holds only because a separate constraint happens to still be there. Every
-- other re-assertion in this gate (sections D, E, G, H) exists precisely so that dropping
-- a constraint cannot silently disable a guarantee; this one did not.
--
-- THE FIX: G2 now measures a root as `parent_era_source_id is null` -- the SAME fact G3
-- walks -- and separately re-asserts the CHECK's own rule, naming any row where `is_root`
-- disagrees with its parentage (`era_root_flag_disagrees_with_parent`). With the CHECK
-- deleted the shape above is refused twice over.
--
-- -------------------------------------------------------------------------------------
-- WHAT WAS WRONG (3): THE SEGA EXTRA-KEY SWEEP WAS TYPE-ONLY.
--
-- The sweep over keys outside the eleven entity names rejected non-numbers but ignored a
-- number, so `{"zztest_future_entity": -1}` or `1.5` passed a sweep whose stated claim is
-- that every key outside the eleven is covered. It cannot skip an entity count, so it is
-- not a publication hole -- but the claim and the code have to agree. The sweep now
-- applies the identical integer/range rule to those keys.
--
-- NOTHING ELSE CHANGES. No table, no constraint, no index, no grant, no policy, no data.
-- The set of conditions that can reject a capture GROWS by four named codes; no capture
-- that published before this migration would be refused by it.
-- =====================================================================================

create or replace function plm.finalize_wildbrain_capture(
  p_capture_id     uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.wildbrain_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_want  bigint;
  v_key   text;
  -- The largest value a bigint can hold, as a numeric. Compared against BEFORE any cast,
  -- so an oversized count is refused by name instead of raising `bigint out of range`
  -- and wedging the capture in 'loading' (#1221).
  v_max   constant numeric := 9223372036854775807::numeric;
  v_pairs text[][] := array[
    ['eras','wildbrain_era'],
    ['creative_groups','wildbrain_creative_group'],
    ['asset_categories','wildbrain_asset_category'],
    ['asset_natures','wildbrain_asset_nature'],
    ['characters','wildbrain_character'],
    ['assets','wildbrain_asset'],
    ['asset_characters','wildbrain_asset_character'],
    ['guides','wildbrain_guide'],
    ['guide_aliases','wildbrain_guide_alias'],
    ['asset_guides','wildbrain_asset_guide']
  ];
  i integer;
begin
  if p_capture_id is null then
    raise exception 'finalize_wildbrain_capture: capture id is required';
  end if;
  if p_observed_counts is not null and jsonb_typeof(p_observed_counts) <> 'object' then
    raise exception 'finalize_wildbrain_capture: observed_counts must be a JSON object when given';
  end if;
  if p_error_summary is not null and jsonb_typeof(p_error_summary) <> 'array' then
    raise exception 'finalize_wildbrain_capture: error_summary must be a JSON array when given';
  end if;

  -- Row lock: two loaders finalizing the same capture must not interleave their counts.
  select * into v_cap from plm.wildbrain_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_wildbrain_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error, and it
    -- must NOT re-run the gate against a snapshot that is already published.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_wildbrain_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. The loader's own reported errors. Anything the loader saw and reported is a
  -- rejection on its own; the checks below are additional, not a replacement.
  if p_error_summary is not null and jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object(
      'code','loader_reported_errors',
      'count', jsonb_array_length(p_error_summary),
      'errors', p_error_summary);
  end if;

  -- ---- B. Paging and scope invariants. pagination_verified is the one that stops a
  -- silently-short capture from being published (see the table comment).
  if not v_cap.pagination_verified then
    v_err := v_err || jsonb_build_object('code','pagination_not_verified');
  end if;
  -- Belt and braces over the table CHECKs: if a future migration ever loosened them,
  -- this gate still refuses to publish.
  if v_cap.truncated_child_lists <> 0 then
    v_err := v_err || jsonb_build_object('code','truncated_child_lists',
                                         'observed', v_cap.truncated_child_lists);
  end if;
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;

  -- ---- C. Row counts, COUNTED FROM THE TABLES, never from a ledger or a summary
  -- document. This repository has shipped a migration that recorded a clean ledger row
  -- while its object did nothing, so "it reported success" is not evidence of anything.
  -- Every one of the ten keys is REQUIRED in expected_counts: a missing key is a
  -- rejection, not a skipped check, because a skipped check is how a truncated capture
  -- passes.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE for
    -- {"assets": null}, and every comparison against the resulting SQL NULL is UNKNOWN --
    -- so a naive `if v_n <> v_want` would never fire and the count would go UNCHECKED,
    -- which is the same publication failure as omitting the key. jsonb_build_object with
    -- an unset variable produces exactly that shape. So the value must be a JSON NUMBER,
    -- and it must be a non-negative integer: a fractional or negative expectation is a
    -- broken loader, not a count.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number','entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    -- A whole, non-negative number can still be too large for a bigint. Refuse it HERE,
    -- by name, because the cast below would raise instead -- and a raise aborts finalize
    -- before the rejection row is written, leaving the capture wedged in 'loading' with
    -- no error_summary and a retry that dies identically (#1221 / #1222).
    elsif (v_exp ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_exp -> v_key,
                                           'max', v_max);
    else
      -- Through NUMERIC, not straight from text. `->>` renders the JSON number 1.0 as the
      -- TEXT '1.0', and '1.0'::bigint raises -- even though 1.0 passed every guard above
      -- because it IS a whole non-negative number. The trunc() guard above makes this
      -- conversion exact, so it never rounds a real count.
      v_want := (v_exp ->> v_key)::numeric::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;
  end loop;

  -- If the loader supplied its own observed counts, they must AGREE with what is actually
  -- in the tables. A loader whose idea of what it wrote differs from what landed has a
  -- bug, and publishing its number instead of the measured one would hide it.
  if p_observed_counts is not null then
    for i in 1 .. array_length(v_pairs, 1) loop
      v_key := v_pairs[i][1];
      -- Same JSON-null trap as the expected counts above: a present-but-null value would
      -- make the comparison UNKNOWN and skip the check silently, so a non-number that is
      -- present is itself a disagreement.
      if (p_observed_counts ? v_key)
         and jsonb_typeof(p_observed_counts -> v_key) <> 'number' then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_not_a_number',
                    'entity', v_key,
                    'json_type', jsonb_typeof(p_observed_counts -> v_key));
      elsif (p_observed_counts ? v_key)
         and (p_observed_counts ->> v_key)::numeric <> (v_obs ->> v_key)::numeric then
        v_err := v_err || jsonb_build_object('code','loader_observed_count_disagrees',
                    'entity', v_key,
                    'loader_reported', p_observed_counts -> v_key,
                    'measured', (v_obs ->> v_key)::bigint);
      end if;
    end loop;
  end if;

  -- ---- D. Duplicate source ids. The primary keys already make these impossible within a
  -- capture; this asserts the constraints are still in force rather than trusting that
  -- nobody weakened one.
  select count(*) into v_n
    from (select asset_source_id from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select asset_uuid from plm.wildbrain_asset where capture_id = p_capture_id
          group by asset_uuid having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_uuid','count',v_n);
  end if;
  select count(*) into v_n
    from (select character_source_id from plm.wildbrain_character where capture_id = p_capture_id
          group by character_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_character_source_id','count',v_n);
  end if;
  select count(*) into v_n
    from (select era_source_id from plm.wildbrain_era where capture_id = p_capture_id
          group by era_source_id having count(*) > 1) d;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','duplicate_era_source_id','count',v_n);
  end if;

  -- ---- E. Orphaned relationship endpoints. The composite FKs already make a
  -- cross-capture edge impossible; same reasoning as D.
  select count(*) into v_n
    from plm.wildbrain_asset_character l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_character c
                       where c.capture_id = l.capture_id
                         and c.character_source_id = l.character_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_character_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_asset_guide l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.wildbrain_asset a
                       where a.capture_id = l.capture_id and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.wildbrain_guide g
                       where g.capture_id = l.capture_id and g.guide_key = l.guide_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_guide_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.wildbrain_guide_alias al
   where al.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide g
                      where g.capture_id = al.capture_id and g.guide_key = al.guide_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_guide_alias','count',v_n);
  end if;

  -- ---- F. Every asset must carry a resolved era. era_source_id is NOT NULL and
  -- FK-bound, so this is the same class of assertion as D and E -- and it is the single
  -- most load-bearing fact in this schema, because the whole property axis hangs off it.
  select count(*) into v_n
    from plm.wildbrain_asset a
   where a.capture_id = p_capture_id
     and (a.era_source_id is null
       or not exists (select 1 from plm.wildbrain_era e
                       where e.capture_id = a.capture_id and e.era_source_id = a.era_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_without_resolved_era','count',v_n);
  end if;

  -- ---- G. Era hierarchy: every non-null parent must resolve INSIDE the same capture.
  select count(*) into v_n
    from plm.wildbrain_era e
   where e.capture_id = p_capture_id
     and e.parent_era_source_id is not null
     and not exists (select 1 from plm.wildbrain_era p
                      where p.capture_id = e.capture_id
                        and p.era_source_id = e.parent_era_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','era_parent_unresolved','count',v_n);
  end if;

  -- ---- G2. EXACTLY ONE ROOT. The licensee account sees one property, so a second root
  -- is either an unlicensed tree that leaked into the crawl or a lost parent link.
  -- Re-asserted here for the same reason as D and E: the partial unique index makes it
  -- impossible, and this refuses to publish if a future migration ever drops it.
  --
  -- A ROOT IS MEASURED AS `parent_era_source_id is null` -- THE SAME FACT G3 WALKS BELOW,
  -- NOT the is_root flag. Counting the flag here made G2 and G3 two DIFFERENT questions
  -- that agreed only while the table CHECK wildbrain_era_root_matches_parent_chk was
  -- present, and the gate never re-asserted that CHECK. With it dropped, a parent-null row
  -- carrying is_root = false is invisible to a flag count while G3 seeds its walk from it
  -- and reaches its whole subtree -- so two disjoint era trees publish as one licensed
  -- property with every count matching. That is the same defect shape as #1219: a guard
  -- that holds only because a separate constraint happens to still exist (#1221).
  select count(*) into v_n
    from plm.wildbrain_era
   where capture_id = p_capture_id and parent_era_source_id is null;
  if v_n > 1 then
    v_err := v_err || jsonb_build_object('code','multiple_root_eras','count',v_n);
  end if;
  -- And the CHECK's own rule, re-asserted rather than assumed -- exactly as D, E, G and H
  -- re-assert theirs. Deleting the constraint now changes nothing that this gate admits.
  select count(*) into v_want
    from plm.wildbrain_era
   where capture_id = p_capture_id
     and is_root <> (parent_era_source_id is null);
  if v_want <> 0 then
    v_err := v_err || jsonb_build_object('code','era_root_flag_disagrees_with_parent',
                                         'count',v_want);
  end if;
  select count(*) into v_want from plm.wildbrain_era where capture_id = p_capture_id;
  if v_want > 0 and v_n = 0 then
    v_err := v_err || jsonb_build_object('code','no_root_era','eras',v_want);
  end if;

  -- ---- G3. NO CYCLE. Nothing above can see one: the self-parent CHECK stops only
  -- A -> A, the composite FK stops only a cross-capture parent, and A -> B -> A satisfies
  -- every one of them AND matches expected_counts, so without this a capture containing a
  -- loop publishes clean and every later walk of the property axis either loops forever
  -- or silently truncates.
  --
  -- Measured as REACHABILITY FROM THE ROOT rather than by chasing parents, because that
  -- walk provably terminates: parent_era_source_id is a single column, so an era has at
  -- most one parent, so no member of a cycle can also be a descendant of the root -- it
  -- would need two parents. The recursion therefore visits each era at most once and can
  -- never follow the loop. Anything not reached is in a cycle or hangs off one, and both
  -- are the same verdict: not landable.
  with recursive reachable as (
    select e.era_source_id
      from plm.wildbrain_era e
     where e.capture_id = p_capture_id
       and e.parent_era_source_id is null
    union all
    select c.era_source_id
      from plm.wildbrain_era c
      join reachable r on c.parent_era_source_id = r.era_source_id
     where c.capture_id = p_capture_id
  )
  select count(*) into v_n from reachable;
  if v_n <> v_want then
    v_err := v_err || jsonb_build_object('code','era_cycle_or_unreachable',
                                         'reachable_from_root', v_n, 'eras', v_want);
  end if;

  -- ---- H. Guide key derivation. The same rule the table CHECK pins, re-asserted here so
  -- that weakening the constraint does not silently disable the guarantee.
  select count(*) into v_n
    from plm.wildbrain_guide g
   where g.capture_id = p_capture_id
     and g.guide_key <> btrim(
           regexp_replace(replace(lower(g.normalized_guide_label), '"', ''),
                          '[[:space:]]+', ' ', 'g'));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','guide_key_not_normalization','count',v_n);
  end if;

  -- ---- I. Every asset-to-guide row must cite a KNOWN alias of its own guide.
  select count(*) into v_n
    from plm.wildbrain_asset_guide ag
   where ag.capture_id = p_capture_id
     and not exists (select 1 from plm.wildbrain_guide_alias al
                      where al.capture_id = ag.capture_id
                        and al.guide_key  = ag.guide_key
                        and al.alias_label = ag.alias_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_guide_unknown_alias','count',v_n);
  end if;

  -- NOT A REJECTION CONDITION, STATED EXPLICITLY SO NOBODY ADDS IT: a character row with
  -- in_source_dictionary = false is a licensor defect preserved as evidence. It is
  -- COUNTED here for visibility and it never blocks publication.
  select count(*) into v_n
    from plm.wildbrain_character
   where capture_id = p_capture_id and in_source_dictionary = false;
  v_obs := v_obs || jsonb_build_object('characters_not_in_source_dictionary', v_n);

  -- ---- Verdict. There is no partial publish.
  if jsonb_array_length(v_err) > 0 then
    update plm.wildbrain_capture
       set status            = 'rejected',
           observed_counts   = v_obs,
           error_summary     = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning
      'finalize_wildbrain_capture: capture % REJECTED with % error(s); read status and error_summary',
      p_capture_id, jsonb_array_length(v_err);
    return;
  end if;

  update plm.wildbrain_capture
     set status            = 'complete',
         observed_counts   = v_obs,
         error_summary     = '[]'::jsonb,
         load_completed_at = now()
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_wildbrain_capture(uuid,jsonb,jsonb) is
  'The publication gate. Under a row lock it counts every table for the capture and '
  'refuses to publish on: unverified pagination, a truncated child list, a nonzero media '
  'count, loader-reported errors, duplicate source ids, orphaned relationship endpoints, '
  'an asset with an unresolved era, an era whose parent does not resolve in the same '
  'capture, more than one root era, no root era at all (a root being an era with no '
  'parent -- the same fact the reachability walk uses, so dropping the is_root CHECK '
  'cannot admit a second tree), an is_root flag that disagrees with its own parentage, '
  'an era cycle (measured as '
  'reachability from the root), a guide_key that is not the normalization of its own '
  'normalized label, an asset-guide row citing an unknown alias, an expected count that '
  'is missing or is not a JSON number that is a non-negative integer, an expected count '
  'too large for a bigint (refused BY NAME, because casting it would raise and leave the '
  'capture wedged in loading with no error_summary), or any count that '
  'differs from expected_counts. All pass -> status complete. Any fail -> status rejected with the '
  'errors PERSISTED and a server WARNING raised; the previous complete capture stays '
  'current. THE CALLER MUST RE-READ status -- it cannot raise on a validation failure '
  'without rolling back the very rejection record it is required to keep. A character '
  'with in_source_dictionary = false is explicitly NOT a rejection condition. '
  'service_role only.';



create or replace function plm.finalize_sega_capture(
  p_capture_id     uuid,
  p_observed_counts jsonb,
  p_error_summary   jsonb
) returns void
language plpgsql
security definer
set search_path = plm, pg_temp
as $$
declare
  v_cap   plm.sega_capture%rowtype;
  v_exp   jsonb;
  v_obs   jsonb := '{}'::jsonb;
  v_err   jsonb := '[]'::jsonb;
  v_n     bigint;
  v_d     bigint;
  v_want  bigint;
  v_key   text;
  -- The largest value a bigint can hold, as a numeric. Compared against BEFORE any cast,
  -- so an oversized count is refused by name instead of raising `bigint out of range`
  -- and wedging the capture in 'loading' (#1222).
  v_max   constant numeric := 9223372036854775807::numeric;
  v_val   jsonb;
  v_pairs text[][] := array[
    ['properties',            'sega_property'],
    ['property_licensors',    'sega_property_licensor'],
    ['catalogs',              'sega_catalog'],
    ['style_guide_candidates','sega_style_guide_candidate'],
    ['character_candidates',  'sega_character_candidate'],
    ['character_evidence',    'sega_character_evidence'],
    ['assets',                'sega_asset'],
    ['tags',                  'sega_tag'],
    ['asset_catalogs',        'sega_asset_catalog'],
    ['asset_tags',            'sega_asset_tag'],
    ['asset_properties',      'sega_asset_property']
  ];
  i integer;
begin
  if p_observed_counts is null or jsonb_typeof(p_observed_counts) <> 'object' then
    raise exception 'finalize_sega_capture: p_observed_counts must be a JSON object';
  end if;
  if p_error_summary is null or jsonb_typeof(p_error_summary) <> 'array' then
    raise exception 'finalize_sega_capture: p_error_summary must be a JSON array';
  end if;

  -- The row lock serialises two loaders finalising the same capture.
  select * into v_cap from plm.sega_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_sega_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error.
    return;
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_sega_capture: capture % is %, not loading',
      p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;

  -- ---- A. SCOPE AND COMPLETENESS. A limited or non-terminal capture is not publishable
  -- at all; it is the "partial crawl landed as if complete" failure this design exists to
  -- prevent.
  if v_cap.is_limited then
    v_err := v_err || jsonb_build_object('code','capture_is_limited');
  end if;
  if not v_cap.ip_paging_terminal then
    v_err := v_err || jsonb_build_object('code','ip_paging_not_terminal');
  end if;
  if not v_cap.asset_paging_terminal then
    v_err := v_err || jsonb_build_object('code','asset_paging_not_terminal');
  end if;
  if not v_cap.ip_associations_complete then
    v_err := v_err || jsonb_build_object('code','ip_associations_incomplete');
  end if;
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;

  -- ---- B. Errors the loader itself reported are fatal. A capture that knows it failed
  -- may never publish, whatever the counts say.
  if jsonb_array_length(p_error_summary) > 0 then
    v_err := v_err || jsonb_build_object('code','loader_reported_errors',
                                         'count', jsonb_array_length(p_error_summary));
  end if;

  -- ---- C. Counts, taken from the TABLES, never from a ledger or a summary document.
  -- This repository has shipped a migration that recorded a clean ledger row while its
  -- object did nothing, so "it reported success" is not evidence of anything here.
  --
  -- Three facts must agree: what the source contract EXPECTED, what the loader CLAIMS it
  -- wrote, and what is ACTUALLY in the tables. Checking only two of the three lets a
  -- loader that miscounted its own output pass.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE for
    -- {"assets": null}, and every comparison against the resulting SQL NULL is UNKNOWN --
    -- so a naive `if v_n <> v_want` would NEVER FIRE and the count would go entirely
    -- unchecked, which is the same publication failure as omitting the key. The value must
    -- therefore be a JSON NUMBER, and a non-negative integer at that: a fractional or
    -- negative expectation is a broken loader, not a count.
    --
    -- This re-checks the STORED object rather than trusting that begin_sega_capture ran
    -- its own guard: an owner-level UPDATE can reach plm.sega_capture.expected_counts
    -- without going through that function at all.
    --
    -- The branches are separate, not one `or`-ed predicate: SQL does not promise to
    -- short-circuit `or`, so a combined test could cast a JSON string and die with a raw
    -- cast error instead of the named code below.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    -- A whole, non-negative number can still be too large for a bigint. Refuse it HERE,
    -- by name, because the cast below would raise instead -- and a raise aborts finalize
    -- before the rejection row is written, leaving the capture wedged in 'loading' with
    -- no error_summary and a retry that dies identically (#1221 / #1222).
    elsif (v_exp ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_exp -> v_key,
                                           'max', v_max);
    else
      -- Through NUMERIC, not straight from text. `->>` renders the JSON number 1.0 as the
      -- TEXT '1.0', and '1.0'::bigint raises -- even though 1.0 passed every guard above
      -- because it IS a whole non-negative number. The trunc() guard above makes this
      -- conversion exact, so it never rounds a real count.
      v_want := (v_exp ->> v_key)::numeric::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;

    -- The loader's own reported counts carry the identical trap: {"assets": null} makes
    -- `?` true and `(p_observed_counts ->> v_key)::bigint` SQL NULL, so the comparison is
    -- UNKNOWN and the check is skipped. A present non-number is itself a disagreement.
    if not (p_observed_counts ? v_key) then
      v_err := v_err || jsonb_build_object('code','reported_count_missing','entity',v_key);
    elsif jsonb_typeof(p_observed_counts -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                           'entity',v_key,
                                           'json_type',
                                           jsonb_typeof(p_observed_counts -> v_key));
    elsif (p_observed_counts ->> v_key)::numeric < 0
       or (p_observed_counts ->> v_key)::numeric
           <> trunc((p_observed_counts ->> v_key)::numeric) then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_nonnegative_integer',
                                           'entity',v_key,
                                           'reported', p_observed_counts -> v_key);
    -- Same wedge as the expected side: a whole non-negative number past bigint would
    -- raise on the cast below, aborting finalize before the rejection row is written.
    elsif (p_observed_counts ->> v_key)::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','reported_count_out_of_range',
                                           'entity',v_key,
                                           'reported', p_observed_counts -> v_key,
                                           'max', v_max);
    -- Through NUMERIC: `->>` of the JSON number 1.0 is the text '1.0', and '1.0'::bigint
    -- raises even though 1.0 satisfied every guard above.
    elsif (p_observed_counts ->> v_key)::numeric::bigint <> v_n then
      v_err := v_err || jsonb_build_object('code','reported_count_mismatch','entity',v_key,
                                           'reported',(p_observed_counts ->> v_key)::numeric::bigint,
                                           'observed',v_n);
    end if;
  end loop;

  -- The loop above only inspects the eleven entity keys this schema knows. A stored
  -- expected_counts or a reported observed_counts may carry OTHER keys -- media_downloaded
  -- is one, and a future loader may add more -- and a non-number sitting in one of those
  -- is the same class of defect: a value that looks supplied and compares to nothing.
  -- Sweep the whole object so no key escapes the rule.
  --
  -- The sweep applies the SAME three-part rule as the eleven entity keys -- type, then
  -- non-negative integer, then bigint range -- not a type test alone. The previous
  -- type-only sweep ignored -1 and 1.5 under an extra key, so its stated claim that
  -- "every key outside the eleven is covered" was not true of the code (#1222). Neither
  -- shape can skip an entity count, so this is a truthfulness fix, not a publication
  -- hole -- but a guard whose comment overstates it is how the next reader is misled.
  for v_key, v_val in select e.key, e.value from jsonb_each(v_exp) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_val,'max', v_max);
    end if;
  end loop;
  for v_key, v_val in select e.key, e.value from jsonb_each(p_observed_counts) e
                       where not (v_obs ? e.key) loop
    if jsonb_typeof(v_val) <> 'number' then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_number',
                                           'entity',v_key,
                                           'json_type', jsonb_typeof(v_val));
    elsif (v_val #>> '{}')::numeric < 0
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric) then
      v_err := v_err || jsonb_build_object('code','reported_count_not_a_nonnegative_integer',
                                           'entity',v_key,'reported', v_val);
    elsif (v_val #>> '{}')::numeric > v_max then
      v_err := v_err || jsonb_build_object('code','reported_count_out_of_range',
                                           'entity',v_key,'reported', v_val,'max', v_max);
    end if;
  end loop;

  -- ---- D. Duplicate source identifiers. The primary keys already make these impossible;
  -- this asserts that they are still in force rather than trusting that no later migration
  -- weakened one. It is cheap and it fails loudly.
  select count(*), count(distinct property_source_id) into v_n, v_d
    from plm.sega_property where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_property_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct catalog_source_id) into v_n, v_d
    from plm.sega_catalog where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_catalog_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct hierarchy_path) into v_n, v_d
    from plm.sega_catalog where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_catalog_hierarchy_path',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct asset_source_id) into v_n, v_d
    from plm.sega_asset where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_asset_source_id',
                                         'rows',v_n,'distinct',v_d);
  end if;
  select count(*), count(distinct tag_source_key) into v_n, v_d
    from plm.sega_tag where capture_id = p_capture_id;
  if v_n <> v_d then
    v_err := v_err || jsonb_build_object('code','duplicate_tag_source_key',
                                         'rows',v_n,'distinct',v_d);
  end if;

  -- ---- E. Catalog parents. The self-FK is DEFERRABLE, so it is checked at commit; this
  -- reports the same condition as a structured error instead of a raw constraint abort,
  -- and additionally rejects a non-root node that names no parent at all.
  select count(*) into v_n
    from plm.sega_catalog c
   where c.capture_id = p_capture_id
     and c.parent_catalog_source_id is not null
     and not exists (select 1 from plm.sega_catalog p
                      where p.capture_id = c.capture_id
                        and p.catalog_source_id = c.parent_catalog_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','unresolved_catalog_parent','count',v_n);
  end if;
  select count(*) into v_n
    from plm.sega_catalog c
   where c.capture_id = p_capture_id
     and c.hierarchy_depth > 1
     and c.parent_catalog_source_id is null;
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','non_root_catalog_without_parent','count',v_n);
  end if;

  -- ---- F. Orphaned relationship endpoints. The composite FKs already make a cross-capture
  -- edge impossible; same reasoning as D -- assert the guarantee, do not assume it.
  select count(*) into v_n
    from plm.sega_asset_catalog l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_catalog c
                       where c.capture_id = l.capture_id
                         and c.catalog_source_id = l.catalog_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_catalog_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_asset_tag l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_tag t
                       where t.capture_id = l.capture_id
                         and t.tag_source_key = l.tag_source_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_tag_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_asset_property l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.sega_asset a
                       where a.capture_id = l.capture_id
                         and a.asset_source_id = l.asset_source_id)
       or not exists (select 1 from plm.sega_property p
                       where p.capture_id = l.capture_id
                         and p.property_source_id = l.property_source_id));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_property_link','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_property_licensor l
   where l.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_property p
                      where p.capture_id = l.capture_id
                        and p.property_source_id = l.property_source_id);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_property_licensor','count',v_n);
  end if;

  select count(*) into v_n
    from plm.sega_character_evidence e
   where e.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_character_candidate c
                      where c.capture_id = e.capture_id
                        and c.character_candidate_key = e.character_candidate_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_character_evidence','count',v_n);
  end if;

  -- Every character candidate must be able to say WHY it exists. A candidate with no
  -- evidence is an unsupported assertion about a licensor's characters.
  select count(*) into v_n
    from plm.sega_character_candidate c
   where c.capture_id = p_capture_id
     and not exists (select 1 from plm.sega_character_evidence e
                      where e.capture_id = c.capture_id
                        and e.character_candidate_key = c.character_candidate_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','character_candidate_without_evidence',
                                         'count',v_n);
  end if;

  -- ---- VERDICT. There is no partial publish: either every check passed or the capture is
  -- rejected and the PREVIOUS complete capture stays current.
  --
  -- WHY THIS DOES NOT RAISE ON A REJECTION, AND WHY THAT IS NOT A SILENT FAILURE.
  -- The contract requires BOTH "set status='rejected' and persist the errors" AND a loud
  -- failure. In PostgreSQL an exception aborts the very transaction that wrote the
  -- rejection row, so raising would roll back the evidence and leave the capture sitting
  -- in 'loading' with no record of why it failed -- destroying the auditability the
  -- rejection exists for. The same impossibility was recorded for
  -- plm.finalize_nbcu_capture (20260810070000) and resolved the same way.
  -- The failure is therefore loud in three simultaneous, inspectable ways:
  --   1. a WARNING in the server log,
  --   2. a PERSISTED status of 'rejected' with the structured errors,
  --   3. the capture is NOT 'complete', which is the only thing any reader keys on.
  -- THE CALLER MUST READ BACK plm.sega_capture.status. This function returns void by
  -- contract, so the status column is the return value.
  if jsonb_array_length(v_err) > 0 then
    update plm.sega_capture
       set status = 'rejected', observed_counts = v_obs, error_summary = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning 'finalize_sega_capture: capture % REJECTED with % error(s): %',
      p_capture_id, jsonb_array_length(v_err), v_err;
    return;
  end if;

  update plm.sega_capture
     set status = 'complete', observed_counts = v_obs,
         error_summary = '[]'::jsonb, load_completed_at = now()
   where id = p_capture_id;
end;
$$;

comment on function plm.finalize_sega_capture(uuid, jsonb, jsonb) is
  'The publication gate for a Sega capture. Under a row lock it rejects a limited or '
  'non-terminal capture, loader-reported errors, duplicate source identifiers, orphaned '
  'relationship endpoints, unresolved or missing non-root catalog parents, character '
  'candidates with no evidence, a count too large for a bigint (refused BY NAME, because '
  'casting it would raise and leave the capture wedged in loading with no error_summary), '
  'and any count where the source contract, the loader''s '
  'claim and the actual table contents disagree. Every key outside the eleven entity '
  'names is held to the identical type, non-negative-integer and range rule. All pass -> status ''complete'' with the '
  'table-derived observed counts. Any fail -> status ''rejected'', errors PERSISTED, a '
  'server WARNING raised, and the previous complete capture left current. NEVER a partial '
  'publish. It returns void by contract, so THE CALLER MUST READ BACK '
  'plm.sega_capture.status -- raising instead would roll back the rejection record itself '
  '(see the comment in the function body). service_role only.';

