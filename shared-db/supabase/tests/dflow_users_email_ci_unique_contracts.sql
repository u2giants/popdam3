-- Issue #4060 contract: dflow.users email is unique case- and whitespace-insensitively.
begin;

do $contract$
declare
  rejected_constraint text;
begin
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class ic on ic.oid=i.indexrelid
    join pg_catalog.pg_class tc on tc.oid=i.indrelid
    join pg_catalog.pg_am am on am.oid=ic.relam
    join pg_catalog.pg_attribute email_attribute on email_attribute.attrelid=tc.oid and email_attribute.attname='email' and email_attribute.attnum>0 and not email_attribute.attisdropped
    where i.indexrelid = to_regclass('dflow.users_email_lower_uidx')
      and i.indrelid = to_regclass('dflow.users')
      and tc.relkind='r' and tc.relam=(select oid from pg_catalog.pg_am where amname='heap' and amhandler='pg_catalog.heap_tableam_handler'::regproc)
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indimmediate and not i.indisprimary and not i.indisexclusion and not i.indnullsnotdistinct
      and am.amname='btree' and am.amhandler='pg_catalog.bthandler'::regproc
      and i.indnkeyatts=1 and i.indnatts=1 and i.indkey[0]=0
      and email_attribute.atttypid in ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype)
      and pg_catalog.pg_get_expr(i.indexprs,i.indrelid)=case email_attribute.atttypid
        when 'pg_catalog.text'::regtype then 'lower(btrim(email))'
        when 'pg_catalog.varchar'::regtype then 'lower(btrim((email)::text))'
      end
      and pg_catalog.pg_get_expr(i.indpred,i.indrelid)=case email_attribute.atttypid
        when 'pg_catalog.text'::regtype then '(NULLIF(btrim(email), ''''::text) IS NOT NULL)'
        when 'pg_catalog.varchar'::regtype then '(NULLIF(btrim((email)::text), ''''::text) IS NOT NULL)'
      end
      and i.indclass[0]=(select oc.oid from pg_catalog.pg_opclass oc join pg_catalog.pg_namespace ns on ns.oid=oc.opcnamespace where ns.nspname='pg_catalog' and oc.opcname='text_ops' and oc.opcmethod=am.oid and oc.opcdefault)
      and i.indcollation[0]=(select co.oid from pg_catalog.pg_collation co join pg_catalog.pg_namespace ns on ns.oid=co.collnamespace where ns.nspname='pg_catalog' and co.collname='default' and co.collisdeterministic)
      and i.indcollation[0]=(select attcollation from pg_catalog.pg_attribute where attrelid=tc.oid and attname='email' and attnum>0 and not attisdropped)
      and i.indoption[0]=0 and ic.reloptions is null and ic.reltablespace=0
      and not exists(select 1 from pg_catalog.pg_inherits where inhrelid=tc.oid or inhparent=tc.oid)
  ) then
    raise exception 'dflow.users_email_lower_uidx exact normalized nonblank index contract refused';
  end if;

  insert into dflow.users(id,name,email) overriding system value
  values (-406001,'issue-4060-user-a','Issue4060@Example.test');
  begin
    insert into dflow.users(id,name,email) overriding system value
    values (-406002,'issue-4060-user-b',' issue4060@example.TEST ');
    raise exception 'case/whitespace variant email was accepted';
  exception when unique_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint is distinct from 'users_email_lower_uidx' then
      raise exception 'unexpected duplicate constraint %', rejected_constraint;
    end if;
  end;

  -- Blank and null emails are absent, not values.
  insert into dflow.users(id,name,email) overriding system value
  values (-406003,'issue-4060-blank-a',''), (-406004,'issue-4060-blank-b','  '),
         (-406005,'issue-4060-null-a',null), (-406006,'issue-4060-null-b',null);
end
$contract$;

rollback;
