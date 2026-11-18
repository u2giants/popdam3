-- Read-only #5609 complete-family candidate, not an acceptance result.
-- Execute only AFTER parent predeclaration, actual merge and qualification.
-- Text-valued numeric fields avoid JSON binary-float/integer precision loss.
with family as materialized (
 select userid,dbid,toplevel,queryid,stats_since,md5(query) query_md5,
        calls,total_exec_time::text::numeric total_exec_time,
        wal_bytes::text::numeric wal_bytes
 from extensions.pg_stat_statements
 where query ilike 'with pgrst_source as (update "public"."assets"%'
), family_summary as (
 select count(*) entry_count,
        md5(string_agg(row(userid,dbid,toplevel,queryid,
          extract(epoch from stats_since),query_md5,calls,total_exec_time,wal_bytes)::text,
          E'\n' order by userid,dbid,toplevel,queryid)) vector_md5,
        jsonb_agg(jsonb_build_object(
          'userid',userid::text,'dbid',dbid::text,'toplevel',toplevel,
          'queryid',queryid::text,'stats_since',stats_since,'query_md5',query_md5,
          'calls',calls::text,'total_exec_time',total_exec_time::text,
          'wal_bytes',wal_bytes::text)
          order by userid,dbid,toplevel,queryid) family
 from family
), tables as materialized (
 select relname,relid,n_tup_upd
 from pg_stat_user_tables
 where relid in ('public.assets'::regclass,'public.dam_search_documents'::regclass)
)
select jsonb_build_object(
 'observed_at',now(),
 'read_identity',current_user,
 'statement_stats_reset',(select stats_reset from extensions.pg_stat_statements_info),
 'database_stats_reset',(select stats_reset from pg_stat_database where datname=current_database()),
 'postmaster_started_at',pg_postmaster_start_time(),
 'statement_dealloc',(select dealloc::text from extensions.pg_stat_statements_info),
 'family_entry_count',s.entry_count::text,'family_vector_md5',s.vector_md5,
 'tables',(select jsonb_agg(jsonb_build_object(
    'relname',relname,'relid',relid::text,'n_tup_upd',n_tup_upd::text) order by relname) from tables),
 'family',s.family) as candidate
from family_summary s;
