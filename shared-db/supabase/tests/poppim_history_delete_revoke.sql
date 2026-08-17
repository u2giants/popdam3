-- Read-only contract test for #898 / migration 20260817031034.
\set ON_ERROR_STOP on

do $$
declare
  relation_name text;
  privilege_name text;
begin
  foreach relation_name in array array[
    'stage',
    'product_update',
    'product_time_entry'
  ] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pim'
        and c.relname = relation_name
        and c.relkind = 'r'
    ) then
      raise exception 'pim.% does not exist', relation_name;
    end if;

    if has_table_privilege(
      'authenticated',
      format('pim.%I', relation_name),
      'DELETE'
    ) then
      raise exception
        'authenticated must not have DELETE on pim.%', relation_name;
    end if;

    if exists (select 1 from pg_roles where rolname = 'anon') then
      foreach privilege_name in array array['INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(
          'anon',
          format('pim.%I', relation_name),
          privilege_name
        ) then
          raise exception
            'anon must not have % on pim.%', privilege_name, relation_name;
        end if;
      end loop;
    end if;

    if exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'pim'
        and table_name = relation_name
        and grantee = 'PUBLIC'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception 'PUBLIC must not have write privileges on pim.%', relation_name;
    end if;

  end loop;
end
$$;
