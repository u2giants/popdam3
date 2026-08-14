-- Issue #953: make the guarded Disney OPA importer honor the normalized model.
-- Forward-only. The deprecated link columns remain for compatibility and are not dropped.

alter table plm.opa_property_character
  alter column property_name drop not null,
  alter column character_name drop not null;

comment on column plm.opa_property_character.property_name is
  'DEPRECATED compatibility column. The guarded importer no longer writes it. New links '
  'store NULL; remove only after Disney re-verifies and every consumer is off it.';

comment on column plm.opa_property_character.character_name is
  'DEPRECATED compatibility column. The guarded importer no longer writes it. New links '
  'store NULL; remove only after Disney re-verifies and every consumer is off it.';

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
  v_conflicts   integer := 0;
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

  -- One source ID may have only one display name in a snapshot. Names are not keys and
  -- different IDs may share a name, but one ID carrying conflicting names is ambiguous.
  select count(*) into v_conflicts
  from (
    select (r.value ->> 'licensedPropertyID')::bigint
    from jsonb_array_elements(v_rows) r
    group by 1
    having count(distinct btrim(r.value ->> 'property')) > 1
  ) c;

  if v_conflicts > 0 then
    raise exception 'OPA import refused: % licensedPropertyID value(s) carry conflicting '
      'property names. Identity stays keyed by ID; the database will not choose a name.',
      v_conflicts using errcode = 'P0001';
  end if;

  select count(*) into v_conflicts
  from (
    select (r.value ->> 'characterID')::bigint
    from jsonb_array_elements(v_rows) r
    group by 1
    having count(distinct btrim(r.value ->> 'character')) > 1
  ) c;

  if v_conflicts > 0 then
    raise exception 'OPA import refused: % characterID value(s) carry conflicting '
      'character names. Identity stays keyed by ID; the database will not choose a name.',
      v_conflicts using errcode = 'P0001';
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
  -- NORMALIZED UPSERT. Entity rows are written before link rows so the foreign keys are
  -- always satisfied. Human core resolutions live on the entities and are deliberately
  -- absent from every UPDATE list.
  -- ---------------------------------------------------------------------------------
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

  insert into plm.opa_property as p (
    licensed_property_id, property_name, first_seen_at, last_seen_at, updated_at
  )
  select distinct
    i.licensed_property_id, i.property_name, now(), now(), now()
  from pg_temp._opa_incoming i
  on conflict (licensed_property_id) do update set
    property_name = excluded.property_name,
    last_seen_at  = now(),
    updated_at    = now();

  insert into plm.opa_character as c (
    character_id, character_name, first_seen_at, last_seen_at, updated_at
  )
  select distinct
    i.character_id, i.character_name, now(), now(), now()
  from pg_temp._opa_incoming i
  on conflict (character_id) do update set
    character_name = excluded.character_name,
    last_seen_at   = now(),
    updated_at     = now();

  insert into plm.opa_property_character as t (
    licensed_property_id, character_id,
    brand_property_id, option_source_id,
    captured_at, source_url, line_of_business,
    raw, source_hash,
    first_seen_at, last_seen_at, imported_at, updated_at
  )
  select
    i.licensed_property_id, i.character_id,
    i.brand_property_id, i.option_source_id,
    v_captured, v_source_url, v_lob,
    i.raw, i.source_hash,
    now(), now(), now(), now()
  from pg_temp._opa_incoming i
  on conflict (licensed_property_id, character_id) do update set
    brand_property_id = excluded.brand_property_id,
    option_source_id  = excluded.option_source_id,
    captured_at       = excluded.captured_at,
    source_url        = excluded.source_url,
    line_of_business  = excluded.line_of_business,
    raw               = excluded.raw,
    source_hash       = excluded.source_hash,
    last_seen_at      = now(),
    imported_at       = now(),
    updated_at        = now();

  -- The temporary compatibility trigger may see old duplicate names during the UPDATE
  -- half of an ON CONFLICT operation. Reassert entity names from the current snapshot
  -- after the link write. This still preserves every core_* resolution column.
  update plm.opa_property p
  set property_name = i.property_name,
      last_seen_at  = now(),
      updated_at    = now()
  from (
    select distinct licensed_property_id, property_name
    from pg_temp._opa_incoming
  ) i
  where p.licensed_property_id = i.licensed_property_id
    and p.property_name is distinct from i.property_name;

  update plm.opa_character c
  set character_name = i.character_name,
      last_seen_at   = now(),
      updated_at     = now()
  from (
    select distinct character_id, character_name
    from pg_temp._opa_incoming
  ) i
  where c.character_id = i.character_id
    and c.character_name is distinct from i.character_name;

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
'MIRROR-ONLY guarded importer for the confidential Disney OPA property-to-character '
'extract. Upserts plm.opa_property by licensed_property_id and plm.opa_character by '
'character_id before writing the many-to-many link. Display names live on those entity '
'rows; core_property_id, core_character_id and all human resolution fields survive '
'refreshes. The link receives only the ID pair, pair-level brand_property_id, source '
'provenance and raw evidence. It never writes deprecated property_name, character_name '
'or property_id link columns. Names are not identity; conflicting names for one ID are '
'refused without exposing row content. Existing privilege, mode, shape, optionSourceID, '
'duplicate-pair, shrink, advisory-lock, no-delete and leak-free diagnostic guards remain.';

revoke all on function plm.sync_opa_property_character(jsonb, text, numeric) from public;
grant execute on function plm.sync_opa_property_character(jsonb, text, numeric) to service_role;
