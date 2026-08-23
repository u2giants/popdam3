-- Synthetic contract for issue #953. No licensed Disney rows are read or committed.
begin;

do $$
declare
  v_licensor uuid;
  v_core_property uuid;
  v_result record;
  v_count integer;
  v_text text;
  v_uuid uuid;
  v_snapshot jsonb;
begin
  -- The deprecated link columns remain temporarily for compatibility, but new normalized
  -- writes must be able to omit them.
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'plm.opa_property_character'::regclass
      and attname in ('property_name', 'character_name', 'property_id')
      and attnotnull
  ) then
    raise exception 'deprecated OPA link columns are still NOT NULL';
  end if;

  insert into core.licensor (name, code)
  values ('Synthetic OPA Contract Licensor', 'ZZOPA953')
  returning id into v_licensor;

  insert into core.property (licensor_id, name, code)
  values (v_licensor, 'Synthetic OPA Core Property', 'ZZOPA953P')
  returning id into v_core_property;

  if to_regclass('core.character') is not null then
    raise exception 'retired core.character unexpectedly exists';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'plm.opa_character'::regclass
      and attname = 'core_character_id' and not attisdropped and not attnotnull
  ) then
    raise exception 'plm.opa_character.core_character_id must remain nullable';
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'plm.opa_character'::regclass
      and c.contype = 'f'
      and c.conkey = array[(select attnum from pg_attribute
        where attrelid = 'plm.opa_character'::regclass and attname = 'core_character_id')]::smallint[]
  ) then
    raise exception 'plm.opa_character.core_character_id still has a foreign key to retired core.character';
  end if;

  -- Seed one entity pair, record its decisions in the durable home, and add one legacy
  -- link. A refresh may update display names but must preserve the durable decisions.
  insert into plm.opa_property (
    licensed_property_id, property_name, last_seen_at
  ) values (
    953000001, 'Old Entity Property Name',
    timestamptz '2026-08-01 00:00:00+00'
  );

  insert into plm.opa_character (
    character_id, character_name, last_seen_at
  ) values (
    953000101, 'Old Entity Character Name',
    timestamptz '2026-08-01 00:00:00+00'
  );

  perform plm.set_source_resolution(
    'disney_opa','property','953000001','matched',v_core_property,
    null,null,null,'synthetic contract resolution',null
  );

  insert into plm.opa_property_character (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id, captured_at, source_url,
    line_of_business, entitlement_scope, raw, source_hash
  ) values (
    953000001, 953000101, 'Legacy Link Property Name', 'Legacy Link Character Name',
    953000901, 1007, date '2026-08-13', 'https://example.invalid/opa-contract',
    'Home', 'licensee_account', '{}'::jsonb, md5('{}')
  );

  v_snapshot := jsonb_build_object(
      'captured_at', '2026-08-14',
      'source_url', 'https://example.invalid/opa-contract',
      'line_of_business', 'Home',
      'rows', jsonb_build_array(
        jsonb_build_object(
          'licensedPropertyID', 953000001,
          'characterID', 953000101,
          'property', 'Shared Synthetic Property Name',
          'character', 'Shared Synthetic Character Name',
          'brandPropertyID', 953000911,
          'optionSourceID', 1007
        ),
        jsonb_build_object(
          'licensedPropertyID', 953000002,
          'characterID', 953000101,
          'property', 'Shared Synthetic Property Name',
          'character', 'Shared Synthetic Character Name',
          'brandPropertyID', 953000912,
          'optionSourceID', 1007
        ),
        jsonb_build_object(
          'licensedPropertyID', 953000002,
          'characterID', 953000102,
          'property', 'Shared Synthetic Property Name',
          'character', 'Shared Synthetic Character Name',
          'brandPropertyID', 953000913,
          'optionSourceID', 1007
        )
      )
    );

  select * into v_result
  from plm.sync_opa_property_character(
    v_snapshot,
    'mirror_only',
    1.0
  );

  if v_result.rows_seen <> 3 or v_result.distinct_property <> 2
     or v_result.distinct_character <> 2 then
    raise exception 'normalized OPA counts are wrong: seen %, properties %, characters %',
      v_result.rows_seen, v_result.distinct_property, v_result.distinct_character;
  end if;

  select count(*) into v_count
  from plm.opa_property
  where licensed_property_id in (953000001, 953000002);
  if v_count <> 2 then
    raise exception 'expected two ID-keyed property entities, found %', v_count;
  end if;

  select count(*) into v_count
  from plm.opa_character
  where character_id in (953000101, 953000102);
  if v_count <> 2 then
    raise exception 'expected two ID-keyed character entities, found %', v_count;
  end if;

  -- Duplicate display names are valid and must not collapse identity.
  select count(*) into v_count
  from plm.opa_property
  where licensed_property_id in (953000001, 953000002)
    and property_name = 'Shared Synthetic Property Name';
  if v_count <> 2 then
    raise exception 'property entities were deduplicated by display name';
  end if;

  select count(*) into v_count
  from plm.opa_character
  where character_id in (953000101, 953000102)
    and character_name = 'Shared Synthetic Character Name';
  if v_count <> 2 then
    raise exception 'character entities were deduplicated by display name';
  end if;

  -- The same character ID under two property IDs proves the link remains many-to-many.
  select count(*) into v_count
  from plm.opa_property_character
  where character_id = 953000101
    and licensed_property_id in (953000001, 953000002);
  if v_count <> 2 then
    raise exception 'many-to-many OPA link was collapsed; expected 2 rows, found %', v_count;
  end if;

  -- brand_property_id belongs to each pair.
  if (select brand_property_id from plm.opa_property_character
      where licensed_property_id = 953000001 and character_id = 953000101) <> 953000911
     or (select brand_property_id from plm.opa_property_character
         where licensed_property_id = 953000002 and character_id = 953000101) <> 953000912 then
    raise exception 'pair-level brand_property_id was lost or moved to an entity';
  end if;

  -- Existing deprecated values are left untouched, and new links store SQL NULL there.
  select property_name into v_text
  from plm.opa_property_character
  where licensed_property_id = 953000001 and character_id = 953000101;
  if v_text is distinct from 'Legacy Link Property Name' then
    raise exception 'refresh rewrote deprecated link property_name to %', v_text;
  end if;

  if exists (
    select 1 from plm.opa_property_character
    where licensed_property_id = 953000002
      and (property_name is not null or character_name is not null or property_id is not null)
  ) then
    raise exception 'new normalized links wrote a deprecated name/property_id column';
  end if;

  -- Entity-level human resolutions must survive the name refresh.
  select core_property_id into v_uuid
  from plm.source_resolution
  where source_system='disney_opa' and entity_kind='property' and source_id='953000001';
  if v_uuid is distinct from v_core_property then
    raise exception 'property core resolution was overwritten';
  end if;

  if (select resolution_status from plm.source_resolution
      where source_system='disney_opa' and entity_kind='property' and source_id='953000001')
       is distinct from 'matched'
     then
    raise exception 'entity resolution status was overwritten';
  end if;

  if exists (
    select 1 from plm.source_resolution
    where source_system='disney_opa' and entity_kind='character'
      and source_id in ('953000101','953000102')
      and core_character_id is not null
  ) then
    raise exception 'normalized OPA sync recreated a retired Universe A character resolution';
  end if;

  -- Reset only recency while keeping the same display names, then replay the identical
  -- snapshot. This proves an unchanged observation still advances last_seen_at.
  update plm.opa_property
  set last_seen_at = timestamptz '2026-08-01 00:00:00+00'
  where licensed_property_id = 953000001;
  update plm.opa_character
  set last_seen_at = timestamptz '2026-08-01 00:00:00+00'
  where character_id = 953000101;

  perform * from plm.sync_opa_property_character(v_snapshot, 'mirror_only', 1.0);

  if (select last_seen_at from plm.opa_property where licensed_property_id = 953000001)
       <= timestamptz '2026-08-01 00:00:00+00'
     or (select last_seen_at from plm.opa_character where character_id = 953000101)
       <= timestamptz '2026-08-01 00:00:00+00' then
    raise exception 'entity last_seen_at did not advance on a repeated observation';
  end if;

  if has_function_privilege('public',
       'plm.sync_opa_property_character(jsonb,text,numeric)', 'execute') then
    raise exception 'PUBLIC can execute the guarded OPA sync function';
  end if;

  if not has_function_privilege('service_role',
       'plm.sync_opa_property_character(jsonb,text,numeric)', 'execute') then
    raise exception 'service_role cannot execute the guarded OPA sync function';
  end if;

  raise notice 'normalized OPA sync contracts passed';
end $$;

rollback;
