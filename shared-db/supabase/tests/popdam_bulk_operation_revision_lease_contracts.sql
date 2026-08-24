-- =====================================================================================
-- PopDAM bulk-operation revision + submission-lease contract tests
-- Issue u2giants/shared-db#1171, claim #1174, for u2giants/popdam3#92.
--
-- Everything below runs inside one transaction that is rolled back, so it may write
-- the real admin_config BULK_OPERATIONS row freely.
--
-- Proves, in order:
--   1. legacy three-argument calls behave exactly as before on unprotected state
--   2. only ONE worker can claim a given revision/lease
--   3. an expired submission lease with no saved provider_batch_id becomes AMBIGUOUS
--      and never a second submission slot
--   4. legacy callers (single and batch) stay compatible but cannot overwrite
--      protected external-job state
--   5. p_only_if_status = 'running' and Stop protection still hold
--   6. a guarded write that does NOT claim the lease cannot move the lease, by any
--      field embedded in the free-form payload (review finding 1)
--   7. the ambiguity rule is enforced on the legacy and batch paths too, and there it
--      RAISES rather than returning anything a historical caller reads as success, so
--      no caller can drive a duplicate, duplicate-billed provider submission (finding 2
--      and review finding B)
--   8. a non-claiming guarded write can neither plant a provider_batch_id where none
--      is stored nor move the phase of a job that has a provider-job pointer
--   9. STATING an owner is not BEING the owner. submission_owner is stored in
--      admin_config and readable by every caller, so a claim over a free lease mints
--      a one-time receipt whose md5 digest alone is stored, and only a caller that
--      sends that receipt back may bind an operation to a provider job. A same-name
--      renewal keeps the incumbent receipt, so ordinary shared-name retry traffic
--      still works (Grok high finding 1)
--  10. neither legacy writer may INTRODUCE a provider_batch_id on an operation that
--      already has a stored external_job, not only replace one (Grok high finding 2)
--  11. there is no payload escape from the ambiguity rule: declaring
--      phase = ambiguous_submission in a legacy or batch payload proves nothing and
--      is refused; reconciliation is guarded-path only (Grok high finding 3)
--  12. a provider-job pointer -- a saved provider_batch_id, or a live/ambiguous phase
--      -- is never dropped or re-pointed by ANY caller, and the lease lapsing does
--      not unlock it (Kimi blocking finding)
--  13. lease_proof -- the digest the whole receipt scheme trusts -- and every other
--      lease-controlling external_job field is immutable on ALL FOUR write paths, not
--      just the guarded non-claiming one. Otherwise a legacy or batch call plants a
--      digest of its own and the same caller comes back on the guarded path with the
--      matching token, is accepted as the lease holder, and plants a fabricated
--      provider_batch_id -- the impostor attack in full (Kimi K3 finding F1)
--  14. a CLAIMING guarded write may not rewrite the ambiguity verdict fields either;
--      they are the forensic record of a possibly-billed job and only this function
--      writes them (Kimi K3 finding F2)
--  15. the same-name renewal trap is signalled explicitly: a renewal over a LIVE
--      lease succeeds and extends the lease but reports lease_receipt_issued = false
--      and issues no token, so the renewer is not, and cannot become, the holder
--      (Kimi K3 finding F3)
--  18. the receipt holder may clear only an exact, completed provider job using the
--      explicit reconciliation flag; wrong revision, provider id, receipt,
--      nonterminal phase, and ambiguity all raise 55000 without mutation (#1211)
-- =====================================================================================

begin;

-- The "Database Contract Tests" workflow replays migrations into an EMPTY database and
-- never applies supabase/ci-bootstrap, so public.admin_config does not exist there. It is
-- a four-column config table and the functions under test are what this file actually
-- proves, so the table is created if (and only if) it is missing. On preview, production
-- and any adopted database this is a no-op against the real table, and the whole
-- transaction is rolled back either way.
create table if not exists public.admin_config (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid);

do $bootstrap$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_config'::regclass and contype = 'p'
  ) then
    alter table public.admin_config add primary key (key);
  end if;
end $bootstrap$;

do $$
declare
  v_out    jsonb;
  v_stored jsonb;
  v_job    jsonb;
  v_field  text;
  v_failed boolean;
  v_token  text;   -- worker A's one-time claim receipt, handed back in the envelope
  v_token2 text;   -- a second receipt, for the forgery and renewal-trap sections
  v_token3 text;   -- worker A's receipt in the destroy-and-remint sections (16, 17)
  v_job2   jsonb;
  v_job3   jsonb;
