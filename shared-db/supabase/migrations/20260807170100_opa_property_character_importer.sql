-- =====================================================================================
-- Disney OPA property->character MIRROR-ONLY importer.
--
-- Migration: 20260807170100_opa_property_character_importer.sql
-- Design:    docs/verification/opa-source-of-truth-20260807/README.md (PR #485)
-- Build note: docs/verification/opa-source-of-truth-20260807/BUILD-NOTE-20260807.md
--
-- Depends on (exact 14-digit versions):
--   20260621150815  app_core                                 -- core.property, core.character
--   20260724030000  coldlion phase1 mirror schema            -- plm.erp_* mirror pattern
--   20260724060000  coldlion phase2a mirror importer         -- the SECURITY DEFINER +
--                                                               public wrapper pattern
--                                                               this migration follows
--   20260807170000  opa_property_character_landing           -- the table written here
--
-- WHY THIS EXISTS INSTEAD OF A SEED
-- ---------------------------------
-- The design doc's section 7.7 proposed a seed migration generated from a CSV committed
-- to this repo. That justification EXPIRED: the CSV was removed (PR #495) to the private
-- repo u2giants/licensor-source-data, and THIS REPO IS PUBLIC. A seed would re-materialise
-- 10,262 confidential Disney rows as INSERTs in public git history, permanently.
--   SCHEMA IN GIT. DATA OUT OF GIT.
-- Rows therefore arrive at runtime as a jsonb snapshot, exactly like the ColdLion
-- vendor mirror (20260724060000). The runner tools/sync-opa-property-character.mjs reads
-- the CSV from the PRIVATE repo and POSTs the snapshot. It contains no data itself.
--
-- OBJECTS
--   plm.opa_loader_privilege_ok(text, text)            -- pure, testable privilege predicate
--   plm.sync_opa_property_character(jsonb, text, numeric)  -- SECURITY DEFINER implementation
--   public.sync_opa_property_character(jsonb, text, numeric) -- thin service-role wrapper
--
-- FIELD-OWNERSHIP CONTRACT. This importer may write ONLY:
--     * plm.opa_property_character  (the mirror rows)
--   It MUST NOT write core.licensor, core.property, core.character,
--   core.property_character, core.style_guide_character, any canonical status or UUID,
--   and it MUST NOT resolve anything: property_id, resolution_status, resolution_reason,
--   resolved_at and resolved_by are NEVER set by this function. Two owner gates are open
--   (how far Disney may overwrite curated names; whether deletions propagate), so the
--   importer also NEVER DELETES a mirror row -- absence from a snapshot is REPORTED as
--   rows_missing and nothing else. "Presence adds and corrects; ABSENCE NEVER REMOVES."
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. The privilege predicate.
--
-- THE NULL-PERMISSIVE TRAP THIS AVOIDS (design doc section 7.4, and it has fired in this
-- repo before). This shape is FORBIDDEN:
--     if not ( current_user = 'postgres' or auth.role() = 'service_role' ) then raise ...
-- Inside a migration auth.role() is NULL. `NULL = 'service_role'` is NULL, `false or NULL`
-- is NULL, and `if not NULL then` NEVER RUNS THE BODY. The guard reads as strict and
-- behaves as wide open, admitting everyone forever.
--
-- Two deliberate choices here:
--   (a) It is a FUNCTION, not a `do $$ ... $$` block. An anonymous block never lands in
--       pg_proc, so a test cannot see it, cannot call it, and cannot prove it rejects
--       anything. This predicate is directly callable, so the contract test asserts the
--       NULL case is REJECTED rather than asserting that some text exists somewhere.
--   (b) It takes SESSION_USER, not CURRENT_USER. SECURITY DEFINER rewrites current_user
--       to the function OWNER, so a current_user check inside a definer function always
--       passes and guards nothing. session_user is the real login role and is unaffected.
--
-- Contract: returns TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity.
-- Every other input, including NULL on both arguments, returns FALSE.
-- -------------------------------------------------------------------------------------
create or replace function plm.opa_loader_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function plm.opa_loader_privilege_ok(text, text) is
'Privilege predicate for the Disney OPA loader. TRUE only for a NON-NULL, positively '
'matched identity: JWT role service_role, or session_user postgres/supabase_admin. '
'NULL/empty on both arguments returns FALSE. Written as a callable function rather than '
'a DO block so a contract test can prove the NULL case is REJECTED -- an anonymous block '
'never lands in pg_proc and cannot be tested. Takes SESSION_USER because SECURITY DEFINER '
'rewrites current_user to the function owner, making a current_user check useless.';

revoke all on function plm.opa_loader_privilege_ok(text, text) from public;
grant execute on function plm.opa_loader_privilege_ok(text, text) to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 2. The importer.
--
-- Snapshot contract (jsonb object):
--   {
--     "captured_at":      "2026-08-06",          -- required, ISO date, NEVER derived from now()
--     "source_url":       "https://opa.disney.com/...",   -- required, non-blank
--     "line_of_business": "Home",                -- required, must be exactly 'Home'
--     "rows": [                                  -- required, non-empty array
--       { "licensedPropertyID": 92, "characterID": 510,
--         "property": "101 Dalmatians", "character": "Beagle Boys",
--         "brandPropertyID": 1, "optionSourceID": 1007 }, ...
--     ]
--   }
--
-- captured_at is supplied EXPLICITLY and is never taken from now(). The server runs
-- America/New_York, so a UTC-midnight timestamp read back through ::date lands on the
-- PREVIOUS DAY; deriving the capture date from a clock would silently misdate snapshots.
-- -------------------------------------------------------------------------------------
create or replace function plm.sync_opa_property_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode              text,
  captured_at       date,
  rows_seen         integer,
  rows_inserted     integer,
  rows_updated      integer,
  rows_unchanged    integer,
  rows_missing      integer,
  distinct_property integer,
  distinct_character integer,
  snapshot_hash     text
)
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role        text := auth.role();
  v_rows        jsonb;
  v_captured    date;
  v_source_url  text;
  v_lob         text;
  v_hash        text;
  v_seen        integer := 0;
  v_before      integer := 0;
  v_ins         integer := 0;
  v_upd         integer := 0;
  v_unch        integer := 0;
  v_missing     integer := 0;
  v_dprop       integer := 0;
  v_dchar       integer := 0;
  v_bad         integer := 0;
  v_dupes       integer := 0;
  v_sample      text;
begin
  -- G1. PRIVILEGE. Non-null role AND positive match; see plm.opa_loader_privilege_ok.
  if not plm.opa_loader_privilege_ok(v_role, session_user) then
    raise exception
      using message = format(
        'OPA import refused: effective JWT role %L / session_user %L is not permitted to '
        'load plm.opa_property_character. Run this through the shared-db apply workflow '
        'or as service_role.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')),
      errcode = 'P0001';
  end if;

  -- G2. MODE. mirror_only is the only mode that exists. There is deliberately no
  --     resolve/promote path: resolution is an OPEN OWNER GATE.
  if p_mode is distinct from 'mirror_only' then
    raise exception 'OPA import refused: mode %L is not supported; only mirror_only exists. '
      'Resolution and promotion are open owner decisions and have no code path.', p_mode
      using errcode = 'P0001';
  end if;

  -- G3. Serialize overlapping runs.
  perform pg_advisory_xact_lock(hashtext('plm.sync_opa_property_character')::bigint);

  -- G4. SNAPSHOT SHAPE.
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'OPA import refused: snapshot must be a jsonb object, got %.',
      coalesce(jsonb_typeof(p_snapshot), 'null') using errcode = 'P0001';
  end if;

  v_rows := p_snapshot -> 'rows';
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    raise exception 'OPA import refused: snapshot.rows must be an array, got %.',
      coalesce(jsonb_typeof(v_rows), 'missing') using errcode = 'P0001';
  end if;

  v_seen := jsonb_array_length(v_rows);
  if v_seen = 0 then
    raise exception 'OPA import refused: snapshot.rows is empty. An empty payload aborts '
      'before any mirror write so a failed extract cannot look like a successful one.'
      using errcode = 'P0001';
  end if;

  -- G5. PROVENANCE. Explicit, never derived from a clock (see the note above about
  --     America/New_York and UTC-midnight dates).
  begin
    v_captured := (p_snapshot ->> 'captured_at')::date;
  exception when others then
    v_captured := null;
  end;
  if v_captured is null then
    raise exception 'OPA import refused: snapshot.captured_at is missing or not a date '
      '(got %L). It must be supplied explicitly and never derived from now().',
      p_snapshot ->> 'captured_at' using errcode = 'P0001';
  end if;

  v_source_url := btrim(coalesce(p_snapshot ->> 'source_url', ''));
  if v_source_url = '' then
    raise exception 'OPA import refused: snapshot.source_url is missing or blank. Every '
      'row must carry its own provenance.' using errcode = 'P0001';
  end if;

  v_lob := coalesce(p_snapshot ->> 'line_of_business', 'Home');
  if v_lob <> 'Home' then
    raise exception 'OPA import refused: line_of_business %L is not Home. This landing is '
      'scoped to the Home line of business only; another LOB needs its own reviewed '
      'migration, not a silent load.', v_lob using errcode = 'P0001';
  end if;

  -- G6. ROW SHAPE. Every row must carry both natural-key IDs as numbers, non-blank
  --     names, and the pinned optionSourceID. One bad row fails the whole snapshot.
  select count(*), min(r.value::text)
  into v_bad, v_sample
  from jsonb_array_elements(v_rows) r
  where jsonb_typeof(r.value) <> 'object'
     or jsonb_typeof(r.value -> 'licensedPropertyID') <> 'number'
     or jsonb_typeof(r.value -> 'characterID') <> 'number'
     or jsonb_typeof(r.value -> 'brandPropertyID') <> 'number'
     or jsonb_typeof(r.value -> 'optionSourceID') <> 'number'
     or btrim(coalesce(r.value ->> 'property', '')) = ''
     or btrim(coalesce(r.value ->> 'character', '')) = ''
     or (r.value ->> 'optionSourceID')::bigint <> 1007;

  if v_bad > 0 then
    raise exception 'OPA import refused: % row(s) are malformed or carry an optionSourceID '
      'other than 1007. First offender: %. optionSourceID is pinned so an extract whose '
      'shape we have never verified fails LOUDLY instead of landing silently.',
      v_bad, left(v_sample, 400) using errcode = 'P0001';
  end if;

  -- G7. NATURAL KEY. The key is the ID PAIR, never the name pair: measured on the
  --     2026-08-06 extract the NAME pair gives 10,240 distinct values over 10,262 rows
  --     (22 collisions), so a name key silently DROPS 22 rows. A duplicate ID pair
  --     inside one snapshot is a real defect and aborts the run rather than letting
  --     last-write-wins pick a winner at random.
  select count(*) into v_dupes from (
    select (r.value ->> 'licensedPropertyID')::bigint as lp,
           (r.value ->> 'characterID')::bigint        as ch
    from jsonb_array_elements(v_rows) r
    group by 1, 2
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception 'OPA import refused: % duplicate (licensedPropertyID, characterID) '
      'pair(s) inside one snapshot. The ID pair is the natural key and must be unique; '
      'a duplicate means the extract is wrong, not that a winner should be chosen.',
      v_dupes using errcode = 'P0001';
  end if;

  -- G8. SHRINK BAND. A refresh that loses more than p_max_shrink_fraction of the rows we
  --     already hold is far more likely to be a truncated extract than a Disney change.
  select count(*) into v_before from plm.opa_property_character;

  if v_before > 0
     and v_seen < v_before * (1 - greatest(0::numeric, least(1::numeric, p_max_shrink_fraction)))
  then
    raise exception 'OPA import refused: snapshot has % rows against % already stored, a '
      'drop beyond the %%%s shrink band. A truncated or partially-scraped extract looks '
      'exactly like this. Re-extract, or pass a wider p_max_shrink_fraction deliberately.',
      v_seen, v_before, round(p_max_shrink_fraction * 100, 1)
      using errcode = 'P0001';
  end if;

  v_hash := md5(v_rows::text);

  -- ---------------------------------------------------------------------------------
  -- UPSERT. Writes ONLY plm.opa_property_character, and only the vendor-owned columns.
  -- The resolution columns (property_id, resolution_status, resolution_reason,
  -- resolved_at, resolved_by) are ABSENT from both the insert list and the update SET
  -- list, so a re-import can never wipe a human's resolution decision. Nothing is
  -- deleted: absence is reported as rows_missing.
  -- ---------------------------------------------------------------------------------
  create temporary table _opa_incoming on commit drop as
  select
    (r.value ->> 'licensedPropertyID')::bigint as licensed_property_id,
    (r.value ->> 'characterID')::bigint        as character_id,
    (r.value ->> 'property')                   as property_name,
    (r.value ->> 'character')                  as character_name,
    (r.value ->> 'brandPropertyID')::bigint    as brand_property_id,
    (r.value ->> 'optionSourceID')::bigint     as option_source_id,
    r.value                                    as raw,
    md5(r.value::text)                         as source_hash
  from jsonb_array_elements(v_rows) r;

  select count(*) into v_unch
  from _opa_incoming i
  join plm.opa_property_character o
    on o.licensed_property_id = i.licensed_property_id
   and o.character_id = i.character_id
  where o.source_hash = i.source_hash
    and o.captured_at = v_captured;

  select count(*) into v_upd
  from _opa_incoming i
  join plm.opa_property_character o
    on o.licensed_property_id = i.licensed_property_id
   and o.character_id = i.character_id
  where o.source_hash is distinct from i.source_hash
     or o.captured_at is distinct from v_captured;

  v_ins := v_seen - v_unch - v_upd;

  insert into plm.opa_property_character as t (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id,
    captured_at, source_url, line_of_business,
    raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select
    i.licensed_property_id, i.character_id, i.property_name, i.character_name,
    i.brand_property_id, i.option_source_id,
    v_captured, v_source_url, v_lob,
    i.raw, i.source_hash,
    now(), now(), now(), now()
  from _opa_incoming i
  on conflict (licensed_property_id, character_id) do update set
    property_name    = excluded.property_name,
    character_name   = excluded.character_name,
    brand_property_id = excluded.brand_property_id,
    option_source_id = excluded.option_source_id,
    captured_at      = excluded.captured_at,
    source_url       = excluded.source_url,
    line_of_business = excluded.line_of_business,
    raw              = excluded.raw,
    source_hash      = excluded.source_hash,
    last_seen_at     = now(),
    imported_at      = now(),
    updated_at       = now()
    -- first_seen_at is deliberately NOT updated: it records first observation.
    -- The five resolution columns are deliberately absent: a re-import must never
    -- overwrite a human decision, and this importer resolves nothing.
  ;

  -- ABSENCE NEVER REMOVES (owner ruling 2026-08-07, and the deletion-propagation gate
  -- is still open). Rows we hold that this snapshot does not mention are counted and
  -- left exactly as they are.
  select count(*) into v_missing
  from plm.opa_property_character o
  where not exists (
    select 1 from _opa_incoming i
    where i.licensed_property_id = o.licensed_property_id
      and i.character_id = o.character_id
  );

  select count(distinct i.licensed_property_id), count(distinct i.character_id)
  into v_dprop, v_dchar
  from _opa_incoming i;

  raise notice 'OPA import ok: % rows seen (% new, % updated, % unchanged), % held rows '
    'not in this snapshot were LEFT ALONE. captured_at=%.',
    v_seen, v_ins, v_upd, v_unch, v_missing, v_captured;

  return query select
    p_mode, v_captured, v_seen, v_ins, v_upd, v_unch, v_missing, v_dprop, v_dchar, v_hash;
end;
$$;

comment on function plm.sync_opa_property_character(jsonb, text, numeric) is
'MIRROR-ONLY guarded importer for the Disney OPA property->character extract into '
'plm.opa_property_character. Exists INSTEAD OF a seed migration because this repository '
'is PUBLIC and the extract is confidential Disney data: schema in git, data out of git. '
'Guards: non-null positively-matched privilege (plm.opa_loader_privilege_ok), mode, '
'advisory lock, snapshot shape, non-empty rows, explicit captured_at and source_url, '
'Home line of business, per-row shape with optionSourceID pinned to 1007, duplicate '
'natural-key detection on the ID PAIR (never the name pair), and a shrink band. Writes '
'ONLY plm.opa_property_character vendor columns. NEVER writes core.*, NEVER sets any '
'resolution column, and NEVER deletes: absence is reported as rows_missing.';

-- -------------------------------------------------------------------------------------
-- 3. Thin wrapper so a serverless/service-role caller needs no raw DB password
--    (AGENTS section 8.1 -- plm and ingest are not PostgREST-exposed).
-- -------------------------------------------------------------------------------------
create or replace function public.sync_opa_property_character(
  p_snapshot            jsonb,
  p_mode                text    default 'mirror_only',
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode              text,
  captured_at       date,
  rows_seen         integer,
  rows_inserted     integer,
  rows_updated      integer,
  rows_unchanged    integer,
  rows_missing      integer,
  distinct_property integer,
  distinct_character integer,
  snapshot_hash     text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_opa_property_character(
    p_snapshot, p_mode, p_max_shrink_fraction);
end;
$$;

comment on function public.sync_opa_property_character(jsonb, text, numeric) is
'Thin SECURITY DEFINER wrapper over plm.sync_opa_property_character so a serverless/'
'service-role caller imports the Disney OPA mirror without a raw DB password. All guards '
'live in the inner function and are re-evaluated there; this wrapper adds no privilege.';

revoke all on function plm.sync_opa_property_character(jsonb, text, numeric) from public;
revoke all on function public.sync_opa_property_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_opa_property_character(jsonb, text, numeric) to service_role;
grant execute on function public.sync_opa_property_character(jsonb, text, numeric) to service_role;
