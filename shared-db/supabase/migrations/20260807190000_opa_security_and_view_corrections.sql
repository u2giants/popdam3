-- =====================================================================================
-- SECURITY AND CORRECTNESS FIXES from the independent review of PR #497.
--
-- Migration:  20260807190000_opa_security_and_view_corrections.sql
-- Fixes:      20260807170000_opa_property_character_landing.sql
--             20260807180000_opa_sync_reentrancy_fix.sql
-- Build note: docs/verification/opa-source-of-truth-20260807/BUILD-NOTE-20260807.md
--
-- Depends on (exact 14-digit versions):
--   20260621150815  app_core                        -- app.has_role / app.has_any_role
--   20260724030000  coldlion phase1 mirror schema   -- the erp_ RLS predicate copied here
--   20260807170000  opa_property_character_landing  -- the policy and view replaced here
--   20260807170100  opa_property_character_importer -- created the function
--   20260807180000  opa_sync_reentrancy_fix         -- the function version replaced here
--
-- FORWARD-ONLY. 20260807170000, 20260807170100 and 20260807180000 are all applied to
-- preview; their versions are in supabase_migrations.schema_migrations and the CLI will
-- never re-run them. Editing those files would desynchronise repo from ledger while
-- changing nothing in any database. Never edit an applied migration.
--
-- FIVE FIXES
-- ----------
-- 1. HIGH -- RLS on plm.opa_property_character was WIDE OPEN.
--    20260807170000 wrote `for select to authenticated using (true)` under a comment
--    claiming "Posture matches plm.erp_property / plm.erp_licensor". IT DID NOT.
--    20260724030000 gates both erp_ tables on
--        app.has_role('administrator')
--        or app.has_app_access('plm')
--        or app.has_any_role(array['sales','licensing'])
--    So every `authenticated` principal across all four applications -- including
--    `vendor` and `viewer` -- could read the entire confidential Disney extract
--    (property names, character names, Disney's own IDs, the source URL) through
--    api.opa_property_character. This repository is PUBLIC and is recovering from
--    exactly this class of exposure. The erp_ predicate is applied below.
--    Note the same migration role-gated core.property_character correctly, so this
--    was an internal inconsistency, not a deliberate posture. The misleading comment
--    in 20260807170000 is NOT edited (applied migration); it is corrected here and in
--    the build note.
--
-- 2. HIGH -- the shrink band was silently disabled by a NULL. See the long comment at
--    G8 below. LEAST/GREATEST ignore NULL, so a NULL fraction turned the truncated-
--    extract guard off while it still read as bounded.
--
-- 3. MEDIUM -- the staging temp table was referenced unqualified. pg_temp resolves
--    first when a temp table exists, but with none present resolution continued
--    through `search_path = plm, core, public, extensions`, and this SECURITY DEFINER
--    function runs as owner -- so a permanent table of that name could have been
--    dropped. Latent, never live. Now qualified pg_temp._opa_incoming throughout.
--
-- 4. MEDIUM -- api.opa_property_reconciliation claimed "one row per OPA property node"
--    while its GROUP BY included the four PER-ROW resolution columns, so a partially
--    resolved node split into several rows with its character count divided between
--    them. The VIEW is fixed rather than the comment, because the comment stated the
--    correct intent. THIS IS A DELIBERATE COLUMN-LIST CHANGE and therefore needs
--    DROP + CREATE: `create or replace view` cannot add, remove or rename columns.
--    Per-row `resolution_reason` and `resolved_by` are DROPPED because they have no
--    meaning at node grain; per-node aggregates replace them. Nothing consumes this
--    view yet (it was created hours ago in an unmerged branch), so no consumer breaks.
--
-- 5. MEDIUM -- the importer's row-shape guard embedded the first offending row's full
--    JSON in its error message, which reaches terminals, CI logs and the runner. It
--    now reports the row ORDINAL and WHICH CHECK FAILED, never the content.
--
-- Unchanged: still resolves nothing, still deletes nothing, still writes only
-- plm.opa_property_character. No table, constraint or index is altered.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. HIGH -- close the read policy to the erp_ posture it always claimed to have.
-- -------------------------------------------------------------------------------------
drop policy if exists opa_property_character_read on plm.opa_property_character;

create policy opa_property_character_read
  on plm.opa_property_character
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

comment on table plm.opa_property_character is
  'RAW Disney OPA (opa.disney.com) property->character picker extract. '
  'READ IS RESTRICTED (migration 20260807190000): administrator, plm app access, or '
  'the sales/licensing roles only -- matching plm.erp_licensor / plm.erp_property. '
  'It is NOT readable by every authenticated account; vendor and viewer are excluded. '
  'SCOPE WARNING: Home line of business ONLY (lobName=Option.Lob.Home), and '
  'ONLY the properties POP Creations'' licensee account is entitled to see. '
  'This is NOT all of Disney and NOT all lines of business. Point-in-time '
  'snapshot, no change feed; refresh is a full manual re-extract requiring '
  'Albert to complete MFA in his own browser. AUTHORITY (owner ruling '
  '2026-08-07): authoritative for what it ASSERTS, SILENT about what it OMITS. '
  'Presence adds and corrects; ABSENCE NEVER REMOVES. Disney''s strings are '
  'stored verbatim; interpretation belongs in api.opa_property_character. '
  'Business-confidential Disney data under a commercial licensing relationship '
  '- do not publish, do not send to any third-party service, and NEVER commit a '
  'row of it to this PUBLIC repository. Rows are loaded at runtime by '
  'plm.sync_opa_property_character, never by a seed.';

-- -------------------------------------------------------------------------------------
-- 2. MEDIUM -- api.opa_property_reconciliation at true node grain.
--
-- DROP + CREATE is required: this changes the column list, which
-- `create or replace view` cannot do.
-- -------------------------------------------------------------------------------------
drop view if exists api.opa_property_reconciliation;

create view api.opa_property_reconciliation
with (security_invoker = true) as
select
  o.licensed_property_id,

  -- Constant within a licensed_property_id in every extract seen so far, but NOT
  -- enforced by any constraint, so it is aggregated rather than grouped on. Grouping
  -- on it is what split nodes into multiple rows before.
  min(o.property_name)                                   as opa_property_name,

  count(*)                                               as opa_character_count,
  count(*) filter (where o.resolution_status = 'unresolved')
                                                         as unresolved_character_count,

  -- A node CAN legitimately resolve to more than one core.property while work is in
  -- progress. Reported as a set, not collapsed to one value that would be a guess.
  count(distinct o.property_id)                          as matched_core_property_count,
  array_agg(distinct o.property_id) filter (where o.property_id is not null)
                                                         as matched_core_property_ids,
  array_agg(distinct p.name) filter (where p.name is not null)
                                                         as core_property_names,
  array_agg(distinct l.code) filter (where l.code is not null)
                                                         as core_licensor_codes,

  -- 'mixed' when a node disagrees with itself. Previously this disagreement silently
  -- became extra rows with the character count divided between them.
  case
    when count(distinct o.resolution_status) = 1 then min(o.resolution_status)
    else 'mixed'
  end                                                    as resolution_status,
  max(o.resolved_at)                                     as last_resolved_at,

  min(o.captured_at)                                     as captured_at,
  min(o.line_of_business)                                as line_of_business,
  min(o.entitlement_scope)                               as entitlement_scope
from plm.opa_property_character o
left join core.property p on p.id = o.property_id
left join core.licensor l on l.id = p.licensor_id
group by o.licensed_property_id;

comment on view api.opa_property_reconciliation is
  'EXACTLY one row per Disney OPA property node (grouped on licensed_property_id '
  'alone) with its reconciliation state against core.property. Corrected by migration '
  '20260807190000: the original grouped on the PER-ROW resolution columns, so a '
  'partially resolved node returned several rows with its character count divided '
  'between them. Per-row resolution_reason and resolved_by were dropped as meaningless '
  'at node grain; resolution_status reports ''mixed'' when a node disagrees with itself. '
  'CAVEAT ON THE LEFT JOINS: core.property and core.licensor carry their own RLS '
  '(shared_read, gated on app.has_any_role of administrator/sales/licensing/designer/'
  'viewer/vendor). A principal that reads this view via app.has_app_access(''plm'') but '
  'holds NO app_role passes the mirror''s policy and FAILS core.property''s, so '
  'core_property_names and core_licensor_codes come back EMPTY rather than raising. '
  'Empty name arrays beside a non-null matched_core_property_ids means RLS suppression, '
  'NOT an unresolved node. EXPECT A LOW MATCH RATE generally and do not treat it as an '
  'error: core.property mirrors ColdLion (what POP produces or holds a code for) while '
  'OPA carries Disney''s licensable title catalogue for the Home line of business. '
  'Resolution NEVER mutates core.property.';

grant select on api.opa_property_reconciliation to authenticated;
grant select on api.opa_property_reconciliation to service_role;
revoke all on api.opa_property_reconciliation from anon;

-- -------------------------------------------------------------------------------------
-- 3. The importer: NULL-safe shrink band, pg_temp-qualified staging, and a row-shape
--    guard that reports an ordinal instead of a row.
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
  v_first_ord   integer;
  v_shrink      numeric;
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
  -- The CASE is ordered so the type checks run BEFORE the ::bigint cast; CASE
  -- short-circuits, so a non-numeric optionSourceID is reported, not crashed on.
  select count(*) filter (where f.reason is not null),
         min(f.ord) filter (where f.reason is not null),
         (array_agg(f.reason order by f.ord) filter (where f.reason is not null))[1]
  into v_bad, v_first_ord, v_sample
  from (
    select r.ord,
      case
        when jsonb_typeof(r.value) <> 'object'                          then 'row is not a JSON object'
        when jsonb_typeof(r.value -> 'licensedPropertyID') <> 'number'  then 'licensedPropertyID is not a number'
        when jsonb_typeof(r.value -> 'characterID') <> 'number'         then 'characterID is not a number'
        when jsonb_typeof(r.value -> 'brandPropertyID') <> 'number'     then 'brandPropertyID is not a number'
        when jsonb_typeof(r.value -> 'optionSourceID') <> 'number'      then 'optionSourceID is not a number'
        when btrim(coalesce(r.value ->> 'property', '')) = ''           then 'property name is blank'
        when btrim(coalesce(r.value ->> 'character', '')) = ''          then 'character name is blank'
        when (r.value ->> 'optionSourceID')::bigint <> 1007             then 'optionSourceID is not 1007'
      end as reason
    from jsonb_array_elements(v_rows) with ordinality as r(value, ord)
  ) f;

  if v_bad > 0 then
    -- REPORTS THE ROW ORDINAL AND WHICH CHECK FAILED -- NEVER THE ROW CONTENT.
    -- This message reaches terminals, CI logs and the runner. The extract is
    -- confidential Disney data and this repository is PUBLIC, so a diagnostic that
    -- echoes a row is a leak. Look the row up by ordinal in the source CSV.
    raise exception 'OPA import refused: % of % row(s) failed the shape check. First '
      'offender is row % (1-based, excluding the CSV header): %. Row content is '
      'deliberately NOT included -- look it up by ordinal in the source extract. '
      'optionSourceID is pinned to 1007 so an extract whose shape we have never '
      'verified fails LOUDLY instead of landing silently.',
      v_bad, v_seen, v_first_ord, v_sample using errcode = 'P0001';
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
  -- THE NULL HOLE THIS REPLACES (migration 20260807190000). The previous form was:
  --     v_seen < v_before * (1 - greatest(0, least(1, p_max_shrink_fraction)))
  -- Postgres LEAST/GREATEST **IGNORE NULL ARGUMENTS**. A NULL fraction therefore
  -- collapsed the expression to 1, the threshold became v_before * 0, and
  -- `v_seen < 0` could never be true -- the truncated-extract guard was SILENTLY
  -- DISABLED while reading as if it were bounded. Measured on this database:
  --     greatest(0::numeric, least(1::numeric, null::numeric))  =>  1
  -- WARNING TO WHOEVER WRITES THE NEXT BOUNDS CHECK: wrapping coalesce() around
  -- the OUTSIDE of greatest(...) does NOT fix this. It returns 1, not NULL, so the
  -- guard stays disabled while looking corrected. Validate the PARAMETER instead,
  -- which is what the explicit check below does.
  if p_max_shrink_fraction is null then
    raise exception 'OPA import refused: p_max_shrink_fraction is NULL. Omit the argument '
      'to accept the 0.10 default, or pass an explicit fraction. NULL is rejected rather '
      'than defaulted because it usually means the caller sent NaN (JSON serialises NaN '
      'as null), and silently defaulting would hide a broken caller.'
      using errcode = 'P0001';
  end if;

  if p_max_shrink_fraction < 0 or p_max_shrink_fraction > 1 then
    raise exception 'OPA import refused: p_max_shrink_fraction must be between 0 and 1 '
      'inclusive, got %.', p_max_shrink_fraction using errcode = 'P0001';
  end if;

  v_shrink := p_max_shrink_fraction;

  select count(*) into v_before from plm.opa_property_character;

  if v_before > 0 and v_seen < v_before * (1 - v_shrink) then
    raise exception 'OPA import refused: snapshot has % rows against % already stored, a '
      'drop beyond the %%%s shrink band. A truncated or partially-scraped extract looks '
      'exactly like this. Re-extract, or pass a wider p_max_shrink_fraction deliberately.',
      v_seen, v_before, round(v_shrink * 100, 1)
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
  -- THE FIX (20260807180000). ON COMMIT DROP fires only at COMMIT, so a SECOND call
  -- inside the SAME transaction previously hit 42P07 "relation _opa_incoming already
  -- exists". Dropping first makes the function re-entrant. Temp tables are
  -- session-local, so this cannot touch another session's staging table.
  drop table if exists pg_temp._opa_incoming;
  create temporary table pg_temp._opa_incoming on commit drop as
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
  from pg_temp._opa_incoming i
  join plm.opa_property_character o
    on o.licensed_property_id = i.licensed_property_id
   and o.character_id = i.character_id
  where o.source_hash = i.source_hash
    and o.captured_at = v_captured;

  select count(*) into v_upd
  from pg_temp._opa_incoming i
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
  from pg_temp._opa_incoming i
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
    select 1 from pg_temp._opa_incoming i
    where i.licensed_property_id = o.licensed_property_id
      and i.character_id = o.character_id
  );

  select count(distinct i.licensed_property_id), count(distinct i.character_id)
  into v_dprop, v_dchar
  from pg_temp._opa_incoming i;

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
'Home line of business, per-row shape with optionSourceID pinned to 1007 reporting the '
'row ORDINAL and never row content, duplicate natural-key detection on the ID PAIR '
'(never the name pair), and a NULL-rejecting shrink band. Writes ONLY '
'plm.opa_property_character vendor columns. NEVER writes core.*, NEVER sets any '
'resolution column, and NEVER deletes: absence is reported as rows_missing. '
'Re-entrant within a transaction (20260807180000); pg_temp-qualified staging, NULL-safe '
'shrink band and leak-free diagnostics as of 20260807190000.';

revoke all on function plm.sync_opa_property_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_opa_property_character(jsonb, text, numeric) to service_role;
