-- Fixed metadata-only observation for the Tracking shipment-notice and factory-time surfaces.
WITH rels AS (
 SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='dflow_prod' AND c.relname IN ('sample_shipment_notice','sample_shipment_notice_recipient','FactoryTime','product_type_factory_time')
), shape AS (
 SELECT jsonb_build_object(
  'relations',(SELECT jsonb_agg(jsonb_build_array(relname,relkind) ORDER BY relname) FROM rels),
  'columns',(SELECT jsonb_agg(jsonb_build_array(r.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY r.relname,a.attnum) FROM rels r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(r.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM rels r JOIN pg_constraint c ON c.conrelid=r.oid),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(r.relname,c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY r.relname,c.relname) FROM rels r JOIN pg_index i ON i.indrelid=r.oid JOIN pg_class c ON c.oid=i.indexrelid),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(r.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY r.relname,t.tgname) FROM rels r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal),
  'views',(SELECT jsonb_agg(jsonb_build_array(relname,pg_get_viewdef(oid)) ORDER BY relname) FROM rels WHERE relkind='v')
 ) AS metadata
), funcs AS (
 SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='dflow_prod' AND p.proname IN ('claim_sample_shipment_notice','prevent_sample_shipment_notice_snapshot_mutation','prevent_sample_shipment_notice_recipient_snapshot_mutation')
)
SELECT jsonb_build_object(
 'return_relations',(SELECT jsonb_agg(jsonb_build_object('name',r.relname,'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),NOT a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY r.relname) FROM rels r),
 'structure_sha256',(SELECT encode(sha256(convert_to(metadata::text,'UTF8')),'hex') FROM shape),
 'relation_count',(SELECT count(*) FROM rels),
 'sequence_access_closed',NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_class c ON c.oid=d.objid CROSS JOIN pg_roles r WHERE d.refobjid IN (SELECT oid FROM rels) AND c.relkind='S' AND r.rolname IN ('anon','authenticated','service_role') AND has_sequence_privilege(r.rolname,c.oid,'USAGE,SELECT,UPDATE')),
 'client_access_closed',
   NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(rolname,'dflow_prod','USAGE'))
   AND NOT EXISTS (SELECT 1 FROM rels r JOIN pg_class c ON c.oid=r.oid CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))
   AND NOT EXISTS (SELECT 1 FROM funcs p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))),
 'functions',(SELECT jsonb_agg(jsonb_build_object(
  'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
  'argument_names',coalesce(to_jsonb(p.proargnames),'[]'::jsonb),
  'argument_types',(SELECT coalesce(jsonb_agg(format_type(t.oid,NULL) ORDER BY a.ordinal),'[]'::jsonb) FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(oid,ordinal) JOIN pg_type t ON t.oid=a.oid),
  'output_names',to_jsonb(p.proargnames[p.pronargs+1:]),'output_types',(SELECT jsonb_agg(format_type(a.oid,NULL) ORDER BY a.ordinal) FROM unnest(p.proallargtypes) WITH ORDINALITY a(oid,ordinal) WHERE a.ordinal>p.pronargs),'return_set',p.proretset,
  'default_count',p.pronargdefaults,'return_type',format_type(p.prorettype,NULL),
  'security_definer',p.prosecdef,'volatility',p.provolatile,'configuration',to_jsonb(p.proconfig),
  'owner',pg_get_userbyid(p.proowner),'source_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
 ) ORDER BY p.proname) FROM funcs p)
) AS catalog;
