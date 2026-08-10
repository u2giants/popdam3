-- =====================================================================
-- capture-postgres-schema.sql — READ-ONLY schema/inventory capture
-- Instructions for the operator: docs/cloudsql-capture-instructions.md
-- =====================================================================
--
-- WHAT THIS IS
--   A single psql script that prints a complete, deterministic description
--   of one Postgres schema: tables, columns, constraints, indexes, views,
--   functions, triggers, sequences, extensions, roles/grants/RLS, row
--   counts and on-disk sizes.
--
-- SAFETY — verifiable by eye in under a minute
--   * Line "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;" below
--     makes the SERVER reject any write for the rest of this connection.
--     It is session-scoped: it dies with the psql process and changes no
--     stored configuration.
--   * Every other statement in this file is a plain SELECT against
--     pg_catalog / information_schema. There is no INSERT, UPDATE, DELETE,
--     CREATE, ALTER, DROP, TRUNCATE, GRANT, COPY, temp table or DO block.
--     Grep it: `grep -inE '\b(insert|update|delete|create|alter|drop|truncate|grant|revoke|copy)\b' capture-postgres-schema.sql`
--   * It prints only names, types, definitions, counts and byte sizes.
--     It never prints a row of business data and never prints a credential.
--   * statement_timeout and lock_timeout are set below so nothing can hang
--     or wait on a lock on a busy production server.
--
-- USAGE
--   psql "<connection string>" -X -f capture-postgres-schema.sql \
--        -v target_schema=designflow > capture.txt 2>&1
--
--   Variables (all optional):
--     -v target_schema=designflow      schema to capture (default: designflow)
--     -v exact_count_max_bytes=2000000000
--                                      tables at or below this total size get
--                                      an EXACT count(*); larger tables get
--                                      only the planner ESTIMATE. Set to 0 to
--                                      skip all exact counts.
--
-- OUTPUT
--   Pipe-separated, one record per line, stable ordering everywhere, so two
--   captures can be compared with a plain `diff`.
-- =====================================================================

\pset pager off
\pset format unaligned
\pset fieldsep '|'
\pset footer off
\pset null '(null)'
\timing off
-- Keep going if one section is unsupported on this server version, so a
-- single failure does not cost the whole capture.
\set ON_ERROR_STOP off

\if :{?target_schema}
\else
\set target_schema designflow
\endif

\if :{?exact_count_max_bytes}
\else
\set exact_count_max_bytes 2000000000
\endif

-- ---------------------------------------------------------------------
-- The read-only lock, and the timeouts. Session-scoped only.
-- ---------------------------------------------------------------------
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
SET statement_timeout = '120s';
SET lock_timeout = '5s';

\echo '====================================================================='
\echo '== SECTION 00 :: CAPTURE HEADER'
\echo '====================================================================='
\echo '-- target_schema variable:' :target_schema
\echo '-- exact_count_max_bytes :' :exact_count_max_bytes

select
  current_database()                         as database_name,
  current_user                               as connected_as,
  version()                                  as server_version_full,
  current_setting('server_version_num')      as server_version_num,
  current_setting('search_path')             as search_path,
  current_setting('TimeZone')                as timezone,
  now()                                      as capture_time,
  :'target_schema'                           as target_schema;

\echo ''
\echo '== SECTION 01 :: SETTINGS THAT AFFECT SCHEMA BEHAVIOUR'
select name, setting, unit, source
from pg_settings
where name in (
  'server_version','server_encoding','lc_collate','lc_ctype',
  'default_text_search_config','DateStyle','IntervalStyle','TimeZone',
  'standard_conforming_strings','row_security','default_transaction_read_only',
  'max_connections','shared_buffers','default_toast_compression'
)
order by name;

\echo ''
\echo '== SECTION 02 :: SCHEMAS PRESENT (settles the dflow / designflow question)'
select
  n.nspname                                  as schema_name,
  pg_get_userbyid(n.nspowner)                as owner,
  count(c.oid) filter (where c.relkind in ('r','p')) as tables,
  count(c.oid) filter (where c.relkind = 'v')        as views,
  count(c.oid) filter (where c.relkind = 'm')        as matviews,
  count(c.oid) filter (where c.relkind = 'S')        as sequences,
  coalesce(sum(pg_total_relation_size(c.oid)) filter (where c.relkind in ('r','p','m')), 0) as total_bytes
from pg_namespace n
left join pg_class c on c.relnamespace = n.oid
where n.nspname not in ('pg_catalog','information_schema','pg_toast')
  and n.nspname not like 'pg_temp%'
  and n.nspname not like 'pg_toast_temp%'
