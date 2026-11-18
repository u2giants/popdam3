-- Issue #6685 (claim #6764, version 20261218140000). Cap concurrent
-- connections for the DesignFlow sandbox HTS worker login role.
-- derived-from: none
--
-- WHY. From the evening of 2026-11-17 this login role held 16 concurrent
-- active connections (hts_rag nearest-product / rulings searches, statements
-- up to 11 s) for 14+ hours, saturating the shared pooler and making PopDAM
-- search slow or return 503 (u2giants/popdam3#1037). The worker-side
-- bound-and-drain fix is popcre/designflow-backend#458; this migration is the
-- durable database-side backstop the issue asked for "via the normal shared-db
-- path" (its other branch, capping the worker's own concurrency, is that PR).
--
-- WHY 8. The nearest-product scorer is designed for a four-connection pool
-- with one case in flight (designflow-backend#458). 8 is twice that budget:
-- room for a restart overlap and one operator sample session (the 2026-11-18
-- recovery observed 5 live connections for this role while the replacement
-- scorer ran), while refusing the 16-way saturation this issue reports.
-- ALTER ROLE does not disconnect existing sessions; new logins are refused
-- once the role is at its ceiling.
--
-- SCOPE. Writes role designflow_hts_alsand_worker's rolconnlimit only. No
-- grant, no schema, no table, no data. designflow_hts_alsand_runtime,
-- designflow_hts_prod_worker and interactive HTS keep their existing
-- behavior (issue #6685 thread, 2026-11-18).
--
-- ROLLBACK (forward fix):
--   alter role designflow_hts_alsand_worker connection limit -1;
-- or a higher explicit ceiling if 8 ever refuses a legitimate launch.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- Plain ALTER ROLE has no IF EXISTS. The role is created by
-- 20260911210709 (later enabled for login by the out-of-git credential step
-- the same migration documents). A database that never had the role must fail
-- this migration loudly rather than silently skip the cap.
do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'designflow_hts_alsand_worker'
  ) then
    raise exception 'ABORT #6685: role designflow_hts_alsand_worker is absent; refusing to apply the cap to a database that never had the role';
  end if;
end $$;

alter role designflow_hts_alsand_worker connection limit 8;

-- In-migration durable proof: the attribute is set when this commits.
do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'designflow_hts_alsand_worker'
      and rolconnlimit = 8
  ) then
    raise exception 'VERIFY FAILED #6685: designflow_hts_alsand_worker rolconnlimit is not 8 after the alter';
  end if;
end $$;

commit;
