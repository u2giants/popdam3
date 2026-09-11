-- #2067: minimum additive, privacy-protected HTS RAG comparison and raw-response
-- audit contract for DesignFlow backend plan Steps 4 and 6 (popcre/designflow-backend#79).
--
-- WHAT THIS ADDS, AND WHY EACH PIECE IS STRUCTURE RATHER THAN APPLICATION CODE.
--
--  1. IMMUTABLE COMPARISON TAXONOMY + COMPLETION IDEMPOTENCY on
--     public.hts_rag_determinations. The table could already record a comparison_key
--     and a review state, but not WHAT the comparison concluded, and it had no
--     identity for the classification session or for the single completion write.
--     Without a database-side unique completion key, a retried completion produces a
--     second determination row and the shadow comparison silently double-counts.
--     Immutability is NOT re-stated as a policy here: it is already enforced by the
--     grant set from 20260901011306 -- service_role holds SELECT, INSERT and a
--     column-scoped UPDATE on comparison_review_state ALONE. Every column added below
--     is therefore append-only from the moment it exists, and the verification block
--     at the end fails the apply if that ceiling ever moves.
--
--  2. DURABLE RAW EXTRACTION + PARSE/ENRICHMENT STATE on
--     public.hts_rag_extraction_jobs. The job row stored an input hash, a result hash
--     and an error code -- hashes prove identity but cannot be re-parsed, so a parser
--     defect found later had nothing to re-run against. raw_extraction stores the
--     structured extraction itself and parse_state records what has been made of it.
--
--  3. BOUNDED RETRY / DEAD LETTER on the same table. attempt_count existed with no
--     ceiling and no terminal record, so an exhausted job was indistinguishable from a
--     slow one. max_attempts, dead_lettered_at, dead_letter_reason and review_needed
--     make exhaustion a state the database can express and a sweep can find.
--
--  4. ORDERED MULTI-TURN PROVIDER RESPONSES, public.hts_rag_provider_responses. Step 6
--     requires that every provider turn -- legacy AI/CROSS included -- is durable
--     BEFORE the HTTP response is released, and that the turns of one session are
--     recoverable in order. That is a new canonical artifact; it cannot be a column on
--     an existing row because there are many turns per determination.
--
-- PRIVACY. hts_rag_provider_responses is SERVICE-ONLY: no grant to anon or
-- authenticated, and therefore no read policy for either. A raw provider artifact is
-- the one place a customer's own product description can appear verbatim, so it is
-- reachable only by the backend role that wrote it. Authorized ADMIN review continues
-- to run on hts_rag_determinations, whose added columns are a bounded taxonomy and a
-- structured, non-prose details object. Nothing here is written to a log or to public
-- evidence.
--
-- WHY THERE IS NO hts_rag_provider_responses_backend_read POLICY. The claim for this
-- work reserved that name alongside hts_rag_provider_responses_backend_all. Postgres
-- cannot express INSERT-and-UPDATE in one policy, so the write path must be FOR ALL --
-- and FOR ALL already covers SELECT for the same role. A second FOR SELECT policy would
-- add no capability and impose no restriction: it would be dead surface that a later
-- reader could mistake for a control. The real ceiling is the GRANT set, which is
-- asserted precisely below and in supabase/tests/hts_rag_audit_contract.sql.
--
-- SAFETY. Additive only: no column is dropped, no type narrowed, no existing assertion
-- weakened. Legacy AI/CROSS stays operative, shadow mode stays mandatory, auto-recommend
-- stays off, and nothing here is or feeds a duty-rate source.

-- ---------------------------------------------------------------------------
-- 1. Determinations: comparison taxonomy, session identity, completion idempotency.
-- ---------------------------------------------------------------------------

alter table public.hts_rag_determinations
  add column comparison_category text not null default 'not_compared',
  add column comparison_details jsonb not null default '{}'::jsonb,
  add column session_id uuid,
  add column completion_key text;

alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_comparison_category_chk
  check (comparison_category in ('not_compared','agree','agree_at_heading','disagree','incomparable'));

alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_comparison_details_chk
  check (jsonb_typeof(comparison_details) = 'object');

-- A completion token that is present but blank is not an idempotency key.
alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_completion_key_chk
  check (completion_key is null or btrim(completion_key) <> '');

-- A completion must be attributable to the session that produced it, otherwise the
-- idempotency key names an event nobody can locate.
alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_completion_session_chk
  check (completion_key is null or session_id is not null);

-- The completion write happens at most once. Nulls are distinct, so rows written
-- before this contract, and rows that are not completions, are unaffected.
alter table public.hts_rag_determinations
  add constraint hts_rag_determinations_completion_key_uq unique (completion_key);

-- DELIBERATELY NOT CONSTRAINED: the relationship between comparison_category and this
-- row's own proposed_hts. 'incomparable' can be caused by the OTHER side of the pair
-- having no code, so a check tying the category to this row's proposed_hts would be
-- false in exactly the case it claims to police.

create index hts_rag_determinations_comparison_category_idx
  on public.hts_rag_determinations (comparison_category, created_at desc);

comment on column public.hts_rag_determinations.comparison_category is
  'Immutable shadow-comparison outcome. Bounded taxonomy only: no free text, and never a customer description.';
comment on column public.hts_rag_determinations.comparison_details is
  'Structured, non-prose comparison detail (differing digits, which side was incomplete). Must not carry customer-supplied text.';
comment on column public.hts_rag_determinations.completion_key is
  'Idempotency token for the single completion write of this determination. Unique across the table.';

-- ---------------------------------------------------------------------------
-- 2 and 3. Extraction jobs: durable raw artifact, parse state, bounded retry,
--          dead-letter and review-needed visibility.
-- ---------------------------------------------------------------------------

alter table public.hts_rag_extraction_jobs
  add column raw_extraction jsonb,
  add column parse_state text not null default 'unparsed',
  add column parse_error_code text,
  add column max_attempts integer not null default 3,
  add column dead_lettered_at timestamptz,
  add column dead_letter_reason text,
  add column review_needed boolean not null default false;

-- Backfill BEFORE the exhaustion constraint is added. An existing in-flight row whose
-- attempt_count already reached the new default would otherwise fail the apply, and a
-- migration that aborts on live data is not additive in any useful sense.
update public.hts_rag_extraction_jobs
   set max_attempts = attempt_count + 1
 where attempt_count >= max_attempts;

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_parse_state_chk
  check (parse_state in ('unparsed','parsed','unparseable','enriched'));

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_raw_extraction_chk
  check (raw_extraction is null or jsonb_typeof(raw_extraction) = 'object');

-- Nothing can be parsed, enriched, or declared unparseable without an artifact.
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_parse_artifact_chk
  check (parse_state = 'unparsed' or raw_extraction is not null);

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_parse_error_chk
  check (parse_state <> 'unparseable' or btrim(coalesce(parse_error_code,'')) <> '');

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_max_attempts_chk
  check (max_attempts >= 1);

-- Bounded retry. A job that has spent its budget cannot still be waiting to run: it is
-- either finished or dead-lettered. This is the invariant that makes an exhausted job
-- findable instead of merely old.
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_retry_budget_chk
  check (attempt_count < max_attempts or status in ('succeeded','failed','cancelled'));

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_dead_letter_pair_chk
  check ((dead_lettered_at is null) = (dead_letter_reason is null));

alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_dead_letter_reason_chk
  check (dead_letter_reason is null or btrim(dead_letter_reason) <> '');

-- A dead letter is a terminal record. A pending or running job is not dead.
alter table public.hts_rag_extraction_jobs
  add constraint hts_rag_extraction_jobs_dead_letter_terminal_chk
  check (dead_lettered_at is null or status in ('failed','cancelled'));

comment on column public.hts_rag_extraction_jobs.raw_extraction is
  'Durable structured extraction artifact. Structured facts only -- never the customer-supplied description text.';
comment on column public.hts_rag_extraction_jobs.max_attempts is
  'Retry ceiling. attempt_count may not reach it while the job is still pending or running.';
comment on column public.hts_rag_extraction_jobs.dead_lettered_at is
  'Set only on a terminal job whose retry budget or parse pipeline was exhausted. Paired with dead_letter_reason.';

-- ---------------------------------------------------------------------------
-- 4. Ordered multi-turn provider responses, persisted before HTTP release.
-- ---------------------------------------------------------------------------

create table public.hts_rag_provider_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  turn_index integer not null check (turn_index >= 0),
  turn_role text not null check (turn_role in ('extractor','classifier','verifier','legacy_ai_cross')),
  determination_id uuid references public.hts_rag_determinations(id) on delete restrict,
  extraction_job_id uuid references public.hts_rag_extraction_jobs(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  model_version text not null check (btrim(model_version) <> ''),
  prompt_version text not null check (btrim(prompt_version) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  raw_response jsonb not null check (jsonb_typeof(raw_response) = 'object'),
  raw_response_hash text not null check (raw_response_hash ~ '^[0-9a-f]{64}$'),
  parse_state text not null default 'unparsed' check (parse_state in ('unparsed','parsed','unparseable','enriched')),
  parsed_payload jsonb check (parsed_payload is null or jsonb_typeof(parsed_payload) = 'object'),
  parse_error_code text,
  enrichment_state text not null default 'none' check (enrichment_state in ('none','pending','enriched','failed')),
  persisted_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  -- The turn must be attributable to something. A response linked to neither a
  -- determination nor an extraction job is an artifact of no known request.
  constraint hts_rag_provider_responses_subject_chk
    check (determination_id is not null or extraction_job_id is not null),
  -- Ordered multi-turn linkage: one row per role per turn within a session.
  constraint hts_rag_provider_responses_turn_uq unique (session_id, turn_role, turn_index),
  -- Persist-before-release. The row exists from the INSERT; the release stamp can
  -- never predate the persist stamp, so a released turn always has a durable artifact
  -- recorded no later than the moment the caller saw the answer.
  constraint hts_rag_provider_responses_release_order_chk
    check (released_at is null or released_at >= persisted_at),
  constraint hts_rag_provider_responses_parse_error_chk
    check (parse_state <> 'unparseable' or btrim(coalesce(parse_error_code,'')) <> ''),
  constraint hts_rag_provider_responses_parsed_payload_chk
    check (parse_state not in ('parsed','enriched') or parsed_payload is not null),
  constraint hts_rag_provider_responses_enrichment_chk
    check (enrichment_state <> 'enriched' or parse_state = 'enriched')
);

create index hts_rag_provider_responses_determination_idx
  on public.hts_rag_provider_responses (determination_id, turn_index)
  where determination_id is not null;

alter table public.hts_rag_provider_responses enable row level security;

revoke all on public.hts_rag_provider_responses from anon, authenticated, service_role;
grant select, insert on public.hts_rag_provider_responses to service_role;
-- The raw artifact and its identity are immutable. Only the parse/enrichment
-- interpretation and the release stamp may ever change, and only column by column.
grant update (parse_state, parsed_payload, parse_error_code, enrichment_state, released_at)
  on public.hts_rag_provider_responses to service_role;

create policy hts_rag_provider_responses_backend_all
  on public.hts_rag_provider_responses for all to service_role using (true) with check (true);

comment on table public.hts_rag_provider_responses is
  'Ordered, durable multi-turn provider artifacts persisted before the HTTP response is released. SERVICE-ONLY by design: a raw provider payload is the one place a customer description can appear verbatim, so neither anon nor authenticated holds any grant and neither has a policy. Authorized admin review runs on hts_rag_determinations instead.';
comment on column public.hts_rag_provider_responses.released_at is
  'When the HTTP response carrying this turn was released. Never earlier than persisted_at.';

-- ---------------------------------------------------------------------------
-- 5. Post-apply verification. This block FAILS THE APPLY if the security posture
--    regresses. It is not documentation: every raise below is a condition that has
--    to be false for this contract to mean anything.
-- ---------------------------------------------------------------------------

do $verify$
declare
  v_count integer;
  v_cols text;
begin
  -- Row level security must be ENABLED on the new table. Policies on a table with RLS
  -- off are inert, and every other assertion here would still pass.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'hts_rag_provider_responses' and c.relrowsecurity) then
    raise exception 'row level security is not enabled on public.hts_rag_provider_responses';
  end if;

  -- No browser path at all, on any privilege, including a grant to PUBLIC.
  -- information_schema.role_table_grants CANNOT see a PUBLIC grantee, so read the ACL
  -- out of pg_class instead.
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname = 'public' and c.relname = 'hts_rag_provider_responses'
       and (a.grantee = 0
            or a.grantee = (select oid from pg_roles where rolname = 'anon')
            or a.grantee = (select oid from pg_roles where rolname = 'authenticated'))) then
    raise exception 'anon, authenticated or PUBLIC holds a grant on public.hts_rag_provider_responses';
  end if;

  -- Service-only WRITES, bounded. No DELETE, no TRUNCATE, no table-wide UPDATE.
  -- GRANTEE-SCOPED on purpose: information_schema reports the owner's own implicit
  -- privileges as grants, so an unscoped form fails on every correctly built table.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'hts_rag_provider_responses'
       and grantee in ('service_role','authenticated','anon','PUBLIC')
       and privilege_type in ('UPDATE','DELETE','TRUNCATE')) then
    raise exception 'public.hts_rag_provider_responses received a table-wide mutation grant';
  end if;

  select string_agg(column_name, ',' order by column_name) into v_cols
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'hts_rag_provider_responses'
     and grantee = 'service_role' and privilege_type = 'UPDATE';
  if coalesce(v_cols, '') <> 'enrichment_state,parse_error_code,parse_state,parsed_payload,released_at' then
    raise exception 'the updatable provider-response columns are not the five interpretation columns, got %', coalesce(v_cols, '<none>');
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'hts_rag_provider_responses'
       and grantee = 'service_role' and privilege_type in ('SELECT','INSERT')
     having count(distinct privilege_type) = 2) then
    raise exception 'service_role cannot both read and append provider responses';
  end if;

  -- The determination immutability ceiling this contract relies on must not have moved.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'hts_rag_determinations'
       and grantee in ('service_role','authenticated','anon','PUBLIC')
       and privilege_type in ('UPDATE','DELETE','TRUNCATE')) then
    raise exception 'hts_rag_determinations received a table-wide mutation grant, so the new comparison columns are not immutable';
  end if;
  select count(*) into v_count from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'hts_rag_determinations'
     and grantee = 'service_role' and privilege_type = 'UPDATE';
  if v_count <> 1 then
    raise exception 'expected exactly one updatable determination column, got %', v_count;
  end if;

  -- Authorized admin review must still work on determinations, and must still be
  -- gated by a real role test rather than a predicate loosened to true.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'hts_rag_determinations'
       and cmd in ('SELECT','ALL') and 'authenticated' = any(roles)
       and position('has_role' in coalesce(qual, '')) > 0) then
    raise exception 'the administrator-gated read policy on hts_rag_determinations is missing or no longer calls app.has_role';
  end if;
  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'hts_rag_determinations'
       and grantee = 'authenticated' and privilege_type = 'SELECT') then
    raise exception 'administrators lost the SELECT grant on hts_rag_determinations, so the admin read policy is inert';
  end if;

  -- The two claimed indexes exist and kept their shape.
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='hts_rag_determinations_comparison_category_idx') then
    raise exception 'hts_rag_determinations_comparison_category_idx is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname='public' and indexname='hts_rag_provider_responses_determination_idx'
       and position('WHERE' in indexdef) > 0) then
    raise exception 'hts_rag_provider_responses_determination_idx is missing or lost its partial predicate';
  end if;

  -- The columns this contract promises are actually present.
  select count(*) into v_count from information_schema.columns
   where table_schema='public' and table_name='hts_rag_determinations'
     and column_name in ('comparison_category','comparison_details','session_id','completion_key');
  if v_count <> 4 then raise exception 'expected four new determination columns, got %', v_count; end if;
  select count(*) into v_count from information_schema.columns
   where table_schema='public' and table_name='hts_rag_extraction_jobs'
     and column_name in ('raw_extraction','parse_state','parse_error_code','max_attempts','dead_lettered_at','dead_letter_reason','review_needed');
  if v_count <> 7 then raise exception 'expected seven new extraction job columns, got %', v_count; end if;
end
$verify$;
