-- popcre/shared-db#6706, claim #6707, u2giants/popdam3#1037
-- Reissue of 20261218084707 (PR #6709), parked after preview-lane mutex contention (#6352).
-- Idempotent: preview already holds these objects from the original version.
-- Resolve only the names and property associations relevant to a typed search.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '5s';

-- Match JavaScript's lowercasing followed by ASCII word normalization. Only
-- U+0130 (i plus a combining separator) and U+212A (k) lowercase into ASCII
-- from outside ASCII. The explicit mappings and C collation make indexes
-- independent of the database locale.
create index if not exists character_dam_search_name_idx on core.character (
  (btrim(regexp_replace(lower(replace(replace(name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')))
);
create index if not exists characters_dam_search_name_idx on public.characters (
  (btrim(regexp_replace(lower(replace(replace(name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')))
);

create or replace function public.get_dam_search_named_rows(p_keys text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  -- Two 500-character inputs contain at most 3,944 contiguous one-to-eight-word phrases.
  if p_keys is null or cardinality(p_keys) > 4000 or coalesce(array_ndims(p_keys), 1) <> 1 then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase list';
  end if;
  if exists (
    select 1 from unnest(p_keys) as phrases(phrase)
    where phrase is null or octet_length(phrase) > 500
      or phrase collate pg_catalog."C" !~ '^[a-z0-9]+( [a-z0-9]+){0,7}$'
  ) then
    raise exception using errcode = '22023', message = 'Invalid DAM named search phrase';
  end if;

  return (
    with properties as materialized (
      select p.id, p.name
      from core.property p
      where btrim(regexp_replace(lower(replace(replace(p.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    ), licensors as (
      select i.name
      from core.licensor i
      where btrim(regexp_replace(lower(replace(replace(i.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      union all
      select a.alias
      from core.licensor_alias a
      where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
    )
    select jsonb_build_object(
      'characters', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
        from core.character c
        where btrim(regexp_replace(lower(replace(replace(c.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'aliases', coalesce((
        select jsonb_agg(jsonb_build_object('characterId', a.character_id, 'alias', a.alias))
        from core.character_alias a
        where btrim(regexp_replace(lower(replace(replace(a.alias, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'legacyCharacters', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
        from public.characters c
        where btrim(regexp_replace(lower(replace(replace(c.name, U&'\0130', 'i '), U&'\212A', 'k') collate pg_catalog."C"), '[^a-z0-9]+', ' ', 'g')) = any(p_keys)
      ), '[]'::jsonb),
      'properties', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)) from properties p
      ), '[]'::jsonb),
      'propertyCharacters', coalesce((
        select jsonb_agg(jsonb_build_object('propertyId', a.property_id, 'characterId', a.character_id))
        from core.property_character_associations_current a
        join properties p on p.id = a.property_id
      ), '[]'::jsonb),
      'licensorNames', coalesce((select jsonb_agg(i.name) from licensors i), '[]'::jsonb)
    )
  );
end;
$function$;

revoke all on function public.get_dam_search_named_rows(text[]) from public, anon, authenticated;
grant execute on function public.get_dam_search_named_rows(text[]) to service_role;

commit;
