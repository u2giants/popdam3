-- =====================================================================================
-- NBCU Creative Asset Factory -- the missing Asset-to-Franchise relationship.
--
-- Migration: 20260811070000_nbcu_asset_ip_family_relationship.sql
-- Issue:     u2giants/shared-db #757. Claim #758. Version PRE-ALLOCATED by the
--            orchestrator (session d152a272, marker #739) -- do NOT re-derive it from
--            now() and do NOT "correct" it to sit above the newest file. Two agents
--            dispatched in the same minute pick the same 14-digit version, and a
--            duplicate version is SILENTLY SKIPPED by the Supabase ledger. That has
--            happened twice in this repository.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA AND CONTAINS NO NBCU VALUES.
-- -------------------------------------------------------------------------------------
-- u2giants/shared-db is a PUBLIC repository. The NBCU extract is licensed source data
-- held in the PRIVATE repo u2giants/licensor-source-data. No NBCU title, property name,
-- character name, franchise/IP Family label, asset path, file name or raw payload may
-- ever appear in this file, in a contract test, in CI output, or in a PR or issue here.
--   SCHEMA IN GIT. DATA OUT OF GIT.
--
-- ------------------------------------------------------------------------------------
-- WHAT WAS MISSING
-- ------------------------------------------------------------------------------------
-- 20260810070000 landed sixteen NBCU tables including seven relationship tables. It
-- preserves each asset's Franchise labels LOSSLESSLY, but only inside the JSON array
-- plm.nbcu_asset.ip_family_labels. Six of the portal's direct relationships are
-- normalized; the seventh -- Asset to Franchise, which the schema calls IP Family -- is
-- not. So "which assets belong to this Franchise" is a jsonb scan with no referential
-- integrity, no capture scoping, and no finalization gate, while every sibling
-- relationship has all three.
--
-- This migration adds the seventeenth table, plm.nbcu_asset_ip_family, and teaches the
-- finalizer to count it. It is purely ADDITIVE.
--
-- THE JSON ARRAY STAYS. plm.nbcu_asset.ip_family_labels is NOT dropped, NOT replaced and
-- NOT rewritten. It is the lossless source record; this table is the relationship view of
-- the same fact. Losing the array would lose the exact source ordering and any label the
-- resolver could not match, which is precisely the evidence a rejection needs.
--
-- ------------------------------------------------------------------------------------
-- WHAT A ROW MEANS, AND WHAT MAY NEVER CREATE ONE
-- ------------------------------------------------------------------------------------
-- One row means exactly: "the NBCU asset metadata explicitly listed this IP Family for
-- this asset." Links come ONLY from the exact values in assets.csv.ip_family_labels.
--
-- A link may NEVER be inferred from a search scope, a folder path, a file name, a related
-- Property, a Character tag namespace, label similarity, another asset, or an assumption
-- about which titles belong to a Franchise. An EMPTY ip_family_labels array means ZERO
-- links for that asset -- that is a correct answer, not a gap to be filled.
--
-- The loader must resolve each exact label against THIS capture's plm.nbcu_ip_family
-- rows. A missing or ambiguous match must REJECT the capture. It must never be silently
-- discarded, and it must never be guessed.
--
-- WHICH RESOLUTION STEP THAT RULE GOVERNS -- READ THIS BEFORE QUOTING THE SENTENCE ABOVE.
-- The sentence is #757's wording and it governs EXACTLY ONE step: resolving an
-- assets.csv ip_family_labels string to a plm.nbcu_ip_family row of the SAME capture.
-- It does NOT govern, and must never be read as governing, the separate and OPTIONAL
-- IP-Family-to-Property step.
--
--   * plm.nbcu_ip_family is built by the private loader from the UNION of every label in
--     assets.csv.ip_family_labels and the evidence file. A label therefore ALWAYS has a
--     family row in its own capture, by construction. "Missing" here means the loader
--     produced an edge whose key or label does not agree with the family row it landed --
--     i.e. a loader defect -- not "NBCU published a label we do not recognise".
--
--   * Check F2 below is a label-FIDELITY check. It joins plm.nbcu_asset_ip_family to
--     plm.nbcu_ip_family on (capture_id, ip_family_key) and compares ip_family_label.
--     It NEVER scans plm.nbcu_asset.ip_family_labels and it never asks whether a label
--     matched a Property. Nothing in this file rejects a capture for an unmatched label.
--
--   * IP Family to Property is a SEPARATE, OPTIONAL relationship
--     (plm.nbcu_ip_family_property). ZERO edges there is LEGAL. An IP Family that maps to
--     no Property is a normal source fact, and the scrape session that reported it was
--     right. That case is outside this rule and outside this migration.
--
-- Recorded because the two were read as contradicting each other on 2026-08-11 (#788).
-- They do not. See docs/licensor-source-shape-decisions (PR #799).
--
-- ------------------------------------------------------------------------------------
-- ORDERING, STATED BECAUSE IT LOOKS RISKIER THAN IT IS
-- ------------------------------------------------------------------------------------
-- Three earlier migrations hard-code the number sixteen:
--   20260810080000 asserts exactly 16 SELECT and 15 INSERT grants on plm.nbcu_*
--   20260810180000 section B and D1 require the nbcu family to be 0 or exactly 16
-- None of them is edited, and none of them breaks, because this version sorts AFTER all
-- three. On a database applying the whole history in order -- which is production, where
-- pg_class holds ZERO plm.nbcu_* tables as read on 2026-08-11 -- those three files run
-- while exactly sixteen tables exist, and the seventeenth is created only afterwards.
-- On preview, 20260810070000 and 20260810080000 are already applied, so they cannot
-- re-run at all. VERIFIED, not assumed.
--
-- ------------------------------------------------------------------------------------
-- PRIVILEGES: WHY THE REVOKES BELOW ARE UNCONDITIONAL
-- ------------------------------------------------------------------------------------
-- The plm schema carries ALTER DEFAULT PRIVILEGES ... GRANT ON TABLES TO service_role,
-- applied by Postgres at CREATE TABLE time, BEFORE any GRANT in this file runs. That is
-- the defect that made 20260810070000's grants inert no-ops and required 20260810080000.
-- 20260810180000 section C narrows the default to arwd, but this migration MUST NOT
-- assume 20260810180000 has run: it may legally be promoted alone, and this file must be
-- correct either way. So the new table is born with EITHER arwdDxtm (default not yet
-- narrowed) or arwd (narrowed), and the revoke below names ALL SIX unwanted privileges
-- unconditionally. Revoking a privilege that is absent is a no-op.
--
-- Final posture, identical to the other fifteen snapshot tables:
--   service_role -> SELECT + INSERT only. Rows are immutable the instant they land.
--   public, anon, authenticated -> nothing at all.
-- No api.* view, no public wrapper function, no PostgREST exposure. Licensed source
-- material does not reach the browser without an explicit access decision.
--
-- The outcome is ASSERTED at the bottom of this file from the catalog, so this migration
-- cannot fail the same silent way as the one it follows.
-- =====================================================================================


-- =====================================================================================
-- 17. plm.nbcu_asset_ip_family -- Asset to IP Family (NBCU's Franchise concept).
--
-- Shaped deliberately like plm.nbcu_ip_family_property and plm.nbcu_asset_property: the
-- same column set, the same evidence columns, the same on delete restrict, the same
-- naming. A relationship that looked different from its six siblings would invite a
-- reader to assume it behaves differently.
--
-- BOTH foreign keys carry capture_id. That is the entire point: without it an edge could
-- join a 2026-08-09 asset to a 2027 IP Family and the corruption would be invisible.
--
-- ip_family_label is stored ALONGSIDE the key, exactly as the sibling tables store their
-- endpoint labels, and with the source's exact capitalization and punctuation. It is not
-- redundant: it is the label the loader actually resolved, so the finalizer can prove the
-- resolution was right rather than trusting it. Nothing here is normalised or trimmed.
-- =====================================================================================
create table plm.nbcu_asset_ip_family (
  capture_id         uuid        not null,
  asset_source_key   text        not null,
  ip_family_key      text        not null,
  ip_family_label    text        not null,
  evidence_type      text        not null,
  evidence_value     text        not null,
  source_captured_at timestamptz not null,
  source_url         text        not null,
  raw                jsonb       not null,

  constraint nbcu_asset_ip_family_pkey
    primary key (capture_id, asset_source_key, ip_family_key),
  constraint nbcu_asset_ip_family_asset_fkey
    foreign key (capture_id, asset_source_key)
    references plm.nbcu_asset (capture_id, asset_source_key) on delete restrict,
  constraint nbcu_asset_ip_family_family_fkey
    foreign key (capture_id, ip_family_key)
    references plm.nbcu_ip_family (capture_id, ip_family_key) on delete restrict,
  constraint nbcu_asset_ip_family_label_chk
    check (btrim(ip_family_label) <> ''),
  constraint nbcu_asset_ip_family_evidence_chk
    check (btrim(evidence_type) <> '' and btrim(evidence_value) <> ''),
  constraint nbcu_asset_ip_family_raw_obj_chk
    check (jsonb_typeof(raw) = 'object')
);

comment on table plm.nbcu_asset_ip_family is
  'Asset-to-IP-Family (NBCU Franchise) evidence, taken ONLY from the exact values in the '
  'asset metadata''s ip_family_labels array. Both FKs carry capture_id, so an edge can '
  'never point across two snapshots. A link may NEVER be inferred from a search scope, a '
  'folder path, a file name, a related Property, a Character namespace or label '
  'similarity. An empty source array means ZERO rows for that asset, which is a correct '
  'answer. plm.nbcu_asset.ip_family_labels REMAINS the lossless source record and is not '
  'replaced by this table.';
comment on column plm.nbcu_asset_ip_family.ip_family_label is
  'The label EXACTLY as the source wrote it -- capitalization and punctuation included, '
  'nothing normalised or trimmed. Held next to the key so finalization can prove the '
  'loader resolved the right plm.nbcu_ip_family row rather than trusting that it did.';
comment on column plm.nbcu_asset_ip_family.evidence_value is
  'The source evidence for this link, preserved rather than reduced to a boolean, exactly '
  'as the six sibling relationship tables do. Evidence is a source fact.';
comment on column plm.nbcu_asset_ip_family.raw is
  'The source relationship record, or the smallest lossless source evidence object. '
  'Required even though typed columns exist: `raw` is what prevents source loss when '
  'NBCU changes the portal.';

-- Reverse FK direction, matching the six sibling edge tables. The composite PK already
-- indexes (capture_id, asset_source_key) left-to-right; what is NOT covered is the
-- delete-check and every "find all assets in this Franchise" query.
create index idx_nbcu_asset_ip_family_family
  on plm.nbcu_asset_ip_family (capture_id, ip_family_key);


-- =====================================================================================
-- RLS AND GRANTS -- see the header for why every revoke below is unconditional.
--
-- ENABLE, deliberately NOT FORCE, matching 20260810070000: FORCE would apply RLS to the
-- table owner too, locking the migration runner and every contract-test session out of
-- its own table for no security gain. service_role is the identity being constrained and
-- it is constrained by the GRANTS -- Supabase's service_role carries BYPASSRLS, so RLS
-- alone could not constrain the loader at all.
-- =====================================================================================
alter table plm.nbcu_asset_ip_family enable row level security;

revoke all on plm.nbcu_asset_ip_family from public;
revoke all on plm.nbcu_asset_ip_family from anon;
revoke all on plm.nbcu_asset_ip_family from authenticated;

-- THE ACTUAL IMMUTABILITY MECHANISM. Without this the table is born holding every
-- privilege the schema default hands out and the grant below is a silent no-op.
revoke update, delete, truncate, references, trigger, maintain
  on plm.nbcu_asset_ip_family from service_role;

grant select, insert on plm.nbcu_asset_ip_family to service_role;

-- One permissive read policy, matching the other sixteen. It grants nothing on its own:
-- without the GRANT above, SELECT still fails.
create policy nbcu_asset_ip_family_service_read
  on plm.nbcu_asset_ip_family for select to service_role using (true);


-- =====================================================================================
-- THE FINALIZATION GATE -- plm.finalize_nbcu_capture(uuid), REPLACED.
--
-- !! WARNING TO EVERY FUTURE AUTHOR AND REVIEWER. READ BEFORE TOUCHING THIS BLOCK. !!
--
-- `create or replace function` SWAPS THE ENTIRE BODY. It does not merge. Anything absent
-- from the text below is DELETED from the database, silently, with a successful apply and
-- a green ledger row. Earlier on 2026-08-11 a draft migration in this very repository did
-- exactly that to plm.validate_pmt_capture: rewritten from memory, it dropped 12 of its
-- 13 finalization checks and the capture-exists guard, and renamed six manifest
-- populations whose names the loader emits. It would have failed every finalization
-- forever while looking perfectly healthy in review.
--
-- SO THIS BODY WAS NOT WRITTEN. IT WAS EXTRACTED.
-- The text below is a byte-for-byte slice of plm.finalize_nbcu_capture as it stands in
-- 20260810070000, with exactly TWO ADDITIVE EDITS applied mechanically:
--
--   1. one new entry in v_pairs      -> ['asset_ip_family','nbcu_asset_ip_family']
--   2. one new block, marked "F2"    -> the IP Family label-resolution check
--
-- Proven, not asserted, before this file was committed: the extracted original and this
-- text were diffed, and the new text was then round-tripped by REMOVING the two additions
-- and compared byte-for-byte against the original -- it matched exactly (8,294 bytes).
-- All NINE pre-existing error codes are still emitted, and the capture-exists guard, the
-- already-complete idempotent return and the not-loading guard are all still present:
--   asset_without_metadata_value, count_mismatch, excluded_unlicensed_mismatch,
--   expected_count_missing, expected_failures_nonzero, media_downloaded_nonzero,
--   nonterminal_or_gapped_scope, orphan_asset_property_link,
--   unknown_or_mismatched_property_label
-- The tenth, unknown_or_mismatched_ip_family_label, is the one added here.
--
-- IF YOU NEED TO CHANGE THIS FUNCTION AGAIN: extract the current body, edit additively,
-- and prove the untouched parts are byte-identical. Do not retype it from memory.
--
-- ------------------------------------------------------------------------------------
-- WHAT THE TWO EDITS DO
-- ------------------------------------------------------------------------------------
-- Edit 1 puts asset_ip_family into the SAME loop that already counts the other eleven
-- entities and edges. That single line delivers three of the spec's rejection conditions
-- at once, because the loop already implements them: a row count that differs from
-- expected_counts.asset_ip_family raises count_mismatch; an ABSENT
-- expected_counts.asset_ip_family raises expected_count_missing (so a loader cannot
-- quietly skip the relationship by omitting its count); and the observed count is always
-- recorded in observed_counts. An expected count of zero is a normal pass, exactly as
-- asset_character's explicit zero already is.
--
-- NO COUNT IS HARD-CODED HERE, and none may ever be. The private loader computes
-- asset_ip_family from the source snapshot and supplies it through expected_counts.
--
-- Edit 2 (block F2) is the twin of the existing check F. Cross-capture edges and missing
-- endpoints are already impossible -- both composite FKs enforce that at the table -- but
-- no constraint can prove the loader resolved a label to the RIGHT family row. F2 does.
--
-- Every other entity and relationship count keeps its existing behaviour untouched.
-- =====================================================================================

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

  -- ---- A. Every entity and edge count must equal what the source contract expects.
  -- Counted from the TABLES, never from a ledger or a summary document. This repository
  -- has shipped a migration that recorded a clean ledger row while its object did nothing,
  -- so "it reported success" is not accepted as evidence of anything.
  for i in 1 .. array_length(v_pairs, 1) loop
    v_key := v_pairs[i][1];
    execute format('select count(*) from plm.%I where capture_id = $1', v_pairs[i][2])
      into v_n using p_capture_id;
    v_obs := v_obs || jsonb_build_object(v_key, v_n);

    if not (v_exp ? v_key) then
      v_err := v_err || jsonb_build_object('code','expected_count_missing','entity',v_key);
    else
      v_want := (v_exp ->> v_key)::bigint;
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
  if (v_exp ? 'excluded_unlicensed_assets')
     and v_cap.excluded_unlicensed_assets <> (v_exp ->> 'excluded_unlicensed_assets')::integer then
    v_err := v_err || jsonb_build_object('code','excluded_unlicensed_mismatch',
               'expected',(v_exp ->> 'excluded_unlicensed_assets')::integer,
               'observed', v_cap.excluded_unlicensed_assets);
  end if;
  if (v_exp ? 'failures') and (v_exp ->> 'failures')::integer <> 0 then
    v_err := v_err || jsonb_build_object('code','expected_failures_nonzero');
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
  select count(*) into v_n from plm.nbcu_right where capture_id = p_capture_id;
  v_obs := v_obs || jsonb_build_object('rights', v_n);

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

  -- ---- F2. ADDED BY MIGRATION 20260811070000 (issue #757). EVERYTHING ELSE IN THIS
  -- FUNCTION IS BYTE-IDENTICAL TO 20260810070000 EXCEPT THE ONE v_pairs ENTRY ABOVE.
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

comment on function plm.finalize_nbcu_capture(uuid) is
  'The publication gate. In ONE transaction it counts every entity and edge table for the '
  'capture -- including asset_ip_family, added by 20260811070000 -- checks scope '
  'completeness, the media-zero and exclusion invariants, that every asset has metadata, '
  'and that no edge is orphaned or cites an unknown Property or IP Family label. All pass '
  '-> status complete. Any fail -> status rejected, structured errors PERSISTED, a server '
  'WARNING raised, and a jsonb whose status is ''rejected'' returned; the previous complete '
  'capture is left untouched. NEVER a partial publish. THE CALLER MUST CHECK THE RETURNED '
  'status -- it does not raise, because raising would roll back the very rejection record '
  'the spec asks it to keep (see the comment in the function body). The expected zero for '
  'asset-to-character, and an expected zero for asset-to-IP-family, are normal passes and '
  'not special cases. service_role only.';

-- Re-issued for the same reason 20260810070000 issued them. `create or replace function`
-- preserves the existing ACL, so on preview these are no-ops -- but this file must also
-- be correct on a database applying the history in order, and stating the intended
-- privilege explicitly is cheaper than depending on REPLACE's ACL-preservation rule.
revoke all on function plm.finalize_nbcu_capture(uuid) from public;
grant execute on function plm.finalize_nbcu_capture(uuid) to service_role;


-- =====================================================================================
-- ASSERT THE OUTCOME, IN THE MIGRATION.
--
-- "It applied successfully" proves nothing. 20260810070000 applied successfully and its
-- grants did nothing at all; the only thing that caught it was a test that read the
-- catalog. These blocks read the catalog here, so this file cannot fail that way.
-- =====================================================================================
do $$
declare
  p     text;
  v_bad int := 0;
  v_n   int;
begin
  -- The table, its key, and its two capture-scoped foreign keys.
  if to_regclass('plm.nbcu_asset_ip_family') is null then
    raise exception 'ASSERT FAILED: plm.nbcu_asset_ip_family was not created';
  end if;

  select count(*) into v_n
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
   where c.relnamespace = 'plm'::regnamespace
     and c.relname = 'nbcu_asset_ip_family'
     and con.contype = 'p'
     and (select attname from pg_attribute
           where attrelid = c.oid and attnum = con.conkey[1]) = 'capture_id';
  if v_n <> 1 then
    raise exception
      'ASSERT FAILED: the primary key of plm.nbcu_asset_ip_family does not begin with '
      'capture_id. Two snapshots could then collide on one row and overwrite history.';
  end if;

  -- Both FKs must be composite AND lead with capture_id, or an edge could cross captures.
  select count(*) into v_n
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class f on f.oid = con.confrelid
   where c.relnamespace = 'plm'::regnamespace
     and c.relname = 'nbcu_asset_ip_family'
     and con.contype = 'f'
     and f.relname in ('nbcu_asset','nbcu_ip_family')
     and array_length(con.conkey, 1) = 2
     and (select attname from pg_attribute
           where attrelid = c.oid and attnum = con.conkey[1]) = 'capture_id';
  if v_n <> 2 then
    raise exception
      'ASSERT FAILED: expected 2 capture-scoped composite foreign keys on '
      'plm.nbcu_asset_ip_family, found %. A relationship could cross snapshots.', v_n;
  end if;

  -- RLS on.
  select count(*) into v_n from pg_class
   where relnamespace = 'plm'::regnamespace
     and relname = 'nbcu_asset_ip_family' and relrowsecurity;
  if v_n <> 1 then
    raise exception 'ASSERT FAILED: row level security is not enabled on plm.nbcu_asset_ip_family';
  end if;

  -- The privilege posture. This is the assertion that matters most: it is the one that
  -- would have caught the inert grants in 20260810070000.
  foreach p in array array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role', 'plm.nbcu_asset_ip_family', p) then
      v_bad := v_bad + 1;
      raise warning 'FAIL service_role still holds % on plm.nbcu_asset_ip_family', p;
    end if;
  end loop;

  foreach p in array array['SELECT','INSERT'] loop
    if not has_table_privilege('service_role', 'plm.nbcu_asset_ip_family', p) then
      v_bad := v_bad + 1;
      raise warning 'FAIL service_role LOST % on plm.nbcu_asset_ip_family -- over-revoked, '
        'the loader cannot write the relationship', p;
    end if;
  end loop;

  select count(*) into v_n
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name = 'nbcu_asset_ip_family'
     and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then
    v_bad := v_bad + 1;
    raise warning 'FAIL anon/authenticated/PUBLIC hold % grant(s) on plm.nbcu_asset_ip_family', v_n;
  end if;

  if v_bad <> 0 then
    raise exception
      'ASSERT FAILED with % privilege violation(s) on plm.nbcu_asset_ip_family -- see the '
      'warnings above. The schema default privilege handed out more than the revoke '
      'removed.', v_bad;
  end if;

  -- The NBCU family is now seventeen tables. Stated as an assertion so that a future
  -- migration adding an eighteenth has to come here and decide, rather than drift.
  select count(*) into v_n from pg_class
   where relnamespace = 'plm'::regnamespace and relkind = 'r' and relname like 'nbcu\_%';
  if v_n <> 17 then
    raise exception
      'ASSERT FAILED: expected 17 plm.nbcu_* tables after this migration, found %. If a '
      'table was legitimately added, update this assertion, the contract tests and '
      'docs/production-promotion-app-tolerance-contract.md together.', v_n;
  end if;

  -- No api.* view or public wrapper may have appeared. Licensed source material does not
  -- reach the browser without an explicit access decision.
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname like 'nbcu%' and c.relkind in ('v','m');
  if v_n <> 0 then
    raise exception
      'ASSERT FAILED: % nbcu view(s) exist. This request adds no api.* view and no public '
      'wrapper -- licensed NBCU metadata is not exposed to the browser.', v_n;
  end if;

  raise notice
    'OK: plm.nbcu_asset_ip_family created -- 17 nbcu tables, 2 capture-scoped FKs, RLS on, '
    'service_role SELECT+INSERT only, no views.';
end;
$$;

-- The finalizer must actually know about the new relationship. Asserted from the source
-- text, because a `create or replace` that silently reverted to an older definition would
-- otherwise be invisible until a real capture failed to reject.
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm' and p.proname = 'finalize_nbcu_capture';

  if v_src is null then
    raise exception 'ASSERT FAILED: plm.finalize_nbcu_capture is missing after replacement';
  end if;
  if position('asset_ip_family' in v_src) = 0 then
    raise exception
      'ASSERT FAILED: plm.finalize_nbcu_capture does not reference asset_ip_family. The '
      'replacement did not take, and the new relationship would never be counted.';
  end if;
  if position('unknown_or_mismatched_property_label' in v_src) = 0
     or position('asset_without_metadata_value' in v_src) = 0
     or position('nonterminal_or_gapped_scope' in v_src) = 0
     or position('orphan_asset_property_link' in v_src) = 0
     or position('excluded_unlicensed_mismatch' in v_src) = 0
     or position('media_downloaded_nonzero' in v_src) = 0
     or position('expected_count_missing' in v_src) = 0
     or position('expected_failures_nonzero' in v_src) = 0
     or position('count_mismatch' in v_src) = 0 then
    raise exception
      'ASSERT FAILED: plm.finalize_nbcu_capture LOST one of its nine pre-existing checks. '
      'A `create or replace` swaps the whole body -- this migration was supposed to be '
      'purely additive.';
  end if;
  raise notice 'OK: finalize_nbcu_capture counts asset_ip_family and kept all 9 prior checks';
end;
$$;
