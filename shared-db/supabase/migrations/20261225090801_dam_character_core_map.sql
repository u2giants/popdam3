-- popcre/shared-db#6994 (stage C1 of u2giants/popdam3#1298; plan_shared_data_no_copies_db.md)
-- PopDAM keeps its own character list (public.characters) instead of the shared
-- core.character. This builds the reviewed map from each PopDAM character to
-- one core.character so stage C2 can re-point image tags. Nothing is re-pointed
-- or dropped here.
--
-- Rules (licensing correctness):
--   * licensor first: PopDAM licensor -> core.licensor by code (DS->DY, WWE->WW)
--     or name, exactly as public.dam_character_catalog does; a PopDAM licensor
--     that resolves to zero or several core licensors stays unmapped;
--   * never map across licensors;
--   * name match is case/space-insensitive within that licensor; when the
--     licensor scrape stored the same name several times (e.g. Warner product
--     catalogue + art assets) the first active row is chosen and the method says
--     so ('exact_name_duplicate', confidence medium);
--   * then core.character_alias within the licensor; core.taxonomy_source_ref has
--     no row matching public.characters.external_id (checked 2026-11-23);
--   * one reviewed manual link: Strawberry Shortcake Classic -> Strawberry
--     Shortcake (same licensor, same character, classic art style);
--   * WWE (0 core characters) and Coca-Cola had tagged PopDAM characters with no
--     shared record; those are created under the licensor the shared records
--     prove (core.licensor WW / COCA COLA) and mapped 'created_from_popdam'.
-- Everything else stays unmapped and is listed in the private C1 report.
-- Recovery: drop table dam.character_core_map; delete from core.character
-- where metadata->>'issue' = 'popcre/shared-db#6994'.

create table if not exists dam.character_core_map (
  public_character_id uuid primary key references public.characters (id) on delete cascade,
  core_character_id uuid not null references core.character (id),
  method text not null check (method in
    ('exact_name', 'exact_name_duplicate', 'alias', 'reviewed_manual', 'created_from_popdam')),
  confidence text not null check (confidence in ('high', 'medium')),
  reviewed_at timestamptz not null default now()
);
create index if not exists character_core_map_core_idx on dam.character_core_map (core_character_id);
alter table dam.character_core_map enable row level security;
comment on table dam.character_core_map is
  'PopDAM public.characters -> core.character (popcre/shared-db#6994). Licensor-scoped; unmapped characters are absent.';

-- Legacy PopDAM licensor -> exactly one core licensor.
create temporary table c1_licensor on commit drop as
select pl.id as public_licensor_id, min(cl.id::text)::uuid as core_licensor_id
from public.licensors pl
join core.licensor cl
  on lower(cl.code) = lower(case pl.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else pl.external_id end)
  or lower(trim(cl.name)) = lower(trim(pl.name))
group by pl.id
having count(distinct cl.id) = 1;

create temporary table c1_popdam on commit drop as
select c.id, c.name, lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) as n, l.core_licensor_id
from public.characters c
join public.properties p on p.id = c.property_id
join c1_licensor l on l.public_licensor_id = p.licensor_id;

-- Missing shared records for tagged WWE / Coca-Cola characters.
insert into core.character (licensor_id, name, code, metadata)
select distinct on (pc.core_licensor_id, pc.n)
  pc.core_licensor_id, trim(pc.name), 'popdam:' || pc.id,
  jsonb_build_object('issue', 'popcre/shared-db#6994', 'source_system', 'popdam',
    'source_table', 'public.characters', 'source_id', pc.id::text)
from c1_popdam pc
join core.licensor cl on cl.id = pc.core_licensor_id
where (upper(cl.code) = 'WW' or upper(trim(cl.name)) in ('WWE', 'COCA COLA'))
  and pc.n in ('hulk hogan', 'undertaker', 'john cena', 'the rock', 'roman reigns',
    'wwe logo', 'smackdown logo', 'raw logo', 'wrestlemania', 'nwo',
    'wwe heavyweight championship title', 'coca-cola', 'coke', 'diet coke')
  and not exists (
    select 1 from core.character x
    where x.licensor_id = pc.core_licensor_id
      and lower(regexp_replace(trim(x.name), '\s+', ' ', 'g')) = pc.n)
order by pc.core_licensor_id, pc.n, pc.id;

-- Name candidates per PopDAM character, within its licensor.
create temporary table c1_name on commit drop as
select pc.id as public_character_id, cc.id as core_character_id,
  count(*) over (partition by pc.id) as k,
  row_number() over (partition by pc.id
    order by (cc.status = 'active') desc, cc.created_at, cc.id) as rn,
  cc.metadata->>'issue' = 'popcre/shared-db#6994' as created
from c1_popdam pc
join core.character cc
  on cc.licensor_id = pc.core_licensor_id
 and lower(regexp_replace(trim(cc.name), '\s+', ' ', 'g')) = pc.n;

insert into dam.character_core_map (public_character_id, core_character_id, method, confidence)
select public_character_id, core_character_id,
  case when created then 'created_from_popdam' when k = 1 then 'exact_name' else 'exact_name_duplicate' end,
  case when k = 1 then 'high' else 'medium' end
from c1_name where rn = 1
on conflict (public_character_id) do nothing;

-- Aliases (exactly one aliased character within the licensor).
insert into dam.character_core_map (public_character_id, core_character_id, method, confidence)
select pc.id, min(a.character_id::text)::uuid, 'alias', 'high'
from c1_popdam pc
join core.character_alias a
  on a.licensor_id = pc.core_licensor_id
 and lower(regexp_replace(trim(a.alias), '\s+', ' ', 'g')) = pc.n
where not exists (select 1 from dam.character_core_map m where m.public_character_id = pc.id)
group by pc.id
having count(distinct a.character_id) = 1
on conflict (public_character_id) do nothing;

-- Reviewed manual link.
insert into dam.character_core_map (public_character_id, core_character_id, method, confidence)
select pc.id, cc.id, 'reviewed_manual', 'high'
from c1_popdam pc
join core.character cc
  on cc.licensor_id = pc.core_licensor_id
 and lower(trim(cc.name)) = 'strawberry shortcake'
where pc.n = 'strawberry shortcake classic'
  and (select count(*) from core.character y
       where y.licensor_id = pc.core_licensor_id and lower(trim(y.name)) = 'strawberry shortcake') = 1
on conflict (public_character_id) do nothing;