begin
  -- ---------------------------------------------------------------------------------
  -- Clean, deterministic starting point for this transaction only.
  -- ---------------------------------------------------------------------------------
  insert into admin_config (key, value, updated_at)
  values ('BULK_OPERATIONS', '{}'::jsonb, now())
  on conflict (key) do update set value = '{}'::jsonb, updated_at = now();

  -- =================================================================================
  -- 1. LEGACY THREE-ARGUMENT COMPATIBILITY (unprotected state)
  -- =================================================================================
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 0)));

  if v_out -> 'ai-tag-untagged' ->> 'status' is distinct from 'running' then
    raise exception 'legacy call did not return the whole BULK_OPERATIONS object as before: %', v_out;
  end if;
  if v_out ? 'ok' then
    raise exception 'legacy call must NOT return the guarded proof envelope: %', v_out;
  end if;

  -- Historical conditional no-op: wrong expected status returns current state unchanged.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'idle'),
    'stopped');
  if v_out -> 'ai-tag-untagged' ->> 'status' is distinct from 'running' then
    raise exception 'p_only_if_status no-op changed state: %', v_out;
  end if;

  -- Matching expected status still writes.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'running', 'state_revision', 0),
    'running');
  if v_out -> 'ai-tag-untagged' ->> 'status' is distinct from 'running' then
    raise exception 'legacy conditional write did not apply: %', v_out;
  end if;

  -- =================================================================================
  -- 2. ONLY ONE WORKER CAN CLAIM A GIVEN REVISION / LEASE
  -- =================================================================================

  -- Worker A claims revision 0 and a 120 second submission lease.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-1')),
    'running',
    0,
    'worker-A',
    120);

  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'worker A could not claim a free revision: %', v_out;
  end if;
  if (v_out ->> 'state_revision')::bigint <> 1 then
    raise exception 'guarded write did not stamp state_revision 1: %', v_out;
  end if;
  if v_out ->> 'submission_owner' is distinct from 'worker-A' then
    raise exception 'saved state does not prove the submission owner: %', v_out;
  end if;
  if v_out ->> 'lease_expires_at' is null then
    raise exception 'saved state does not prove a lease expiry: %', v_out;
  end if;
  if v_out ->> 'external_job_phase' is distinct from 'submitting' then
    raise exception 'saved state does not prove the external_job phase: %', v_out;
  end if;

  -- Claiming a FREE lease mints a one-time claim receipt, returned here and nowhere
  -- else. This is the only thing that will later distinguish worker A from any
  -- process that merely repeats the (publicly readable) name 'worker-A'.
  v_token := v_out ->> 'lease_token';
  if v_token is null or length(v_token) < 16 then
    raise exception 'claiming a free lease did not issue a claim receipt: %', v_out;
  end if;

  -- The receipt itself must NOT be readable from stored state -- only its digest.
  select value -> 'ai-tag-untagged' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  if v_job ? 'lease_token' then
    raise exception 'the claim receipt was stored in readable form: %', v_job;
  end if;
  if v_job ->> 'lease_proof' is distinct from md5(v_token) then
    raise exception 'stored lease_proof is not the digest of the issued receipt: %', v_job;
  end if;

  -- The envelope must reflect what is STORED, not what was passed in.
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'submission_owner' is distinct from 'worker-A'
     or coalesce(v_stored ->> 'state_revision', '') <> '1' then
    raise exception 'stored row does not match the returned proof envelope: %', v_stored;
  end if;

  -- Worker B replays the SAME expected revision. This is the overlapping-Railway-deploy
  -- case: it must lose, and must not touch stored state.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-1')),
    'running',
    0,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'revision_conflict' then
    raise exception 'a second worker claimed the same revision: %', v_out;
  end if;
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'submission_owner' is distinct from 'worker-A' then
    raise exception 'the losing claim mutated stored state: %', v_stored;
  end if;

  -- Worker B now uses the CURRENT revision but the lease is still live and held by A.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-1')),
    'running',
    1,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_held' then
    raise exception 'a live submission lease was stolen: %', v_out;
  end if;

  -- 2b. A NON-CLAIMING WRITE MAY NOT PLANT A provider_batch_id (review finding A).
  --
  -- Worker B reads revision 1, carries A's seven lease fields forward byte-for-byte
  -- (so the immutability rule is satisfied) and states no p_submission_owner -- then
  -- writes a provider_batch_id of its own invention. If that were accepted, worker A
  -- could never save the REAL id its POST returned, and the billed job would be
  -- orphaned behind B's fake one.
  select value -> 'ai-tag-untagged' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('provider_batch_id', 'batch_FAKE')),
    'running',
    1);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a non-claiming write planted a provider_batch_id: %', v_out;
  end if;
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ? 'provider_batch_id'
     or (v_stored ->> 'state_revision')::bigint <> 1 then
    raise exception 'the refused batch-id plant still mutated stored state: %', v_stored;
  end if;

  -- 2b-ii. NOR MAY IT PLANT ONE BY REPEATING THE STORED OWNER NAME.
  --
  -- This is the hole the previous version of the rule left: it only asked whether
  -- p_submission_owner had been supplied and then compared it to the stored
  -- external_job.submission_owner -- a value published in admin_config to everyone
  -- who can call this function. Worker B reads the JSON, states 'worker-A' as its
  -- own p_submission_owner, and brings a batch id of its own. Under the old rule the
  -- owner compare passed, the write was accepted, the lease was RENEWED and the fake
  -- id was stored -- after which worker A's real id was refused as a replacement and
  -- the billed job was orphaned.
  --
  -- Worker B cannot produce the claim receipt that worker A's claim minted, so it is
  -- refused, and nothing about it -- not the id, not the lease, not the revision --
  -- reaches stored state.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('provider_batch_id', 'batch_FAKE')),
    'running',
    1,
    'worker-A',
    600);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'repeating the stored owner name planted a provider_batch_id: %', v_out;
  end if;
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ? 'provider_batch_id'
     or (v_stored ->> 'state_revision')::bigint <> 1
     or v_stored -> 'external_job' ->> 'lease_expires_at'
        is distinct from v_job ->> 'lease_expires_at' then
    raise exception 'the refused copycat claim still mutated stored state: %', v_stored;
  end if;

  -- 2b-iii. AND A STOLEN RECEIPT IS NOT A RECEIPT. Sending back the stored DIGEST
  -- (which anyone can read) rather than the issued receipt proves nothing.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object(
        'provider_batch_id', 'batch_FAKE',
        'lease_token', v_job ->> 'lease_proof')),
    'running',
    1,
    'worker-A',
    600);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'the readable lease_proof digest was accepted as a claim receipt: %', v_out;
  end if;

  -- 2c. NOR MAY IT MOVE THE PHASE OF A LIVE-LEASED JOB.
  -- Same shape, same faithful carry-forward, no claim -- it just parks A's healthy
  -- job as ambiguous (denial of service) or walks it back to a submittable phase.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('phase', 'ambiguous_submission')),
    'running',
    1);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'phase_protected' then
    raise exception 'a non-claiming write declared a healthy job ambiguous: %', v_out;
  end if;

  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('phase', 'prepared')),
    'running',
    1);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'phase_protected' then
    raise exception 'a non-claiming write moved the phase of a live-leased job: %', v_out;
  end if;
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'phase' <> 'submitting'
     or (v_stored ->> 'state_revision')::bigint <> 1 then
    raise exception 'a refused phase move still mutated stored state: %', v_stored;
  end if;

  -- A non-claiming write that touches neither the phase nor the batch id is still
  -- fine: progress reporting under someone else's live lease is normal traffic.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'progress', jsonb_build_object('done', 3),
      'external_job', v_job),
    'running',
    1);
  if (v_out ->> 'ok')::boolean is not true or (v_out ->> 'state_revision')::bigint <> 2 then
    raise exception 'ordinary progress reporting under a live lease was refused: %', v_out;
  end if;

  -- Worker A saves the accepted provider batch id and can PROVE it was stored. It
  -- sends back the claim receipt it was issued when it took this lease, which is the
  -- ONLY thing that distinguishes it from any process that can read the same JSON.
  -- The lease is renewed by the same owner, which is allowed.
  select value -> 'ai-tag-untagged' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object(
        'phase', 'pending',
        'provider_batch_id', 'batch_abc',
        'lease_token', v_token)),
    'running',
    2,
    'worker-A',
    120);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_abc'
     or v_out ->> 'submission_owner' <> 'worker-A'
     or (v_out ->> 'state_revision')::bigint <> 3 then
    raise exception 'the receipt-holding worker could not save its provider batch id: %', v_out;
  end if;

  -- A renewal by the same owner keeps the incumbent receipt rather than re-minting,
  -- so it hands nothing out and invalidates nothing. And the receipt the holder just
  -- sent must not have been written into stored state.
  if v_out ? 'lease_token' and v_out ->> 'lease_token' is not null then
    raise exception 'a same-owner renewal issued a second claim receipt: %', v_out;
  end if;
  select value -> 'ai-tag-untagged' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'lease_token' then
    raise exception 'the claim receipt leaked into stored state: %', v_stored;
  end if;
  if v_stored ->> 'lease_proof' is distinct from md5(v_token) then
    raise exception 'the renewal rotated the incumbent claim receipt: %', v_stored;
  end if;

  -- 2d. AND CLAIMING DOES NOT HELP A BYSTANDER EITHER -- UNDER ITS OWN NAME OR THE
  -- HOLDER'S.
  --
  -- The earlier version of this test only tried worker-B stating ITSELF, and then
  -- claimed "there is no route" for a non-holder to bind the operation to a provider
  -- job. That sentence was false: the rule it exercised compared p_submission_owner
  -- to the stored owner, and the stored owner is readable, so worker-B simply had to
  -- say 'worker-A'. Both spellings are exercised below, and both must be refused
  -- before anything is stored, because neither can produce the claim receipt.
  v_out := public.update_bulk_operation(
    'bystander-batch',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-by')),
    null,
    0,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'could not set up the bystander fixture: %', v_out;
  end if;

  v_out := public.update_bulk_operation(
    'bystander-batch',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_B')),
    null,
    1,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a bystander claimed the lease to save a batch id: %', v_out;
  end if;
  select value -> 'bystander-batch' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ? 'provider_batch_id' then
    raise exception 'the refused bystander claim still stored a batch id: %', v_stored;
  end if;

  -- The same call, now spelling the OWNER'S name. This is the case the old test
  -- never tried and the old rule accepted.
  v_out := public.update_bulk_operation(
    'bystander-batch',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_B')),
    null,
    1,
    'worker-A',
    120);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a bystander repeating the holder name saved a batch id: %', v_out;
  end if;
  select value -> 'bystander-batch' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ? 'provider_batch_id'
     or (v_stored ->> 'state_revision')::bigint <> 1 then
    raise exception 'the refused copycat claim still mutated stored state: %', v_stored;
  end if;

  -- And a same-name renewal that does NOT bring a batch id is still ordinary retry
  -- traffic: it succeeds, but it is handed no receipt of its own and does not rotate
  -- the incumbent one, so the real holder keeps working.
  select value -> 'bystander-batch' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation(
    'bystander-batch',
    jsonb_build_object('status', 'running', 'external_job', v_job),
    null,
    1,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'a same-name lease renewal was refused: %', v_out;
  end if;
  if v_out ->> 'lease_token' is not null then
    raise exception 'a same-name renewal was handed a claim receipt: %', v_out;
  end if;
  select value -> 'bystander-batch' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'lease_proof' is distinct from (v_job ->> 'lease_proof') then
    raise exception 'a same-name renewal rotated the incumbent receipt: %', v_stored;
  end if;

  -- A saved provider batch id can never be re-pointed at a different provider job.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_OTHER')),
    'running',
    3);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a saved provider_batch_id was re-pointed: %', v_out;
  end if;

  -- A non-claiming guarded write may not drop an external_job whose lease is still
  -- live: dropping it and re-creating it on the next revision is lease theft in two
  -- steps. Only once the lease has lapsed may the proving caller clear a finished
  -- job (the saved provider_batch_id means this is NOT the ambiguous crash window).
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 100)),
    'running',
    3);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_held' then
    raise exception 'a non-claiming guarded write dropped a live-leased external_job: %', v_out;
  end if;

  -- 2e. AND THE LEASE LAPSING DOES NOT UNLOCK THE POINTER.
  --
  -- This is where the previous version of this file asserted the WEAK behaviour as
  -- if it were intended: once the lease expired, a caller that merely matched the
  -- revision was allowed to drop the whole external_job -- saved provider_batch_id
  -- and all -- and that was described as "clearing a finished job". It is not. A
  -- lapsed lease is not evidence that the provider job finished or went away; it is
  -- the state in which a real, billed job is most likely to exist unrecorded. With
  -- the pointer destroyed, the next writer sees a clean operation and submits it
  -- again, which is precisely the duplicate-billing window this migration closes --
  -- re-opened by nothing more than the clock running out.
  update admin_config
     set value = jsonb_set(value, array['ai-tag-untagged','external_job','lease_expires_at'],
                           to_jsonb((now() - interval '1 second')::text))
   where key = 'BULK_OPERATIONS';

  -- Non-claiming, revision matched, lease long lapsed: still refused.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 100)),
    'running',
    3);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a lapsed lease let a guarded write destroy a provider-job pointer: %', v_out;
  end if;

  -- Claiming the lapsed lease does not unlock it either.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 100)),
    'running',
    3,
    'worker-C',
    120);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a new claimer destroyed a provider-job pointer after lapse: %', v_out;
  end if;

  -- Nor may it be re-pointed at a different provider job after the lapse.
  select value -> 'ai-tag-untagged' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('provider_batch_id', 'batch_OTHER')),
    'running',
    3,
    'worker-C',
    120);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a lapsed lease let a provider_batch_id be re-pointed: %', v_out;
  end if;

  -- The pointer survived all three attempts, untouched, at the same revision.
  select value -> 'ai-tag-untagged' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'provider_batch_id' <> 'batch_abc'
     or (v_stored ->> 'state_revision')::bigint <> 3 then
    raise exception 'the provider-job pointer did not survive the lapse attacks: %', v_stored;
  end if;

  -- A legacy caller cannot destroy it after the lapse either. The stored phase here
  -- is 'pending' (live), but the saved provider_batch_id alone is enough: protection
  -- keys off the pointer, not off the lease and not off the phase.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-untagged',
      jsonb_build_object('status', 'idle', 'state_revision', 3));
  exception when others then
    v_failed := position('would drop a protected external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write destroyed a provider-job pointer after the lease lapsed';
  end if;

  -- Ordinary non-claiming traffic over the lapsed lease is still fine, as long as it
  -- carries the pointer forward: the operation is not frozen, only its pointer is.
  v_out := public.update_bulk_operation(
    'ai-tag-untagged',
    jsonb_build_object(
      'status', 'running',
      'progress', jsonb_build_object('done', 100),
      'external_job', v_job),
    'running',
    3);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_abc'
     or (v_out ->> 'state_revision')::bigint <> 4 then
    raise exception 'faithful carry-forward over a lapsed lease was refused: %', v_out;
  end if;

  -- =================================================================================
  -- 3. EXPIRED LEASE WITH NO BATCH ID => AMBIGUITY, NEVER A RESUBMISSION
  -- =================================================================================
  update admin_config
     set value = jsonb_set(value, array['ai-tag-all'], jsonb_build_object(
           'status', 'running',
           'state_revision', 5,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'run_id', 'run-9',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() - interval '10 seconds'))))
   where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'ai-tag-all',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-9')),
    'running',
    5,
    'worker-B',
    120);

  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'ambiguous_submission' then
    raise exception 'an expired lease with no provider_batch_id handed out a new submission slot: %', v_out;
  end if;
  if v_out ->> 'external_job_phase' <> 'ambiguous_submission' then
    raise exception 'the ambiguity was not made durable: %', v_out;
  end if;
  if (v_out ->> 'state_revision')::bigint <> 6 then
    raise exception 'the durable ambiguity did not advance the revision: %', v_out;
  end if;
  if v_out ->> 'submission_owner' is distinct from 'worker-A' then
    raise exception 'the ambiguity lost the prior submission owner: %', v_out;
  end if;

  select value -> 'ai-tag-all' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'phase' <> 'ambiguous_submission'
     or v_stored -> 'external_job' ->> 'ambiguous_reason'
        <> 'submission_lease_expired_without_provider_batch_id' then
    raise exception 'ambiguity is not readable from stored state: %', v_stored;
  end if;

  -- Retrying against the new revision still refuses: ambiguity is terminal until a
  -- human/explicit reconciliation flow resolves it.
  v_out := public.update_bulk_operation(
    'ai-tag-all',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-9')),
    'running',
    6,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'ambiguous_submission' then
    raise exception 'an ambiguous submission was auto-resubmitted: %', v_out;
  end if;

  -- A guarded caller with the exact current revision still cannot clear ambiguity.
  v_out := public.update_bulk_operation(
    'ai-tag-all',
    jsonb_build_object('status', 'idle'),
    null,
    6);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'ambiguous_submission' then
    raise exception 'ambiguity was cleared by an ordinary guarded write: %', v_out;
  end if;

  -- =================================================================================
  -- 4. LEGACY CALLERS: COMPATIBLE, BUT CANNOT OVERWRITE PROTECTED STATE
  -- =================================================================================

  -- 4a. A live protected job. Set one up on its own key.
  update admin_config
     set value = jsonb_set(value, array['ai-tag-groups'], jsonb_build_object(
           'status', 'running',
           'state_revision', 4,
           'external_job', jsonb_build_object(
             'phase', 'pending',
             'provider_batch_id', 'batch_live',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() + interval '5 minutes'))))
   where key = 'BULK_OPERATIONS';

  -- Legacy Start/Start Fresh style replacement that drops external_job: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-groups',
      jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 0)));
  exception when others then
    v_failed := position('would drop a protected external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy full-state replacement dropped a live external_job';
  end if;

  -- Legacy write that re-points the provider batch id: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-groups',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_OTHER')));
  exception when others then
    v_failed := position('would replace saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write re-pointed a saved provider_batch_id';
  end if;

  -- Legacy write that regresses the revision: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-groups',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 1,
        'external_job', jsonb_build_object(
          'phase', 'pending',
          'provider_batch_id', 'batch_live',
          'submission_owner', 'worker-A',
          'lease_expires_at', (now() + interval '5 minutes'))));
  exception when others then
    v_failed := position('would regress state_revision' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write regressed state_revision over protected state';
  end if;

  -- Legacy write that steals a live lease: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-groups',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object(
          'phase', 'pending',
          'provider_batch_id', 'batch_live',
          'submission_owner', 'worker-B',
          'lease_expires_at', (now() + interval '5 minutes'))));
  exception when others then
    v_failed := position('submission lease is held by' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write stole a live submission lease';
  end if;

  -- A legacy write that faithfully carries the protected job forward still works.
  --
  -- IT MUST CARRY THE STORED external_job OBJECT ITSELF, NOT REBUILD IT. This test
  -- used to re-express lease_expires_at as `now() + interval '5 minutes'`, which is
  -- byte-identical to the fixture only because the whole file runs in ONE transaction
  -- where now() is frozen. A real caller runs on the wall clock, so a rebuilt
  -- timestamp differs and is refused -- the test proved nothing about the caller it
  -- claimed to model. So: read what is stored and write exactly that back.
  select value -> 'ai-tag-groups' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'ai-tag-groups',
    jsonb_build_object(
      'status', 'running',
      'state_revision', 4,
      'progress', jsonb_build_object('done', 7),
      'external_job', v_job));
  if v_out -> 'ai-tag-groups' -> 'progress' ->> 'done' <> '7' then
    raise exception 'a faithful legacy write was refused: %', v_out;
  end if;

  -- AND THE WALL-CLOCK CALLER IS REFUSED, LOUDLY. A caller that RECONSTRUCTS
  -- lease_expires_at instead of writing back the stored string moves a
  -- lease-controlling field, whatever it intended. That is a real coordinated change
  -- for popdam3#92, so it is asserted here rather than left to be discovered live.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-groups',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 5,
        'external_job', v_job || jsonb_build_object(
          'lease_expires_at', ((v_job ->> 'lease_expires_at')::timestamptz + interval '1 second'))));
  exception when others then
    v_failed := position('lease-controlling external_job field "lease_expires_at"' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy caller rebuilt lease_expires_at to a different instant and was accepted';
  end if;

  -- Unprotected keys are entirely untouched by any of this.
  v_out := public.update_bulk_operation(
    'thumbnail-scan',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 3)));
  if v_out -> 'thumbnail-scan' -> 'progress' ->> 'done' <> '3' then
    raise exception 'legacy behaviour regressed on an unprotected operation: %', v_out;
  end if;

  -- =================================================================================
  -- 5. THE BATCH WRITER CANNOT CLOBBER PROTECTED STATE
  -- =================================================================================

  -- Dropping a protected external_job through the batch writer: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'thumbnail-scan', jsonb_build_object('status', 'idle'),
      'ai-tag-groups',  jsonb_build_object('status', 'running')));
  exception when others then
    v_failed := position('would drop a protected external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'update_bulk_operations_batch dropped a live external_job';
  end if;

  -- The refused batch call must be all-or-nothing: the unprotected sibling key it
  -- also carried must NOT have been written.
  select value -> 'thumbnail-scan' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'status' <> 'running' then
    raise exception 'a refused batch call partially applied: %', v_stored;
  end if;

  -- Re-pointing the provider batch id through the batch writer: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'ai-tag-groups', jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_OTHER'))));
  exception when others then
    v_failed := position('would replace saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'update_bulk_operations_batch re-pointed a saved provider_batch_id';
  end if;

  -- Regressing the revision through the batch writer: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'ai-tag-groups', jsonb_build_object(
        'status', 'running',
        'external_job', jsonb_build_object(
          'phase', 'pending',
          'provider_batch_id', 'batch_live',
          'submission_owner', 'worker-A',
          'lease_expires_at', (now() + interval '5 minutes')))));
  exception when others then
    v_failed := position('would regress state_revision' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'update_bulk_operations_batch regressed state_revision over protected state';
  end if;

  -- Clobbering an ambiguous submission through the batch writer: must RAISE.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'ai-tag-all', jsonb_build_object('status', 'idle')));
  exception when others then
    v_failed := position('would drop a protected external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'update_bulk_operations_batch cleared an ambiguous submission';
  end if;

  -- Unprotected multi-key merging still behaves exactly as before.
  v_out := public.update_bulk_operations_batch(jsonb_build_object(
    'thumbnail-scan', jsonb_build_object('status', 'idle'),
    'some-other-op',  jsonb_build_object('status', 'queued')));
  if v_out -> 'thumbnail-scan' ->> 'status' <> 'idle'
     or v_out -> 'some-other-op' ->> 'status' <> 'queued' then
    raise exception 'the batch writer regressed on unprotected keys: %', v_out;
  end if;
  if v_out -> 'ai-tag-groups' -> 'external_job' ->> 'provider_batch_id' <> 'batch_live' then
    raise exception 'the batch writer disturbed a key it was not asked to write: %', v_out;
  end if;

  -- =================================================================================
  -- 6. p_only_if_status = 'running' AND STOP PROTECTION STILL HOLD
  -- =================================================================================
  update admin_config
     set value = jsonb_set(value, array['ai-tag-stopped'], jsonb_build_object(
           'status', 'stopped',
           'state_revision', 2))
   where key = 'BULK_OPERATIONS';

  -- The historical guard, now on the guarded path too.
  v_out := public.update_bulk_operation(
    'ai-tag-stopped',
    jsonb_build_object('status', 'running'),
    'running',
    2,
    'worker-A',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'status_conflict' then
    raise exception 'p_only_if_status = running protection was lost on the guarded path: %', v_out;
  end if;

  -- Even without p_only_if_status, a stopped operation is not resumed into provider work.
  v_out := public.update_bulk_operation(
    'ai-tag-stopped',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting')),
    null,
    2,
    'worker-A',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'stopped' then
    raise exception 'a stopped operation was resumed into a submission lease: %', v_out;
  end if;

  -- A legacy caller cannot un-stop it into a live external job either.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-stopped',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 2,
        'external_job', jsonb_build_object('phase', 'submitting')));
  exception when others then
    v_failed := position('would resume a live external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy caller un-stopped an operation into a live external_job';
  end if;

  -- Acknowledging the stop (dismiss) is still allowed.
  v_out := public.update_bulk_operation(
    'ai-tag-stopped',
    jsonb_build_object('status', 'idle', 'state_revision', 2),
    'stopped');
  if v_out -> 'ai-tag-stopped' ->> 'status' <> 'idle' then
    raise exception 'dismissing a stopped operation was refused: %', v_out;
  end if;

  -- =================================================================================
  -- 7. ARGUMENT VALIDATION
  -- =================================================================================
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-untagged', jsonb_build_object('status', 'running'), null, null, 'worker-A', 120);
  exception when others then
    v_failed := position('p_expected_revision is required' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a lease claim was accepted without a compare-and-swap revision';
  end if;

  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'ai-tag-untagged', jsonb_build_object('status', 'running'), null, 3, 'worker-A', 0);
  exception when others then
    v_failed := position('p_lease_seconds must be between' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a zero-second submission lease was accepted';
  end if;

  v_failed := false;
  begin
    -- Deliberately an operation with NO external_job: on one that HAS a provider-job
    -- pointer, the pointer rule refuses a claim with no external_job first (2e), and
    -- this argument check would never be reached.
    perform public.update_bulk_operation(
      'thumbnail-scan', jsonb_build_object('status', 'running'), null, 0, 'worker-A', 120);
  exception when others then
    v_failed := position('requires an external_job object' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a lease was claimed with no external_job to attach it to';
  end if;

  -- =================================================================================
  -- 8. A GUARDED WRITE THAT DOES NOT CLAIM THE LEASE CANNOT MOVE THE LEASE
  --    (review finding 1: two workers could otherwise both believe they own one
  --     submission, using only this API.)
  -- =================================================================================
  v_out := public.update_bulk_operation(
    'lease-attack',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-att')),
    null,
    0,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true or v_out ->> 'submission_owner' <> 'worker-A' then
    raise exception 'could not set up the live-lease fixture: %', v_out;
  end if;

  select value -> 'lease-attack' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';

  -- 8a. THE ATTACK. p_submission_owner is null, so no lease is claimed and every
  -- lease check that keys off it is skipped -- but the payload names worker-B as
  -- the submission owner. If this is applied, worker-B reads back a state naming
  -- worker-B as owner while worker-A's live lease says worker-A. Must be refused.
  v_out := public.update_bulk_operation(
    'lease-attack',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job || jsonb_build_object('submission_owner', 'worker-B')),
    null,
    1);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_fields_immutable' then
    raise exception 'a no-owner guarded write took over a live submission lease: %', v_out;
  end if;
  select value -> 'lease-attack' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'submission_owner' <> 'worker-A' then
    raise exception 'the refused write still moved the stored submission owner: %', v_stored;
  end if;

  -- 8b. FAITHFUL CARRY-FORWARD MUST STILL SUCCEED. Same call shape, lease fields
  -- carried forward exactly as stored, ordinary fields changed. The PHASE is not an
  -- ordinary field while the lease is live -- only the holder moves it (2c) -- so an
  -- ordinary external_job field is changed here instead.
  v_out := public.update_bulk_operation(
    'lease-attack',
    jsonb_build_object(
      'status', 'running',
      'progress', jsonb_build_object('done', 42),
      'external_job', v_job || jsonb_build_object('attempt', 2)),
    null,
    1);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'submission_owner' <> 'worker-A'
     or (v_out ->> 'state_revision')::bigint <> 2 then
    raise exception 'a faithful no-owner carry-forward was refused: %', v_out;
  end if;

  select value -> 'lease-attack' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';

  -- 8c. THE SAME ATTACK THROUGH EVERY OTHER LEASE-CONTROLLING FIELD. Overriding any
  -- one of them without claiming the lease -- extending the expiry, restamping the
  -- claim time, or forging an ambiguity verdict -- must be refused just as hard.
  foreach v_field in array array['lease_expires_at','lease_claimed_at','ambiguous_since',
                                 'ambiguous_reason','ambiguous_prior_phase','ambiguous_prior_owner',
                                 'lease_proof'] loop
    v_out := public.update_bulk_operation(
      'lease-attack',
      jsonb_build_object(
        'status', 'running',
        'external_job', v_job || jsonb_build_object(v_field, 'forged-by-worker-B')),
      null,
      2);
    if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_fields_immutable' then
      raise exception 'a no-owner guarded write forged external_job.%: %', v_field, v_out;
    end if;
  end loop;

  -- Dropping external_job entirely while the lease is live is the same theft in two
  -- steps (clear now, re-create as yourself on the next revision). Also refused.
  v_out := public.update_bulk_operation(
    'lease-attack',
    jsonb_build_object('status', 'running'),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_held' then
    raise exception 'a no-owner guarded write dropped a live-leased external_job: %', v_out;
  end if;

  -- 8d. A payload may not restate a state_revision other than the stored one.
  v_out := public.update_bulk_operation(
    'lease-attack',
    jsonb_build_object(
      'status', 'running',
      'state_revision', 99,
      'external_job', v_job),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_fields_immutable' then
    raise exception 'a no-owner guarded write restated state_revision: %', v_out;
  end if;

  -- =================================================================================
  -- 9. THE AMBIGUITY RULE ON THE LEGACY AND BATCH PATHS
  --    (review finding 2: the money-losing rule was enforced on the guarded path
  --     only, so a legacy caller could still drive a duplicate provider submission.)
  -- =================================================================================

  -- 9a. LEGACY THREE-ARGUMENT PATH over an expired lease with NO saved batch id.
  --     It must RAISE. A three-argument caller cannot be handed a proof envelope,
  --     it reads "no exception" as success, and the money path is write-then-POST,
  --     so any quiet return -- flip or not -- is a silent failure that arrives after
  --     the provider has been billed. Nothing is flipped and nothing is written: the
  --     stored row stays in the refusing state, so the refusal repeats forever.
  update admin_config
     set value = jsonb_set(value, array['legacy-ambiguous'], jsonb_build_object(
           'status', 'running',
           'state_revision', 3,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'run_id', 'run-legacy',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() - interval '30 seconds'))))
   where key = 'BULK_OPERATIONS';

  -- This is the write that would otherwise walk the operation back to a submittable
  -- state and drive a second, duplicate-billed POST to the provider.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'legacy-ambiguous',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 3,
        'external_job', jsonb_build_object('phase', 'prepared', 'run_id', 'run-legacy-2')));
  exception when others then
    v_failed := position('expired at' in sqlerrm) > 0
                and position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the legacy path did not RAISE on the expired-lease-no-batch-id rule';
  end if;

  -- Nothing was applied and nothing was flipped.
  select value -> 'legacy-ambiguous' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'phase' <> 'submitting'
     or v_stored -> 'external_job' ->> 'run_id' <> 'run-legacy'
     or (v_stored ->> 'state_revision')::bigint <> 3 then
    raise exception 'the legacy refusal still mutated stored state: %', v_stored;
  end if;

  -- And it is not a one-off: the SAME call raises again, because the stored row
  -- still matches the rule. Safety does not depend on a durable flip.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'legacy-ambiguous',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 3,
        'external_job', jsonb_build_object('phase', 'prepared', 'run_id', 'run-legacy-2')));
  exception when others then
    v_failed := position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the legacy refusal was not repeatable';
  end if;

  -- 9a-ii. THERE IS NO PAYLOAD ESCAPE, AND THERE MUST NOT BE.
  --
  -- The previous version of this file asserted the opposite: that a legacy payload
  -- declaring phase = 'ambiguous_submission' is "the documented escape" for a caller
  -- that has reconciled with the provider. It proves nothing of the kind. The string
  -- is free-form JSONB that any caller can type, and taking the escape did not
  -- merely record a verdict -- the call fell through to the ordinary rules and wrote
  -- the WHOLE object, so the same payload could carry a fabricated provider_batch_id,
  -- a new submission owner and a fresh lease, and it returned the ordinary success
  -- shape (full BULK_OPERATIONS, status running, no exception) that a write-then-POST
  -- caller reads as permission to submit. That is the duplicate-billing hole this
  -- whole rule exists to close, re-opened through the back door.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'legacy-ambiguous',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 3,
        'external_job', jsonb_build_object(
          'phase', 'ambiguous_submission',
          'run_id', 'run-legacy',
          'provider_batch_id', 'batch_LAUNDERED',
          'submission_owner', 'worker-B',
          'lease_expires_at', (now() + interval '5 minutes'))));
  exception when others then
    v_failed := position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy payload laundered a resubmission through the ambiguity escape';
  end if;

  select value -> 'legacy-ambiguous' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ? 'provider_batch_id'
     or v_stored -> 'external_job' ->> 'submission_owner' <> 'worker-A'
     or v_stored -> 'external_job' ->> 'phase' <> 'submitting' then
    raise exception 'the refused legacy reconciliation still mutated stored state: %', v_stored;
  end if;

  -- The batch writer has no escape either.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'legacy-ambiguous', jsonb_build_object(
        'status', 'running',
        'state_revision', 3,
        'external_job', jsonb_build_object(
          'phase', 'ambiguous_submission',
          'provider_batch_id', 'batch_LAUNDERED',
          'submission_owner', 'worker-B',
          'lease_expires_at', (now() + interval '5 minutes')))));
  exception when others then
    v_failed := position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a batch payload laundered a resubmission through the ambiguity escape';
  end if;

  -- Reconciliation is a GUARDED-PATH operation. The function itself records the
  -- verdict, from stored state, and answers ok = false -- which no caller can mistake
  -- for permission to POST.
  v_out := public.update_bulk_operation(
    'legacy-ambiguous',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-legacy')),
    null,
    3);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'ambiguous_submission'
     or v_out ->> 'external_job_phase' <> 'ambiguous_submission' then
    raise exception 'the guarded path did not record the ambiguity verdict: %', v_out;
  end if;
  select value -> 'legacy-ambiguous' into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'ambiguous_prior_owner' <> 'worker-A'
     or v_stored -> 'external_job' ? 'provider_batch_id' then
    raise exception 'the recorded verdict was not built from stored state: %', v_stored;
  end if;

  -- Once ambiguous, a legacy write still cannot resume it.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'legacy-ambiguous',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object('phase', 'prepared')));
  exception when others then
    v_failed := position('requires explicit reconciliation' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write resumed an ambiguous submission';
  end if;

  -- 9b. BATCH PATH over an expired lease with NO saved batch id: same verdict.
  update admin_config
     set value = jsonb_set(value, array['batch-ambiguous'], jsonb_build_object(
           'status', 'running',
           'state_revision', 7,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'run_id', 'run-batch',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() - interval '30 seconds'))))
   where key = 'BULK_OPERATIONS';

  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'batch-sibling',   jsonb_build_object('status', 'queued'),
      'batch-ambiguous', jsonb_build_object(
        'status', 'running',
        'state_revision', 7,
        'external_job', jsonb_build_object('phase', 'prepared', 'run_id', 'run-batch-2'))));
  exception when others then
    v_failed := position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the batch path did not RAISE on the expired-lease-no-batch-id rule';
  end if;

  -- All-or-nothing, and no flip: neither key was written.
  select value into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'batch-sibling' then
    raise exception 'the batch path partially applied around the ambiguity rule: %', v_stored;
  end if;
  if v_stored -> 'batch-ambiguous' -> 'external_job' ->> 'phase' <> 'submitting'
     or v_stored -> 'batch-ambiguous' -> 'external_job' ->> 'run_id' <> 'run-batch'
     or (v_stored -> 'batch-ambiguous' ->> 'state_revision')::bigint <> 7 then
    raise exception 'the batch refusal still mutated stored state: %', v_stored;
  end if;

  -- Repeatable for the same reason: the stored row still matches the rule.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'batch-ambiguous', jsonb_build_object(
        'status', 'running',
        'state_revision', 7,
        'external_job', jsonb_build_object('phase', 'prepared'))));
  exception when others then
    v_failed := position('no saved provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the batch refusal was not repeatable';
  end if;

  -- =================================================================================
  -- 10. NO LEGACY OR BATCH CALLER MAY *INTRODUCE* A provider_batch_id
  --
  -- Both writers only ever refused to REPLACE an id that was already stored. That
  -- left the window where it actually matters completely unguarded: between the
  -- moment a worker claims the lease and the moment it saves the id its POST
  -- returned, NOTHING is stored, so the replacement rule never fired and no rule on
  -- these paths required the caller to be anybody in particular. Any three-argument
  -- or batch call repeating the (readable) owner name and revision could bind the
  -- operation to a job of its own invention -- after which the real id came back and
  -- was refused as a replacement, orphaning the billed job.
  -- =================================================================================
  update admin_config
     set value = jsonb_set(value, array['introduce-guard'], jsonb_build_object(
           'status', 'running',
           'state_revision', 4,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'run_id', 'run-intro',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() + interval '5 minutes'))))
   where key = 'BULK_OPERATIONS';

  -- 10a. Legacy three-argument path: everything carried forward faithfully, same
  -- owner, same revision -- plus a batch id that this caller cannot possibly know.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'introduce-guard',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object(
          'phase', 'submitting',
          'run_id', 'run-intro',
          'provider_batch_id', 'batch_FAKE',
          'submission_owner', 'worker-A',
          'lease_expires_at', (now() + interval '5 minutes'))));
  exception when others then
    v_failed := position('would introduce provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write introduced a provider_batch_id under a live lease';
  end if;

  -- 10b. Batch writer: identical hole, identical verdict, and all-or-nothing.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'introduce-sibling', jsonb_build_object('status', 'queued'),
      'introduce-guard',   jsonb_build_object(
        'status', 'running',
        'state_revision', 4,
        'external_job', jsonb_build_object(
          'phase', 'submitting',
          'run_id', 'run-intro',
          'provider_batch_id', 'batch_FAKE',
          'submission_owner', 'worker-A',
          'lease_expires_at', (now() + interval '5 minutes')))));
  exception when others then
    v_failed := position('would introduce provider_batch_id' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the batch writer introduced a provider_batch_id under a live lease';
  end if;

  select value into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'introduce-sibling' then
    raise exception 'the refused batch introduce partially applied: %', v_stored;
  end if;
  if v_stored -> 'introduce-guard' -> 'external_job' ? 'provider_batch_id' then
    raise exception 'a refused introduce still stored a provider_batch_id: %', v_stored;
  end if;

  -- 10c. Faithful carry-forward that does NOT touch the batch id is untouched, and
  -- so is a brand-new operation created with an id (there is no stored external_job
  -- for it to be the holder of).
  v_out := public.update_bulk_operation(
    'introduce-guard',
    jsonb_build_object(
      'status', 'running',
      'state_revision', 4,
      'progress', jsonb_build_object('done', 5),
      'external_job', jsonb_build_object(
        'phase', 'submitting',
        'run_id', 'run-intro',
        'submission_owner', 'worker-A',
        'lease_expires_at', (now() + interval '5 minutes'))));
  if v_out -> 'introduce-guard' -> 'progress' ->> 'done' <> '5' then
    raise exception 'a faithful legacy write was refused by the introduce rule: %', v_out;
  end if;

  v_out := public.update_bulk_operation(
    'greenfield-op',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'pending', 'provider_batch_id', 'batch_new')));
  if v_out -> 'greenfield-op' -> 'external_job' ->> 'provider_batch_id' <> 'batch_new' then
    raise exception 'creating a brand-new operation with a batch id was refused: %', v_out;
  end if;

  -- 11. None of this touches ordinary callers: a legitimate legacy write on an
  -- unprotected key still succeeds, single and batch.
  v_out := public.update_bulk_operation(
    'plain-op',
    jsonb_build_object('status', 'running', 'progress', jsonb_build_object('done', 11)));
  if v_out -> 'plain-op' -> 'progress' ->> 'done' <> '11' then
    raise exception 'a legitimate legacy write on an unprotected key was refused: %', v_out;
  end if;

  v_out := public.update_bulk_operations_batch(jsonb_build_object(
    'plain-op', jsonb_build_object('status', 'idle')));
  if v_out -> 'plain-op' ->> 'status' <> 'idle' then
    raise exception 'a legitimate legacy batch write on an unprotected key was refused: %', v_out;
  end if;

  -- =================================================================================
  -- 13. THE ROOT OF TRUST IS NOT WRITABLE BY A PATH THAT HOLDS NO PROOF
  --     (Kimi K3 finding F1 -- disqualifying.)
  --
  -- c_lease_fields was enforced in exactly ONE place: the p_submission_owner-is-null
  -- branch of the guarded path. The legacy three-argument path and the batch path
  -- never checked it at all, so external_job.lease_proof -- the md5 digest that
  -- decides who the lease holder is -- was writable by anyone who can call either of
  -- them. The two-call attack, reachable by anyone who can read admin_config:
  --
  --   1. call the legacy (or batch) path with a payload setting lease_proof to
  --      md5('attacker-token'); nothing checks it, so it is stored;
  --   2. call the GUARDED path presenting external_job.lease_token =
  --      'attacker-token'; it verifies against the digest just planted, the caller is
  --      accepted as the holder, and plants a fabricated provider_batch_id.
  --
  -- The real holder's genuine id is then refused as a replacement and the billed
  -- provider job is orphaned -- exactly the failure this migration exists to prevent.
  -- =================================================================================

  -- Worker A takes a real lease and gets the only genuine receipt.
  v_out := public.update_bulk_operation(
    'proof-forgery',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-forge')),
    null,
    0,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true or v_out ->> 'lease_token' is null then
    raise exception 'could not set up the forgery fixture: %', v_out;
  end if;
  if (v_out ->> 'lease_receipt_issued')::boolean is not true then
    raise exception 'a fresh claim did not report that it was issued a receipt: %', v_out;
  end if;
  v_token2 := v_out ->> 'lease_token';

  select value -> 'proof-forgery' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  if v_job ->> 'lease_proof' is distinct from md5(v_token2) then
    raise exception 'the forgery fixture did not store the receipt digest: %', v_job;
  end if;

  -- 13a. ATTACK STEP 1, LEGACY PATH. Everything carried forward faithfully -- same
  -- owner, same lease, same revision, so every pre-existing legacy rule is satisfied
  -- -- except that lease_proof is replaced with the digest of a token the attacker
  -- chose. This MUST raise. Before the fix it was simply stored.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'proof-forgery',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 1,
        'external_job', v_job || jsonb_build_object('lease_proof', md5('attacker-token'))));
  exception when others then
    v_failed := position('lease-controlling external_job field "lease_proof"' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write forged external_job.lease_proof -- the root of trust for the claim receipt is writable by a path that holds no proof';
  end if;

  -- 13b. Same attack through the batch writer: same verdict, and all-or-nothing.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'forgery-sibling', jsonb_build_object('status', 'queued'),
      'proof-forgery',   jsonb_build_object(
        'status', 'running',
        'state_revision', 1,
        'external_job', v_job || jsonb_build_object('lease_proof', md5('attacker-token')))));
  exception when others then
    v_failed := position('lease-controlling external_job field "lease_proof"' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the batch writer forged external_job.lease_proof';
  end if;
  select value into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'forgery-sibling' then
    raise exception 'the refused batch forgery partially applied: %', v_stored;
  end if;

  -- Neither refusal mutated anything: the genuine digest is untouched.
  select value -> 'proof-forgery' -> 'external_job' into v_job2
  from admin_config where key = 'BULK_OPERATIONS';
  if v_job2 ->> 'lease_proof' is distinct from md5(v_token2) then
    raise exception 'a refused forgery still rotated the stored receipt digest: %', v_job2;
  end if;

  -- 13c-i. THE CAPABILITY THE PLANT WOULD HAVE BOUGHT -- PROVEN, NOT ASSERTED.
  --
  -- This step used to forge a token against the UNALTERED digest and observe that it
  -- was refused. That would pass even if 13a were deleted, so it proved nothing about
  -- the two-call attack and left 13a with no demonstrated consequence.
  --
  -- Instead: on a SEPARATE key, simulate what step 1 would have stored if the legacy
  -- path had accepted it, by planting the forged digest with direct SQL -- deliberately
  -- BYPASSING the functions, because the functions are the thing under test. Then run
  -- step 2 exactly as the attacker would. It SUCCEEDS. That is the capability 13a and
  -- 13b are the only things standing between an ordinary caller and.
  update admin_config
     set value = jsonb_set(value, array['forgery-capability'], jsonb_build_object(
           'status', 'running',
           'state_revision', 6,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'submission_owner', 'worker-A',
             'lease_claimed_at', now(),
             'lease_expires_at', (now() + interval '5 minutes'),
             'lease_proof', md5('attacker-token'))))
   where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'forgery-capability',
    jsonb_build_object(
      'status', 'running',
      'external_job', (select value -> 'forgery-capability' -> 'external_job'
                       from admin_config where key = 'BULK_OPERATIONS')
                      || jsonb_build_object(
                           'lease_token', 'attacker-token',
                           'provider_batch_id', 'batch_FORGED')),
    null,
    6);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_FORGED' then
    raise exception
      'the forgery capability test is inert -- a matching planted digest no longer binds a provider job, so 13a/13b prove nothing: %',
      v_out;
  end if;

  -- 13c-ii. AND THE SAME STEP 2 AGAINST THE REAL KEY, WHERE STEP 1 WAS REFUSED, FAILS.
  -- The digest there is still worker-A's, so the attacker's token proves nothing.
  v_out := public.update_bulk_operation(
    'proof-forgery',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job2 || jsonb_build_object(
        'lease_token', 'attacker-token',
        'provider_batch_id', 'batch_FORGED')),
    null,
    1);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a forged claim receipt was accepted as proof of the lease: %', v_out;
  end if;
  select value -> 'proof-forgery' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'provider_batch_id' then
    raise exception 'a forged claim receipt planted a provider_batch_id: %', v_stored;
  end if;

  -- 13d. A LEGACY CALLER THAT ROUND-TRIPS FAITHFULLY IS UNAFFECTED. The rule refuses
  -- a CHANGE to a lease field, never the carry-forward, so an innocent legacy caller
  -- that writes back what it read still works -- lease_proof and lease_claimed_at
  -- included.
  v_out := public.update_bulk_operation(
    'proof-forgery',
    jsonb_build_object(
      'status', 'running',
      'state_revision', 2,
      'progress', jsonb_build_object('done', 13),
      'external_job', v_job2));
  if v_out -> 'proof-forgery' -> 'progress' ->> 'done' <> '13' then
    raise exception 'a faithful legacy round-trip was refused by the lease-field rule: %', v_out;
  end if;

  -- 13e. A legacy caller may not plant a digest on an operation that has none either
  -- -- "as stored" means ABSENT. A digest planted on an unclaimed operation buys the
  -- same fake-provider_batch_id capability as soon as anybody claims it.
  v_out := public.update_bulk_operation(
    'plant-greenfield',
    jsonb_build_object('status', 'running', 'external_job', jsonb_build_object('phase', 'idle')));
  if v_out -> 'plant-greenfield' -> 'external_job' ->> 'phase' <> 'idle' then
    raise exception 'could not set up the greenfield plant fixture: %', v_out;
  end if;
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'plant-greenfield',
      jsonb_build_object(
        'status', 'running',
        'external_job', jsonb_build_object('phase', 'idle', 'lease_proof', md5('attacker-token'))));
  exception when others then
    v_failed := position('lease-controlling external_job field "lease_proof"' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write planted a lease_proof digest on an operation that had none';
  end if;

  -- 13f. And the real holder is untouched by all of it: its receipt still binds the
  -- operation to the real provider job.
  v_out := public.update_bulk_operation(
    'proof-forgery',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job2 || jsonb_build_object(
        'lease_token', v_token2,
        'provider_batch_id', 'batch_REAL')),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_REAL' then
    raise exception 'the genuine receipt no longer binds the real provider job: %', v_out;
  end if;

  -- =================================================================================
  -- 14. A CLAIMING WRITE MAY NOT REWRITE THE AMBIGUITY VERDICT
  --     (Kimi K3 finding F2.)
  --
  -- The claim stamps submission_owner, lease_expires_at, lease_claimed_at and
  -- lease_proof itself, so the payload's versions of those are discarded. The four
  -- ambiguous_* fields were NOT stamped. An ambiguous operation always has a lapsed
  -- lease, so anybody may claim it -- and could carry the required
  -- phase = 'ambiguous_submission' forward while rewriting ambiguous_prior_owner to
  -- itself and ambiguous_reason to noise, destroying the record of who actually held
  -- the lease when a possibly-billed provider job went unrecorded.
  -- =================================================================================
  update admin_config
     set value = jsonb_set(value, array['verdict-guard'], jsonb_build_object(
           'status', 'running',
           'state_revision', 2,
           'external_job', jsonb_build_object(
             'phase', 'submitting',
             'run_id', 'run-verdict',
             'submission_owner', 'worker-A',
             'lease_expires_at', (now() - interval '30 seconds'))))
   where key = 'BULK_OPERATIONS';

  -- The guarded path records the verdict itself, from stored state.
  v_out := public.update_bulk_operation(
    'verdict-guard',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-verdict')),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'ambiguous_submission' then
    raise exception 'could not set up the verdict fixture: %', v_out;
  end if;

  select value -> 'verdict-guard' -> 'external_job' into v_job2
  from admin_config where key = 'BULK_OPERATIONS';
  if v_job2 ->> 'ambiguous_prior_owner' <> 'worker-A' then
    raise exception 'the verdict fixture did not record the prior owner: %', v_job2;
  end if;

  -- 14a. THE ATTACK: claim the (lapsed) lease and rewrite the verdict on the way.
  v_out := public.update_bulk_operation(
    'verdict-guard',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job2 || jsonb_build_object(
        'ambiguous_prior_owner', 'worker-B',
        'ambiguous_reason', 'nothing to see here')),
    null,
    3,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'lease_fields_immutable' then
    raise exception 'a claiming write rewrote the ambiguity verdict: %', v_out;
  end if;
  select value -> 'verdict-guard' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'ambiguous_prior_owner' <> 'worker-A'
     or v_stored ->> 'ambiguous_reason' <> 'submission_lease_expired_without_provider_batch_id' then
    raise exception 'a refused verdict rewrite still mutated stored state: %', v_stored;
  end if;

  -- 14b. A claim that carries the verdict forward faithfully is still allowed --
  -- this is how a reconciling worker takes the operation over.
  v_out := public.update_bulk_operation(
    'verdict-guard',
    jsonb_build_object('status', 'running', 'external_job', v_job2),
    null,
    3,
    'worker-B',
    120);
  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'a faithful reconciling claim was refused: %', v_out;
  end if;
  if (v_out ->> 'lease_receipt_issued')::boolean is not true then
    raise exception 'a claim over an unclaimed digest was not issued a receipt: %', v_out;
  end if;

  -- =================================================================================
  -- 15. THE SAME-NAME RENEWAL TRAP IS SIGNALLED, NOT SILENT
  --     (Kimi K3 finding F3.)
  --
  -- A renewal over a still-LIVE lease by a process sharing the holder's owner name
  -- SUCCEEDS and extends the lease, but it is not the holder and never becomes one.
  -- That is deliberate -- re-minting would hand a receipt to anyone who repeats the
  -- publicly readable owner name -- but "ok = true and no receipt" must be readable
  -- as such, so the envelope says so in its own field rather than leaving the caller
  -- to infer it from a null token.
  -- =================================================================================
  v_out := public.update_bulk_operation(
    'renewal-trap',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-renew')),
    null,
    0,
    'shared-name',
    300);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'lease_receipt_issued')::boolean is not true then
    raise exception 'could not set up the renewal-trap fixture: %', v_out;
  end if;
  v_token2 := v_out ->> 'lease_token';

  select value -> 'renewal-trap' -> 'external_job' into v_job2
  from admin_config where key = 'BULK_OPERATIONS';

  -- The twin renews under the same name over the LIVE lease.
  v_out := public.update_bulk_operation(
    'renewal-trap',
    jsonb_build_object('status', 'running', 'external_job', v_job2),
    null,
    1,
    'shared-name',
    300);
  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'a same-name renewal over a live lease was refused: %', v_out;
  end if;
  if (v_out ->> 'lease_receipt_issued')::boolean is not false then
    raise exception 'a same-name renewal claimed to have been issued a receipt: %', v_out;
  end if;
  if v_out ->> 'lease_token' is not null then
    raise exception 'a same-name renewal was handed a claim receipt: %', v_out;
  end if;

  -- The incumbent receipt is intact, and it -- not the renewal -- is what makes a
  -- caller the holder.
  select value -> 'renewal-trap' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'lease_proof' is distinct from md5(v_token2) then
    raise exception 'a same-name renewal rotated the incumbent receipt: %', v_stored;
  end if;

  -- The renewer cannot bind a provider job (it holds no receipt) ...
  v_out := public.update_bulk_operation(
    'renewal-trap',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_stored || jsonb_build_object('provider_batch_id', 'batch_TWIN')),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a same-name renewer bound a provider job without a receipt: %', v_out;
  end if;

  -- ... while the real holder still can.
  v_out := public.update_bulk_operation(
    'renewal-trap',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_stored || jsonb_build_object(
        'lease_token', v_token2,
        'provider_batch_id', 'batch_HOLDER')),
    null,
    2);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_HOLDER' then
    raise exception 'the incumbent holder lost its receipt to a same-name renewal: %', v_out;
  end if;

  -- =================================================================================
  -- 16. DESTROY-AND-REMINT VIA phase (Grok 4.6 sequence 177, finding 1 -- HIGH)
  --
  -- Every earlier round froze the field the reviewer named and left the field the
  -- guard was COMPUTED from writable. Round 4 froze the eight lease fields; drop
  -- protection is computed from external_job.phase, and phase was not one of them.
  --
  -- The attack, in three ordinary calls and no forgery at all:
  --   1. on a path that holds no receipt (legacy, batch, or a same-name claim), move
  --      phase off its live value. Everything else is carried forward faithfully, so
  --      every other rule of round 4 is satisfied;
  --   2. the operation no longer looks protected, so drop external_job outright;
  --   3. claim the now-clean operation: a fresh receipt is minted, and with it a
  --      provider_batch_id of the caller's invention. The real holder's genuine id is
  --      afterwards refused as a replacement and the billed job is orphaned.
  --
  -- Round 4 had NO test that changed phase on a no-receipt path and then dropped
  -- external_job. That is why this survived three repair rounds of "we tested the
  -- named field". Step 1 is now refused on every path that holds no receipt.
  -- =================================================================================
  v_out := public.update_bulk_operation(
    'phase-pointer',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-phase')),
    null,
    0,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true or v_out ->> 'lease_token' is null then
    raise exception 'could not set up the phase-pointer fixture: %', v_out;
  end if;
  v_token3 := v_out ->> 'lease_token';

  select value -> 'phase-pointer' -> 'external_job' into v_job3
  from admin_config where key = 'BULK_OPERATIONS';

  -- 16a. STEP 1 ON THE LEGACY PATH. Faithful in every field except phase.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'phase-pointer',
      jsonb_build_object(
        'status', 'running',
        'state_revision', 1,
        'external_job', v_job3 || jsonb_build_object('phase', 'idle')));
  exception when others then
    v_failed := position('would move the external_job phase of a protected job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'a legacy write moved the phase of a pointer-bearing job -- the drop protection is computed from that phase, so it can now be destroyed and reminted';
  end if;

  -- 16b. STEP 1 ON THE BATCH PATH: same verdict, and all-or-nothing.
  v_failed := false;
  begin
    perform public.update_bulk_operations_batch(jsonb_build_object(
      'phase-sibling',  jsonb_build_object('status', 'queued'),
      'phase-pointer',  jsonb_build_object(
        'status', 'running',
        'state_revision', 1,
        'external_job', v_job3 || jsonb_build_object('phase', 'idle'))));
  exception when others then
    v_failed := position('would move the external_job phase of a protected job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'the batch writer moved the phase of a pointer-bearing job';
  end if;
  select value into v_stored from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'phase-sibling' then
    raise exception 'the refused batch phase move partially applied: %', v_stored;
  end if;

  -- 16c. STEP 1 ON A SAME-NAME CLAIM. Repeating the publicly readable owner name over
  -- a LIVE lease claims successfully (the renewal trap, section 15) -- so the claim
  -- itself must not carry the power to move the phase, or the trap is the attack.
  v_out := public.update_bulk_operation(
    'phase-pointer',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job3 || jsonb_build_object('phase', 'idle')),
    null,
    1,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'phase_protected' then
    raise exception 'a same-name claiming write moved the phase of a pointer-bearing job: %', v_out;
  end if;

  -- Nothing above mutated anything, so STEP 2 still meets a protected operation.
  select value -> 'phase-pointer' -> 'external_job' into v_job2
  from admin_config where key = 'BULK_OPERATIONS';
  if v_job2 ->> 'phase' <> 'submitting' then
    raise exception 'a refused phase move still moved the phase: %', v_job2;
  end if;
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'phase-pointer', jsonb_build_object('status', 'idle'));
  exception when others then
    v_failed := position('would drop a protected external_job' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'step 2 of the destroy-and-remint attack succeeded: the pointer was dropped';
  end if;

  -- 16d. A MINTING TAKEOVER MAY NOT MOVE IT EITHER. A bound operation whose lease has
  -- lapsed may be taken over by a new worker, and that takeover DOES mint a receipt
  -- (nothing is left to invent -- the binding is already made and immutable). It still
  -- is not the holder of the job it is walking into, so it may not move the phase.
  update admin_config
     set value = jsonb_set(value, array['phase-takeover'], jsonb_build_object(
           'status', 'running',
           'state_revision', 3,
           'external_job', jsonb_build_object(
             'phase', 'pending',
             'provider_batch_id', 'batch_bound',
             'submission_owner', 'worker-A',
             'lease_claimed_at', (now() - interval '10 minutes'),
             'lease_expires_at', (now() - interval '30 seconds'),
             'lease_proof', md5('worker-A-receipt'))))
   where key = 'BULK_OPERATIONS';

  select value -> 'phase-takeover' -> 'external_job' into v_job2
  from admin_config where key = 'BULK_OPERATIONS';

  v_out := public.update_bulk_operation(
    'phase-takeover',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job2 || jsonb_build_object('phase', 'idle')),
    null,
    3,
    'worker-B',
    300);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'phase_protected' then
    raise exception 'a minting takeover moved the phase of a bound job: %', v_out;
  end if;

  -- The same takeover carrying the phase forward is still allowed, and is issued a
  -- receipt -- the rule refuses the phase MOVE, never the takeover.
  v_out := public.update_bulk_operation(
    'phase-takeover',
    jsonb_build_object('status', 'running', 'external_job', v_job2),
    null,
    3,
    'worker-B',
    300);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'lease_receipt_issued')::boolean is not true then
    raise exception 'a takeover of a BOUND operation was refused or denied a receipt: %', v_out;
  end if;

  -- 16e. AND THE REAL HOLDER MOVES THE PHASE NORMALLY, WITH ITS RECEIPT. This is the
  -- rule working, not a wall: the worker driving the job advances it as always.
  select value -> 'phase-pointer' -> 'external_job' into v_job3
  from admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation(
    'phase-pointer',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_job3 || jsonb_build_object(
        'lease_token', v_token3,
        'phase', 'applying')),
    null,
    1);
  if (v_out ->> 'ok')::boolean is not true or v_out ->> 'external_job_phase' <> 'applying' then
    raise exception 'the genuine lease holder could not advance its own phase: %', v_out;
  end if;

  -- =================================================================================
  -- 17. REMINT THROUGH THE AMBIGUITY DOOR (Grok 4.6 sequence 177, finding 2 -- HIGH)
  --
  -- Round 4 argued that a lapsed lease with no saved provider_batch_id never reaches
  -- the mint, because the ambiguity rule intercepts it. That is true on the FIRST
  -- write only:
  --
  --   lapsed, no batch id, NOT yet ambiguous  -> intercepted, correctly refused
  --   lapsed, no batch id, ALREADY ambiguous  -> walks straight through
  --
  -- So call one trips the intercept and marks the operation ambiguous, and call two
  -- claims the now-ambiguous operation and re-mints. The new receipt matches the
  -- caller's token, so it may bind a provider_batch_id it invented, and the real
  -- holder's genuine id is afterwards refused as a replacement. `authenticated` holds
  -- execute on these functions, so "reconciliation" was any signed-in caller and there
  -- was no human anywhere in that loop.
  --
  -- THE FIX (chosen over inventing a separate reconcile operation, which would be a
  -- new object outside claim #1174 and would still need a proof of its own): while an
  -- operation has NO saved provider_batch_id, the receipt minted when its lease was
  -- first taken is never reissued. A later claim still succeeds as a lease extension,
  -- so ordinary retry traffic is untouched, but it is handed no receipt and therefore
  -- can never bind. The original receipt stays the only binder.
  -- =================================================================================
  v_out := public.update_bulk_operation(
    'remint-door',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-remint')),
    null,
    0,
    'worker-A',
    300);
  if (v_out ->> 'ok')::boolean is not true or v_out ->> 'lease_token' is null then
    raise exception 'could not set up the remint-door fixture: %', v_out;
  end if;
  v_token3 := v_out ->> 'lease_token';

  -- Worker A crashes mid-POST: the lease lapses with nothing saved. (Direct SQL only
  -- because the test transaction cannot wait for a clock.)
  update admin_config
     set value = jsonb_set(
           value,
           array['remint-door', 'external_job', 'lease_expires_at'],
           to_jsonb((now() - interval '30 seconds')::timestamptz))
   where key = 'BULK_OPERATIONS';

  -- CALL ONE: the intercept fires and makes the ambiguity durable.
  v_out := public.update_bulk_operation(
    'remint-door',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_build_object('phase', 'submitting', 'run_id', 'run-remint')),
    null,
    1);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'ambiguous_submission' then
    raise exception 'the ambiguity intercept did not fire on call one: %', v_out;
  end if;

  select value -> 'remint-door' -> 'external_job' into v_job3
  from admin_config where key = 'BULK_OPERATIONS';

  -- CALL TWO: the same caller comes straight back and claims the now-ambiguous
  -- operation. It MAY extend the lease. It MUST NOT be handed a receipt.
  v_out := public.update_bulk_operation(
    'remint-door',
    jsonb_build_object('status', 'running', 'external_job', v_job3),
    null,
    2,
    'worker-B',
    300);
  if (v_out ->> 'ok')::boolean is not true then
    raise exception 'a claim over an ambiguous operation was refused outright: %', v_out;
  end if;
  if (v_out ->> 'lease_receipt_issued')::boolean is not false
     or v_out ->> 'lease_token' is not null then
    raise exception
      'a second call through the ambiguity door was re-minted a claim receipt -- it can now bind an invented provider_batch_id: %',
      v_out;
  end if;

  select value -> 'remint-door' -> 'external_job' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ->> 'lease_proof' is distinct from md5(v_token3) then
    raise exception 'the ambiguity claim rotated the original holder''s receipt digest: %', v_stored;
  end if;

  -- And with no receipt it cannot invent a binding, which is the whole point.
  v_out := public.update_bulk_operation(
    'remint-door',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_stored || jsonb_build_object('provider_batch_id', 'batch_INVENTED')),
    null,
    3);
  if (v_out ->> 'ok')::boolean is not false or v_out ->> 'reason' <> 'external_job_protected' then
    raise exception 'a caller that walked through the ambiguity door bound an invented provider job: %', v_out;
  end if;

  -- The original holder -- the only party that can know whether the provider was
  -- actually billed -- still resolves it with the receipt it was issued.
  v_out := public.update_bulk_operation(
    'remint-door',
    jsonb_build_object(
      'status', 'running',
      'external_job', v_stored || jsonb_build_object(
        'lease_token', v_token3,
        'provider_batch_id', 'batch_REAL_AFTER_AMBIGUITY')),
    null,
    3);
  if (v_out ->> 'ok')::boolean is not true
     or v_out ->> 'provider_batch_id' <> 'batch_REAL_AFTER_AMBIGUITY' then
    raise exception 'the original receipt no longer resolves the ambiguity it was minted for: %', v_out;
  end if;

  -- =================================================================================
  -- 18. RECEIPT-PROVEN TERMINAL CLEAR (issue #1211)
  -- =================================================================================
  -- A legacy completed job can be bound without any receipt digest. A later claim
  -- must not mint its first receipt: doing so would grant terminal-clear authority
  -- to whichever authenticated process arrived first.
  update admin_config
     set value = jsonb_set(value, array['terminal-clear-legacy'], jsonb_build_object(
           'status', 'completed',
           'state_revision', 3,
           'external_job', jsonb_build_object(
             'phase', 'completed',
             'run_id', 'run-terminal-clear-legacy',
             'provider_batch_id', 'batch_terminal_clear_legacy')))
   where key = 'BULK_OPERATIONS';
  select value -> 'terminal-clear-legacy' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation(
    'terminal-clear-legacy',
    jsonb_build_object(
      'status', 'running',
      'external_job', jsonb_set(v_job, array['phase'], to_jsonb('pending'::text))),
    null,
    3,
    'legacy-phase-takeover',
    1);
  if (v_out ->> 'ok')::boolean is not false
     or v_out ->> 'reason' <> 'phase_protected' then
    raise exception 'a proof-less legacy completed job moved back to a live phase: %', v_out;
  end if;
  select value -> 'terminal-clear-legacy' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'phase' <> 'completed'
     or (v_stored ->> 'state_revision')::bigint <> 3
     or v_stored -> 'external_job' ->> 'lease_proof' is not null then
    raise exception 'a refused legacy phase takeover mutated the completed job: %', v_stored;
  end if;
  v_job := v_stored -> 'external_job';

  v_out := public.update_bulk_operation(
    'terminal-clear-legacy',
    jsonb_build_object('status', 'completed', 'external_job', v_job),
    null,
    3,
    'legacy-takeover',
    120);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'lease_receipt_issued')::boolean is not false
     or v_out ->> 'lease_token' is not null then
    raise exception 'a proof-less legacy completed job minted terminal-clear authority: %', v_out;
  end if;
  select value -> 'terminal-clear-legacy' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'lease_proof' is not null then
    raise exception 'a proof-less legacy completed job gained a receipt digest: %', v_stored;
  end if;

  update admin_config
     set value = jsonb_set(value, array['terminal-clear'], jsonb_build_object(
           'status', 'completed',
           'state_revision', 7,
           'external_job', jsonb_build_object(
             'phase', 'completed',
             'run_id', 'run-terminal-clear',
             'provider_batch_id', 'batch_terminal_clear',
             'submission_owner', 'worker-terminal',
             'lease_claimed_at', now(),
             'lease_expires_at', now() - interval '1 second',
             'lease_proof', md5('terminal-clear-receipt'))))
   where key = 'BULK_OPERATIONS';

  select value -> 'terminal-clear' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  v_job := v_stored -> 'external_job';

  -- A completed job's lapsed lease must not let another signed-in process mint
  -- the receipt needed by the terminal-clear exit. The original receipt remains
  -- the only authority that can clear this durable provider-job pointer.
  v_out := public.update_bulk_operation(
    'terminal-clear',
    jsonb_build_object('status', 'completed', 'external_job', v_job),
    null,
    7,
    'takeover-after-completion',
    120);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'lease_receipt_issued')::boolean is not false
     or v_out ->> 'lease_token' is not null then
    raise exception 'a completed-job takeover was handed terminal-clear authority: %', v_out;
  end if;
  select value -> 'terminal-clear' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored -> 'external_job' ->> 'lease_proof' is distinct from md5('terminal-clear-receipt')
     or (v_stored ->> 'state_revision')::bigint <> 8 then
    raise exception 'a completed-job takeover rotated the original receipt or revision unexpectedly: %', v_stored;
  end if;
  v_job := v_stored -> 'external_job';

  -- Wrong provider identity is an error, not a false-success envelope, and the
  -- exact stored operation survives the refusal.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'terminal-clear',
      jsonb_build_object(
        'status', 'completed',
        'external_job', v_job || jsonb_build_object(
          'provider_batch_id', 'batch_wrong',
          'lease_token', 'terminal-clear-receipt',
          'clear_after_reconciliation', true)),
      null,
      8);
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a terminal clear with the wrong provider_batch_id did not raise 55000';
  end if;
  select value -> 'terminal-clear' into v_out
  from admin_config where key = 'BULK_OPERATIONS';
  if v_out is distinct from v_stored then
    raise exception 'a refused provider-id mismatch mutated the operation: %', v_out;
  end if;

  -- Wrong receipt and stale revision are independently fail-closed.
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'terminal-clear',
      jsonb_build_object(
        'status', 'completed',
        'external_job', v_job || jsonb_build_object(
          'lease_token', 'wrong-receipt',
          'clear_after_reconciliation', true)),
      null,
      8);
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a terminal clear with the wrong receipt did not raise 55000';
  end if;

  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'terminal-clear',
      jsonb_build_object(
        'status', 'completed',
        'external_job', v_job || jsonb_build_object(
          'lease_token', 'terminal-clear-receipt',
          'clear_after_reconciliation', true)),
      null,
      7);
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a terminal clear with a stale revision did not raise 55000';
  end if;

  -- A live/nonterminal provider job cannot use the exit even with its real receipt.
  update admin_config
     set value = jsonb_set(
       value,
       array['terminal-clear', 'external_job', 'phase'],
       to_jsonb('applying'::text))
   where key = 'BULK_OPERATIONS';
  select value -> 'terminal-clear' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  v_job := v_stored -> 'external_job';
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'terminal-clear',
      jsonb_build_object(
        'status', 'running',
        'external_job', v_job || jsonb_build_object(
          'lease_token', 'terminal-clear-receipt',
          'clear_after_reconciliation', true)),
      null,
      8);
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a nonterminal provider job used the terminal-clear exit';
  end if;

  -- Ambiguity stays terminal even when every readable identity field and receipt
  -- matches. This contract is intentionally not an ambiguity-reconciliation API.
  update admin_config
     set value = jsonb_set(
       value,
       array['terminal-clear', 'external_job', 'phase'],
       to_jsonb('ambiguous_submission'::text))
   where key = 'BULK_OPERATIONS';
  select value -> 'terminal-clear' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  v_job := v_stored -> 'external_job';
  v_failed := false;
  begin
    perform public.update_bulk_operation(
      'terminal-clear',
      jsonb_build_object(
        'status', 'completed',
        'external_job', v_job || jsonb_build_object(
          'lease_token', 'terminal-clear-receipt',
          'clear_after_reconciliation', true)),
      null,
      8);
  exception when sqlstate '55000' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an ambiguous provider job used the terminal-clear exit';
  end if;

  -- Restore the proven completed fixture and exercise the one allowed clear.
  update admin_config
     set value = jsonb_set(
       value,
       array['terminal-clear', 'external_job', 'phase'],
       to_jsonb('completed'::text))
   where key = 'BULK_OPERATIONS';
  select value -> 'terminal-clear' -> 'external_job' into v_job
  from admin_config where key = 'BULK_OPERATIONS';
  v_out := public.update_bulk_operation(
    'terminal-clear',
    jsonb_build_object(
      'status', 'completed',
      'external_job', v_job || jsonb_build_object(
        'lease_token', 'terminal-clear-receipt',
        'clear_after_reconciliation', true)),
    null,
    8);
  if (v_out ->> 'ok')::boolean is not true
     or (v_out ->> 'state_revision')::bigint <> 9
     or v_out -> 'operation' ? 'external_job'
     or v_out ->> 'provider_batch_id' is not null then
    raise exception 'the exact receipt-proven completed clear did not succeed cleanly: %', v_out;
  end if;
  select value -> 'terminal-clear' into v_stored
  from admin_config where key = 'BULK_OPERATIONS';
  if v_stored ? 'external_job' or (v_stored ->> 'state_revision')::bigint <> 9 then
    raise exception 'the proven clear did not remove only external_job and advance the revision: %', v_stored;
  end if;

  if to_regprocedure('public.update_bulk_operation(text,jsonb,text,bigint,text,integer)') is null then
    raise exception 'public.update_bulk_operation disappeared after migration replay';
  end if;

  raise notice 'popdam_bulk_operation_revision_lease_contracts: all assertions held';
end $$;

rollback;
