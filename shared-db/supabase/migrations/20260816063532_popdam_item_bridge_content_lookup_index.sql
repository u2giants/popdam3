-- #853/#868 forward performance fix.
-- The full preview bridge refresh timed out without this normalized item lookup.

create index if not exists item_upper_trim_item_number_idx
  on plm.item ((upper(trim(item_number))));
