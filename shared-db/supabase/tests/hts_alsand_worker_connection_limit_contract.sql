-- Behavioural contract for migration 20261218140000 (issue #6685, claim #6764):
-- the DesignFlow sandbox HTS worker role carries a durable connection ceiling,
-- so the 16-way saturation of 2026-11-17/18 cannot recur from the database
-- side. Runs inside the usual rolled-back transaction.

do $catalog$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = 'designflow_hts_alsand_worker'
      and rolconnlimit = 8
  ) then
    raise exception 'designflow_hts_alsand_worker rolconnlimit is not 8';
  end if;
end
$catalog$;