group by n.nspname, n.nspowner
order by n.nspname;

\echo ''
\echo '== SECTION 03 :: INSTALLED EXTENSIONS'
select
  e.extname                     as extension,
  e.extversion                  as installed_version,
  n.nspname                     as installed_in_schema,
  ae.default_version            as available_default_version,
  e.extrelocatable              as relocatable
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
left join pg_available_extensions ae on ae.name = e.extname
order by e.extname;

\echo ''
\echo '== SECTION 04 :: RELATIONS IN TARGET SCHEMA (kind, owner, RLS, size)'
select
  c.relname                      as relation,
  case c.relkind
    when 'r' then 'table' when 'p' then 'partitioned table'
    when 'v' then 'view'  when 'm' then 'materialized view'
    when 'S' then 'sequence' when 'f' then 'foreign table'
    when 'i' then 'index' when 'c' then 'composite type'
    else c.relkind::text end     as kind,
  pg_get_userbyid(c.relowner)    as owner,
  c.relrowsecurity               as rls_enabled,
  c.relforcerowsecurity          as rls_forced,
  c.relpersistence               as persistence,
  pg_total_relation_size(c.oid)  as total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_pretty,
  obj_description(c.oid, 'pg_class') as comment
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = :'target_schema'
  and c.relkind in ('r','p','v','m','S','f')
order by c.relkind, c.relname;

\echo ''
\echo '== SECTION 05 :: COLUMNS'
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  coalesce(c.character_maximum_length::text, '') as char_max_len,
  coalesce(c.numeric_precision::text, '')        as num_precision,
  coalesce(c.numeric_scale::text, '')            as num_scale,
  coalesce(c.udt_name, '')                       as udt_name,
  c.is_nullable,
  coalesce(c.column_default, '')                 as column_default,
  c.is_identity,
  coalesce(c.identity_generation, '')            as identity_generation,
  coalesce(c.is_generated, '')                   as is_generated,
  coalesce(c.generation_expression, '')          as generation_expression,
  coalesce(c.collation_name, '')                 as collation_name
from information_schema.columns c
where c.table_schema = :'target_schema'
order by c.table_name, c.ordinal_position;

\echo ''
\echo '== SECTION 06 :: CONSTRAINTS (p=PK u=UNIQUE f=FK c=CHECK x=EXCLUDE t=TRIGGER)'
select
  rel.relname                                  as table_name,
  con.conname                                  as constraint_name,
  con.contype                                  as type,
  con.convalidated                             as validated,
  coalesce(fn.nspname || '.' || fr.relname, '') as references_table,
  regexp_replace(pg_get_constraintdef(con.oid), '\s+', ' ', 'g') as definition
from pg_constraint con
join pg_class rel      on rel.oid = con.conrelid
join pg_namespace n    on n.oid = rel.relnamespace
left join pg_class fr     on fr.oid = con.confrelid
left join pg_namespace fn on fn.oid = fr.relnamespace
where n.nspname = :'target_schema'
order by rel.relname, con.contype, con.conname;

\echo ''
\echo '== SECTION 07 :: INDEXES'
select
  i.tablename                                        as table_name,
  i.indexname                                        as index_name,
  regexp_replace(i.indexdef, '\s+', ' ', 'g')        as definition,
  pg_relation_size(c.oid)                            as index_bytes
from pg_indexes i
join pg_namespace n on n.nspname = i.schemaname
join pg_class c on c.relname = i.indexname and c.relnamespace = n.oid
where i.schemaname = :'target_schema'
order by i.tablename, i.indexname;

\echo ''
\echo '== SECTION 08 :: VIEWS (definitions, whitespace collapsed for diffing)'
select
  c.relname                                                     as view_name,
  pg_get_userbyid(c.relowner)                                   as owner,
  regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g')  as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = :'target_schema' and c.relkind = 'v'
order by c.relname;

\echo ''
\echo '== SECTION 09 :: MATERIALIZED VIEWS'
select
  c.relname                                                     as matview_name,
  pg_get_userbyid(c.relowner)                                   as owner,
  c.relispopulated                                              as is_populated,
  pg_total_relation_size(c.oid)                                 as total_bytes,
  regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g')  as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = :'target_schema' and c.relkind = 'm'
order by c.relname;

