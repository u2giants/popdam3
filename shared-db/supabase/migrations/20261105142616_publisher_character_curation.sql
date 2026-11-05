-- Governed outside-source admission: shared-db #5683 / PopDAM #680.
-- Exactly two publisher-backed character identities under unchanged ColdLion parents.
-- No aliases, property edges, parent edits, matched-row updates or inferred editions.
-- Hashes bind private publisher captures and exact pre-admission parent witnesses.
do $curation$
declare
  candidate record;
  target_id uuid;
  parent_hash text;
  witness_hash text;
begin
  -- These global all-status/all-system identities are checked once for the whole packet.
  if exists (select 1 from core.character c where c.metadata->>'source_id' in
      ('https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase','https://www.carebears.com/#cheer-bear'))
    or exists (select 1 from core.taxonomy_source_ref r where r.source_id in
      ('https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase','https://www.carebears.com/#cheer-bear'))
  then raise exception 'Existing or conflicting identity in any status; packet abstained'; end if;
  -- Preflight the complete packet first; any identity match/conflict abstains all writes.
  for candidate in select * from (
    select 'cfb4783e-1b64-43ac-af92-96c098ea9456'::text as id,'Chase'::text as name,'a03fff4b-65f4-4fd6-98ad-c9db3216b140'::text as licensor_id,'https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase'::text as source_id,'aaa02545232ed4de09829b582f9e9c7396fcea13c8796ced112ccc08e0f8c08a'::text as page_sha256,'c60b4b8c468491a776eeaa2055107d1f'::text as parent_hash,'3f657490a39eb75d2a557f03c2addbc2'::text as witness_hash
    union all select 'e3733bd4-5547-473b-ad38-063d2237835a','Cheer Bear','b96edc00-9261-46ec-af93-9de0f5b88d48','https://www.carebears.com/#cheer-bear','7f010a2a3750014f845eaf35709189358042c034a27e339942ceab875b251cdb','90251184f71c72503ec125057f347349','1cd7d09dc8a047f8226b3681eff67efb'
  ) proposed
  loop
    select md5(to_jsonb(l)::text) into parent_hash from core.licensor l
      where l.id=candidate.licensor_id::uuid and l.status='active' for share;
    select md5(jsonb_agg(to_jsonb(r) order by r.id)::text) into witness_hash
      from core.taxonomy_source_ref r where r.entity_schema='core' and r.entity_table='licensor'
      and r.entity_id=candidate.licensor_id::uuid and r.source_system='coldlion';
    if parent_hash is distinct from candidate.parent_hash or witness_hash is distinct from candidate.witness_hash then
      raise exception 'Unchanged approved parent/source witness unavailable; packet abstained';
    end if;
    if exists (select 1 from core.character c where c.id=candidate.id::uuid
      or (c.licensor_id=candidate.licensor_id::uuid and
        (regexp_replace(lower(c.name),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g')
         or regexp_replace(lower(coalesce(c.code,'')),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g'))))
      or exists (select 1 from core.character_alias a where a.licensor_id=candidate.licensor_id::uuid
        and (regexp_replace(lower(a.alias),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g')
          or regexp_replace(lower(a.normalized_alias),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g')))
      or exists (select 1 from core.taxonomy_source_ref r where (r.entity_table='character' and
          (r.source_licensor_id=candidate.licensor_id::uuid or r.entity_id in
            (select c.id from core.character c where c.licensor_id=candidate.licensor_id::uuid))
          and (regexp_replace(lower(coalesce(r.source_name,'')),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g')
            or regexp_replace(lower(coalesce(r.source_code,'')),'[^a-z0-9]','','g')=regexp_replace(lower(candidate.name),'[^a-z0-9]','','g'))))
    then raise exception 'Existing or conflicting identity in any status; packet abstained'; end if;
  end loop;
  for candidate in select * from (
    select 'cfb4783e-1b64-43ac-af92-96c098ea9456'::text as id,'Chase'::text as name,'a03fff4b-65f4-4fd6-98ad-c9db3216b140'::text as licensor_id,'https://www.paramountplus.com/sneak-peak/paw-patrol-characters-cast/#chase'::text as source_id,'aaa02545232ed4de09829b582f9e9c7396fcea13c8796ced112ccc08e0f8c08a'::text as page_sha256,'c60b4b8c468491a776eeaa2055107d1f'::text as parent_hash,'3f657490a39eb75d2a557f03c2addbc2'::text as witness_hash
    union all select 'e3733bd4-5547-473b-ad38-063d2237835a','Cheer Bear','b96edc00-9261-46ec-af93-9de0f5b88d48','https://www.carebears.com/#cheer-bear','7f010a2a3750014f845eaf35709189358042c034a27e339942ceab875b251cdb','90251184f71c72503ec125057f347349','1cd7d09dc8a047f8226b3681eff67efb'
  ) proposed
  loop
    insert into core.character(id,licensor_id,name,code,status,metadata)
    values(candidate.id::uuid,candidate.licensor_id::uuid,candidate.name,null,'active',
      jsonb_build_object('loaded_by','shared-db migration 20261105142616','issue','popdam3#680',
        'source_system','primary_publisher','source_table','publisher_character_roster','source_id',candidate.source_id,
        'page_sha256',candidate.page_sha256,'parent_witness_md5',candidate.parent_hash,'coldlion_witness_md5',candidate.witness_hash))
    returning id into target_id;
    insert into core.taxonomy_source_ref(entity_schema,entity_table,entity_id,source_system,source_table,source_id,
      source_name,confidence,source_licensor_id,raw)
    values('core','character',target_id,'primary_publisher','publisher_character_roster',candidate.source_id,
      candidate.name,'verified',candidate.licensor_id::uuid,
      jsonb_build_object('page_sha256',candidate.page_sha256,'loaded_by','shared-db migration 20261105142616',
        'parent_witness_md5',candidate.parent_hash,'coldlion_witness_md5',candidate.witness_hash));
  end loop;
end
$curation$;
