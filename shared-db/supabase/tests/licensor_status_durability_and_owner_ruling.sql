-- Rollback-safe contract tests for
--   20260802170000_plm_import_preserve_curated_licensor_property_status.sql
--   20260802171000_owner_ruling_friends_tv_frida_kahlo.sql
--
-- Run against a disposable DB or preview AFTER both migrations are applied.
-- Every fixture rolls back. Do not run as a long-lived production session.
--
-- Proves, in order:
--   A. OBJECT EXISTENCE. core.licensor.status and core.property.status exist and are
--      app.entity_status, and that enum can already express 'inactive'. This is the
--      evidence that no new status column was needed and none was added.
--   B. OBJECT EXISTENCE. core.taxonomy_owner_ruling exists, has RLS on, and is
--      read-only for browser roles.
--   C. BEHAVIOUR. A ruling cannot be faked: ruler, timestamp, evidence and action are
--      each unrepresentable as blank, and a ruling must name a subject.
--   D. BEHAVIOUR. A real PLM re-pull no longer resets a curated status. This calls
--      plm.import_master_data() for real against a fixture.
--   E. BEHAVIOUR. Albert's 2026-08-02 ruling is recorded, with the date reading
--      2026-08-02 in BOTH UTC and the server's local timezone.
--   F. BEHAVIOUR. The applied half landed (licensor FR is inactive) and the unapplied
--      half was genuinely left alone (property FK untouched, nothing deleted).

begin;

-- ---------------------------------------------------------------------------
-- A. The status column already existed. No new column was added.
-- ---------------------------------------------------------------------------
do $$
declare
  v_typ text;
begin
  if to_regclass('core.licensor') is null then
    raise exception 'A FAILED: core.licensor is missing';
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_typ
  from pg_attribute a
  where a.attrelid = 'core.licensor'::regclass and a.attname = 'status'
    and a.attnum > 0 and not a.attisdropped;

  if v_typ is distinct from 'app.entity_status' then
    raise exception 'A FAILED: core.licensor.status is % (expected app.entity_status)',
      coalesce(v_typ, 'ABSENT');
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_typ
  from pg_attribute a
  where a.attrelid = 'core.property'::regclass and a.attname = 'status'
    and a.attnum > 0 and not a.attisdropped;

  if v_typ is distinct from 'app.entity_status' then
    raise exception 'A FAILED: core.property.status is % (expected app.entity_status)',
      coalesce(v_typ, 'ABSENT');
  end if;

  -- The enum must already be able to say "defunct". If this ever fails, adding an enum
  -- VALUE is the fix -- never a second status column.
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'app' and t.typname = 'entity_status' and e.enumlabel = 'inactive'
  ) then
    raise exception 'A FAILED: app.entity_status cannot express ''inactive''';
  end if;

  -- Guard against a redundant flag being introduced later by anyone.
  if exists (
    select 1 from pg_attribute a
    where a.attrelid = 'core.licensor'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname in ('is_active', 'active', 'is_defunct', 'defunct', 'active_flag')
  ) then
    raise exception
      'A FAILED: core.licensor has a redundant active/defunct flag alongside status';
  end if;

  raise notice 'A OK: status column pre-exists on licensor and property; enum covers inactive';
end;
$$;