\echo ''
\echo '== SECTION 10 :: FUNCTIONS AND PROCEDURES'
\echo '-- (prokind column requires PostgreSQL 11+; see section 10b if this errors)'
select
  p.proname                                                    as name,
  pg_get_function_identity_arguments(p.oid)                    as arguments,
  p.prokind                                                    as kind,
  pg_get_userbyid(p.proowner)                                  as owner,
  l.lanname                                                    as language,
  p.prosecdef                                                  as security_definer,
  p.provolatile                                                as volatility,
  pg_get_function_result(p.oid)                                as returns,
  regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l  on l.oid = p.prolang
where n.nspname = :'target_schema'
order by p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '== SECTION 10b :: FUNCTION SIGNATURES (portable fallback, no prokind)'
select
  p.proname                                 as name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid)             as returns,
  p.prosecdef                               as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = :'target_schema'
order by p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '== SECTION 11 :: TRIGGERS'
select
  rel.relname                                                  as table_name,
  t.tgname                                                     as trigger_name,
  t.tgenabled                                                  as enabled_flag,
  regexp_replace(pg_get_triggerdef(t.oid, true), '\s+', ' ', 'g') as definition
from pg_trigger t
join pg_class rel   on rel.oid = t.tgrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = :'target_schema'
  and not t.tgisinternal
order by rel.relname, t.tgname;

\echo ''
\echo '== SECTION 12 :: SEQUENCES AND OWNERSHIP'
\echo '-- (pg_sequences requires PostgreSQL 10+; section 12b is the fallback)'
select
  s.sequencename                as sequence_name,
  s.sequenceowner               as owner,
  s.data_type                   as data_type,
  s.start_value, s.min_value, s.max_value, s.increment_by, s.cycle, s.cache_size,
  coalesce(dep_tab.relname || '.' || dep_att.attname, '') as owned_by_column
from pg_sequences s
join pg_class sc      on sc.relname = s.sequencename
join pg_namespace sn  on sn.oid = sc.relnamespace and sn.nspname = s.schemaname
left join pg_depend d on d.objid = sc.oid and d.classid = 'pg_class'::regclass
                     and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i')
left join pg_class dep_tab on dep_tab.oid = d.refobjid
left join pg_attribute dep_att on dep_att.attrelid = d.refobjid and dep_att.attnum = d.refobjsubid
where s.schemaname = :'target_schema'
order by s.sequencename;

\echo ''
\echo '== SECTION 12b :: SEQUENCES (portable fallback, names and ownership only)'
select
  sc.relname                                              as sequence_name,
  pg_get_userbyid(sc.relowner)                            as owner,
  coalesce(dep_tab.relname || '.' || dep_att.attname, '') as owned_by_column
from pg_class sc
join pg_namespace sn  on sn.oid = sc.relnamespace
left join pg_depend d on d.objid = sc.oid and d.classid = 'pg_class'::regclass
                     and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i')
left join pg_class dep_tab on dep_tab.oid = d.refobjid
left join pg_attribute dep_att on dep_att.attrelid = d.refobjid and dep_att.attnum = d.refobjsubid
where sn.nspname = :'target_schema' and sc.relkind = 'S'
order by sc.relname;

\echo ''
\echo '== SECTION 13 :: ROW-LEVEL SECURITY POLICIES'
select
  pol.tablename    as table_name,
  pol.policyname   as policy_name,
  pol.cmd          as command,
  array_to_string(pol.roles, ',')                        as roles,
  regexp_replace(coalesce(pol.qual, ''), '\s+', ' ', 'g')       as using_expression,
  regexp_replace(coalesce(pol.with_check, ''), '\s+', ' ', 'g') as with_check_expression
from pg_policies pol
where pol.schemaname = :'target_schema'
order by pol.tablename, pol.policyname;

\echo ''
\echo '== SECTION 14 :: ROLES ON THIS SERVER (no passwords are readable)'
select
  r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
  r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
  case when r.rolvaliduntil is null then '' else r.rolvaliduntil::text end as valid_until
from pg_roles r
order by r.rolname;

\echo ''
\echo '== SECTION 15 :: ROLE MEMBERSHIPS'
select
  m.rolname       as member,
  g.rolname       as member_of,
  am.admin_option
from pg_auth_members am
join pg_roles m on m.oid = am.member
join pg_roles g on g.oid = am.roleid
order by m.rolname, g.rolname;

\echo ''
\echo '== SECTION 16 :: SCHEMA-LEVEL PRIVILEGES'
select
  n.nspname                     as schema_name,
  pg_get_userbyid(n.nspowner)   as owner,
  case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
  a.privilege_type,
  a.is_grantable
