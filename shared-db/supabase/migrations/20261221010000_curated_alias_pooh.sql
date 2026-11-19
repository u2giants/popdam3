-- Curated alias (shared-db #6781, popdam3#1037): "Pooh" names the Disney character "Winnie The Pooh".
-- One row only. Abstains if the parent is missing or any Disney alias already normalizes to "pooh".
do $curation$
declare
  target_id constant uuid := 'c80171c3-cd42-4d61-9a98-177e83ce0917';
  target_licensor uuid;
begin
  select c.licensor_id into target_licensor from core."character" c
    where c.id = target_id and c.name = 'Winnie The Pooh' for share;
  if target_licensor is null then
    raise exception 'Winnie The Pooh parent unavailable; alias abstained';
  end if;
  if exists (select 1 from core.character_alias a
      where a.licensor_id = target_licensor
        and a.normalized_alias = core.normalize_popsg_property_observation('Pooh')) then
    raise exception 'A Disney alias already normalizes to pooh; alias abstained';
  end if;
  insert into core.character_alias (character_id, licensor_id, alias, source_system, evidence_notes, created_by, updated_by)
  values (target_id, target_licensor, 'Pooh', 'popdam3#1037',
    'Common short name used in PopDAM search (shared-db #6781)', 'shared-db migration 20261221010000', 'shared-db migration 20261221010000');
end $curation$;
