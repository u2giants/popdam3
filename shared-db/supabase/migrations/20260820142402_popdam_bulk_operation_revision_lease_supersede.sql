-- SUPERSEDES 20260819011639 -- identical executable content, promotable provenance.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- 20260819011639 is merged, was applied to preview, survived FIVE independent review
-- rounds plus a sixth promotion review (glm-5.3, APPROVE, no Critical or High), and is
-- CORRECT. It simply cannot be promoted, and the reason is provenance, not content.
--
-- Its preview rehearsal (run 32250275467) ran POST-MERGE from main tip
-- b8390fe7ff4eb0cc441c2f490cfb9777bebb6f2b -- exactly what the "merge first, then rehearse
-- on preview from merged main, then promote" rule instructs. The production business-risk
-- gate refused it on 2026-08-20:
--
--   Production business-risk gate rejected evidence: original apply run 32250275467
--   dispatched at b8390fe... produced evidence with a different
--   .github/workflows/shared-supabase-migrations.yml than the merge commit 51e7764... of
--   the pull request that authored 20260819011639
--
-- The historical-recovery lane pins the original run's producer files to the AUTHORING
-- PULL REQUEST'S MERGE COMMIT. A post-merge rehearsal runs from a LATER main tip, and ten
-- producer files changed between 51e7764 and b8390fe. So the lane cannot recover evidence
-- produced by the very workflow the repository mandates. That gap is real and is filed
-- separately; it is NOT worked around here.
--
-- NO GUARD WAS WEAKENED TO PRODUCE THIS FILE. The refusal was accepted. This migration
-- takes the ordinary path instead: fresh preview rehearsal from current main, independent
-- review, guarded merge, promotion -- all on today's machinery.
--
-- URGENCY, stated so nobody mistakes speed for corner-cutting: the owner reports #1171 is
-- blocking a fix for a leaking OpenAI API token that is costing real money. That justified
-- superseding rather than waiting for the recovery lane to be repaired. It did not justify
-- changing a single line of the SQL below.
--
-- WHAT CHANGED FROM 20260819011639
-- --------------------------------
-- NOTHING executable. The statements below are a byte-faithful copy of that file's
-- executable portion. Only this header differs. If you diff the two files' SQL and find a
-- difference, that is a defect in this migration, not an improvement.
--
-- IF 20260819011639 IS SOMEHOW ALREADY APPLIED to a database, this file is still safe:
-- every statement is `drop function if exists` / `create [or replace] function` /
-- `grant` / `revoke`, so re-running it converges on the same catalog state.
--
-- NO pure-data declaration is made here, deliberately: this migration names real catalog
-- objects (two functions plus their grants), so the post-apply verifier has plenty to
-- assert. Note the guard does not merely trust such a declaration -- it re-lexes the file
-- and refuses if the claim disagrees with the statements. An earlier draft of THIS header
-- mentioned the declaration token in prose and was correctly refused for exactly that
-- reason, naming all 12 non-data statements.
--
-- ORIGINAL HEADER FROM 20260819011639 FOLLOWS, UNCHANGED, because it carries the design
-- reasoning that five review rounds shaped and it must not be lost.
--
-- Issue #1171 / claim #1174. Shared-database prerequisite for u2giants/popdam3#92
-- (plan_openrouter_batch_restart_recovery.md, Step 1).
--
-- WHAT THIS GUARDS
-- ----------------
-- PopDAM bulk-operation state is NOT a table. It is one JSONB value in
-- public.admin_config under key 'BULK_OPERATIONS'; each operation is one object
-- under its own op key. Two writers exist today and both replace whole operation
-- objects: public.update_bulk_operation (single key) and
-- public.update_bulk_operations_batch (many keys). Both serialize on
-- pg_advisory_xact_lock(hashtext('BULK_OPERATIONS')), which orders writers but
-- does NOT stop a stale writer from overwriting a newer state.
--
-- Once the PopDAM worker persists an accepted OpenRouter Batch API job inside an
-- operation, an overwrite is no longer a lost UI field: it abandons (or worse,
-- re-submits and re-bills) provider work. Overlapping Railway processes during a
-- deploy make that a normal event, and run_id is not a lock because nothing ever
-- compared it.
--
-- THE ONE DESIGN PRINCIPLE (read this before changing anything below)
-- -------------------------------------------------------------------
--   A GUARD MUST NEVER BE COMPUTED FROM A VALUE THE UNPROVEN CALLER CAN SET.
--
-- Four independent reviews found four different holes and every one of them was the
-- same hole: the thing that decided whether the protection applied was itself
-- writable by the caller the protection was aimed at. No proof at all; then "did you
-- pass an owner argument" (the owner name is published in admin_config, so anyone can
-- pass it); then a digest that two write paths could overwrite; then the eight lease
-- fields were frozen but `phase` -- the field the whole drop-protection is computed
-- from -- was left writable on exactly the three paths that hold no receipt.
--
-- So there is now ONE notion of proof, v_proven, and every guard that protects a
-- provider-job pointer is gated on it:
--   * v_token_ok  -- the caller sent back the one-time claim receipt minted when the
--                    lease was taken; the receipt is never readable from stored state; OR
--   * an establishing claim -- a lease claim on an operation with no incumbent owner
--                    and no stored receipt digest, which has nobody to displace.
-- Everything else -- legacy three-argument calls, the batch writer, a guarded write
-- that does not claim, and a claim that repeats a publicly readable owner name -- is
-- UNPROVEN and may only carry the pointer-bearing state forward exactly as stored.
-- The inputs to every pointer guard (external_job presence, provider_batch_id, phase
-- and the eight lease fields) are therefore all immutable to an unproven caller. If
-- you add a guard, check what it reads: if an unproven caller can write that value,
-- the guard is broken by construction.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
-- 1. A guarded compare-and-swap path on public.update_bulk_operation:
--      * caller states the revision it read (p_expected_revision);
--      * the stored revision must match exactly or the write is refused;
--      * a successful guarded write stamps state_revision = stored + 1;
--      * p_submission_owner + p_lease_seconds atomically claim a time-bounded
--        submission lease inside external_job in the SAME statement, under the
--        SAME advisory lock, so exactly one worker can ever hold a given revision;
--      * the guarded call returns an envelope carrying the SAVED revision, owner,
--        lease and provider_batch_id, so the worker can PROVE what was stored
--        instead of treating a missing response as success.
-- 2. Protected external-job state, keyed off the JOB POINTER and never off the
--    lease clock. An operation that names a provider job (a saved
--    provider_batch_id) or is in a phase where PopDAM believes one exists
--    ('prepared','submitting','pending','applying','ambiguous_submission') may not
--    have that external_job dropped, re-pointed at a different provider batch, or
--    un-stopped by ANY caller -- guarded or legacy, claiming or not, lease live or
--    long lapsed. A lapsed lease is not evidence the provider job went away; it is
--    the state in which a real, billed job is most likely to exist unrecorded, so
--    letting the guards expire with the lease would re-open the duplicate-billing
--    window on a timer.
-- 2b. Only a call that CLAIMS the lease may move the lease, and only the caller
--    that actually claimed it can PROVE it holds it. p_op_state is free-form JSONB,
--    so a guarded call passing p_submission_owner => null could otherwise embed a
--    different submission_owner / lease_expires_at inside the payload and write it
--    over a live lease. A non-claiming guarded write must therefore carry every
--    lease-controlling field forward EXACTLY as stored, may not drop a live-leased
--    external_job, and may not move the phase of a job that has a pointer.
--    Stating an owner name is NOT proof of being the owner: submission_owner is
--    stored in admin_config, which every caller of these functions can read. So a
--    claim over a free lease mints a one-time CLAIM RECEIPT, stores only its md5
--    digest (external_job.lease_proof) and returns the raw receipt once, in the
--    proof envelope, as lease_token. Binding an operation that already has a stored
--    external_job to a provider job requires sending that receipt back as
--    external_job.lease_token; it is verified and stripped before anything is
--    stored. A same-name renewal over a live lease keeps the incumbent receipt, so
--    two processes that legitimately share one worker name still retry normally
--    without either of them becoming the holder by repeating a public string.
-- 3. Ambiguity instead of automatic resubmission, on ALL FOUR write paths. A
--    submission lease that expires with NO provider_batch_id saved is the exact
--    crash window where OpenRouter may already hold (and bill) the job.
--      * Guarded path (claiming or not): the payload is NOT applied, the operation
--        is durably flipped to 'ambiguous_submission' from STORED state, and the
--        envelope returns ok = false with that verdict.
--      * Legacy three-argument call and the batch writer: they RAISE (55000) and
--        change nothing. Those callers have no envelope and read "no exception" as
--        success, and the money path is write-then-POST, so a quiet return would
--        arrive after the bill. The stored row keeps matching the rule, so the
--        refusal repeats forever. The batch writer applies NO key, so it stays
--        all-or-nothing.
--    There is NO payload escape from this rule. Declaring phase =
--    'ambiguous_submission' in a legacy or batch payload is just a string anyone can
--    type, it proves nothing was reconciled, and honouring it used to write the
--    whole object (fabricated batch id, new owner, fresh lease and all) while
--    returning the ordinary success shape. Reconciliation is a guarded-path
--    operation only, where the function itself writes the verdict.
-- 4. Backward compatibility only where it is safe. A three-argument legacy call
--    still behaves exactly as before -- same conditional-status no-op, same full
--    'BULK_OPERATIONS' object returned -- for every operation with no protected
--    external-job state. When protected state exists and the legacy write would
--    clobber it, the call RAISES. Legacy and batch callers may never introduce a
--    provider_batch_id on an operation that already has a stored external_job:
--    they can hold no proof, and refusing only REPLACEMENT left the window where it
--    matters (lease taken, POST in flight, nothing stored yet) unguarded.
--
-- WHY update_bulk_operations_batch IS IN SCOPE
-- -------------------------------------------
-- It writes the same key and never looked at what it was overwriting, so it is the
-- one legacy caller that could clobber a protected job. It now applies the same
-- protection rules per key and raises loudly rather than merging over them.
--
-- Objects written by this migration (claim #1174):
--   function public.update_bulk_operation
--   function public.update_bulk_operations_batch
-- public.admin_config is read and upserted exactly as before; its shape is unchanged.

begin;

-- The legacy three-argument function must be dropped, not overloaded: adding
-- defaulted parameters via CREATE OR REPLACE would leave two candidates and make
-- every existing three-argument call ambiguous. Dropping and recreating keeps ONE
-- function whose defaults preserve the legacy call shape.

drop function if exists public.update_bulk_operation(text, jsonb, text);
drop function if exists public.update_bulk_operation(text, jsonb, text, bigint, text, integer);

create function public.update_bulk_operation(
  p_op_key text,
  p_op_state jsonb,
  p_only_if_status text default null,
  p_expected_revision bigint default null,
  p_submission_owner text default null,
  p_lease_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  -- Live phases are phases in which PopDAM believes a provider job exists or is
  -- about to exist. 'ambiguous_submission' is protected too, more strongly.
  c_live_phases constant text[] := array['prepared','submitting','pending','applying'];
  c_stop_status constant text[] := array['stop','stopping','stopped','stop_requested'];
  c_default_lease constant integer := 120;

  -- Fields inside external_job that describe WHO holds the submission lease and
  -- what the ambiguity verdict is. Only a call that actually claims the lease
  -- (p_submission_owner supplied) or the function itself may set them; every other
  -- caller may carry them forward and nothing else. See the guarded-path block.
  c_lease_fields constant text[] := array[
    'submission_owner',
    'lease_expires_at',
    'lease_claimed_at',
    'ambiguous_since',
    'ambiguous_reason',
    'ambiguous_prior_phase',
    'ambiguous_prior_owner',
    'lease_proof'];

  -- The ambiguity VERDICT fields. The other four members of c_lease_fields are
  -- stamped by this function on a claim, so whatever the payload said about them is
  -- discarded; these four are not, so a claiming caller could otherwise rewrite them.
  c_verdict_fields constant text[] := array[
    'ambiguous_since',
    'ambiguous_reason',
    'ambiguous_prior_phase',
    'ambiguous_prior_owner'];

  v_field          text;
  v_current        jsonb;
  v_stored         jsonb;
  v_stored_status  text;
  v_stored_rev     bigint;
  v_stored_job     jsonb;
  v_stored_phase   text;
  v_stored_batch   text;
  v_stored_owner   text;
  v_stored_lease   timestamptz;
  v_stored_live    boolean;
  v_stored_ambig   boolean;
  v_stored_proof   text;
  v_protected      boolean;
  v_pointer        boolean;
  v_proven         boolean := false;

  v_in_job         jsonb;
  v_in_status      text;
  v_in_batch       text;
  v_in_phase       text;
  v_in_owner       text;
  v_in_rev         bigint;
  v_in_token       text;
  v_token_ok       boolean := false;

  v_now            timestamptz := now();
  v_lease_until    timestamptz;
  v_lease_token    text;
  v_minted         boolean := false;
  v_new            jsonb;
  v_out_op         jsonb;
  v_ok             boolean := true;
  v_reason         text := 'ok';
begin
  if p_op_key is null or btrim(p_op_key) = '' then
    raise exception 'update_bulk_operation: p_op_key is required'
      using errcode = '22023';
  end if;

  -- Serialize all writers on the BULK_OPERATIONS config key (unchanged).
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);

  v_stored := case when jsonb_typeof(v_current -> p_op_key) = 'object'
                   then v_current -> p_op_key end;
  v_stored_status := v_stored ->> 'status';
  v_stored_rev    := coalesce(nullif(v_stored ->> 'state_revision', '')::bigint, 0);
  v_stored_job    := case when jsonb_typeof(v_stored -> 'external_job') = 'object'
                          then v_stored -> 'external_job' end;
  v_stored_phase  := v_stored_job ->> 'phase';
  v_stored_batch  := nullif(v_stored_job ->> 'provider_batch_id', '');
  v_stored_owner  := nullif(v_stored_job ->> 'submission_owner', '');
  v_stored_lease  := nullif(v_stored_job ->> 'lease_expires_at', '')::timestamptz;
  v_stored_proof  := nullif(v_stored_job ->> 'lease_proof', '');
  v_stored_live   := coalesce(v_stored_phase = any(c_live_phases), false);
  v_stored_ambig  := coalesce(v_stored_phase = 'ambiguous_submission', false);

  -- ==========================================================================
  -- WHAT "PROTECTED" MEANS, AND WHY IT NO LONGER MENTIONS THE LEASE.
  --
  -- Both independent reviews of this migration landed on the same root cause: the
  -- guards keyed off whether a lease was still LIVE. A lease lapses on a timer, and
  -- the moment it lapses is exactly the moment a real, billable provider job is most
  -- likely to exist and be unrecorded -- so lease liveness is the one thing that must
  -- NOT decide whether the pointer to that job can be destroyed or re-pointed.
  --
  -- v_pointer is the durable fact instead: this operation either already names a
  -- provider job (provider_batch_id) or is in a phase where PopDAM believes one
  -- exists or is about to (live phases, or an unresolved ambiguity verdict). While
  -- v_pointer holds, nobody -- claiming, non-claiming, legacy or batch -- may drop or
  -- re-point external_job, whatever the lease clock says.
  -- ==========================================================================
  v_pointer       := v_stored_live or v_stored_ambig or v_stored_batch is not null;
  v_protected     := v_pointer;

  v_in_job    := case when jsonb_typeof(p_op_state -> 'external_job') = 'object'
                      then p_op_state -> 'external_job' end;

  -- ==========================================================================
  -- THE CLAIM RECEIPT: THE ONLY THING THAT DISTINGUISHES THE REAL HOLDER.
  --
  -- Stating an owner name is not being the owner: every caller of this function can
  -- also read admin_config, so the stored submission_owner is public and copyable. A
  -- rival process that repeats the stored name satisfies every name-based check.
  --
  -- So a lease claim that finds no live lease MINTS a random receipt, stores only its
  -- md5 DIGEST in external_job.lease_proof, and returns the raw receipt exactly once,
  -- in the proof envelope, to the caller that claimed. Reading admin_config yields the
  -- digest, never the receipt. A later caller proves it is the holder by sending the
  -- receipt back as external_job.lease_token; the token is verified here and STRIPPED
  -- before anything is stored, so it never becomes readable state.
  --
  -- A same-name RENEWAL over a still-live lease deliberately does NOT re-mint. Two
  -- processes that legitimately share one owner name (a redeploy running the same
  -- worker twice) can therefore still extend the lease -- ordinary retry traffic --
  -- without either invalidating the real holder's receipt or being handed one.
  -- ==========================================================================
  v_in_token  := nullif(v_in_job ->> 'lease_token', '');
  if v_in_job is not null and v_in_job ? 'lease_token' then
    v_in_job   := v_in_job - 'lease_token';
    p_op_state := jsonb_set(p_op_state, array['external_job'], v_in_job);
  end if;
  v_token_ok  := v_stored_proof is not null
                 and v_in_token is not null
                 and md5(v_in_token) = v_stored_proof;

  v_in_status := p_op_state ->> 'status';
  v_in_batch  := nullif(v_in_job ->> 'provider_batch_id', '');
  v_in_phase  := v_in_job ->> 'phase';
  v_in_owner  := nullif(v_in_job ->> 'submission_owner', '');
  v_in_rev    := nullif(p_op_state ->> 'state_revision', '')::bigint;

  -- ==========================================================================
  -- v_proven -- THE ONE NOTION OF PROOF, USED BY EVERY POINTER GUARD.
  --
  -- See THE ONE DESIGN PRINCIPLE at the top of this file. A caller is proven only if:
  --   * it sent back the one-time claim receipt (verified against the stored digest,
  --     which is all that is ever stored, so the receipt cannot be read out of
  --     admin_config); or
  --   * it is CLAIMING a lease on an operation that has no incumbent owner and no
  --     stored receipt digest -- it is establishing the job and has nobody to displace.
  --
  -- Stating an owner name is not proof (the name is readable). Matching the revision
  -- is not proof (everyone who read the state matches it). Being on the legacy or
  -- batch path is the absence of proof by construction.
  -- ==========================================================================
  v_proven := v_token_ok
              or (p_submission_owner is not null
                  and v_stored_owner is null
                  and v_stored_proof is null);

  -- ==========================================================================
  -- LEGACY PATH -- byte-for-byte the historical behaviour, except that it can no
  -- longer clobber protected external-job state.
  -- ==========================================================================
  if p_expected_revision is null and p_submission_owner is null then

    -- ------------------------------------------------------------------------
    -- THE AMBIGUITY RULE, ON THE LEGACY PATH TOO.
    --
    -- An expired submission lease with NO saved provider_batch_id is the crash
    -- window in which OpenRouter may already hold -- and bill -- the job. The
    -- guarded path already refuses to hand out a new submission slot there. A
    -- legacy caller must not be able to walk around that rule: it writes the same
    -- key, and a legacy write that carries the operation back to a submittable
    -- state is exactly what drives the duplicate, duplicate-billed POST.
    --
    -- A legacy call cannot be handed a proof envelope, so the ONLY way to tell a
    -- three-argument caller "no" is to RAISE. It must not be told anything that a
    -- historical caller reads as success: those callers treat "no exception" as
    -- success, they detect the one historical no-op by STATUS, and the money path
    -- here is write-then-POST -- a refusal that arrives on the NEXT write arrives
    -- after the provider has already been billed.
    --
    -- So: the payload is NOT applied and the stored row is left exactly as it is --
    -- expired lease, no provider_batch_id, live phase. That row still matches this
    -- predicate, so every later legacy or batch write over this operation raises
    -- again, forever, until a guarded caller or a human reconciles it. The refusal,
    -- not a durable flip, is what prevents the duplicate submission.
    --
    -- THERE IS NO PAYLOAD ESCAPE FROM THIS RULE ANY MORE.
    --
    -- This predicate used to fall through whenever the PAYLOAD declared
    -- phase = 'ambiguous_submission', on the theory that such a payload is an
    -- explicit reconciliation. It is not: the string is just text in free-form
    -- JSONB, anyone can type it, and nothing about typing it proves the caller
    -- checked anything with the provider. Worse, taking the escape did not merely
    -- record a verdict -- the call fell through and wrote the WHOLE object, so the
    -- same payload could carry a fabricated provider_batch_id, a new owner or a
    -- fresh lease, and it returned the ordinary success shape that a write-then-POST
    -- caller reads as "go ahead and submit".
    --
    -- Reconciliation is now a GUARDED-PATH operation only. A guarded call over this
    -- state makes the ambiguity durable itself (it writes the verdict, the prior
    -- phase and the prior owner from what is STORED, never from the payload) and
    -- returns ok = false, which no caller can mistake for permission to submit.
    -- ------------------------------------------------------------------------
    if v_stored_job is not null
       and v_stored_batch is null
       and v_stored_owner is not null
       and v_stored_lease is not null
       and v_stored_lease <= v_now
       and coalesce(v_stored_phase, '') <> 'ambiguous_submission' then  -- already flipped

      raise exception
        'update_bulk_operation: legacy write to "%" refused -- the submission lease held by % expired at % with no saved provider_batch_id, so the provider may already hold (and bill) this job. This operation is ambiguous: call the guarded path with p_expected_revision, which records the ambiguity verdict itself. A legacy payload declaring phase = ''ambiguous_submission'' is NOT accepted as proof of reconciliation.',
        p_op_key, v_stored_owner, v_stored_lease
        using errcode = '55000';
    end if;

    if p_only_if_status is not null
       and v_stored_status is distinct from p_only_if_status then
      -- Unchanged contract: return current state so the caller detects the no-op.
      return v_current;
    end if;

    if v_protected then
      -- A legacy caller has no revision to compare, so it is allowed through only
      -- when its payload demonstrably carries the same protected job forward.
      if v_in_job is null then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- it would drop a protected external_job (phase=%, provider_batch_id=%). Use the guarded path with p_expected_revision.',
          p_op_key, coalesce(v_stored_phase, '<none>'), coalesce(v_stored_batch, '<none>')
          using errcode = '55000';
      end if;

      if v_stored_ambig and coalesce(v_in_phase, '') <> 'ambiguous_submission' then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- external_job is ambiguous_submission and requires explicit reconciliation.',
          p_op_key
          using errcode = '55000';
      end if;

      -- ----------------------------------------------------------------------
      -- DESTROY-AND-REMINT VIA phase. THE PROTECTION MUST NOT BE COMPUTED FROM A
      -- FIELD THIS CALLER CAN WRITE.
      --
      -- Everything that stops a pointer being destroyed -- the drop refusal above,
      -- the guarded path's v_pointer -- is computed from external_job.phase. phase
      -- was not one of the frozen fields, so the drop protection could simply be
      -- switched off and then walked around in two calls:
      --
      --   1. a legacy (or batch, or same-name claiming) write moves phase from a live
      --      phase to a non-live one; every other rule is satisfied because every
      --      other field is carried forward faithfully;
      --   2. the pointer is now gone, so the next call drops external_job outright;
      --   3. a fresh claim over the now-clean operation mints a NEW receipt and binds
      --      a provider_batch_id of the caller's invention. The real holder's genuine
      --      id is afterwards refused as a replacement and the billed job is orphaned.
      --
      -- The digest can no longer be planted IN PLACE; this destroyed and reissued it
      -- to reach the same end. So: while this operation carries a provider-job
      -- pointer, its phase may only be moved by a caller that PROVES it is the holder
      -- (v_proven). A caller that round-trips the object it read carries the same
      -- phase and is untouched.
      -- ----------------------------------------------------------------------
      if not v_proven
         and (v_in_job -> 'phase') is distinct from (v_stored_job -> 'phase') then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- it would move the external_job phase of a protected job from % to %. The drop and re-point protections are computed from this phase, so moving it is how a pointer gets destroyed and reissued; only a caller that proves it holds the lease (its lease_token) may move it. Carry the phase forward exactly as stored.',
          p_op_key,
          coalesce((v_stored_job -> 'phase')::text, '<absent>'),
          coalesce((v_in_job -> 'phase')::text, '<absent>')
          using errcode = '55000';
      end if;

      if v_stored_batch is not null and v_in_batch is distinct from v_stored_batch then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- it would replace saved provider_batch_id % with %.',
          p_op_key, v_stored_batch, coalesce(v_in_batch, '<null>')
          using errcode = '55000';
      end if;

      if coalesce(v_stored_lease > v_now, false)
         and v_in_owner is distinct from v_stored_owner then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- submission lease is held by % until %.',
          p_op_key, v_stored_owner, v_stored_lease
          using errcode = '55000';
      end if;

      if coalesce(v_stored_rev > 0, false)
         and (v_in_rev is null or v_in_rev < v_stored_rev) then
        raise exception
          'update_bulk_operation: legacy write to "%" refused -- it would regress state_revision % to %.',
          p_op_key, v_stored_rev, coalesce(v_in_rev::text, '<null>')
          using errcode = '55000';
      end if;
    end if;

    -- ------------------------------------------------------------------------
    -- A LEGACY CALLER MAY NEVER MOVE A LEASE-CONTROLLING FIELD. NOT ONE.
    --
    -- c_lease_fields used to be enforced in exactly ONE place -- the non-claiming
    -- branch of the guarded path -- which left the root of trust writable by the two
    -- paths that hold no proof of anything. external_job.lease_proof is the md5 digest
    -- the whole receipt scheme trusts, and a three-argument call could overwrite it:
    --
    --   1. a legacy call plants external_job.lease_proof = md5('attacker-token');
    --      nothing checked it, so it was stored;
    --   2. the same caller returns on the guarded path presenting that token as
    --      external_job.lease_token, is verified as the holder, and plants a
    --      fabricated provider_batch_id.
    --
    -- The real holder's genuine id is then refused as a replacement and the billed
    -- provider job is orphaned -- the exact failure this migration exists to prevent.
    -- Planting the digest also destroys the true holder's receipt on the way past.
    --
    -- THE RULE: a legacy caller may not modify ANY member of c_lease_fields. They must
    -- be carried forward exactly as stored -- same values, same present/absent --
    -- including on an operation with NO stored external_job, where "as stored" means
    -- ABSENT. Planting a digest on an operation nobody holds yet buys the same
    -- fake-provider_batch_id capability as soon as anybody claims it.
    --
    -- REFUSE, DO NOT SILENTLY CARRY FORWARD. A legacy caller that innocently
    -- round-trips the whole object writes back exactly what it read, so it passes this
    -- check untouched; the only call that fails is one that CHANGED a lease field, and
    -- that is never innocent. Silently substituting the stored values would hand such a
    -- caller an ordinary success it reads as "my lease fields were accepted" -- the
    -- same silent-success class of behaviour the payload ambiguity escape was rejected
    -- for, and on the same money path.
    -- ------------------------------------------------------------------------
    if v_in_job is not null then
      foreach v_field in array c_lease_fields loop
        if (v_in_job -> v_field) is distinct from (v_stored_job -> v_field) then
          raise exception
            'update_bulk_operation: legacy write to "%" refused -- it would modify the lease-controlling external_job field "%" (stored=%, offered=%). These fields, lease_proof above all, are the root of trust for the claim receipt; a three-argument caller holds no proof and may never move them. Carry them forward exactly as stored, or claim the lease on the guarded path.',
            p_op_key, v_field,
            coalesce((v_stored_job -> v_field)::text, '<absent>'),
            coalesce((v_in_job -> v_field)::text, '<absent>')
            using errcode = '55000';
        end if;
      end loop;
    end if;

    -- ------------------------------------------------------------------------
    -- A LEGACY CALLER MAY NEVER INTRODUCE A provider_batch_id.
    --
    -- Refusing only to REPLACE a stored id left the window where it matters wide
    -- open: while a worker holds a lease and has not yet saved the id its POST
    -- returned, nothing is stored, so the replacement rule did not apply and no
    -- rule required a legacy caller to be anybody in particular. A three-argument
    -- call repeating the stored owner and revision could therefore bind this
    -- operation to a fabricated job, and the real id would afterwards be refused as
    -- a replacement -- orphaning the billed job.
    --
    -- Binding an operation to a provider job is the lease holder's write and only
    -- the holder's, and a legacy caller can hold no proof, so it may never do it.
    -- Creating a brand-new operation that already carries an id is untouched (there
    -- is no stored external_job to be the holder of).
    -- ------------------------------------------------------------------------
    if v_stored_job is not null
       and v_stored_batch is null
       and v_in_batch is not null then
      raise exception
        'update_bulk_operation: legacy write to "%" refused -- it would introduce provider_batch_id % on an operation that has none. Only the submission-lease holder may bind an operation to a provider job, on the guarded path with p_expected_revision and its lease_token.',
        p_op_key, v_in_batch
        using errcode = '55000';
    end if;

    -- Stop is never un-stopped by a writer that is driving provider work.
    if coalesce(v_stored_status = any(c_stop_status), false)
       and coalesce(v_in_status, '') <> all(c_stop_status)
       and coalesce(v_in_phase = any(c_live_phases), false) then
      raise exception
        'update_bulk_operation: legacy write to "%" refused -- operation status is "%" (stopped) and the write would resume a live external_job.',
        p_op_key, v_stored_status
        using errcode = '55000';
    end if;

    v_current := jsonb_set(v_current, array[p_op_key], p_op_state);

    insert into admin_config (key, value, updated_at)
    values ('BULK_OPERATIONS', v_current, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;

    return v_current;
  end if;

  -- ==========================================================================
  -- GUARDED COMPARE-AND-SWAP PATH
  -- ==========================================================================
  if p_expected_revision is null then
    raise exception
      'update_bulk_operation: p_expected_revision is required when p_submission_owner is supplied'
      using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(p_op_state), 'null') <> 'object' then
    raise exception 'update_bulk_operation: the guarded path requires a JSON object in p_op_state'
      using errcode = '22023';
  end if;

  if p_expected_revision < 0 then
    raise exception 'update_bulk_operation: p_expected_revision must be non-negative'
      using errcode = '22023';
  end if;

  if p_submission_owner is not null and btrim(p_submission_owner) = '' then
    raise exception 'update_bulk_operation: p_submission_owner must not be blank'
      using errcode = '22023';
  end if;

  if p_lease_seconds is not null and (p_lease_seconds <= 0 or p_lease_seconds > 3600) then
    raise exception 'update_bulk_operation: p_lease_seconds must be between 1 and 3600'
      using errcode = '22023';
  end if;

  if p_lease_seconds is not null and p_submission_owner is null then
    raise exception 'update_bulk_operation: p_lease_seconds requires p_submission_owner'
      using errcode = '22023';
  end if;

  v_out_op := v_stored;

  <<guarded>>
  begin
    -- The historical p_only_if_status protection still applies first.
    if p_only_if_status is not null
       and v_stored_status is distinct from p_only_if_status then
      v_ok := false; v_reason := 'status_conflict';
      exit guarded;
    end if;

    if v_stored_rev is distinct from p_expected_revision then
      v_ok := false; v_reason := 'revision_conflict';
      exit guarded;
    end if;

    -- An ambiguous submission outranks a matching revision: it may only be
    -- carried forward as ambiguous, never cleared or resumed here.
    if v_stored_ambig and coalesce(v_in_phase, '') <> 'ambiguous_submission' then
      v_ok := false; v_reason := 'ambiguous_submission';
      exit guarded;
    end if;

    -- THE AMBIGUITY RULE. An expired lease with no saved provider_batch_id means a
    -- submission may already have been accepted and billed. Do not hand out a new
    -- submission slot; make the ambiguity durable and refuse. This applies to EVERY
    -- guarded write, claiming or not: a non-claiming write that simply carried the
    -- expired lease forward and set the phase back to a submittable one would drive
    -- exactly the duplicate POST this rule exists to prevent.
    if v_stored_job is not null
       and v_stored_batch is null
       and v_stored_owner is not null
       and v_stored_lease is not null
       and v_stored_lease <= v_now
       and coalesce(v_stored_phase, '') <> 'ambiguous_submission' then  -- not already flipped

      v_new := coalesce(v_stored, '{}'::jsonb)
               || jsonb_build_object(
                    'state_revision', v_stored_rev + 1,
                    'external_job', v_stored_job || jsonb_build_object(
                      'phase', 'ambiguous_submission',
                      'ambiguous_since', v_now,
                      'ambiguous_reason', 'submission_lease_expired_without_provider_batch_id',
                      'ambiguous_prior_phase', coalesce(v_stored_phase, 'unknown'),
                      'ambiguous_prior_owner', v_stored_owner));

      v_current := jsonb_set(v_current, array[p_op_key], v_new);

      insert into admin_config (key, value, updated_at)
      values ('BULK_OPERATIONS', v_current, now())
      on conflict (key) do update
        set value = excluded.value,
            updated_at = excluded.updated_at;

      v_out_op := v_new;
      v_ok := false; v_reason := 'ambiguous_submission';
      exit guarded;
    end if;


    -- A saved provider batch id may only be carried forward EXACTLY. It may not be
    -- re-pointed and it may not be cleared -- clearing it is how a pointer to a
    -- billed job is destroyed, and matching the revision proves only that the caller
    -- read the state, never that it is the holder.
    if v_stored_batch is not null
       and v_in_job is not null
       and v_in_batch is distinct from v_stored_batch then
      v_ok := false; v_reason := 'external_job_protected';
      exit guarded;
    end if;

    -- ------------------------------------------------------------------------
    -- INTRODUCING A provider_batch_id REQUIRES THE CLAIM RECEIPT.
    --
    -- Saving the id the provider just handed back is the single write that binds
    -- this operation to a real, billable job, and only the worker that actually
    -- POSTed can know it. Matching the revision does not prove that. Neither does
    -- carrying the stored lease fields forward: any caller that read this revision
    -- can copy them byte-for-byte. And -- this is what the earlier version of this
    -- rule got wrong -- neither does STATING an owner. The previous rule only asked
    -- whether p_submission_owner was supplied and then compared it to the stored
    -- submission_owner, a value published in admin_config to everyone who can call
    -- this function. A rival process simply repeated the stored name, passed the
    -- owner compare, planted a FAKE id and renewed the lease; the real holder's id
    -- was then refused as a replacement and the billed job was orphaned.
    --
    -- THE RULE: an operation that already has a stored external_job may only be
    -- bound to a provider job by a caller that sends back the claim receipt minted
    -- when that lease was taken (external_job.lease_token, checked against the
    -- stored md5 digest). The receipt is issued once, to the claimer, and is not
    -- readable from stored state, so repeating the owner name buys nothing.
    --
    -- The one exception is the caller that claims a lease where NO owner and NO id
    -- are stored at all: it is establishing the whole job in one write and there is
    -- no incumbent holder for it to orphan.
    -- ------------------------------------------------------------------------
    if v_stored_batch is null
       and v_in_batch is not null
       and not v_token_ok
       and not (p_submission_owner is not null and v_stored_owner is null) then
      v_ok := false; v_reason := 'external_job_protected';
      exit guarded;
    end if;

    -- Only this function ever declares a submission ambiguous. A caller that could
    -- set phase = 'ambiguous_submission' on a healthy operation could park it
    -- permanently, since ambiguity is terminal until an explicit reconciliation.
    -- Carrying an ALREADY ambiguous phase forward is the reconciliation path and is
    -- handled above.
    if coalesce(v_in_phase, '') = 'ambiguous_submission' and not v_stored_ambig then
      v_ok := false; v_reason := 'phase_protected';
      exit guarded;
    end if;

    -- ------------------------------------------------------------------------
    -- THE PHASE OF A POINTER-BEARING JOB IS MOVED BY THE HOLDER OR BY NOBODY.
    --
    -- v_pointer -- the value every drop and re-point refusal is computed from -- is
    -- derived from external_job.phase. Freezing the eight lease fields while leaving
    -- phase writable therefore left the protection switchable-off by the callers it
    -- was aimed at: move phase off a live value, and the operation stops being
    -- protected, so the next call may drop external_job entirely and a fresh claim
    -- mints a new receipt and binds an invented provider_batch_id. Destroy and
    -- reissue reaches the same end as planting the digest in place.
    --
    -- This check is deliberately NOT inside the non-claiming branch below. A CLAIM is
    -- not proof either: a caller repeating the publicly readable submission_owner over
    -- a live lease claims successfully (the same-name renewal trap) and would
    -- otherwise be free to move the phase. Only v_proven may move it.
    -- ------------------------------------------------------------------------
    if v_in_job is not null
       and v_pointer
       and not v_proven
       and (v_in_job -> 'phase') is distinct from (v_stored_job -> 'phase') then
      v_ok := false; v_reason := 'phase_protected';
      exit guarded;
    end if;

    -- ------------------------------------------------------------------------
    -- A GUARDED WRITE THAT DOES NOT CLAIM THE LEASE MAY NOT MOVE THE LEASE.
    --
    -- p_op_state is free-form JSONB, so without this block a caller could pass
    -- p_submission_owner => null (skipping every lease check below) while embedding
    -- a DIFFERENT submission_owner / lease_expires_at inside p_op_state, write it
    -- straight over a live lease, and read back a state naming itself as owner --
    -- at the same moment the real holder reads a state naming IT as owner. Matching
    -- the revision proves the caller read this state; it does not prove the caller
    -- holds the lease. Only claiming the lease proves that.
    --
    -- THE RULE: when p_submission_owner is null, every lease-controlling field in
    -- external_job (c_lease_fields) must be carried forward EXACTLY as stored --
    -- same values, same present/absent -- and the payload may not restate a
    -- state_revision other than the stored one. Faithful carry-forward succeeds;
    -- anything else is refused as lease_fields_immutable. Additionally, an
    -- external_job whose lease is still LIVE may not be dropped by a non-claiming
    -- write, because dropping it and re-creating it on the next revision is the
    -- same lease theft in two steps.
    -- ------------------------------------------------------------------------
    if p_submission_owner is null then
      if v_stored_owner is not null
         and coalesce(v_stored_lease > v_now, false)
         and v_in_job is null then
        v_ok := false; v_reason := 'lease_held';
        exit guarded;
      end if;

      if v_in_job is not null then
        foreach v_field in array c_lease_fields loop
          if (v_in_job -> v_field) is distinct from (v_stored_job -> v_field) then
            v_ok := false; v_reason := 'lease_fields_immutable';
            exit guarded;
          end if;
        end loop;
      end if;

      -- The phase of a job that PopDAM believes exists is driven by its holder and
      -- nobody else. A non-claiming write may still report progress and status, but
      -- moving the phase would let a bystander walk the job back to a submittable
      -- state or park it as finished under the holder's feet.
      --
      -- This used to be gated on the lease still being LIVE, which handed a
      -- bystander the whole capability the moment the lease clock ran out -- the
      -- one moment a real provider job is most likely to exist unrecorded. It is
      -- now gated on the job pointer instead (live phase, unresolved ambiguity, or
      -- a stored provider_batch_id), which does not expire.
      -- The pointer case is covered path-independently above; what this adds is the
      -- live-lease case on an operation that has no pointer yet. It is gated on
      -- v_proven for the same reason: the holder, sending its receipt, is exactly the
      -- caller that is supposed to drive this phase forward.
      if v_in_job is not null
         and not v_proven
         and (v_pointer or coalesce(v_stored_lease > v_now, false))
         and (v_in_job -> 'phase') is distinct from (v_stored_job -> 'phase') then
        v_ok := false; v_reason := 'phase_protected';
        exit guarded;
      end if;

      if p_op_state ? 'state_revision'
         and coalesce(nullif(p_op_state ->> 'state_revision', '')::bigint, -1)
             is distinct from v_stored_rev then
        v_ok := false; v_reason := 'lease_fields_immutable';
        exit guarded;
      end if;
    end if;

    -- ------------------------------------------------------------------------
    -- THE POINTER TO A PROVIDER JOB IS NEVER DESTROYED, BY ANYONE.
    --
    -- The rule above refuses a non-claiming caller that drops external_job while a
    -- lease is live. That was not enough: leases lapse on a timer, and a lapsed
    -- lease is not evidence that the provider job went away -- it is the single
    -- state in which a real, billable job is most likely to exist and be
    -- unrecorded. Once the lease lapsed, ANY caller could drop the whole
    -- external_job (saved provider_batch_id and all), and the next writer would see
    -- a clean operation and submit it again. That is the duplicate-billing window
    -- this migration exists to close, re-opened by the clock.
    --
    -- THE RULE: while this operation names a provider job or is in a phase where
    -- PopDAM believes one exists (v_pointer), external_job may not be dropped --
    -- claiming or not, lease live or lapsed. Re-pointing it is refused separately
    -- and equally unconditionally above. An operation with no pointer is
    -- unaffected, so ordinary lifecycle writes are untouched.
    -- ------------------------------------------------------------------------
    if v_in_job is null and v_pointer then
      v_ok := false; v_reason := 'external_job_protected';
      exit guarded;
    end if;

    if coalesce(v_stored_status = any(c_stop_status), false)
       and coalesce(v_in_status, '') <> all(c_stop_status)
       and (p_submission_owner is not null
            or coalesce(v_in_phase = any(c_live_phases), false)) then
      v_ok := false; v_reason := 'stopped';
      exit guarded;
    end if;

    if p_submission_owner is not null then
      -- A live lease belongs to exactly one owner.
      if v_stored_owner is not null
         and coalesce(v_stored_lease > v_now, false)
         and v_stored_owner <> p_submission_owner then
        v_ok := false; v_reason := 'lease_held';
        exit guarded;
      end if;

      if coalesce(jsonb_typeof(p_op_state -> 'external_job'), 'null') <> 'object' then
        raise exception
          'update_bulk_operation: a submission lease claim on "%" requires an external_job object in p_op_state'
          , p_op_key
          using errcode = '22023';
      end if;

      -- ----------------------------------------------------------------------
      -- A CLAIMING CALLER MAY NOT REWRITE THE AMBIGUITY VERDICT EITHER.
      --
      -- The claim below stamps submission_owner, lease_expires_at, lease_claimed_at
      -- and lease_proof itself, so the payload's versions of those four are simply
      -- overwritten. The four ambiguous_* fields were NOT stamped, and an ambiguous
      -- operation always has a lapsed lease, so anybody may claim it -- and could
      -- carry the required phase = 'ambiguous_submission' forward while rewriting
      -- ambiguous_prior_owner to somebody else and ambiguous_reason to noise. That is
      -- the forensic record of who held the lease when a possibly-billed provider job
      -- went unrecorded, on the one operation a human must reconcile by hand. Only
      -- this function writes it.
      -- ----------------------------------------------------------------------
      foreach v_field in array c_verdict_fields loop
        if (v_in_job -> v_field) is distinct from (v_stored_job -> v_field) then
          v_ok := false; v_reason := 'lease_fields_immutable';
          exit guarded;
        end if;
      end loop;

      v_lease_until := v_now + make_interval(secs => coalesce(p_lease_seconds, c_default_lease));

      -- ----------------------------------------------------------------------
      -- THE SAME-NAME RENEWAL TRAP, STATED PLAINLY. THIS IS DELIBERATE.
      --
      -- Mint a claim receipt only when this call is actually TAKING a free lease. A
      -- same-name renewal over a still-LIVE lease keeps the incumbent receipt.
      --
      -- What that means for a second process that shares the holder's owner name (a
      -- redeploy running the same worker twice), while the lease is LIVE: its claim
      -- SUCCEEDS -- ok = true -- and it extends lease_expires_at and bumps the
      -- revision, but it is NOT the holder and never becomes one. It is handed no
      -- receipt (envelope.lease_token is null, envelope.lease_receipt_issued is
      -- false), so it can never bind this operation to a provider_batch_id. The real
      -- holder's receipt keeps working. The trap is therefore: A SUCCESSFUL CLAIM IS
      -- NOT PROOF THAT YOU HOLD THE LEASE. Callers must key off
      -- lease_receipt_issued / lease_token, never off ok alone, and a renewer that
      -- receives no receipt must not go on to POST to the provider -- it must treat
      -- itself as the losing twin and stand down.
      --
      -- Why it is nevertheless right. Re-minting on renewal would hand a receipt to
      -- anyone who repeats the stored submission_owner, and that name is published in
      -- admin_config to every caller -- it would restore the impostor attack this
      -- receipt scheme exists to close, this time with the function issuing the
      -- credential. Refusing same-name renewal outright would break the legitimate
      -- redeploy retry that keeps a real lease alive.
      --
      -- ----------------------------------------------------------------------
      -- NO REMINT WHILE NOTHING IS BOUND. (The "reaches the mint" argument that used
      -- to stand here was wrong, and this is the repair.)
      --
      -- The old reasoning was: a lapsed lease with no saved provider_batch_id never
      -- reaches the mint, because the ambiguity rule intercepts it. That is true on
      -- the FIRST write only. The intercept flips the operation to
      -- 'ambiguous_submission' -- and an operation that is ALREADY ambiguous no longer
      -- matches the intercept, so the SECOND call walks straight through it, claims
      -- the (always lapsed) lease and re-mints. The new receipt then matches the
      -- caller's token, so it may introduce a provider_batch_id of its own invention,
      -- and the real holder's genuine id is afterwards refused as a replacement. There
      -- is no human in that loop: `authenticated` holds execute, so "reconciliation"
      -- was any signed-in caller.
      --
      -- THE RULE, chosen over inventing a separate reconcile operation: while this
      -- operation has NO saved provider_batch_id, the receipt minted when the lease
      -- was first taken is the ONLY thing that can ever bind it to a provider job, and
      -- it is never reissued. A claim over such an operation still SUCCEEDS as a lease
      -- extension -- ordinary retry traffic keeps working -- but it is handed no
      -- receipt (lease_receipt_issued = false), exactly like the same-name renewal
      -- trap below, so it cannot bind anything. Nobody but the original holder can
      -- resolve an ambiguity into a provider job, which is the correct answer: the
      -- ambiguity exists precisely because nobody else knows whether a job was billed.
      --
      -- Reminting is safe in exactly two states and is confined to them:
      --   * no receipt was ever minted (v_stored_proof is null) -- nothing to displace;
      --   * a provider_batch_id is already saved -- the operation is bound, and a
      --     saved id can never be re-pointed or cleared by anyone, so a new receipt
      --     buys a takeover of the lease and no power to invent a binding.
      -- A same-name renewal over a still-LIVE lease keeps the incumbent receipt in
      -- both of those states as well; see THE SAME-NAME RENEWAL TRAP below.
      -- ----------------------------------------------------------------------
      if v_stored_proof is null then
        -- Nobody has ever held this lease: establish it.
        v_lease_token := gen_random_uuid()::text;
        v_minted      := true;
      elsif v_stored_batch is null then
        -- Nothing is bound: never reissue the only thing that can bind. A caller that
        -- is not the holder succeeds as a lease extension and is holder of nothing;
        -- the holder itself already has its receipt and needs no second one, so this
        -- branch deliberately covers it too rather than rotating a working receipt
        -- (rotation would break the twin that legitimately shares its owner name).
        v_lease_token := null;
        v_minted      := false;
      elsif v_stored_owner = p_submission_owner
            and coalesce(v_stored_lease > v_now, false) then
        -- Same-name renewal over a LIVE lease: keep the incumbent receipt.
        v_lease_token := null;
        v_minted      := false;
      else
        -- A bound operation whose lease has lapsed (or whose owner differs and is not
        -- live): a takeover may mint, because the binding it might have abused is
        -- already made and is immutable.
        v_lease_token := gen_random_uuid()::text;
        v_minted      := true;
      end if;
    end if;

    -- Accept the write and stamp the next revision.
    v_new := p_op_state || jsonb_build_object('state_revision', v_stored_rev + 1);

    if p_submission_owner is not null then
      v_new := jsonb_set(
                 v_new,
                 array['external_job'],
                 (v_new -> 'external_job') || jsonb_build_object(
                   'submission_owner', p_submission_owner,
                   'lease_expires_at', v_lease_until,
                   'lease_claimed_at', v_now,
                   -- Only the DIGEST is ever stored. Reading admin_config therefore
                   -- tells a rival nothing it can send back as proof.
                   'lease_proof', case when v_minted then md5(v_lease_token)
                                       else v_stored_proof end));
    end if;

    v_current := jsonb_set(v_current, array[p_op_key], v_new);

    insert into admin_config (key, value, updated_at)
    values ('BULK_OPERATIONS', v_current, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;

    v_out_op := v_new;
    v_ok := true; v_reason := 'ok';
  end guarded;

  -- Proof envelope. Everything reported here is read back out of what is now
  -- stored, never echoed from the caller's arguments.
  return jsonb_build_object(
    'ok', v_ok,
    'reason', v_reason,
    'op_key', p_op_key,
    'expected_revision', p_expected_revision,
    'state_revision', coalesce(nullif(v_out_op ->> 'state_revision', '')::bigint, 0),
    'status', v_out_op ->> 'status',
    'external_job_phase', v_out_op -> 'external_job' ->> 'phase',
    'submission_owner', v_out_op -> 'external_job' ->> 'submission_owner',
    'lease_expires_at', v_out_op -> 'external_job' ->> 'lease_expires_at',
    'provider_batch_id', v_out_op -> 'external_job' ->> 'provider_batch_id',
    -- Issued exactly once, to the caller whose claim minted it, and never stored in
    -- readable form. Send it back as external_job.lease_token to prove you are the
    -- holder when saving the provider_batch_id.
    'lease_token', case when v_ok and v_minted then v_lease_token end,
    -- Explicit, never inferred from a null token: false on a successful same-name
    -- renewal over a live lease, which extends the lease WITHOUT making the renewer
    -- the holder. See THE SAME-NAME RENEWAL TRAP above.
    'lease_receipt_issued', v_ok and v_minted,
    'operation', v_out_op,
    'operations', v_current);
end;
$function$;

comment on function public.update_bulk_operation(text, jsonb, text, bigint, text, integer) is
  'Atomic writer for one operation inside the admin_config BULK_OPERATIONS JSONB value. '
  'Three-argument calls keep the historical behaviour and return the whole BULK_OPERATIONS object. '
  'Supplying p_expected_revision selects the guarded compare-and-swap path, which returns a proof '
  'envelope {ok, reason, state_revision, submission_owner, lease_expires_at, provider_batch_id, operation, operations}. '
  'p_submission_owner + p_lease_seconds atomically claim a submission lease. A guarded write that does NOT '
  'claim the lease may only carry the lease-controlling external_job fields (submission_owner, lease_expires_at, '
  'lease_claimed_at, ambiguous_*) forward unchanged, and may not drop a live-leased external_job; anything else '
  'is refused with reason = lease_fields_immutable, and the legacy three-argument path RAISES (55000) if it would '
  'move any of them, lease_proof included -- no path that holds no proof may touch the root of trust. '
  'Claiming a free lease mints a one-time claim receipt: only its '
  'md5 digest is stored (external_job.lease_proof) and the raw receipt is returned once as envelope.lease_token. '
  'On an operation that already has a stored external_job, a provider_batch_id may only be INTRODUCED by a caller '
  'that sends that receipt back as external_job.lease_token (stating an owner name proves nothing, because the '
  'stored owner is readable); a same-name renewal over a still-LIVE lease keeps the incumbent receipt rather than '
  're-minting, so it succeeds and extends the lease but does NOT make the renewer the holder -- callers must key '
  'off envelope.lease_receipt_issued / envelope.lease_token, never off ok alone. Only this '
  'function may set phase = ambiguous_submission, and while the operation has NO saved provider_batch_id the '
  'receipt minted when its lease was first taken is never reissued, so a later claim over it (an ambiguous '
  'operation included) succeeds as a lease extension but is handed no receipt and can never bind it to a '
  'provider job. While the operation names a provider job or is in a live or '
  'ambiguous phase, external_job may not be dropped or re-pointed by ANY caller, and its external_job.phase -- '
  'the value those protections are computed from -- may only be moved by a caller that proves it holds the lease '
  '(its lease_token, or an establishing claim on an operation with no incumbent); legacy, batch, non-claiming and '
  'same-name-renewing callers must carry the phase forward exactly as stored. None of which depends on the lease '
  'still being live. An expired lease '
  'with no saved provider_batch_id is never an automatic resubmission: the guarded path makes it durably '
  'ambiguous and returns ok = false, while the legacy three-argument path RAISES (55000) and changes nothing, '
  'so the refusal repeats on every later call until the operation is reconciled on the guarded path; declaring '
  'phase = ambiguous_submission in a legacy payload is not accepted as proof of reconciliation. '
  'See u2giants/shared-db#1171 and u2giants/popdam3#92.';

revoke execute on function public.update_bulk_operation(text, jsonb, text, bigint, text, integer)
  from public, anon;
grant execute on function public.update_bulk_operation(text, jsonb, text, bigint, text, integer)
  to authenticated, service_role, postgres;

-- ==========================================================================
-- The legacy multi-key writer. Same signature, same return value, same merge --
-- but it can no longer merge over protected external-job state.
-- ==========================================================================
create or replace function public.update_bulk_operations_batch(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  c_live_phases constant text[] := array['prepared','submitting','pending','applying'];
  c_stop_status constant text[] := array['stop','stopping','stopped','stop_requested'];

  -- Must stay identical to c_lease_fields in public.update_bulk_operation. These are
  -- the external_job fields that decide WHO holds the submission lease and what the
  -- ambiguity verdict is. This writer holds no proof of anything, so it may never
  -- move one of them.
  c_lease_fields constant text[] := array[
    'submission_owner',
    'lease_expires_at',
    'lease_claimed_at',
    'ambiguous_since',
    'ambiguous_reason',
    'ambiguous_prior_phase',
    'ambiguous_prior_owner',
    'lease_proof'];

  v_field         text;
  v_current       jsonb;
  v_key           text;
  v_stored        jsonb;
  v_stored_status text;
  v_stored_rev    bigint;
  v_stored_job    jsonb;
  v_stored_phase  text;
  v_stored_batch  text;
  v_stored_owner  text;
  v_stored_lease  timestamptz;
  v_protected     boolean;
  v_in            jsonb;
  v_in_job        jsonb;
  v_in_status     text;
  v_in_batch      text;
  v_in_phase      text;
  v_in_owner      text;
  v_in_rev        bigint;
  v_now           timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  select value into v_current
  from admin_config
  where key = 'BULK_OPERATIONS';

  v_current := coalesce(v_current, '{}'::jsonb);

  -- ------------------------------------------------------------------------
  -- THE AMBIGUITY RULE, ON THE BATCH PATH TOO.
  --
  -- Same money-losing rule as the single-key writer: an expired submission lease
  -- with NO saved provider_batch_id may never be carried back to a submittable
  -- state, because the provider may already hold and bill that job. This pass runs
  -- BEFORE any merge, so no update in the batch can slip past it.
  --
  -- If any key in the batch is in that state the whole call RAISES: nothing is
  -- applied and nothing is flipped. A batch caller has no proof envelope either, so
  -- a quiet return is read as success by every existing caller, and the money path
  -- is write-then-POST -- a refusal on the NEXT write arrives after the bill. The
  -- stored row is left as it is (expired lease, no provider_batch_id, live phase),
  -- so it still matches this predicate and every later batch or legacy write over it
  -- raises again, forever, until it is reconciled.
  --
  -- There is NO payload escape. This predicate used to fall through when the payload
  -- itself declared phase = 'ambiguous_submission', which anybody can type and which
  -- proves nothing was reconciled with anybody -- and taking that escape wrote the
  -- whole object, so the same payload could also carry a fabricated batch id, a new
  -- owner or a fresh lease, and returned the ordinary success value. Reconciliation
  -- is a guarded-path operation now; there the function records the verdict itself
  -- from stored state and returns ok = false.
  -- ------------------------------------------------------------------------
  for v_key in select jsonb_object_keys(p_updates) loop
    v_in := p_updates -> v_key;
    v_stored := case when jsonb_typeof(v_current -> v_key) = 'object'
                     then v_current -> v_key end;
    v_stored_job := case when jsonb_typeof(v_stored -> 'external_job') = 'object'
                         then v_stored -> 'external_job' end;

    if v_stored_job is null then
      continue;
    end if;

    v_stored_rev   := coalesce(nullif(v_stored ->> 'state_revision', '')::bigint, 0);
    v_stored_phase := v_stored_job ->> 'phase';
    v_stored_batch := nullif(v_stored_job ->> 'provider_batch_id', '');
    v_stored_owner := nullif(v_stored_job ->> 'submission_owner', '');
    v_stored_lease := nullif(v_stored_job ->> 'lease_expires_at', '')::timestamptz;
    v_in_job       := case when jsonb_typeof(v_in -> 'external_job') = 'object'
                           then v_in -> 'external_job' end;
    v_in_phase     := v_in_job ->> 'phase';

    if v_stored_batch is null
       and v_stored_owner is not null
       and v_stored_lease is not null
       and v_stored_lease <= v_now
       and coalesce(v_stored_phase, '') <> 'ambiguous_submission' then  -- already flipped

      raise exception
        'update_bulk_operations_batch: refused -- key "%" has a submission lease held by % that expired at % with no saved provider_batch_id, so the provider may already hold (and bill) this job. No key in this batch was applied. Call update_bulk_operation with p_expected_revision, which records the ambiguity verdict itself. A batch payload declaring phase = ''ambiguous_submission'' is NOT accepted as proof of reconciliation.',
        v_key, v_stored_owner, v_stored_lease
        using errcode = '55000';
    end if;
  end loop;

  -- Merge each key from p_updates into the current state.
  for v_key in select jsonb_object_keys(p_updates) loop
    v_in := p_updates -> v_key;

    v_stored := case when jsonb_typeof(v_current -> v_key) = 'object'
                     then v_current -> v_key end;
    v_stored_status := v_stored ->> 'status';
    v_stored_rev    := coalesce(nullif(v_stored ->> 'state_revision', '')::bigint, 0);
    v_stored_job    := case when jsonb_typeof(v_stored -> 'external_job') = 'object'
                            then v_stored -> 'external_job' end;
    v_stored_phase  := v_stored_job ->> 'phase';
    v_stored_batch  := nullif(v_stored_job ->> 'provider_batch_id', '');
    v_stored_owner  := nullif(v_stored_job ->> 'submission_owner', '');
    v_stored_lease  := nullif(v_stored_job ->> 'lease_expires_at', '')::timestamptz;
    -- Protection keys off the job POINTER, never off lease liveness: a stored
    -- provider_batch_id protects this operation for good, whatever the lease clock
    -- says and whatever phase the job has reached.
    v_protected     := coalesce(v_stored_phase = any(c_live_phases), false)
                       or coalesce(v_stored_phase = 'ambiguous_submission', false)
                       or v_stored_batch is not null;

    v_in_job    := case when jsonb_typeof(v_in -> 'external_job') = 'object'
                        then v_in -> 'external_job' end;
    v_in_status := v_in ->> 'status';
    v_in_batch  := nullif(v_in_job ->> 'provider_batch_id', '');
    v_in_phase  := v_in_job ->> 'phase';
    v_in_owner  := nullif(v_in_job ->> 'submission_owner', '');
    v_in_rev    := nullif(v_in ->> 'state_revision', '')::bigint;

    if v_protected then
      -- This function has no compare-and-swap argument, so it is a legacy writer
      -- by construction. It may only carry protected state forward untouched.
      if v_in_job is null then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" would drop a protected external_job (phase=%, provider_batch_id=%). Use update_bulk_operation with p_expected_revision.',
          v_key, coalesce(v_stored_phase, '<none>'), coalesce(v_stored_batch, '<none>')
          using errcode = '55000';
      end if;

      if coalesce(v_stored_phase = 'ambiguous_submission', false)
         and coalesce(v_in_phase, '') <> 'ambiguous_submission' then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" external_job is ambiguous_submission and requires explicit reconciliation.',
          v_key
          using errcode = '55000';
      end if;

      -- ----------------------------------------------------------------------
      -- AND IT MAY NOT MOVE THE PHASE EITHER -- THE PROTECTION IS COMPUTED FROM IT.
      --
      -- v_protected above is derived from external_job.phase. Freezing the lease
      -- fields while leaving phase writable left this writer able to switch the
      -- protection off and then walk around it: move phase off a live value here, and
      -- the very next batch or legacy call may drop external_job outright, after which
      -- a fresh claim mints a new receipt and binds an invented provider_batch_id. The
      -- billed job is orphaned by destroying the pointer instead of forging it.
      --
      -- A batch caller can hold no proof of anything (there is no lease_token on this
      -- path at all), so it may never move the phase of a pointer-bearing job. Callers
      -- that spread the object they loaded carry the same phase and are untouched.
      -- ----------------------------------------------------------------------
      if (v_in_job -> 'phase') is distinct from (v_stored_job -> 'phase') then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" would move the external_job phase of a protected job from % to %. The drop and re-point protections are computed from this phase, so moving it is how a pointer gets destroyed and reissued, and a batch caller holds no proof of the lease. Carry the phase forward exactly as stored. No key in this batch was applied.',
          v_key,
          coalesce((v_stored_job -> 'phase')::text, '<absent>'),
          coalesce((v_in_job -> 'phase')::text, '<absent>')
          using errcode = '55000';
      end if;

      if v_stored_batch is not null and v_in_batch is distinct from v_stored_batch then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" would replace saved provider_batch_id % with %.',
          v_key, v_stored_batch, coalesce(v_in_batch, '<null>')
          using errcode = '55000';
      end if;

      if coalesce(v_stored_lease > v_now, false)
         and v_in_owner is distinct from v_stored_owner then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" submission lease is held by % until %.',
          v_key, v_stored_owner, v_stored_lease
          using errcode = '55000';
      end if;

      if coalesce(v_stored_rev > 0, false)
         and (v_in_rev is null or v_in_rev < v_stored_rev) then
        raise exception
          'update_bulk_operations_batch: refused -- key "%" would regress state_revision % to %.',
          v_key, v_stored_rev, coalesce(v_in_rev::text, '<null>')
          using errcode = '55000';
      end if;
    end if;

    -- ------------------------------------------------------------------------
    -- A BATCH CALLER MAY NEVER MOVE A LEASE-CONTROLLING FIELD EITHER.
    --
    -- Same disqualifying hole as the legacy three-argument path, reachable by anyone
    -- who can call this function: external_job.lease_proof is the md5 digest the
    -- claim-receipt scheme trusts, and nothing here checked it. A batch payload could
    -- plant lease_proof = md5('attacker-token'), and the same caller could then return
    -- on the guarded path presenting that token, be verified as the lease holder, and
    -- plant a fabricated provider_batch_id -- after which the real holder's genuine id
    -- is refused as a replacement and the billed provider job is orphaned. Planting
    -- the digest also destroys the true holder's receipt.
    --
    -- THE RULE: every member of c_lease_fields must be carried forward exactly as
    -- stored -- same values, same present/absent -- including on a key with NO stored
    -- external_job, where "as stored" means ABSENT. This is checked on EVERY key,
    -- protected or not, because an unprotected key with a planted digest becomes the
    -- same weapon the moment anybody claims it.
    --
    -- It RAISES rather than silently substituting the stored values, for the same
    -- reason every other refusal on this path raises: a batch caller gets no proof
    -- envelope, reads a quiet return as success, and the money path is
    -- write-then-POST. A caller that faithfully round-trips what it read passes this
    -- check untouched; only a caller that CHANGED a lease field is refused.
    -- ------------------------------------------------------------------------
    if v_in_job is not null then
      foreach v_field in array c_lease_fields loop
        if (v_in_job -> v_field) is distinct from (v_stored_job -> v_field) then
          raise exception
            'update_bulk_operations_batch: refused -- key "%" would modify the lease-controlling external_job field "%" (stored=%, offered=%). These fields, lease_proof above all, are the root of trust for the claim receipt; a batch caller holds no proof and may never move them. No key in this batch was applied.',
            v_key, v_field,
            coalesce((v_stored_job -> v_field)::text, '<absent>'),
            coalesce((v_in_job -> v_field)::text, '<absent>')
            using errcode = '55000';
        end if;
      end loop;
    end if;

    -- A batch caller may never INTRODUCE a provider_batch_id either. Refusing only
    -- REPLACEMENT left the window that matters open: while a worker holds a lease and
    -- has not yet saved the id its POST returned, nothing is stored, so nothing was
    -- checked and any batch payload could bind this operation to a fabricated job --
    -- after which the real id is refused as a replacement and the billed job is
    -- orphaned. Binding an operation to a provider job is the lease holder's write,
    -- proven with its lease_token on the guarded path, and a batch caller can hold no
    -- proof at all.
    if v_stored_job is not null
       and v_stored_batch is null
       and v_in_batch is not null then
      raise exception
        'update_bulk_operations_batch: refused -- key "%" would introduce provider_batch_id % on an operation that has none. Only the submission-lease holder may bind an operation to a provider job, via update_bulk_operation with p_expected_revision and its lease_token.',
        v_key, v_in_batch
        using errcode = '55000';
    end if;

    if coalesce(v_stored_status = any(c_stop_status), false)
       and coalesce(v_in_status, '') <> all(c_stop_status)
       and coalesce(v_in_phase = any(c_live_phases), false) then
      raise exception
        'update_bulk_operations_batch: refused -- key "%" status is "%" (stopped) and the write would resume a live external_job.',
        v_key, v_stored_status
        using errcode = '55000';
    end if;

    v_current := jsonb_set(v_current, array[v_key], v_in);
  end loop;

  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', v_current, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = excluded.updated_at;

  return v_current;
end;
$function$;

comment on function public.update_bulk_operations_batch(jsonb) is
  'Legacy multi-key writer for the admin_config BULK_OPERATIONS JSONB value. Behaviour and return value '
  'are unchanged for every operation with no protected external_job. It raises rather than merging over a '
  'live or ambiguous external_job, any change to a lease-controlling external_job field (submission_owner, '
  'lease_expires_at, lease_claimed_at, lease_proof, ambiguous_*) on ANY key, any change to external_job.phase on a '
  'protected key (the drop and re-point protections are computed from that phase), '
  'a saved provider_batch_id (which protects the operation for good, whatever the '
  'lease clock says), a held submission lease, a regressing state_revision, or a stopped operation, and it may '
  'never INTRODUCE a provider_batch_id on an operation that has none. If ANY key in the batch has an expired '
  'submission lease with no saved provider_batch_id it RAISES (55000) and no key in the batch is applied or '
  'changed, so the same refusal repeats on every later call until that operation is reconciled on the guarded '
  'path; a batch payload declaring phase = ambiguous_submission is not accepted as proof of reconciliation. '
  'See u2giants/shared-db#1171.';

revoke execute on function public.update_bulk_operations_batch(jsonb) from public, anon;
grant execute on function public.update_bulk_operations_batch(jsonb)
  to authenticated, service_role, postgres;

commit;
