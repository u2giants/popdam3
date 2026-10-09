-- #4060 / claim4117: forward repair after audit4116 and immutable retirement
-- d3fa4a2e7573abb5904b10f8e713a8b04880357e of never-applied 20261008160444.
-- Adds only normalized nonblank email uniqueness; preserves all rows and permissions.
-- Historical preview index is preserved only after full exact catalog validation.
-- Genuine top-level CREATE is guarded by exact catalog assertions before and after.
-- A mismatched named index refuses; matching historical index keeps its identity.
-- Application lookup performance is not asserted.
-- Recovery: DROP INDEX dflow.users_email_lower_uidx through a separately reviewed migration.
-- derived-from: none
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE ONLY dflow.users IN SHARE MODE;
DO $guard$
DECLARE
  dup_groups bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid = 'dflow.users'::regclass OR inhparent = 'dflow.users'::regclass) THEN
    RAISE EXCEPTION 'dflow.users inheritance is unsupported (#4060)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_am a ON a.oid=c.relam WHERE c.oid='dflow.users'::regclass AND c.relkind='r' AND a.amname='heap' AND a.amhandler='pg_catalog.heap_tableam_handler'::regproc) THEN
    RAISE EXCEPTION 'dflow.users must be an ordinary builtin heap (#4060)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='dflow.users'::regclass AND attname='email' AND attnum>0 AND NOT attisdropped AND atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype)) THEN
    RAISE EXCEPTION 'dflow.users email must be builtin text or varchar (#4060)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation JOIN pg_catalog.pg_namespace ns ON ns.oid=co.collnamespace WHERE a.attrelid='dflow.users'::regclass AND a.attname='email' AND a.attnum>0 AND NOT a.attisdropped AND ns.nspname='pg_catalog' AND co.collname='default' AND co.collisdeterministic) THEN
    RAISE EXCEPTION 'dflow.users email must use builtin default deterministic collation (#4060)';
  END IF;
  IF to_regclass('dflow.users_email_lower_uidx') IS NOT NULL THEN
    IF NOT EXISTS (
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
    ) THEN
      RAISE EXCEPTION 'existing dflow.users_email_lower_uidx exact contract refused (#4060)';
    END IF;
    -- The verified unique index already proves no duplicate nonblank keys.
    -- Preserve its OID, definition, comment, and every application row.
    RETURN;
  END IF;
  SELECT count(*) INTO dup_groups FROM (
    SELECT lower(btrim(email)) FROM ONLY dflow.users
    WHERE nullif(btrim(email), '') IS NOT NULL
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'dflow.users has % case-insensitive duplicate email group(s); resolve them in the application before adding the unique index (#4060)', dup_groups;
  END IF;
END
$guard$;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx
  ON dflow.users (lower(btrim(email)))
  WHERE nullif(btrim(email), '') IS NOT NULL;
DO $postguard$
BEGIN
  IF NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION 'dflow.users_email_lower_uidx exact post-create contract refused (#4060)';
  END IF;
END
$postguard$;
COMMIT;
