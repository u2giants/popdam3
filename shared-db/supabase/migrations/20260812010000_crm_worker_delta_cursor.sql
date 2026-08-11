-- =====================================================================================
-- PopCRM DURABLE WORKER DELTA CURSOR -- one opaque Microsoft Graph delta link, held
-- safely, advanced only by compare-and-swap.
--
-- Migration: 20260812010000_crm_worker_delta_cursor.sql
-- Issue:     u2giants/shared-db #782. Object claim: #795.
-- Requires:  nothing beyond schema `crm`, which exists since 20260621150714_foundation.
--            This migration ALTERS NOTHING and DROPS NOTHING. It is purely additive.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA. Every row arrives at runtime from the
-- PopCRM Outlook worker (u2giants/popcrm-web, workers/crm-worker-supabase.mjs).
--
-- CONFIDENTIALITY. This repository is PUBLIC and this database's logs are not private.
-- A Microsoft Graph delta link is an opaque, potentially credential-bearing URL. It
-- appears in NO comment, NO error message, NO return value of the verification function
-- and NO test fixture below. Every diagnostic in this file reports a KEY, a COUNT or a
-- DIGEST -- never the link itself.
--
-- -------------------------------------------------------------------------------------
-- THE BUSINESS PROBLEM, IN ONE PARAGRAPH
-- -------------------------------------------------------------------------------------
-- PopCRM's Outlook worker fetches a bounded window of newest messages. A burst larger
-- than that window PERMANENTLY skips the older unseen mail underneath it -- and the
-- existing idempotency (unique on outlook_message_id) does not help, because that proves
-- only "no duplicates", never "nothing was missed". The permanent fix is Graph delta
-- pagination, and delta pagination needs one durable thing: the delta link, surviving a
-- restart, advanced ONLY after every fetched item has been successfully persisted.
--
-- -------------------------------------------------------------------------------------
-- WHY COMPARE-AND-SWAP AND NOT A LOCK -- DO NOT "SIMPLIFY" THIS INTO SELECT FOR UPDATE
-- -------------------------------------------------------------------------------------
-- The unsafe interleaving is:
--     worker A loads the cursor -> calls Graph (seconds to minutes) -> saves
--     worker B loads the SAME cursor -> calls Graph -> saves
-- and whichever saves last silently overwrites the other's progress. Messages that only
-- the loser fetched are then never re-offered, which is the exact defect this contract
-- exists to remove.
--
-- A row lock CANNOT close that window. The worker's Graph round-trip happens BETWEEN the
-- load and the save, outside any database transaction; holding a lock across it would
-- mean holding a Postgres transaction open across an arbitrarily slow network call, which
-- pins a connection, blocks vacuum, and dies on any statement timeout -- and on that
-- death the lock is released mid-flight anyway. So the lock would be both expensive and
-- ineffective.
--
-- Compare-and-swap is the honest mechanism, because it needs no state held across the
-- round-trip at all. `load` hands out a `version` uuid. `save` must present that exact
-- uuid; the save is an UPDATE whose WHERE clause names it, so under READ COMMITTED the
-- second of two concurrent savers blocks on the row lock, re-evaluates the predicate
-- after the first commits, matches ZERO rows, and is REFUSED with P0001. The loser LOSES,
-- loudly, and its caller re-loads and re-runs its delta -- which is safe, because a Graph
-- delta replay yields items the idempotent insert already handles.
--
-- The version is rotated on EVERY successful save, never derived from the content. A
-- content digest would compare equal on a save that legitimately re-writes the same link,
-- letting a stale writer win.
--
-- -------------------------------------------------------------------------------------
-- WHY updated_at AND advanced_at ARE SET IN THE FUNCTION AND NOT BY A BEFORE TRIGGER
-- -------------------------------------------------------------------------------------
-- Deliberate. A BEFORE trigger that stamps timestamps is the shape that silently stops
-- working the day a column it touches becomes GENERATED ... STORED (Postgres refuses to
-- let a BEFORE trigger assign one, and the failure surfaces far from the trigger). It
-- also makes the timestamps a property of "any write", including a write this contract
-- does not sanction. Here the ONLY sanctioned write path is
-- crm.save_worker_delta_cursor, so that is where the stamps belong: one place, visible in
-- the same function whose semantics they describe.
--
-- =====================================================================================
-- Objects created (the whole of claim #795, and nothing outside it):
--   1 table      crm.worker_delta_cursor
--   4 functions  crm.worker_cursor_privilege_ok, crm.load_worker_delta_cursor,
--                crm.save_worker_delta_cursor, crm.worker_delta_cursor_status
-- NOTHING else is created, altered or dropped. No new schema, no new type, no index
-- beyond the implicit primary key, no trigger, no view, no public.* wrapper, and no
-- change to any existing object anywhere in the database.
-- =====================================================================================

-- =====================================================================================
-- SECTION 1. THE PRIVILEGE PREDICATE
--
-- MIRRORS plm.dcp_loader_privilege_ok (20260810190000 section 0) ON PURPOSE. This is the
-- same predicate, not a fifth invention, and the two properties that matter are:
--
--   1. It is a POSITIVE match on a NON-NULL identity. The tempting shape
--          if not ( ... or auth.role() = 'service_role' ) then raise
--      NEVER FIRES when auth.role() is NULL, because `NULL = 'service_role'` is NULL, the
--      OR is NULL, and `not NULL` is NULL -- which is not true, so the raise is skipped.
--      auth.role() IS NULL inside a migration and inside psql. That guard reads as strict
--      and behaves as wide open. Section D of the contract tests proves the NULL case is
--      rejected here, which is only possible because this is a callable function rather
--      than an inline expression.
--
--   2. It takes SESSION_USER, never current_user. SECURITY DEFINER rewrites current_user
--      to the function OWNER, so a current_user check inside a definer function is
--      always true and guards precisely nothing.
-- =====================================================================================
create or replace function crm.worker_cursor_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
-- Pinned even though this is not SECURITY DEFINER and calls only builtins: an IMMUTABLE
-- function with an unpinned search_path is the shape that becomes a problem the day a
-- schema-qualified callee is added, and pinning costs nothing today.
set search_path = pg_catalog
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function crm.worker_cursor_privilege_ok(text, text) is
'Privilege predicate for the PopCRM durable worker delta cursor. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/'
'supabase_admin. NULL or empty on BOTH arguments returns FALSE -- which is the case that '
'holds inside a migration and in psql, where auth.role() is NULL. Deliberately identical '
'in shape to plm.dcp_loader_privilege_ok. Written as a callable function rather than an '
'inline expression so a contract test can prove the NULL case is rejected.';

-- service_role ONLY -- deliberately NOT `authenticated`, which is where the plm predicate
-- this one mirrors did land. The function is pure over its arguments and leaks nothing, so
-- an authenticated grant would be harmless; it is still withheld, because this file argues
-- a few lines further down that "not reachable" beats "fails safely once you read the
-- body", and a predicate a browser role can call would be the one object in the contract
-- contradicting that.
revoke all on function crm.worker_cursor_privilege_ok(text, text) from public;
grant execute on function crm.worker_cursor_privilege_ok(text, text) to service_role;

-- =====================================================================================
-- SECTION 2. crm.worker_delta_cursor -- the durable state itself
--
-- GENERIC NAME, OUTLOOK IDENTITY IN A COLUMN. The table is not called
-- `outlook_delta_cursor`, and that is an endorsed decision, not laziness. The state this
-- holds -- "one opaque continuation token per named worker purpose, advanced only after
-- work succeeds" -- is not specific to Microsoft Graph. Naming the table after Outlook
-- would guarantee that the second worker needing exactly this shape (a Gmail history id,
-- a Salesforce replay id, a webhook watermark) gets a SECOND near-identical table with a
-- second copy of the CAS logic and a second set of grants to get wrong. The Outlook
-- identity lives in `purpose` and `owner_identity`, where it is data.
--
-- ONE OPAQUE COLUMN AND NO STRUCTURE. delta_link is stored exactly as Graph issued it and
-- is never parsed, validated against a URL shape, split, or normalised. It is a token
-- this database does not get to have an opinion about; treating it as a URL would invite
-- code that "helpfully" rewrites it.
-- =====================================================================================
create table crm.worker_delta_cursor (
  cursor_key         text        not null,
  purpose            text        not null,
  owner_identity     text,
  delta_link         text,
  delta_link_sha256  text,
  version            uuid        not null default gen_random_uuid(),
  save_count         integer     not null default 0,
  advanced_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint worker_delta_cursor_pkey primary key (cursor_key),
  constraint worker_delta_cursor_key_chk     check (btrim(cursor_key) = cursor_key
                                                    and btrim(cursor_key) <> ''),
  constraint worker_delta_cursor_purpose_chk check (btrim(purpose) <> ''),
  constraint worker_delta_cursor_link_chk    check (delta_link is null
                                                    or btrim(delta_link) <> ''),
  -- The digest and the link travel together or neither exists. A digest without a link
  -- would claim a cursor that is not there; a link without a digest would leave the only
  -- non-sensitive way to compare two cursors unavailable exactly when it is needed.
  constraint worker_delta_cursor_digest_chk  check (
    (delta_link is null and delta_link_sha256 is null)
    or (delta_link is not null and delta_link_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint worker_delta_cursor_save_count_chk check (save_count >= 0),
  -- A row that has never been saved cannot have advanced. NOTE that save_count = 0 is NOT
  -- reachable through the sanctioned API at all -- create mode always writes 1 -- so this
  -- is a STRUCTURAL guard against a hand-written row, not a state the contract produces.
  constraint worker_delta_cursor_advanced_chk check (
    save_count > 0 or advanced_at is null
  )
);

comment on table crm.worker_delta_cursor is
'Durable worker continuation state: ONE opaque provider delta/continuation token per named '
'cursor_key, so a restart resumes where the worker stopped instead of re-scanning a bounded '
'newest-first window that silently skips anything older than it. Deliberately GENERIC -- the '
'Outlook identity lives in purpose/owner_identity as DATA, so the next worker needing this '
'exact shape does not get a second near-identical table with a second copy of the '
'compare-and-swap logic. TWO FENCES, COVERING DIFFERENT ROLES: RLS is enabled AND FORCED '
'with ZERO policies, which denies the browser roles; and EVERY table privilege is revoked '
'from service_role, which is the ONLY thing that denies service_role, because service_role '
'has BYPASSRLS and therefore ignores policies entirely. The `crm` default ACL grants every '
'new table {arwdDxtm} to service_role, so without that revoke this contract would be '
'decoration. The only sanctioned access is the three SECURITY DEFINER functions. Writes are '
'compare-and-swap on `version`, never last-writer-wins.';

comment on column crm.worker_delta_cursor.cursor_key is
'The caller-chosen identity of one cursor, e.g. one mailbox under one integration. Primary '
'key. Constrained to be non-blank and already-trimmed, so " k" and "k" can never become two '
'cursors for the same worker.';
comment on column crm.worker_delta_cursor.purpose is
'What this cursor is FOR, in non-sensitive words, e.g. the integration and stream it '
'follows. This is where the Outlook-specific identity lives, which is why the table itself '
'carries a generic name.';
comment on column crm.worker_delta_cursor.owner_identity is
'Non-sensitive identity of the worker or mailbox that owns this cursor. Diagnostic only. '
'Never a secret, never a token, never a password.';
comment on column crm.worker_delta_cursor.delta_link is
'The OPAQUE provider continuation token, stored exactly as issued and NEVER parsed, '
'validated as a URL, split or normalised. Potentially credential-bearing, so it is returned '
'ONLY by crm.load_worker_delta_cursor and NEVER by crm.worker_delta_cursor_status, appears '
'in NO error message in this file, and must never be written to a log, an issue, a commit '
'message or a handoff.';
comment on column crm.worker_delta_cursor.delta_link_sha256 is
'sha256 of the UTF-8 bytes of delta_link, computed SERVER-SIDE inside the save function so '
'it cannot disagree with what was stored. It exists so two cursors can be compared, and a '
'save can be confirmed, WITHOUT ever handling the link itself.';
comment on column crm.worker_delta_cursor.version is
'The compare-and-swap token. Handed out by load, required by save, and ROTATED on every '
'successful save. Deliberately a fresh uuid rather than a digest of the content: a content '
'digest compares equal on a legitimate re-write of the same link, which would let a stale '
'writer win the very race this column exists to lose.';
comment on column crm.worker_delta_cursor.save_count is
'Number of successful saves. Monotonic, and useful evidence that a worker is actually '
'advancing rather than repeatedly failing its compare-and-swap. The lowest value the '
'sanctioned API can produce is 1 -- create mode counts as a save -- so 0 exists only as a '
'structural guard against a hand-written row, not as a state this contract creates.';
comment on column crm.worker_delta_cursor.advanced_at is
'When the stored link last actually CHANGED -- not when the row was last written. A worker '
'that keeps saving the same link is not making progress, and collapsing the two timestamps '
'would hide exactly that.';

-- -------------------------------------------------------------------------------------
-- THE GRANTS. THE ONE LINE THIS WHOLE CONTRACT DEPENDS ON IS THE service_role REVOKE.
--
-- The `crm` schema carries a DEFAULT ACL of {service_role=arwdDxtm/postgres} (verified
-- against pg_default_acl on 2026-08-11). Every new table in this schema is therefore BORN
-- with service_role holding SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
-- and MAINTAIN. Without the revoke below, the entire "narrow RPC only" design is
-- decoration: the worker's own service_role key could UPDATE the row directly, bypassing
-- the compare-and-swap completely, and could TRUNCATE the table -- which fires no row
-- trigger and would erase every cursor in one statement.
--
-- Note the ORDER. `revoke all from service_role` must come AFTER the table is created and
-- BEFORE any grant, and the `grant execute` on the functions below is what restores the
-- worker's access -- through the narrow path, and only through it.
-- -------------------------------------------------------------------------------------
revoke all on crm.worker_delta_cursor from public;
revoke all on crm.worker_delta_cursor from anon;
revoke all on crm.worker_delta_cursor from authenticated;
revoke all on crm.worker_delta_cursor from service_role;

-- RLS with ZERO POLICIES is the deny-everything state, and FORCE extends it to the table
-- owner as well, so the deny is not quietly waived for whoever happens to own the table.
--
-- ***** READ THIS BEFORE TRUSTING RLS HERE. RLS IS **NOT** WHAT STOPS service_role. *****
-- Verified against the live project on 2026-08-11: `service_role` has rolbypassrls = TRUE.
-- A BYPASSRLS role ignores policies AND ignores FORCE, so if service_role still held the
-- default {arwdDxtm} table ACL, zero policies would stop it exactly not at all. THE REVOKE
-- ABOVE IS THE ONLY THING THAT DENIES service_role DIRECT ACCESS -- which is why the
-- contract test asserts it from information_schema.role_table_grants rather than printing
-- the line and calling that proof. The two fences cover different roles and neither is
-- redundant:
--   * anon / authenticated (browser roles, no BYPASSRLS) -> stopped by BOTH the revoke and
--     the empty policy set. Belt and braces, on purpose.
--   * service_role (BYPASSRLS)                           -> stopped by the REVOKE alone.
--
-- `postgres` also has rolbypassrls = TRUE (it is NOT a superuser on Supabase), which is why
-- FORCE plus zero policies is safe here and not a self-inflicted outage: the three SECURITY
-- DEFINER functions below run as the owner and keep working, and they are the only path
-- that does.
alter table crm.worker_delta_cursor enable row level security;
alter table crm.worker_delta_cursor force row level security;

-- =====================================================================================
-- SECTION 3. crm.load_worker_delta_cursor -- read the cursor AND take out a CAS ticket
--
-- Returns jsonb rather than the table row type on purpose: the shape can gain a field
-- without a signature change, and a jsonb return cannot accidentally be joined against
-- as though it were a queryable relation.
--
-- A MISSING CURSOR IS NOT AN ERROR. First run is the normal case, and it returns
-- exists=false with a NULL delta_link and a NULL version -- which is exactly the input
-- save() requires to CREATE the cursor. Raising here would force every caller to catch an
-- exception on its happy path, and callers that do that stop distinguishing it from the
-- real failures.
-- =====================================================================================
create or replace function crm.load_worker_delta_cursor(
  p_cursor_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, crm, extensions
as $$
declare
  v_role text := auth.role();
  v_row  crm.worker_delta_cursor%rowtype;
begin
  if not crm.worker_cursor_privilege_ok(v_role, session_user) then
    raise exception 'Worker delta cursor refused: effective JWT role %L / session_user %L '
      'may not load a cursor. Run as service_role, or through the shared-db apply '
      'workflow.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if p_cursor_key is null or btrim(p_cursor_key) = '' then
    raise exception 'Worker delta cursor refused: cursor_key is required and must be '
      'non-blank. A blank key would make every worker share one cursor.'
      using errcode = 'P0001';
  end if;

  select * into v_row from crm.worker_delta_cursor c
  where c.cursor_key = btrim(p_cursor_key);

  if not found then
    -- FIRST RUN. Not an error. version is NULL, and NULL is the exact expected_version
    -- save() demands in order to create the cursor.
    return jsonb_build_object(
      'cursor_key', btrim(p_cursor_key),
      'exists',     false,
      'delta_link', null,
      'version',    null,
      'save_count', 0
    );
  end if;

  return jsonb_build_object(
    'cursor_key',        v_row.cursor_key,
    'exists',            true,
    'purpose',           v_row.purpose,
    'owner_identity',    v_row.owner_identity,
    'delta_link',        v_row.delta_link,
    'delta_link_sha256', v_row.delta_link_sha256,
    'version',           v_row.version,
    'save_count',        v_row.save_count,
    'advanced_at',       v_row.advanced_at,
    'updated_at',        v_row.updated_at
  );
end;
$$;

comment on function crm.load_worker_delta_cursor(text) is
'Reads one durable worker cursor and hands out the compare-and-swap ticket (`version`) that '
'the matching save must present. THE ONLY object in this contract that returns delta_link, '
'because the worker genuinely needs it. A MISSING cursor is NOT an error: first run returns '
'exists=false with a NULL version, which is exactly the expected_version save() requires to '
'CREATE the cursor -- raising instead would put an exception on every caller''s happy path. '
'service_role only.';

-- =====================================================================================
-- SECTION 4. crm.save_worker_delta_cursor -- the atomic compare-and-swap upsert
--
-- CALL THIS ONLY AFTER ALL FETCHED WORK HAS BEEN PERSISTED. That ordering is the entire
-- point of the contract and this database cannot enforce it: advancing the cursor first
-- and then failing to store the items is indistinguishable, afterwards, from having
-- stored them. The worker must treat the save as the LAST step of a successful cycle.
--
-- p_expected_version is REQUIRED-BY-MEANING, not by NOT NULL:
--   NULL     means "I believe this cursor does not exist yet" -> INSERT, and a concurrent
--            creator makes this caller lose.
--   non-NULL means "I believe the cursor is at exactly this version" -> UPDATE, and any
--            other value -- including a cursor that has since been deleted -- loses.
-- There is NO third mode. In particular there is no "force" flag and no NULL-means-
-- overwrite path, because one would be used the first time somebody hit a P0001 in
-- production and the CAS would be over.
-- =====================================================================================
create or replace function crm.save_worker_delta_cursor(
  p_cursor_key       text,
  p_purpose          text,
  p_owner_identity   text,
  p_delta_link       text,
  p_expected_version uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, crm, extensions
as $$
declare
  v_role      text := auth.role();
  v_key       text := btrim(coalesce(p_cursor_key, ''));
  -- THE LINK IS NOT TRIMMED, AND THAT IS DELIBERATE -- do not "tidy" this into btrim().
  -- The column contract says the token is stored EXACTLY as the provider issued it, and
  -- btrim() is a normalisation: it would make the stored bytes differ from the bytes the
  -- caller holds, and the server-computed digest would then be a digest of something the
  -- caller cannot reproduce -- so "confirm the save by comparing digests", the entire
  -- reason delta_link_sha256 exists, would fail against the untrimmed original.
  -- A blank or whitespace-only input is still folded to NULL, because "no cursor yet" and
  -- "a cursor made of spaces" must not be two different states -- but that is a test on
  -- the input, not an edit of it.
  v_link      text := case when btrim(coalesce(p_delta_link, '')) = ''
                           then null else p_delta_link end;
  v_sha       text;
  v_new       uuid := gen_random_uuid();
  v_now       timestamptz := now();
  -- SCALARS, NOT A %rowtype. plpgsql refuses a record/row variable in a MULTIPLE-ITEM INTO
  -- list ("record variable cannot be part of multiple-item INTO list", 42601), and the
  -- ADVANCE branch below must return the row AND the computed `advanced` boolean from one
  -- statement -- which is the whole point of doing the digest comparison inside the CAS.
  -- So the fields are captured individually. v_r_key doubles as the "did the statement
  -- match a row?" flag: it is NULL exactly when the compare-and-swap found nothing.
  v_r_key     text;
  v_r_version uuid;
  v_r_count   integer;
  v_r_adv     timestamptz;
  v_r_upd     timestamptz;
  v_r_sha     text;
  v_advanced  boolean;
  v_exists    boolean;
begin
  if not crm.worker_cursor_privilege_ok(v_role, session_user) then
    raise exception 'Worker delta cursor refused: effective JWT role %L / session_user %L '
      'may not save a cursor.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if v_key = '' then
    raise exception 'Worker delta cursor refused: cursor_key is required and must be '
      'non-blank.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_purpose, '')) = '' then
    raise exception 'Worker delta cursor refused: purpose is required for cursor %L. An '
      'unlabelled cursor cannot be reasoned about six months from now.', v_key
      using errcode = 'P0001';
  end if;

  -- The digest is computed HERE, from the value about to be stored, and is never accepted
  -- from the caller. A caller-supplied digest can disagree with the link it claims to
  -- describe, and the disagreement would only ever be discovered by the one person
  -- relying on it to avoid touching the link.
  v_sha := case when v_link is null
                then null
                else encode(sha256(convert_to(v_link, 'UTF8')), 'hex') end;

  if p_expected_version is null then
    -- ---------------------------------------------------------------------------------
    -- CREATE MODE. ON CONFLICT DO NOTHING, not DO UPDATE: a row already being there means
    -- the caller's belief ("this cursor does not exist") was wrong, and the correct
    -- outcome is to LOSE, not to overwrite whatever the real owner just wrote.
    -- ---------------------------------------------------------------------------------
    insert into crm.worker_delta_cursor (
      cursor_key, purpose, owner_identity, delta_link, delta_link_sha256,
      version, save_count, advanced_at, created_at, updated_at
    ) values (
      v_key, btrim(p_purpose), nullif(btrim(coalesce(p_owner_identity, '')), ''),
      v_link, v_sha, v_new, 1,
      case when v_link is null then null else v_now end,
      v_now, v_now
    )
    on conflict (cursor_key) do nothing
    returning cursor_key, version, save_count, advanced_at, updated_at, delta_link_sha256
      into v_r_key, v_r_version, v_r_count, v_r_adv, v_r_upd, v_r_sha;

    -- A brand-new cursor that arrived carrying a link HAS advanced -- from nothing to
    -- something. One that arrived empty has not.
    v_advanced := v_link is not null;

    if v_r_key is null then
      raise exception 'Worker delta cursor refused: cursor %L already exists, but this '
        'save presented no expected_version, i.e. it believed it was CREATING the cursor. '
        'Another worker created or advanced it first. Re-load the cursor and retry the '
        'delta from the version you are given.', v_key using errcode = 'P0001';
    end if;
  else
    -- ---------------------------------------------------------------------------------
    -- ADVANCE MODE. THE COMPARE-AND-SWAP. The version test lives in the WHERE clause of
    -- the UPDATE ITSELF -- not in a preceding SELECT, which would reopen the race it is
    -- meant to close. Under READ COMMITTED the second of two concurrent savers blocks on
    -- the row lock, RE-EVALUATES this predicate after the first commits, sees the rotated
    -- version, matches zero rows, and is refused below. The loser loses, loudly.
    --
    -- WHY THE `prev` CTE WITH `FOR UPDATE`, RATHER THAN READING c.delta_link_sha256
    -- DIRECTLY IN THE SET LIST -- AND WHY NOT A PLAIN SELECT BEFOREHAND EITHER.
    -- Two things need the value the row held BEFORE this write: advanced_at, and the
    -- `advanced` field returned to the caller. Neither can get it honestly any other way:
    --   * A plain SELECT before the UPDATE reads OUTSIDE the row lock, so a concurrent
    --     saver can change the row in between and the answer is stale.
    --   * Deriving it afterwards from `advanced_at = now()` is WRONG, and provably so:
    --     now() is TRANSACTION time, so two saves in one transaction share it and the
    --     second reports "advanced" even when it did not move the link. The contract
    --     tests run in a single transaction and caught exactly that.
    --   * RETURNING cannot see old values on this Postgres version (`RETURNING OLD.*`
    --     arrived in PG18; this project is 17.6).
    -- The CTE takes the row lock FIRST, and under READ COMMITTED a FOR UPDATE that waits
    -- follows the update chain and re-reads the newest committed version -- so `prev` is
    -- the value that was really there when this statement won the lock, and the whole
    -- comparison happens inside one statement with the row held.
    -- ---------------------------------------------------------------------------------
    with prev as (
      select c.cursor_key, c.delta_link_sha256
      from crm.worker_delta_cursor c
      where c.cursor_key = v_key
      for update
    )
    update crm.worker_delta_cursor c
       set purpose           = btrim(p_purpose),
           owner_identity    = nullif(btrim(coalesce(p_owner_identity, '')), ''),
           delta_link        = v_link,
           delta_link_sha256 = v_sha,
           version           = v_new,
           save_count        = c.save_count + 1,
           -- advanced_at moves only when the STORED link actually changed. A worker that
           -- keeps re-saving the same link is not advancing, and stamping it anyway would
           -- hide a stuck worker behind a fresh-looking timestamp. `is distinct from`
           -- rather than `<>`, so a NULL on either side compares correctly.
           advanced_at       = case
                                 when v_sha is distinct from prev.delta_link_sha256
                                 then v_now else c.advanced_at
                               end,
           updated_at        = v_now
      from prev
     where c.cursor_key = prev.cursor_key
       and c.version    = p_expected_version
    returning c.cursor_key, c.version, c.save_count, c.advanced_at, c.updated_at,
              c.delta_link_sha256, (v_sha is distinct from prev.delta_link_sha256)
      into v_r_key, v_r_version, v_r_count, v_r_adv, v_r_upd, v_r_sha, v_advanced;

    if v_r_key is null then
      select exists (select 1 from crm.worker_delta_cursor c where c.cursor_key = v_key)
        into v_exists;
      raise exception 'Worker delta cursor refused: compare-and-swap failed for cursor '
        '%L. The expected version did not match the stored one (cursor present: %). '
        'Another worker advanced this cursor while this one was fetching. Re-load the '
        'cursor and re-run the delta from the version you are given -- a delta replay is '
        'safe, because the message insert is idempotent. No version, link or digest is '
        'echoed here: this database''s logs are not private.',
        v_key, v_exists using errcode = 'P0001';
    end if;
  end if;

  -- Never returns delta_link. The caller just supplied it; echoing it back would put an
  -- opaque, potentially credential-bearing token into one more place for no benefit.
  --
  -- `advanced` comes from the DIGEST COMPARISON made inside the CAS statement itself,
  -- against the row while it was LOCKED -- see the note on the `prev` CTE above. It is not
  -- inferred from `advanced_at = now()`, which is transaction time and therefore reports a
  -- false "advanced" for a second save in the same transaction.
  return jsonb_build_object(
    'cursor_key',        v_r_key,
    'version',           v_r_version,
    'save_count',        v_r_count,
    'advanced',          coalesce(v_advanced, false),
    'delta_link_sha256', v_r_sha,
    'advanced_at',       v_r_adv,
    'updated_at',        v_r_upd
  );
end;
$$;

comment on function crm.save_worker_delta_cursor(text, text, text, text, uuid) is
'Atomically creates or ADVANCES one worker delta cursor by COMPARE-AND-SWAP. Call it only '
'after ALL fetched work has been persisted -- that ordering is the whole point and this '
'database cannot enforce it. p_expected_version NULL means "I am creating this cursor" and '
'loses to a concurrent creator; a non-NULL value means "the cursor is at exactly this '
'version" and loses to anything else. There is deliberately NO force mode: one would be used '
'the first time somebody hit a P0001 in production and the CAS would be over. The version '
'test lives in the UPDATE''s own WHERE clause, not in a preceding SELECT that would reopen '
'the race. A failed swap raises P0001. The sha256 is computed server-side from the value '
'being stored, never accepted from the caller, and advanced_at moves only when the stored '
'link actually CHANGED, so a stuck worker cannot hide behind a fresh timestamp. Returns the '
'new version but NEVER the delta_link. service_role only.';

-- =====================================================================================
-- SECTION 5. crm.worker_delta_cursor_status -- verification output, safe to look at
--
-- THIS FUNCTION EXISTS SO NOBODY EVER HAS A REASON TO SELECT delta_link "just to check".
-- It answers every operational question -- does the cursor exist, does it hold a link, is
-- it advancing, when did it last move, how many saves -- and it returns the DIGEST rather
-- than the link, so two cursors can still be compared and a save still confirmed.
--
-- IT MUST NEVER RETURN delta_link. Section F of the contract tests asserts that against
-- the function's ACTUAL OUTPUT and against pg_get_functiondef, so adding the column back
-- fails CI rather than quietly leaking a credential-bearing token into a dashboard.
-- =====================================================================================
create or replace function crm.worker_delta_cursor_status(
  p_cursor_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, crm, extensions
as $$
declare
  v_role text := auth.role();
  v_row  crm.worker_delta_cursor%rowtype;
begin
  if not crm.worker_cursor_privilege_ok(v_role, session_user) then
    raise exception 'Worker delta cursor refused: effective JWT role %L / session_user %L '
      'may not read cursor status.', coalesce(v_role, '<null>'),
      coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  select * into v_row from crm.worker_delta_cursor c
  where c.cursor_key = btrim(coalesce(p_cursor_key, ''));

  if not found then
    return jsonb_build_object(
      'cursor_key', btrim(coalesce(p_cursor_key, '')),
      'exists',     false
    );
  end if;

  return jsonb_build_object(
    'cursor_key',        v_row.cursor_key,
    'exists',            true,
    'purpose',           v_row.purpose,
    'owner_identity',    v_row.owner_identity,
    'has_delta_link',    v_row.delta_link is not null,
    'delta_link_sha256', v_row.delta_link_sha256,
    'version',           v_row.version,
    'save_count',        v_row.save_count,
    'advanced_at',       v_row.advanced_at,
    'created_at',        v_row.created_at,
    'updated_at',        v_row.updated_at
  );
end;
$$;

comment on function crm.worker_delta_cursor_status(text) is
'Verification output for one worker delta cursor. NEVER RETURNS delta_link -- it reports '
'has_delta_link plus the sha256 digest instead, which answers "is it set" and "did it '
'change" without ever handling an opaque, potentially credential-bearing token. It exists '
'so nobody ever has a reason to select the link "just to check". A contract test asserts '
'the absence against both the actual output and pg_get_functiondef, so putting the column '
'back fails CI rather than leaking quietly into a dashboard. service_role only.';

-- -------------------------------------------------------------------------------------
-- FUNCTION GRANTS. service_role ONLY -- deliberately NOT authenticated.
--
-- The predicate in section 1 already refuses a browser JWT, so an EXECUTE grant to
-- `authenticated` would not let a browser change anything. It is still withheld, because
-- an anon/authenticated-callable definer function is the exact class of exposure the
-- 2026-07-29 public-schema audit found 88 instances of, and "it fails safely once you
-- read the body" is a worse position than "it is not reachable".
--
-- AND DO NOT ASSUME THE SCHEMA HIDES THEM. `crm` IS ALREADY POSTGREST-EXPOSED:
--     pgrst.db_schemas = public, graphql_public, api, crm, pim, core, app
-- (read from the live `authenticator` role settings, and recorded in AGENTS.md 8.1). So
-- PostgREST CAN route an RPC call to these functions today. There is no second "it is not
-- in the exposed schema list" fence, and an earlier draft of this comment claimed there
-- was -- which is exactly the kind of durable false statement that gets cited later to
-- justify a grant nobody re-checks.
--
-- WHAT ACTUALLY PROTECTS THEM, both tested: (1) EXECUTE is service_role only, so a browser
-- JWT gets 42501 at the door; and (2) if that grant were ever widened, the predicate still
-- refuses, because a real PostgREST connection has session_user `authenticator` and JWT
-- role `authenticated` and fails BOTH arms of the positive match. Section B asserts the
-- grants and section D asserts the predicate, so neither can regress silently.
-- -------------------------------------------------------------------------------------
revoke all on function crm.load_worker_delta_cursor(text) from public;
revoke all on function crm.save_worker_delta_cursor(text, text, text, text, uuid) from public;
revoke all on function crm.worker_delta_cursor_status(text) from public;

grant execute on function crm.load_worker_delta_cursor(text) to service_role;
grant execute on function crm.save_worker_delta_cursor(text, text, text, text, uuid) to service_role;
grant execute on function crm.worker_delta_cursor_status(text) to service_role;