-- ---------------------------------------------------------------------------
-- B. The ruling table exists and browser roles cannot write to it.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('core.taxonomy_owner_ruling') is null then
    raise exception 'B FAILED: core.taxonomy_owner_ruling does not exist';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'core.taxonomy_owner_ruling'::regclass) then
    raise exception 'B FAILED: RLS is not enabled on core.taxonomy_owner_ruling';
  end if;

  if not has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'select') then
    raise exception
      'B FAILED: authenticated cannot SELECT core.taxonomy_owner_ruling (a policy without a '
      'grant is the failure mode that looks like success)';
  end if;

  if has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'insert')
     or has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'update')
     or has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'delete') then
    raise exception 'B FAILED: authenticated can write to core.taxonomy_owner_ruling';
  end if;

  if has_table_privilege('anon', 'core.taxonomy_owner_ruling', 'select') then
    raise exception 'B FAILED: anon can read core.taxonomy_owner_ruling';
  end if;

  if not has_table_privilege('service_role', 'core.taxonomy_owner_ruling', 'insert') then
    raise exception 'B FAILED: service_role cannot write core.taxonomy_owner_ruling';
  end if;

  raise notice 'B OK: ruling table exists, RLS on, browser roles read-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- C. A ruling cannot be faked, even by service_role.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- Blank ruler must be rejected.
  begin
    insert into core.taxonomy_owner_ruling
      (entity_table, entity_code, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
    values ('licensor', 'ZZTEST', 'x', '   ', now(), 'e', 'a');
    raise exception 'C FAILED: a blank ruled_by was accepted';
  exception when check_violation then null;
  end;

  -- Blank evidence must be rejected.
  begin
    insert into core.taxonomy_owner_ruling
      (entity_table, entity_code, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
    values ('licensor', 'ZZTEST', 'x', 'Someone', now(), '', 'a');
    raise exception 'C FAILED: a blank ruling_evidence was accepted';
  exception when check_violation then null;
  end;

  -- A missing timestamp must be rejected.
  begin
    insert into core.taxonomy_owner_ruling
      (entity_table, entity_code, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
    values ('licensor', 'ZZTEST', 'x', 'Someone', null, 'e', 'a');
    raise exception 'C FAILED: a null ruled_at was accepted';
  exception when not_null_violation then null;
  end;

  -- A ruling about nothing must be rejected.
  begin
    insert into core.taxonomy_owner_ruling
      (entity_table, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
    values ('licensor', 'x', 'Someone', now(), 'e', 'a');
    raise exception 'C FAILED: a subjectless ruling was accepted';
  exception when check_violation then null;
  end;

  -- A complete ruling must be accepted.
  insert into core.taxonomy_owner_ruling
    (entity_table, entity_code, ruling, ruled_by, ruled_at, ruling_evidence, action_taken)
  values ('licensor', 'ZZTEST', 'x', 'Someone', now(), 'e', 'a');

  raise notice 'C OK: ruling provenance cannot be faked';
end;
$$;

-- ---------------------------------------------------------------------------
-- D. A real PLM re-pull no longer resets curated status.
--    This is the whole point of 20260802170000 and is tested by calling the
--    importer for real, not by reading its source.
-- ---------------------------------------------------------------------------
do $$
declare
  v_suffix   text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_lic_id   uuid;
  v_prop_id  uuid;
  v_lic_src  text;
  v_prop_src text;
  v_status   text;
  v_lic_par  uuid;
begin
  v_lic_src  := 'zztest-lic-'  || v_suffix;
  v_prop_src := 'zztest-prop-' || v_suffix;

  -- A curated, deliberately INACTIVE licensor with a defunct property under it,
  -- both already known to the PLM importer via taxonomy_source_ref.
  insert into core.licensor (name, code, status)
  values ('ZZ TEST DEFUNCT LICENSOR ' || v_suffix, 'ZZT-' || v_suffix, 'inactive')
  returning id into v_lic_id;

  insert into core.property (licensor_id, name, code, status)
  values (v_lic_id, 'ZZ TEST DEFUNCT PROPERTY ' || v_suffix, 'ZZP-' || v_suffix, 'inactive')
  returning id into v_prop_id;

  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'licensor', v_lic_id, 'designflow_plm', 'merchGroup', v_lic_src),
         ('core', 'property', v_prop_id, 'designflow_plm', 'merchGroup', v_prop_src);

  -- Re-pull exactly these two from PLM, the way the real sync does.
  perform plm.import_master_data(
    jsonb_build_array(
      jsonb_build_object(
        'id',      v_lic_src,
        'title',   'ZZ TEST DEFUNCT LICENSOR ' || v_suffix,
        'mg_code', 'ZZT-' || v_suffix,
        'properties', jsonb_build_array(
          jsonb_build_object(
            'id',      v_prop_src,
            'title',   'ZZ TEST DEFUNCT PROPERTY ' || v_suffix,
            'mg_code', 'ZZP-' || v_suffix
          )
        )
      )
    ),
    '[]'::jsonb
  );

  select status::text into v_status from core.licensor where id = v_lic_id;
  if v_status is distinct from 'inactive' then
    raise exception
      'D FAILED: a PLM re-pull reset core.licensor.status to %. Curated status is not '
      'durable and any owner ruling will silently revert.', v_status;
  end if;

  select status::text, licensor_id into v_status, v_lic_par
  from core.property where id = v_prop_id;
  if v_status is distinct from 'inactive' then
    raise exception
      'D FAILED: a PLM re-pull reset core.property.status to %', v_status;
  end if;

  -- Documenting the KNOWN, deliberate remaining gap: parentage is still PLM-owned.
  -- This asserts the importer still re-points, so that if someone later changes that
  -- behaviour without an owner decision, this test tells them.
  if v_lic_par is distinct from v_lic_id then
    raise exception
      'D FAILED: unexpected parentage change -- fixture property moved to %', v_lic_par;
  end if;

  raise notice 'D OK: curated licensor/property status survives a real PLM re-pull';
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Albert's ruling of 2026-08-02 is recorded, and dated correctly in BOTH
--    UTC and the server's local timezone.
-- ---------------------------------------------------------------------------
do $$
declare
  r          record;
  v_count    integer;
  v_utc      date;
  v_local    date;
  v_srvtz    text := current_setting('TimeZone');
begin
  select count(*) into v_count
  from core.taxonomy_owner_ruling
  where ruled_at = timestamptz '2026-08-02 12:00:00+00'
    and ruled_by = 'Albert Hazan (owner)';

  if v_count <> 2 then
    raise exception
      'E FAILED: expected 2 rows for the 2026-08-02 ruling (licensor FR + property FK), found %',
      v_count;
  end if;

  for r in
    select entity_table, entity_code, ruled_at, action_taken, open_questions
    from core.taxonomy_owner_ruling
    where ruled_at = timestamptz '2026-08-02 12:00:00+00'
      and ruled_by = 'Albert Hazan (owner)'
  loop
    v_utc   := (r.ruled_at at time zone 'UTC')::date;
    v_local := (r.ruled_at at time zone v_srvtz)::date;

    if v_utc <> date '2026-08-02' then
      raise exception 'E FAILED: %/% reads % in UTC, expected 2026-08-02',
        r.entity_table, r.entity_code, v_utc;
    end if;

    -- THE TRAP. A midnight-UTC timestamp passes the UTC check above and fails here.
    if v_local <> date '2026-08-02' then
      raise exception
        'E FAILED: %/% reads % in server-local time (%), expected 2026-08-02. The approval '
        'timestamp was not pinned to midday UTC.',
        r.entity_table, r.entity_code, v_local, v_srvtz;
    end if;

    if r.open_questions is null or length(btrim(r.open_questions)) = 0 then
      if r.entity_table = 'property' then
        raise exception
          'E FAILED: the FK ruling records no open questions, but the FRIDA KAHLO licensor '
          'and the re-point are explicitly undecided';
      end if;
    end if;
  end loop;

  -- The FK ruling must be honest that it changed no data.
  if not exists (
    select 1 from core.taxonomy_owner_ruling
    where entity_table = 'property' and entity_code = 'FK'
      and ruled_at = timestamptz '2026-08-02 12:00:00+00'
      and action_taken like 'RECORDED ONLY%'
  ) then
    raise exception
      'E FAILED: the FK ruling does not state that it is recorded-only. A reader could '
      'mistake a recorded opinion for an applied change.';
  end if;

  raise notice 'E OK: ruling recorded, dated 2026-08-02 in UTC and in % ', v_srvtz;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. The applied half landed; the unapplied half was genuinely left alone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fr_id     uuid;
  v_fk_id     uuid;
  v_fr_status text;
  v_fk_status text;
  v_fk_parent uuid;
  v_srcrefs   integer;
begin
  select id, status::text into v_fr_id, v_fr_status
  from core.licensor where code = 'FR' and name = 'FRIENDS TV';

  if v_fr_id is null then
    raise exception
      'F FAILED: licensor FR was removed. The ruling was additive and reversible only -- '
      'nothing should have been deleted.';
  end if;

  if v_fr_status <> 'inactive' then
    raise exception
      'F FAILED: licensor FR status is %, expected inactive', v_fr_status;
  end if;

  select id, status::text, licensor_id into v_fk_id, v_fk_status, v_fk_parent
  from core.property where code = 'FK' and name = 'FRIDA KAHLO';

  if v_fk_id is null then
    raise exception 'F FAILED: property FK was removed';
  end if;

  -- Deliberately unchanged: the re-point is escalated, not applied.
  if v_fk_parent is distinct from v_fr_id then
    raise exception
      'F FAILED: property FK was re-pointed away from FR. That re-point is an undecided '
      'owner question and must not have been applied.';
  end if;

  if v_fk_status <> 'active' then
    raise exception
      'F FAILED: property FK status is %, expected active (unchanged)', v_fk_status;
  end if;

  -- Nothing was deleted from the audit trail either.
  select count(*) into v_srcrefs
  from core.taxonomy_source_ref
  where (entity_table = 'licensor' and entity_id = v_fr_id)
     or (entity_table = 'property' and entity_id = v_fk_id);

  if v_srcrefs < 2 then
    raise exception
      'F FAILED: expected both FR and FK to keep their taxonomy_source_ref rows, found %',
      v_srcrefs;
  end if;

  -- The unrelated, correct FRIENDS property under Warner Bros must be untouched.
  if not exists (
    select 1 from core.property p join core.licensor l on l.id = p.licensor_id
    where p.code = 'FN' and p.name = 'FRIENDS' and l.code = 'WB' and p.status = 'active'
  ) then
    raise exception
      'F FAILED: property FN "FRIENDS" under WB WARNER BROS was disturbed. It is the real '
      'Friends TV series and is outside this ruling.';
  end if;

  raise notice 'F OK: FR inactive; FK, its parentage, its source refs and FN/WB all intact';
end;
$$;

rollback;
