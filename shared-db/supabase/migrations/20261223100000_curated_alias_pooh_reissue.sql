-- derived-from: none
-- (Original 20261221010000 is retired and was never applied anywhere, so no ledger can hold it as a base.)
-- Curated alias reissue (shared-db #6781, popdam3#1037): "Pooh" names the Disney character "Winnie The Pooh".
-- 20261221010000 abstained in preview because the parent row id differs there; this resolves the parent by
-- licensor and exact name. Where the parent is absent (preview) it is a no-op; production verification
-- (curated_alias_pooh_v2) requires the row. Abstains if any alias anywhere already normalizes to "pooh".
do $curation$
declare
  target_id uuid;
  target_licensor uuid;
begin
  select c.id, c.licensor_id into target_id, target_licensor
    from core."character" c join core.licensor l on l.id = c.licensor_id
    where l.name = 'DISNEY' and c.name = 'Winnie The Pooh'
    for share of c;
  if (select count(*) from core."character" c join core.licensor l on l.id = c.licensor_id
      where l.name = 'DISNEY' and c.name = 'Winnie The Pooh') > 1 then
    raise exception 'More than one Disney Winnie The Pooh; alias abstained';
  end if;
  if target_id is null then
    raise notice 'Winnie The Pooh parent absent in this database; no alias written';
    return;
  end if;
  if exists (select 1 from core.character_alias a
      where a.normalized_alias = core.normalize_popsg_property_observation('Pooh')) then
    raise exception 'An alias already normalizes to pooh; alias abstained';
  end if;
  insert into core.character_alias (character_id, licensor_id, alias, source_system, evidence_notes, created_by, updated_by)
  values (target_id, target_licensor, 'Pooh', 'popdam3#1037',
    'Common short name used in PopDAM search (shared-db #6781)', 'shared-db migration 20261223100000', 'shared-db migration 20261223100000');
end $curation$;
