-- #5231 follow-up (review finding #5241): keep DAM search fresh when licensor
-- character tags change, exactly as asset_characters_dam_search_refresh does,
-- and give the policies the table-qualified names the sibling table uses.
-- derived-from: none

create trigger asset_licensor_characters_dam_search_refresh
  after insert or update or delete on public.asset_licensor_characters
  for each row execute function public.trg_refresh_dam_tag_or_character();

alter policy "Authenticated read" on public.asset_licensor_characters
  rename to "Authenticated read asset_licensor_characters";
alter policy "Admin write" on public.asset_licensor_characters
  rename to "Admin write asset_licensor_characters";