from pg_namespace n
left join lateral aclexplode(n.nspacl) a on true
where n.nspname not in ('pg_catalog','information_schema','pg_toast')
  and n.nspname not like 'pg_temp%'
  and n.nspname not like 'pg_toast_temp%'
order by n.nspname, grantee, a.privilege_type;

\echo ''
\echo '== SECTION 17 :: TABLE / VIEW / SEQUENCE PRIVILEGES IN TARGET SCHEMA'
\echo '-- relacl NULL means "no explicit grants; owner-only defaults apply"'
select
  c.relname                     as relation,
  c.relkind                     as kind,
  pg_get_userbyid(c.relowner)   as owner,
  case when c.relacl is null then '(defaults only)'
       when a.grantee = 0 then 'PUBLIC'
       else pg_get_userbyid(a.grantee) end as grantee,
  coalesce(a.privilege_type, '')          as privilege_type,
  coalesce(a.is_grantable::text, '')      as is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join lateral aclexplode(c.relacl) a on true
where n.nspname = :'target_schema'
  and c.relkind in ('r','p','v','m','S','f')
order by c.relname, grantee, privilege_type;

\echo ''
\echo '== SECTION 18 :: FUNCTION PRIVILEGES IN TARGET SCHEMA'
select
  p.proname                                 as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  case when p.proacl is null then '(defaults only)'
       when a.grantee = 0 then 'PUBLIC'
       else pg_get_userbyid(a.grantee) end  as grantee,
  coalesce(a.privilege_type, '')            as privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) a on true
where n.nspname = :'target_schema'
order by p.proname, arguments, grantee, privilege_type;

\echo ''
\echo '== SECTION 19 :: DEFAULT PRIVILEGES (what future objects will inherit)'
select
  coalesce(n.nspname, '(all schemas)')    as schema_name,
  pg_get_userbyid(d.defaclrole)           as granting_role,
  d.defaclobjtype                         as object_type,
  case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
  a.privilege_type
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
left join lateral aclexplode(d.defaclacl) a on true
order by schema_name, granting_role, d.defaclobjtype, grantee, a.privilege_type;

\echo ''
\echo '== SECTION 20 :: ROW COUNTS AND SIZES'
\echo '-- exact_rows is a real count(*). It is populated ONLY for tables whose'
\echo '-- total size is <= exact_count_max_bytes. Where exact_rows is null, use'
\echo '-- estimated_rows (planner statistic, can be stale).'
\echo '-- NOTE: for a PARTITIONED table (kind=p) the count includes its partitions,'
\echo '--       which are also listed individually. Do not add those rows twice.'
select
  c.relname                                     as table_name,
  case c.relkind when 'p' then 'partitioned' when 'f' then 'foreign' else 'table' end as kind,
  c.reltuples::bigint                           as estimated_rows,
  x.exact_rows                                  as exact_rows,
  pg_relation_size(c.oid)                       as heap_bytes,
  pg_indexes_size(c.oid)                        as index_bytes,
  pg_total_relation_size(c.oid)                 as total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_pretty
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join lateral (
  select (xpath('/row/c/text()',
           query_to_xml(
             format('select count(*) as c from %I.%I', n.nspname, c.relname),
             false, true, '')
         ))[1]::text::bigint as exact_rows
  where pg_total_relation_size(c.oid) <= :exact_count_max_bytes
) x on true
where n.nspname = :'target_schema'
  and c.relkind in ('r','p','f')
order by c.relname;

\echo ''
\echo '== SECTION 21 :: TOTALS'
select
  :'target_schema'                                   as target_schema,
  count(*)                                           as relation_count,
  sum(pg_total_relation_size(c.oid))                 as schema_total_bytes,
  pg_size_pretty(sum(pg_total_relation_size(c.oid))) as schema_total_pretty
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = :'target_schema' and c.relkind in ('r','p','m','f');

select
  current_database()                              as database_name,
  pg_database_size(current_database())            as database_total_bytes,
  pg_size_pretty(pg_database_size(current_database())) as database_total_pretty;

\echo ''
\echo '== SECTION 22 :: PER-SCHEMA SIZE ROLL-UP (whole database)'
select
  n.nspname                                          as schema_name,
  count(*)                                           as relation_count,
  sum(pg_total_relation_size(c.oid))                 as total_bytes,
  pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total_pretty
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p','m','f')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
group by n.nspname
order by n.nspname;

\echo ''
\echo '== END OF CAPTURE =='
select now() as finished_at;
