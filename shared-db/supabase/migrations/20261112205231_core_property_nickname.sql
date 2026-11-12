-- shared-db#6178. Nickname for MG06 Properties (core.property), same pattern as
-- core.licensor.nickname / core.customer.nickname (20261112025359).
-- Owner authority, Albert Hazan, 2026-11-12: "“Standard Characters”'s nickname should be
-- Mickey Group."
-- Production check 2026-11-12 2:45 PM EST: no 'Standard Characters' property exists yet (it
-- arrives with the corrected MG06 list). The value is therefore set only when exactly one
-- such row exists; otherwise a NOTICE is raised and the value is a recorded follow-up on #6178.
-- Rollback: alter table core.property drop column nickname;

alter table core.property add column if not exists nickname text;
comment on column core.property.nickname is 'Short everyday name used inside POP (owner-maintained).';

do $data$
declare
  v_n integer;
begin
  select count(*) into v_n from core.property where name = 'Standard Characters';
  if v_n = 1 then
    update core.property set nickname = 'Mickey Group' where name = 'Standard Characters';
  else
    raise notice '#6178: % Standard Characters property rows; nickname not set', v_n;
  end if;
end
$data$;
