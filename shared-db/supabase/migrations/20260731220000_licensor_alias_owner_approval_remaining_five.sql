-- Albert's owner ruling of 2026-07-31 on the FIVE remaining LIVE Licensor aliases.
--
-- Plan: fix_popsg_property_taxonomy_reconciliation.md section 22.6 (the "OWNER GATE")
-- and section 13 decision 7. Predecessor: 20260731210000_core_licensor_alias.sql
-- (shared-db PR #345), which created core.licensor_alias, seeded ten rows, and
-- recorded the FIRST owner approval — the NBC family.
--
-- WHY THIS IS A SEPARATE, FORWARD MIGRATION
-- -----------------------------------------
-- 20260731210000 is merged to `main` and already applied to the preview branch
-- (rjyboqwcdzcocqgmsyel). Editing it is forbidden by AGENTS.md section 4 rule 4, and
-- would in any case be inert: Supabase's ledger keys on the version, so an edited file
-- at an already-recorded version never re-runs. The approval therefore has to arrive as
-- new forward DDL/DML, which is what this file is.
--
-- WHAT ALBERT WAS ASKED, AND WHAT HE ANSWERED
-- -------------------------------------------
-- On 2026-07-31, in session, Albert Hazan was shown this exact table:
--
--     | Folder says        | Filed under canonical Licensor | Files (frozen measurement) |
--     | Marvel Style Guide | Marvel                         | 14,636 |
--     | One Piece          | TOEI - ONE PIECE               |  8,383 |
--     | Peanuts            | Peanuts Worldwide              |  3,509 |
--     | Sesame Workshop    | Sesame Street                  |  1,630 |
--     | Paramount          | Viacom Multi                   |  9,052 |
--
-- and asked, verbatim: "Is that correct?"
--
-- He answered, verbatim: "all correct"
--
-- THE CAVEAT HE WAS GIVEN BEFORE HE RULED — AND RULED ANYWAY
-- ----------------------------------------------------------
-- He was told explicitly, BEFORE answering, that Sesame Workshop -> Sesame Street was the
-- one mapping that would be scrutinised hardest, because it is the only mapping from a
-- COMPANY name to a SHOW name while the other four run the other way (a show/imprint name
-- filed under the company that owns it). He approved it anyway. That flag is recorded in
-- the approval_evidence of every row below, verbatim, so the reasoning behind the decision
-- survives the session — a future reader must be able to see that the odd one out was
-- named as odd and accepted with eyes open, not slipped through in a batch.
--
-- WHAT THIS DOES *NOT* COVER
-- --------------------------
-- Nickelodeon and Viacom stay `inherited_unverified`, untouched. Both are dormant with a
-- measured ZERO files in the frozen PSG-1 corpus, so they were explicitly presented to
-- Albert as needing no decision, and he did not rule on them. Approving them here would be
-- inventing a ruling he never gave — exactly the laundering that core.licensor_alias's
-- approval_status column exists to prevent. Contract test A4/H4 pins them BY NAME.
--
-- STATE AFTER THIS MIGRATION: 10 alias rows.
--   owner_approved (8):        NBC Universal, NBCU, NBCUniversal   (NBC ruling, 20260731210000)
--                              Marvel Style Guide, One Piece, Peanuts,
--                              Sesame Workshop, Paramount           (this migration)
--   inherited_unverified (2):  Nickelodeon, Viacom                  (dormant, no ruling)
--
-- THIS MIGRATION STILL HAS NO RUNTIME EFFECT. READ THIS BEFORE ASSUMING ANYTHING CHANGED.
-- --------------------------------------------------------------------------------------
-- The PopDAM worker (u2giants/popdam3, apps/worker/src/handlers/popsg-tags.ts) continues to
-- resolve Licensor strings from its OWN hard-coded `LICENSOR_ALIASES` array. It does not
-- read core.licensor_alias, and nothing in this repository can make it. Until that worker is
-- switched over to public.resolve_licensor_alias() (plan section 22.13 / 22.8 cutover), this
-- file changes the AUDIT RECORD ONLY: it records that a human ratified five mappings that
-- were already in force. No file is re-routed, no tag is recomputed, no behaviour differs by
-- one byte. popdam3 is a separate repository and is deliberately not modified here.
--
-- APPROVAL IS PERFORMED THROUGH public.approve_licensor_alias(), the table's single
-- sanctioned path — not by writing the four approval columns directly. Same reasoning as
-- section 7 of 20260731210000: the constraints would have caught a faked provenance either
-- way, but exercising the real mechanism is how a latent defect in it gets found cheaply.

do $$
declare
  -- One shared evidence string: Albert was shown the five as ONE table and ruled on the
  -- table as a whole with a single answer. Splitting it into five bespoke notes would
  -- misrepresent five separate rulings where there was one.
  v_evidence constant text :=
    'OWNER RULING, verbatim, given by Albert Hazan in session on 2026-07-31: "all correct". '
    || 'THE EXACT QUESTION ASKED: Albert was shown this table -- '
    || '[Folder says | Filed under canonical Licensor | Files (frozen measurement)] '
    || 'Marvel Style Guide | Marvel | 14,636 ; '
    || 'One Piece | TOEI - ONE PIECE | 8,383 ; '
    || 'Peanuts | Peanuts Worldwide | 3,509 ; '
    || 'Sesame Workshop | Sesame Street | 1,630 ; '
    || 'Paramount | Viacom Multi | 9,052 -- '
    || 'and asked, verbatim: "Is that correct?". He answered, verbatim: "all correct". '
    || 'CAVEAT PUT TO HIM BEFORE HE RULED, AND RULED ANYWAY: he was told explicitly that '
    || 'Sesame Workshop -> Sesame Street was the one mapping that would be scrutinised '
    || 'hardest, because it is the only mapping from a COMPANY name to a SHOW name while '
    || 'the other four run the other way. He approved it anyway, with that flag in front '
    || 'of him. '
    || 'Albert is the owner of POP Creations and the sole authority on licensor identity '
    || 'for this data set. File counts are the frozen PSG-1 production measurement of '
    || '2026-07-26/27 (docs/verification/popsg-property-reconciliation-20260727-psg1/), '
    || 'not a live re-count. Recorded by migration '
    || '20260731220000_licensor_alias_owner_approval_remaining_five.sql. '
    || 'SCOPE: these five aliases ONLY -- Albert did NOT rule on Nickelodeon or Viacom, '
    || 'which are dormant (zero measured files) and were presented to him as needing no '
    || 'decision. They remain inherited_unverified.';

  v_aliases constant text[] := array[
    'Marvel Style Guide', 'One Piece', 'Peanuts', 'Sesame Workshop', 'Paramount'
  ];
  v_alias text;
  v_id    uuid;
  v_count integer;
begin
  -- WHY THE JWT CLAIM IS SET (same null hole as 20260731210000 section 7).
  -- approve_licensor_alias() guards itself with
  --   `if not (app.has_role('administrator') or auth.role() = 'service_role')`.
  -- In a migration there is no JWT, so auth.role() is NULL, the whole expression is NULL,
  -- and `if NULL then` does not fire -- the guard would admit this call BY ACCIDENT rather
  -- than by right. The transaction-local claim below asserts, truthfully, that this
  -- migration runs with service-level authority, and is reset immediately after.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  foreach v_alias in array v_aliases
  loop
    v_id := public.approve_licensor_alias(v_alias, 'Albert Hazan', v_evidence);
    if v_id is null then
      raise exception 'five-alias approval: approve_licensor_alias(%) returned no row', v_alias;
    end if;
  end loop;

  perform set_config('request.jwt.claims', '', true);

  -- approved_at is pinned to the DATE OF THE RULING, not to whenever this migration runs.
  -- The RPC can only stamp now(), which would make preview say one day and production say
  -- whatever day it was promoted -- two different "when did Albert decide this" answers for
  -- one decision. The ruling has exactly one date.
  --
  -- MIDDAY UTC, NOT MIDNIGHT, AND THIS IS NOT COSMETIC. This database's session TimeZone is
  -- America/New_York (verified on preview 2026-07-31). Storing the ruling as
  -- '2026-07-31 00:00:00+00' makes `approved_at::date` render as 2026-07-30 for any reader
  -- on server-local time -- i.e. the audit trail would state the wrong day for Albert's
  -- decision, which is precisely the thing an approval record exists to get right. This was
  -- caught by contract test G3 during the 20260731210000 preview rehearsal, not in review.
  -- 12:00 UTC reads as 2026-07-31 in every timezone from UTC-11 through UTC+12.
  update core.licensor_alias
     set approved_at = timestamptz '2026-07-31 12:00:00+00'
   where alias = any (v_aliases)
     and approval_status = 'owner_approved';

  -- ---------------------------------------------------------------------------
  -- Fail loudly if this did not land exactly as intended.
  -- Asserted BY NAME, never by count alone: a bare count would not notice a swap.
  -- ---------------------------------------------------------------------------

  -- 1. All five are approved, by Albert, dated correctly in BOTH UTC and server-local
  --    time, carrying his verbatim words and the Sesame Workshop caveat.
  select count(*) into v_count
    from core.licensor_alias
   where alias = any (v_aliases)
     and approval_status = 'owner_approved'
     and approved_by = 'Albert Hazan'
     and approved_at is not null
     and (approved_at at time zone 'UTC')::date = date '2026-07-31'
     and approved_at::date = date '2026-07-31'
     and approval_evidence like '%"all correct"%'
     and approval_evidence like '%Is that correct?%'
     and approval_evidence like '%COMPANY name to a SHOW name%';
  if v_count <> 5 then
    raise exception
      'five-alias approval: expected all 5 rows owner_approved by Albert Hazan, dated '
      '2026-07-31 in both UTC and server-local time, quoting the ruling verbatim and '
      'carrying the Sesame Workshop caveat; found %', v_count;
  end if;

  -- 2. Nickelodeon and Viacom are UNTOUCHED. Albert did not rule on them.
  select count(*) into v_count
    from core.licensor_alias
   where alias in ('Nickelodeon', 'Viacom')
     and approval_status = 'inherited_unverified'
     and approved_by is null
     and approved_at is null
     and approval_evidence is null;
  if v_count <> 2 then
    raise exception
      'five-alias approval: Nickelodeon and Viacom must both remain inherited_unverified '
      'with no approval fields -- they are dormant and Albert did not rule on them. Found % '
      'of 2 in the expected state.', v_count;
  end if;

  -- 3. The NBC family's EXISTING approval is untouched -- still Albert, still dated to the
  --    NBC ruling, still quoting the NBC words. This migration must not disturb it.
  select count(*) into v_count
    from core.licensor_alias
   where alias in ('NBC Universal', 'NBCU', 'NBCUniversal')
     and approval_status = 'owner_approved'
     and approved_by = 'Albert Hazan'
     and (approved_at at time zone 'UTC')::date = date '2026-07-31'
     and approved_at::date = date '2026-07-31'
     and approval_evidence like
         '%NBC Universal really means NBC, really means NBCU, really means NBCUniversal%';
  if v_count <> 3 then
    raise exception
      'five-alias approval: the NBC family''s existing approval was disturbed. Expected 3 '
      'rows still owner_approved by Albert Hazan quoting the NBC ruling; found %', v_count;
  end if;

  -- 4. Nothing outside the eight ruled-on aliases claims approval. Guards against a stray
  --    row being swept up.
  select count(*) into v_count
    from core.licensor_alias
   where approval_status = 'owner_approved'
     and alias not in ('NBC Universal', 'NBCU', 'NBCUniversal',
                       'Marvel Style Guide', 'One Piece', 'Peanuts',
                       'Sesame Workshop', 'Paramount');
  if v_count <> 0 then
    raise exception
      'five-alias approval: % alias row(s) outside the eight Albert actually ruled on claim '
      'owner approval.', v_count;
  end if;
end;
$$;
