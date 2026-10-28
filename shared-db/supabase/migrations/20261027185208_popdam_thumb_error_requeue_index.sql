-- derived-from: none
-- #4905 (author claim #4926; application issue u2giants/popdam3 #540): make
-- the thumbnail-error requeue scans index-driven on public.assets.
--
-- MEASURED ON PRODUCTION (read-only, 2026-10-27 ~10:41 AM EDT, popdam3 #486
-- diagnosis): the designed repair route admin-api `requeue-broken-thumbnails`
-- (service-role PostgREST, `thumbnail_error LIKE 'Thumbnail not found in
-- storage%' AND is_deleted = false ORDER BY id`, first page of 1000) dies
-- deterministically with "canceling statement due to statement timeout"
-- (HTTP 500, ~8.4 s, reproduced 3x). Root cause: no index exists on
-- assets.thumbnail_error; the assets relation is ~3.3 GB (~139.5k rows), so
-- every page fetch seq-scans it, which cannot fit Supabase's 8 s PostgREST
-- statement cap. Exactly 50 rows carried the marker at diagnosis (51 including
-- the AVIS_0032.psd prerequisite marked out-of-band 2026-10-27), so the route
-- touches a tiny set — only the scan is unbounded. `requeue-all-no-preview`
-- (`thumbnail_url IS NULL AND thumbnail_error IS NOT NULL`) shares the
-- unindexed-scan shape.
--
-- Change: one partial text_pattern_ops index. The marker LIKE-prefix filter
-- becomes an index condition over only the marked rows, and the
-- `thumbnail_error IS NOT NULL` leg of requeue-all-no-preview matches the
-- partial predicate directly. No handler rewrite is needed.
--
-- Build shape (20260830013942 precedent): the repository's atomic migration
-- runner cannot execute CREATE INDEX CONCURRENTLY, so the build is
-- transactional with a bounded lock timeout (fail fast instead of waiting
-- behind live traffic) and a statement budget sized for a ~3.3 GB heap walk.
-- The build takes a SHARE lock on public.assets for its duration; writes
-- queue briefly.

set lock_timeout = '5s';
set statement_timeout = '10min';

create index if not exists idx_assets_thumbnail_error_pattern
  on public.assets using btree (thumbnail_error text_pattern_ops)
  where thumbnail_error is not null;

-- =====================================================================================
-- POST-APPLY VERIFICATION.
-- =====================================================================================
do $verify$
declare
  v_index  oid;
  v_keycol text;
  v_opcls  text;
  v_pred   text;
begin
  select i.indexrelid,
         (select a.attname from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = i.indkey[0]),
         (select opc.opcname from pg_opclass opc where opc.oid = i.indclass[0]),
         lower(regexp_replace(regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()]', '', 'g'), '\s+', '', 'g'))
  into v_index, v_keycol, v_opcls, v_pred
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'idx_assets_thumbnail_error_pattern';

  if v_index is null then
    raise exception 'VERIFY FAILED: public.idx_assets_thumbnail_error_pattern is missing';
  end if;

  if not (select i.indisvalid and i.indisready from pg_index i where i.indexrelid = v_index) then
    raise exception 'VERIFY FAILED: idx_assets_thumbnail_error_pattern is not valid and ready';
  end if;

  if v_keycol is distinct from 'thumbnail_error'
     or v_opcls is distinct from 'text_pattern_ops'
     or (select i.indnkeyatts from pg_index i where i.indexrelid = v_index) <> 1 then
    raise exception 'VERIFY FAILED: index key is not exactly (thumbnail_error text_pattern_ops)';
  end if;

  if v_pred is distinct from 'thumbnail_errorisnotnull' then
    raise exception 'VERIFY FAILED: index predicate is not "thumbnail_error is not null"';
  end if;
end
$verify$;
