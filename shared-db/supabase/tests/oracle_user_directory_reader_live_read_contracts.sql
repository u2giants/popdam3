-- Live-read contract for migration 20261106010627 (#5776): execute
-- api.oracle_user_directory() AS the read-only login and prove the write is
-- refused. Quarantined from the from-empty lane (supabase/tests/ci-quarantine.txt):
-- the function reads dflow_prod.user_roles, which only 20261022182809 creates,
-- and that migration correctly refuses an empty database ("tree rows absent")
-- because its precondition is the real role-tree rows. The catalogue and
-- privilege contract in oracle_user_directory_reader_contract.sql stays
-- enforced; this live read is proven on preview before the production
-- promotion, which the quarantine policy requires of its listed files.

grant oracle_directory_reader to postgres;
set local role oracle_directory_reader;

select user_id, email, name, lastname, status, level, office_location, roles
from api.oracle_user_directory()
limit 0;

select count(*) from api.oracle_user_directory();

do $deny$
begin
  begin
    perform set_config('transaction_read_only', 'off', true);
    execute $q$create table api.oracle_user_directory_probe (id int)$q$;
    raise exception 'oracle_directory_reader was able to CREATE in api';
  exception when insufficient_privilege or read_only_sql_transaction then null;
  end;
end
$deny$;

reset role;
