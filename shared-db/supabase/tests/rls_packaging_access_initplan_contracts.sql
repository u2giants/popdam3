-- Issue #4430 packaging access InitPlan contracts.
-- LOCAL THROWAWAY DATABASE ONLY. Never execute against production.
-- Asserts: if a target policy is wrapped, the wrap is well-formed; email exception survives.
do $rls4430_contracts$
declare
  r record;
begin
  for r in
    select policyname, qual, with_check
    from pg_policies
    where schemaname = 'core' and tablename = 'packaging_type'
      and policyname in ('admin_or_packaging_manager_write','shared_read')
  loop
    if coalesce(r.qual, '') not like '%has_role(%' then
      raise exception 'rls4430: policy % lost has_role entirely', r.policyname;
    end if;
    if coalesce(r.qual, '') not like '%apinilla@popcre.com%' then
      raise exception 'rls4430: policy % lost the email exception', r.policyname;
    end if;
    if r.policyname = 'shared_read' and coalesce(r.qual, '') not like '%has_any_role(%' then
      raise exception 'rls4430: shared_read lost has_any_role';
    end if;
    if r.policyname = 'admin_or_packaging_manager_write' and r.with_check is null then
      raise exception 'rls4430: admin_or_packaging_manager_write lost with_check';
    end if;
    if r.policyname = 'shared_read' and r.with_check is not null then
      raise exception 'rls4430: shared_read with_check should remain null';
    end if;
  end loop;
end
$rls4430_contracts$;
