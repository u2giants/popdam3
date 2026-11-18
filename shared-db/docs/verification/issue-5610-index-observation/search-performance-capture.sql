-- #5610 statement evidence input. Verify the protected target before executing read-only.
-- No application function executes and no raw query, parameter, or application row is returned.
-- Match source-backed relation/call shapes, allowing schema and identifier quoting.
-- Evidence covers retained pg_stat_statements data, not individual request timing/errors.
with opening as materialized (
  select clock_timestamp() as started_at, stats_reset, dealloc
  from extensions.pg_stat_statements_info
), families(feature, relation_or_call, predicate) as (
  values
    ('dam_search', $re$(from|join)[[:space:]]+("?(public|api)"?\.)?"?search_(assets_full_text|dam_documents)"?[[:space:]]*\($re$, null),
    ('dam_image_similarity', $re$(from|join)[[:space:]]+("?(public|api)"?\.)?"?search_dam_image_similarity"?[[:space:]]*\($re$, null),
    ('style_guide_browse', $re$(from|join)[[:space:]]+("?(public|api)"?\.)?"?style_guide_file(s|_groups)"?([[:space:]]|\)|$)$re$, 'directory_path'),
    ('style_guide_search', $re$(from|join)[[:space:]]+("?(public|api)"?\.)?"?search_(style_guide_library(_v2)?|style_groups_full_text)"?[[:space:]]*\($re$, null),
    ('ai_tag_candidates', $re$(from|join)[[:space:]]+("?(public|api)"?\.)?"?get_ai_tag_candidates"?[[:space:]]*\($re$, null),
    ('hts_ruling_search', $re$(from|join)[[:space:]]+("?(hts_rag)"?\.)?"?hts_rag_rulings"?([[:space:]]|\)|$)$re$, 'hts_rag_(fold_text|tariff_subheadings)')
), statement_rows as materialized (
  select s.userid, s.dbid, s.toplevel, s.queryid, s.stats_since,
         s.query, s.calls, s.total_exec_time
  from opening
  cross join lateral (
    select * from extensions.pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database())
    offset (case when opening.started_at is not null then 0 else 1 end)
  ) s
), captured as materialized (
  select count(*) filter (where s.query is null or s.queryid is null) as unreadable_rows,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'userid', s.userid::text, 'dbid', s.dbid::text, 'toplevel', s.toplevel,
             'queryid', s.queryid::text, 'stats_since', s.stats_since,
             'query_md5', md5(s.query), 'features', f.features,
             'calls', s.calls::text, 'total_exec_ms', s.total_exec_time::text
           ) order by s.userid, s.dbid, s.toplevel, s.queryid
         ) filter (where f.features is not null), '[]'::jsonb) as statements
  from statement_rows s
  cross join lateral (
    select array_agg(feature order by feature) as features
    from families
    where s.query ~* relation_or_call and (predicate is null or s.query ~* predicate)
  ) f
), closing as materialized (
  select clock_timestamp() as finished_at, stats_reset, dealloc
  from captured
  cross join lateral (
    select * from extensions.pg_stat_statements_info
    offset (case when captured.unreadable_rows >= 0 then 0 else 1 end)
  ) i
)
select jsonb_build_object(
  'format', '5610-search-performance-v1',
  'started_at', opening.started_at,
  'finished_at', closing.finished_at,
  'postmaster_started_at', pg_postmaster_start_time(),
  'database_oid', (select oid::text from pg_database where datname = current_database()),
  'database_stats_reset', (select stats_reset from pg_stat_database where datname = current_database()),
  'statement_track', current_setting('pg_stat_statements.track'),
  'statement_stats_reset', opening.stats_reset,
  'dealloc', opening.dealloc::text,
  'capture_stable', opening.stats_reset is not distinct from closing.stats_reset
                   and opening.dealloc = closing.dealloc,
  'unreadable_rows', captured.unreadable_rows,
  'statements', captured.statements
) as snapshot
from opening, captured, closing;
