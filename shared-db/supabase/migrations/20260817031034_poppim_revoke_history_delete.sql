-- #898: staff may maintain these records, but may not erase their history.
--
-- pim.stage deletion can null the stage identifiers retained by stage_history.
-- product_update and product_time_entry carry imported external history. PopPIM
-- does not delete from any of the three tables, so DELETE is unnecessary.

revoke delete on table
  pim.stage,
  pim.product_update,
  pim.product_time_entry
from authenticated;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'stage',
    'product_update',
    'product_time_entry'
  ] loop
    if has_table_privilege(
      'authenticated',
      format('pim.%I', relation_name),
      'DELETE'
    ) then
      raise exception
        'authenticated still has DELETE on pim.%', relation_name;
    end if;
  end loop;
end
$$;
