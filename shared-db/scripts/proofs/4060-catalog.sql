-- Fixed #4060 metadata only. User values are never returned by this query.
SELECT json_build_object(
  'table_kind', c.relkind,
  'table_oid', c.oid::bigint,
  'inheritance_edges', (SELECT count(*) FROM pg_inherits WHERE inhrelid IN (c.oid,to_regclass('supabase_migrations.schema_migrations')) OR inhparent IN (c.oid,to_regclass('supabase_migrations.schema_migrations'))),
  'table_am', (SELECT amname FROM pg_am WHERE oid = c.relam AND amhandler='pg_catalog.heap_tableam_handler'::regproc),
  'index', (SELECT json_build_object('unique', i.indisunique, 'valid', i.indisvalid,
    'ready', i.indisready, 'table_oid', i.indrelid::bigint, 'method', am.amname, 'builtin_method', am.amhandler='pg_catalog.bthandler'::regproc,
    'keys', i.indnkeyatts, 'attributes', i.indnatts,
    'expression', pg_get_expr(i.indexprs, i.indrelid),
    'predicate', pg_get_expr(i.indpred, i.indrelid),
    'definition', pg_get_indexdef(i.indexrelid),
    'opclass_exact', i.indclass[0] = (SELECT oc.oid FROM pg_opclass oc JOIN pg_namespace ns ON ns.oid=oc.opcnamespace WHERE ns.nspname='pg_catalog' AND oc.opcname='text_ops' AND oc.opcmethod=am.oid AND oc.opcdefault),
    'collation_exact', i.indcollation[0] = (SELECT a.attcollation FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='email') AND i.indcollation[0] = (SELECT co.oid FROM pg_collation co JOIN pg_namespace ns ON ns.oid=co.collnamespace WHERE ns.nspname='pg_catalog' AND co.collname='default' AND co.collisdeterministic),
    'options', i.indoption::smallint[], 'storage_options', ic.reloptions,
    'immediate', i.indimmediate, 'primary', i.indisprimary,
    'exclusion', i.indisexclusion, 'nulls_not_distinct', i.indnullsnotdistinct)
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE i.indexrelid = to_regclass('dflow.users_email_lower_uidx')),
  'columns', (SELECT json_agg(json_build_object('name', a.attname,
    'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'identity', a.attidentity, 'generated', a.attgenerated,
    'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
  'insert_triggers', (SELECT coalesce(json_agg(json_build_object('internal', t.tgisinternal,
    'type', t.tgtype, 'function_schema', n.nspname, 'function', p.proname,
    'constraint_type', fk.contype, 'constraint_table', fk.conrelid::bigint,
    'referenced_table', fk.confrelid::bigint,
    'key_columns', (SELECT array_agg(a.attname ORDER BY k.ord)
      FROM unnest(fk.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.num))
    ORDER BY t.oid), '[]'::json)
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_constraint fk ON fk.oid = t.tgconstraint
    WHERE t.tgrelid = c.oid AND t.tgenabled <> 'D' AND (t.tgtype & 4) <> 0),
  'profile_oid', to_regclass('app.profile')::oid::bigint,
  'checks', (SELECT json_agg(json_build_object(
    'name', ck.conname, 'table_oid', ck.conrelid::bigint,
    'validated', ck.convalidated, 'no_inherit', ck.connoinherit,
    'definition', pg_get_constraintdef(ck.oid), 'expression', pg_get_expr(ck.conbin,ck.conrelid),
    'key_columns', (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(ck.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=ck.conrelid AND a.attnum=k.num AND NOT a.attisdropped),
    -- Builtin pinned operators/types have no dependency entries. Any external
    -- operator, function, type or collation creates a dependency and refuses.
    'dependencies_safe', NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_constraint'::regclass AND d.objid=ck.oid AND NOT (d.refclassid='pg_class'::regclass AND d.refobjid=c.oid AND (d.refobjsubid=0 OR d.refobjsubid=ANY(ck.conkey))))) ORDER BY ck.conname)
    FROM pg_constraint ck WHERE ck.conrelid=c.oid AND ck.contype='c'),
  'profile_index', (SELECT json_build_object(
    'table_oid', pi.indrelid::bigint, 'kind', pc.relkind,
    'unique', pi.indisunique, 'valid', pi.indisvalid, 'ready', pi.indisready, 'live', pi.indislive,
    'immediate', pi.indimmediate, 'primary', pi.indisprimary, 'exclusion', pi.indisexclusion, 'nulls_not_distinct', pi.indnullsnotdistinct,
    'method', pa.amname, 'builtin_method', pa.amhandler='pg_catalog.bthandler'::regproc,
    'keys', pi.indnkeyatts, 'attributes', pi.indnatts,
    'key_columns', (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(pi.indkey::smallint[]) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=pi.indrelid AND a.attnum=k.num AND NOT a.attisdropped),
    'expression', pg_get_expr(pi.indexprs,pi.indrelid), 'predicate', pg_get_expr(pi.indpred,pi.indrelid), 'definition', pg_get_indexdef(pi.indexrelid),
    'opclass_exact', pi.indclass[0]=(SELECT o.oid FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname='pg_catalog' AND o.opcname='uuid_ops' AND o.opcdefault AND o.opcmethod=pa.oid),
    'collation_exact', pi.indcollation[0]=0, 'options', pi.indoption::smallint[], 'storage_options',pc.reloptions,'tablespace',pc.reltablespace::bigint,
    'dependencies_safe', NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=pc.oid AND NOT (d.refclassid='pg_class'::regclass AND d.refobjid=c.oid AND d.refobjsubid=(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='app_profile_id' AND NOT a.attisdropped))))
    FROM pg_index pi JOIN pg_class pc ON pc.oid=pi.indexrelid JOIN pg_am pa ON pa.oid=pc.relam WHERE pi.indexrelid=to_regclass('dflow.users_app_profile_id_uidx')),
  'unsafe_indexes', (SELECT count(*) FROM pg_index other JOIN pg_class ic ON ic.oid = other.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE other.indrelid = c.oid AND (
      am.amname <> 'btree' OR am.amhandler <> 'pg_catalog.bthandler'::regproc OR other.indisexclusion OR
      (other.indexrelid NOT IN (to_regclass('dflow.users_email_lower_uidx'),to_regclass('dflow.users_app_profile_id_uidx'))
        AND (other.indexprs IS NOT NULL OR other.indpred IS NOT NULL)) OR
      EXISTS(SELECT 1 FROM unnest(other.indclass::oid[]) op(oid)
        JOIN pg_opclass oc ON oc.oid = op.oid JOIN pg_namespace ns ON ns.oid = oc.opcnamespace
        WHERE ns.nspname <> 'pg_catalog' OR NOT oc.opcdefault OR oc.opcmethod <> am.oid OR oc.opcname NOT IN ('int4_ops','text_ops','timestamptz_ops','uuid_ops')))),
  'rules', (SELECT count(*) FROM pg_rewrite WHERE ev_class = c.oid),
  'ledger_heap', (SELECT l.relkind='r' AND la.amname='heap' AND la.amhandler='pg_catalog.heap_tableam_handler'::regproc FROM pg_class l JOIN pg_am la ON la.oid=l.relam WHERE l.oid=to_regclass('supabase_migrations.schema_migrations'))
) FROM pg_class c WHERE c.oid = to_regclass('dflow.users');
