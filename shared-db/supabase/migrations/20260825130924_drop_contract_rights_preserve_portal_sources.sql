-- Issue #1242: licence contracts, terms, territories and restrictions are not
-- sources for this database. Portal-scraped source fields remain authoritative.
--
-- The destructive NBCU step is fail-closed: the contract-derived table was never
-- a loader target and must still be empty. Any unexpected row aborts the migration.
do $$
begin
  if to_regclass('plm.nbcu_right') is not null then
    lock table plm.nbcu_right in access exclusive mode;
    if exists (select 1 from plm.nbcu_right) then
      raise exception 'Issue #1242 refused: plm.nbcu_right contains rows; preserve and investigate them before removal.'
        using errcode = 'P0001';
    end if;
  end if;
end
$$;

-- Replace the publication gate before removing its obsolete dependency. The
-- portal capture remains fully checked; only the contract-derived rights count
-- disappears from observed_counts.
create or replace function plm.finalize_nbcu_capture(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = plm, core, pg_temp
as $$
declare
  v_cap      plm.nbcu_capture%rowtype;
  v_exp      jsonb;
  v_obs      jsonb;
  v_err      jsonb := '[]'::jsonb;
  v_n        bigint;
  v_want     bigint;
  v_key      text;
  -- Named, not inlined: the same limit is quoted in the rejection payload so the
  -- operator sees the boundary that was crossed, not just that one was.
  v_max      numeric := 9223372036854775807::numeric;  -- bigint
  v_max_int  numeric := 2147483647::numeric;           -- integer, for the scalar below
  v_pairs    text[][] := array[
    ['assets','nbcu_asset'], ['properties','nbcu_property'], ['characters','nbcu_character'],
    ['style_guides','nbcu_style_guide'], ['scopes','nbcu_scope'],
    ['ip_family_property','nbcu_ip_family_property'],
    ['property_character','nbcu_property_character'],
    ['asset_property','nbcu_asset_property'],
    ['asset_character','nbcu_asset_character'],
    ['asset_style_guide','nbcu_asset_style_guide'],
    ['style_guide_property','nbcu_style_guide_property'],
    ['asset_ip_family','nbcu_asset_ip_family']
  ];
  i integer;
begin
  select * into v_cap from plm.nbcu_capture where id = p_capture_id for update;
  if not found then
    raise exception 'finalize_nbcu_capture: no capture %', p_capture_id;
  end if;
  if v_cap.status = 'complete' then
    -- Idempotent. A retry after a successful finalize is a no-op, not an error.
    return jsonb_build_object('capture_id', p_capture_id, 'status', 'complete',
                              'observed_counts', v_cap.observed_counts, 'already_complete', true);
  end if;
  if v_cap.status <> 'loading' then
    raise exception 'finalize_nbcu_capture: capture % is %, not loading', p_capture_id, v_cap.status;
  end if;

  v_exp := v_cap.expected_counts;
  v_obs := '{}'::jsonb;

  -- ---- A. Every entity and edge count must equal what the portal capture expects.
  -- Counted from the TABLES, never from a ledger or a summary document. This repository
  -- has shipped a migration that recorded a clean ledger row while its object did nothing,
  -- so "it reported success" is not accepted as evidence of anything.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    -- A KEY PRESENT WITH JSON `null` IS NOT A SUPPLIED COUNT. `v_exp ? v_key` is TRUE
    -- for {"assets": null}, and every comparison against the resulting SQL NULL is
    -- UNKNOWN -- so the old `if v_n <> v_want` never fired and the count went UNCHECKED,
    -- which is the same publication failure as omitting the key entirely.
    -- jsonb_build_object with an unset variable produces exactly that shape.
    -- The elsif chain is deliberate: the numeric cast is only reached after the type
    -- test has ALREADY passed, because SQL does not promise to short-circuit `or` and a
    -- single combined predicate can cast a JSON string and die with a raw cast error
    -- instead of the named rejection below.
    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    elsif jsonb_typeof(v_exp -> v_key) <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number','entity',v_key,
                                           'json_type', jsonb_typeof(v_exp -> v_key));
    elsif (v_exp ->> v_key)::numeric < 0
       or (v_exp ->> v_key)::numeric <> trunc((v_exp ->> v_key)::numeric) then
      -- A fractional or negative expectation is a broken loader, not a count. Named
      -- here rather than left to blow up on the ::bigint cast below.
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                                           'entity',v_key,'expected', v_exp -> v_key);
    elsif (v_exp ->> v_key)::numeric > v_max then
      -- A whole, non-negative number can still be too large for a bigint. Refuse it HERE,
      -- by name, because the cast below would raise instead -- and a raise aborts finalize
      -- BEFORE the rejection row is written, leaving the capture wedged in 'loading' with
      -- no error_summary and a retry that dies identically.
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                                           'entity',v_key,'expected', v_exp -> v_key,
                                           'max', v_max);
    else
      -- THROUGH NUMERIC, NOT STRAIGHT FROM TEXT. `->>` renders the JSON number 1.0 as the
      -- TEXT '1.0', and '1.0'::bigint raises `invalid input syntax for type bigint' --
      -- even though 1.0 passed every guard above, because it IS a whole non-negative
      -- number and 1.0 = trunc(1.0). Any loader arithmetic that yields a numeric rather
      -- than an integer emits that shape; it is not exotic. The trunc() guard above makes
      -- this conversion exact, so it never rounds a real count.
      v_want := (v_exp ->> v_key)::numeric::bigint;
      if v_n <> v_want then
        v_err := v_err || jsonb_build_object('code','count_mismatch','entity',v_key,
                                             'expected',v_want,'observed',v_n);
      end if;
    end if;
  end loop;

  -- ---- B. Scope paging must be complete. Belt and braces over the table CHECKs.
  select count(*) into v_n from plm.nbcu_scope
   where capture_id = p_capture_id and (terminal is not true or cardinality(missing_offsets) <> 0);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','nonterminal_or_gapped_scope','count',v_n);
  end if;

  -- ---- C. Capture-level invariants that are scope rules, not counts.
  if v_cap.media_downloaded <> 0 then
    v_err := v_err || jsonb_build_object('code','media_downloaded_nonzero',
                                         'observed', v_cap.media_downloaded);
  end if;
  -- Both scalars below carried the SAME defect as block A: `?` said "supplied" for a
  -- JSON null, the comparison then evaluated to UNKNOWN and the invariant was skipped;
  -- and a JSON string or float reached a raw ::integer cast. Both keys remain OPTIONAL
  -- -- their absence is not an error, exactly as before -- but a present value must be
  -- a non-negative integer NUMBER, tested BEFORE anything casts it.
  if (v_exp ? 'excluded_unlicensed_assets') then
    if jsonb_typeof(v_exp -> 'excluded_unlicensed_assets') <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                 'entity','excluded_unlicensed_assets',
                 'json_type', jsonb_typeof(v_exp -> 'excluded_unlicensed_assets'));
    elsif (v_exp ->> 'excluded_unlicensed_assets')::numeric < 0
       or (v_exp ->> 'excluded_unlicensed_assets')::numeric
          <> trunc((v_exp ->> 'excluded_unlicensed_assets')::numeric) then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_nonnegative_integer',
                 'entity','excluded_unlicensed_assets',
                 'expected', v_exp -> 'excluded_unlicensed_assets');
    elsif (v_exp ->> 'excluded_unlicensed_assets')::numeric > v_max_int then
      -- Its own NAMED branch, and its own limit: the column is `integer`, not bigint, so
      -- a value between int and bigint would have raised `integer out of range` on the
      -- comparison cast below and wedged the capture exactly like the block A case.
      v_err := v_err || jsonb_build_object('code','expected_count_out_of_range',
                 'entity','excluded_unlicensed_assets',
                 'expected', v_exp -> 'excluded_unlicensed_assets',
                 'max', v_max_int);
    elsif v_cap.excluded_unlicensed_assets
          <> (v_exp ->> 'excluded_unlicensed_assets')::numeric::integer then
      -- Through numeric for the same reason as block A: 0.0 renders as the text '0.0'
      -- and '0.0'::integer raises.
      v_err := v_err || jsonb_build_object('code','excluded_unlicensed_mismatch',
                 'expected',(v_exp ->> 'excluded_unlicensed_assets')::numeric::integer,
                 'observed', v_cap.excluded_unlicensed_assets);
    end if;
  end if;
  if (v_exp ? 'failures') then
    if jsonb_typeof(v_exp -> 'failures') <> 'number' then
      v_err := v_err || jsonb_build_object('code','expected_count_not_a_number',
                 'entity','failures',
                 'json_type', jsonb_typeof(v_exp -> 'failures'));
    elsif (v_exp ->> 'failures')::numeric <> 0 then
      -- Any non-zero -- including a fraction or a negative, which are themselves broken
      -- loader output -- is a refusal. Compared as numeric so nothing casts to integer
      -- before the type test has passed.
      v_err := v_err || jsonb_build_object('code','expected_failures_nonzero',
                 'expected', v_exp -> 'failures');
    end if;
  end if;

  -- ---- D. Every asset must carry at least one metadata-value row. An asset that landed
  -- with no metadata means the detail expansion silently produced nothing for it.
  select count(*) into v_n
    from plm.nbcu_asset a
   where a.capture_id = p_capture_id
     and not exists (select 1 from plm.nbcu_asset_metadata_value m
                      where m.capture_id = a.capture_id
                        and m.asset_source_key = a.asset_source_key);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','asset_without_metadata_value','count',v_n);
  end if;
  select count(*) into v_n from plm.nbcu_asset_metadata_value where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('asset_metadata_values', v_n);

  select count(*) into v_n from plm.nbcu_asset_scope where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('asset_scopes', v_n);
  -- ---- E. Relationship endpoints. The composite FKs already make a cross-capture edge
  -- impossible, so this is an assertion that they are still in force, not a substitute
  -- for them. It is cheap and it fails loudly if a future migration weakens a constraint.
  select count(*) into v_n
    from plm.nbcu_asset_property l
   where l.capture_id = p_capture_id
     and (not exists (select 1 from plm.nbcu_asset a
                       where a.capture_id = l.capture_id and a.asset_source_key = l.asset_source_key)
       or not exists (select 1 from plm.nbcu_property p
                       where p.capture_id = l.capture_id and p.property_key = l.property_key));
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','orphan_asset_property_link','count',v_n);
  end if;

  -- ---- F. No relationship may cite a Property label that the snapshot never landed.
  -- This is the check that would have caught the unrelated search results if the
  -- upstream exclusion had ever failed.
  select count(*) into v_n
    from plm.nbcu_asset_property l
    left join plm.nbcu_property p
      on p.capture_id = l.capture_id and p.property_key = l.property_key
   where l.capture_id = p_capture_id
     and (p.property_label is null or p.property_label is distinct from l.property_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','unknown_or_mismatched_property_label','count',v_n);
  end if;

  -- ---- F2. ADDED BY MIGRATION 20260811070000 (issue #757), then retained through
  -- the 20260819123658 count hardening and this migration's rights-count removal.
  -- The Asset-to-IP-Family twin of check F. The composite FK already proves the
  -- ip_family_key exists in THIS capture; what it cannot prove is that the label the
  -- loader resolved is the label that snapshot actually landed. A loader that resolved
  -- an NBCU Franchise label onto the wrong family row would satisfy every constraint and
  -- still silently misstate the source. The specification requires finalization to reject
  -- when an exact IP Family label cannot be resolved, so it is asserted, not assumed.
  select count(*) into v_n
    from plm.nbcu_asset_ip_family l
    left join plm.nbcu_ip_family f
      on f.capture_id = l.capture_id and f.ip_family_key = l.ip_family_key
   where l.capture_id = p_capture_id
     and (f.ip_family_label is null or f.ip_family_label is distinct from l.ip_family_label);
  if v_n <> 0 then
    v_err := v_err || jsonb_build_object('code','unknown_or_mismatched_ip_family_label','count',v_n);
  end if;

  -- ---- Verdict. There is no partial publish: either every check passed or the capture
  -- is rejected and the PREVIOUS complete capture stays current.
  --
  -- WHY THIS RETURNS INSTEAD OF RAISING, AND WHY THAT IS NOT A WEAKENING.
  -- Spec section 7 asks for BOTH "set status='rejected', record structured errors" AND
  -- "raise an exception". In PostgreSQL those two instructions destroy each other: the
  -- exception aborts the very transaction that wrote the rejection row, so the evidence
  -- is rolled back and the capture is left sitting in `loading` with no record of why it
  -- failed. That directly defeats the spec's own auditability goal. It is an impossibility
  -- in the spec, not a choice, and it is FLAGGED in the pull request.
  -- The safety property the spec actually wants is "never partially publish", and that is
  -- fully preserved: the capture is marked `rejected`, it is not `complete`, no
  -- current-capture reader will ever select it, and the previous complete capture stays
  -- current. The failure is loud in three ways at once -- a WARNING in the server log, a
  -- persisted `rejected` status, and a returned status of 'rejected' the loader must check.
  --
  if jsonb_array_length(v_err) > 0 then
    update plm.nbcu_capture
       set status = 'rejected', observed_counts = v_obs, error_summary = v_err,
           load_completed_at = null
     where id = p_capture_id;
    raise warning 'finalize_nbcu_capture: capture % REJECTED with % error(s)',
      p_capture_id, jsonb_array_length(v_err);
    return jsonb_build_object('capture_id', p_capture_id, 'status', 'rejected',
                              'observed_counts', v_obs, 'errors', v_err,
                              'already_complete', false);
  end if;

  update plm.nbcu_capture
     set status = 'complete', observed_counts = v_obs,
         error_summary = '[]'::jsonb, load_completed_at = now()
   where id = p_capture_id;

  return jsonb_build_object('capture_id', p_capture_id, 'status', 'complete',
                            'observed_counts', v_obs, 'already_complete', false);
end;
$$;

revoke all on function plm.finalize_nbcu_capture(uuid) from public, anon, authenticated;
grant execute on function plm.finalize_nbcu_capture(uuid) to service_role;

comment on function plm.finalize_nbcu_capture(uuid) is
  'The publication gate. In ONE transaction it counts every portal-derived entity and edge table for the '
  'capture -- including asset_ip_family -- checks scope completeness, the media-zero and '
  'exclusion invariants, that every asset has metadata, and that no edge is orphaned or '
  'cites an unknown Property or IP Family label. Contract-derived rights, licence terms and '
  'territories are deliberately absent. All pass -> status complete. Any fail -> status '
  'rejected, structured errors PERSISTED, a server WARNING raised, and a jsonb whose status '
  'is ''rejected'' returned; the previous complete capture is left untouched. NEVER a partial '
  'publish. THE CALLER MUST CHECK THE RETURNED status -- it does not raise, because raising '
  'would roll back the very rejection record the spec asks it to keep. Since 20260819123658 '
  '(#1219) an expected count that is present but NOT a JSON number -- a JSON null, string, '
  'bool, object or array -- is a NAMED rejection (expected_count_not_a_number), never a '
  'skipped check: jsonb ? key is true for a null value, so the old code compared against '
  'SQL NULL and silently published unverified counts. A negative, fractional or out-of-'
  'bigint-range number is rejected by name too, instead of dying on a raw cast. The same '
  'applies to the optional excluded_unlicensed_assets and failures keys. The expected zero '
  'for asset-to-character, and an expected zero for asset-to-IP-family, are normal passes '
  'and not special cases. service_role only.';

drop table if exists plm.nbcu_right;
