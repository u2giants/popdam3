-- Historical #1374 retirement remains effective where #1684 did not supersede it.
do $contracts$
declare
  v_definition text;
begin
  if to_regclass('core.property_character') is not null then
    raise exception 'retired scalar-era core.property_character bridge returned';
  end if;
  if to_regclass('core.character') is null or (select count(*) from core.character) <> 0 then
    raise exception 'issue #1684 must restore only an empty canonical Character contract';
  end if;
  select pg_get_functiondef(
    'api.db_data_admin_licensor_property_list(text,boolean,text,integer)'::regprocedure
  ) into v_definition;
  if position('core.character' in v_definition) <> 0 then
    raise exception 'legacy Property list unexpectedly depends on canonical Character';
  end if;
  select pg_get_functiondef(
    'api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure
  ) into v_definition;
  if position('core.property_character_associations' in v_definition) = 0
     or position('core.character ' in v_definition) <> 0 then
    raise exception 'Property tree Character count contract changed';
  end if;
end
$contracts$;
