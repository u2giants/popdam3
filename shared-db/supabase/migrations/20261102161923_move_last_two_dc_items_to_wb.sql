-- Issue popcre/shared-db#5436: the last two items on the retired DC licensor.
--
-- SDD2DDYTB01 and EB92DYTB01 are absent from the ColdLion feed, so the import that re-pointed
-- the other DC items in run 41372259878 cannot reach them. Their Property, THE BATMAN MOVIE,
-- already belongs to WARNER BROS, so only the licensor changes.
--
-- Idempotent. No matching rows on preview is a pass. RECOVERY: set licensor_id back to
-- 33962356-f1f9-4226-b3ef-00154e5b7d56 for these two item numbers.

do $move$
declare
  v_remaining integer;
begin
  update plm.item i
     set licensor_id = p.licensor_id
    from core.property p
   where p.id = i.property_id
     and i.item_number in ('SDD2DDYTB01', 'EB92DYTB01')
     and i.licensor_id = '33962356-f1f9-4226-b3ef-00154e5b7d56'
     and i.property_id = '99e3b4f5-f7ec-4d7a-b56a-9b71b374b61c'
     and p.licensor_id = '88313675-0089-4072-87be-5b989df8a3fc';

  select count(*) into v_remaining
    from plm.item
   where item_number in ('SDD2DDYTB01', 'EB92DYTB01')
     and licensor_id = '33962356-f1f9-4226-b3ef-00154e5b7d56';

  if v_remaining > 0 then
    raise exception 'popcre/shared-db#5436: % item(s) still on the DC licensor', v_remaining;
  end if;
end;
$move$;
