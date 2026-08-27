-- Issue #1684, Phase 1: make the mixed Property/Character table read-only
-- while consumers are cut over to separate canonical datasets. No rows are
-- copied, changed, or removed by this staging migration.
-- derived-from: none

comment on table core.properties_and_characters is
  'EOL under issue #1684. Reads remain available during consumer cutover. Do not add dependencies or write rows; this mixed table will be removed after Properties and Characters are separated.';

create or replace function core.reject_properties_and_characters_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'core.properties_and_characters is EOL and read-only under issue #1684';
end;
$function$;

comment on function core.reject_properties_and_characters_write() is
  'Reversible Phase 1 write guard for the EOL core.properties_and_characters table (issue #1684).';

drop trigger if exists properties_and_characters_eol_write_guard
  on core.properties_and_characters;

create trigger properties_and_characters_eol_write_guard
before insert or update or delete or truncate
on core.properties_and_characters
for each statement
execute function core.reject_properties_and_characters_write();
