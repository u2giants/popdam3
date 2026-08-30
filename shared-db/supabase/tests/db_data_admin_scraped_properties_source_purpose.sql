begin;

do $$
declare
  v_definition text;
  v_required_heading text;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position('plm.wildbrain_era' in v_definition) = 0
     or position('plm.wildbrain_capture' in v_definition) = 0
     or position('plm.sega_submission_property' in v_definition) = 0
     or position('plm.sega_submission_capture' in v_definition) = 0 then
    raise exception 'WildBrain or Sega submission source identity is absent';
  end if;

  foreach v_required_heading in array array[
    'Strawberry Shortcake - Creative',
    'Sega - Submissions',
    'Sega - Creative',
    'Paramount - Creative (Creative Library)',
    'Warner Bros. - Creative (STARLABS)',
    'NBCUniversal - Creative (Creative Asset Factory)',
    '20th Century - Creative (DCP Vault)',
    'Disney - Creative (DCP Vault)',
    'DCP Vault - Creative (authoritative Marvel scope)',
    'Lucasfilm / Star Wars - Creative (DCP Vault)',
    'Pixar - Creative (DCP Vault)'
  ] loop
    if position(v_required_heading in v_definition) = 0 then
      raise exception 'required source-purpose heading is absent: %', v_required_heading;
    end if;
  end loop;

  if position('plm.sega_property_licensor' in v_definition) <> 0
     or position('normalized_licensor_label' in v_definition) <> 0
     or position('Source Property vocabulary' in v_definition) <> 0 then
    raise exception 'retired Sega heading split or purpose-free label remains';
  end if;

  if (select count(*) from regexp_matches(v_definition, '''Sega - Submissions''', 'g')) <> 1
     or (select count(*) from regexp_matches(v_definition, '''Sega - Creative''', 'g')) <> 1 then
    raise exception 'Sega must expose exactly two source-purpose heading definitions';
  end if;
end $$;

rollback;
