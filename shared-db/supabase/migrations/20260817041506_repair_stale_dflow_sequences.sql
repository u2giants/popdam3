-- Keep the two legacy nextval-backed sequences ahead of their tables.
-- The table locks close the race between reading MAX(id) and resetting the
-- associated sequence. Existing values are never moved backwards.

lock table dflow."LicensingTime" in share row exclusive mode;

select setval(
  'dflow."LicensingTime_id_seq"'::regclass,
  greatest(
    coalesce((select max(id)::bigint from dflow."LicensingTime"), 1),
    (select last_value from dflow."LicensingTime_id_seq")
  ),
  true
);

lock table dflow.properties_and_characters in share row exclusive mode;

select setval(
  'dflow.properties_and_characters_id_seq'::regclass,
  greatest(
    coalesce((select max(id)::bigint from dflow.properties_and_characters), 1),
    (select last_value from dflow.properties_and_characters_id_seq)
  ),
  true
);

do $$
begin
  if not (
    select is_called
       and last_value >= coalesce((select max(id) from dflow."LicensingTime"), 1)
    from dflow."LicensingTime_id_seq"
  ) then
    raise exception 'LicensingTime sequence remains behind its table';
  end if;

  if not (
    select is_called
       and last_value >= coalesce((select max(id) from dflow.properties_and_characters), 1)
    from dflow.properties_and_characters_id_seq
  ) then
    raise exception 'properties_and_characters sequence remains behind its table';
  end if;
end;
$$;
