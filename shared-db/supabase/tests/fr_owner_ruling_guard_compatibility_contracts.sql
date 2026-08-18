begin;

do $$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(oid)
  into strict v_constraint
  from pg_constraint
  where conrelid = 'plm.licensing_write_authorization'::regclass
    and conname = 'licensing_write_authorization_write_kind_check';

  if position('owner_ruling_fr_inactivation' in v_constraint) = 0 then
    raise exception 'FR owner-ruling authorization type is missing';
  end if;

  if exists (
    select 1
    from plm.licensing_write_authorization
    where write_kind = 'owner_ruling_fr_inactivation'
      and consumed_at is null
  ) then
    raise exception 'compatibility prerequisite must not pre-issue a reusable authorization';
  end if;
end $$;

rollback;
