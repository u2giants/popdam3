-- Normalize Disney OPA properties and characters out of the flat landing table.
--
-- BEFORE: plm.opa_property_character is a single flat table carrying, on every one of its
-- 10,262 rows, both the property name and the character name alongside the pair of IDs.
-- A property's name is therefore stored once per character it has, and Disney's 9,613
-- characters have no entity table at all. That is why an earlier session could not use the
-- Disney capture: there was nothing to resolve against.
--
-- AFTER: plm.opa_property and plm.opa_character hold one row per entity, and
-- plm.opa_property_character becomes the link between them.
--
-- MEASURED FACTS THIS DESIGN RESTS ON (production, 2026-08-13):
--   10,262 rows, and 10,262 distinct (licensed_property_id, character_id) pairs
--     -> the pair is already a clean natural key, no duplicate collapsing needed.
--   1,445 property IDs / 1,444 distinct names, 9,613 character IDs / 9,591 distinct names
--     -> two properties and 22 characters legitimately SHARE a display name. Names are
--        therefore not identity. Every ID maps to exactly one name (zero conflicts), so
--        the ID is safe as the primary key.
--   609 character IDs appear under MORE THAN ONE property
--     -> property-to-character is genuinely MANY-TO-MANY. The link table is required and
--        must not be folded into a character.property_id column. This is also why
--        plm.opa_property_character cannot simply be dropped: deleting it would destroy
--        the only record of those relationships.
--   24 properties carry more than one brand_property_id
--     -> brand_property_id is NOT a property attribute. It stays on the link row.
--
-- SCOPE. This migration is additive: it creates the two entity tables, backfills them from
-- rows already present, and adds foreign keys. It deliberately does NOT drop
-- property_name, character_name or property_id from the link table, because the Disney
-- loader still writes them; removing them here would break the next capture. That removal
-- is a separate step, after the loader is updated.

-- ---------------------------------------------------------------------------
-- 1. Property entity
-- ---------------------------------------------------------------------------
create table if not exists plm.opa_property (
  licensed_property_id bigint primary key,
  property_name        text not null check (btrim(property_name) <> ''),
  core_property_id     uuid references core.property(id) on delete restrict,
  resolution_status    text not null default 'unresolved'
                       check (resolution_status in ('unresolved','resolved','ambiguous','not_a_property')),
  resolution_reason    text,
  resolved_at          timestamptz,
  resolved_by          text,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- A resolution is only real if it names both a target and a resolver.
  constraint plm_opa_property_resolution_ck check (
    (resolution_status = 'resolved'
       and core_property_id is not null and resolved_at is not null
       and resolved_by is not null and btrim(resolved_by) <> '')
    or
    (resolution_status <> 'resolved'
       and core_property_id is null and resolved_at is null and resolved_by is null)
  )
);

comment on table plm.opa_property is
  'One row per Disney OPA licensed property. Identity is licensed_property_id; display '
  'names are NOT unique (two properties share a name as of 2026-08-13) and must never be '
  'used as a key. Populated from plm.opa_property_character.';

create index if not exists plm_opa_property_unresolved_idx
  on plm.opa_property (resolution_status) where resolution_status <> 'resolved';

-- ---------------------------------------------------------------------------
-- 2. Character entity
-- ---------------------------------------------------------------------------
create table if not exists plm.opa_character (
  character_id      bigint primary key,
  character_name    text not null check (btrim(character_name) <> ''),
  core_character_id uuid references core.character(id) on delete restrict,
  resolution_status text not null default 'unresolved'
                    check (resolution_status in ('unresolved','resolved','ambiguous','not_a_character')),
  resolution_reason text,
  resolved_at       timestamptz,
  resolved_by       text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint plm_opa_character_resolution_ck check (
    (resolution_status = 'resolved'
       and core_character_id is not null and resolved_at is not null
       and resolved_by is not null and btrim(resolved_by) <> '')
    or
    (resolution_status <> 'resolved'
       and core_character_id is null and resolved_at is null and resolved_by is null)
  )
);

comment on table plm.opa_character is
  'One row per Disney OPA character. Identity is character_id. 22 characters share a '
  'display name with another character, and 609 characters belong to more than one '
  'property, so NEVER deduplicate on name and never assume a single parent property. '
  'Populated from plm.opa_property_character.';

create index if not exists plm_opa_character_unresolved_idx
  on plm.opa_character (resolution_status) where resolution_status <> 'resolved';

-- ---------------------------------------------------------------------------
-- 3. Backfill from the rows already captured.
--
-- min/max of the observed timestamps preserve real capture history rather than stamping
-- everything with now(). The name is taken with min() only because every ID was verified
-- to have exactly one distinct name; if that ever stops being true the unique check in
-- step 5 fails the migration rather than silently picking one.
-- ---------------------------------------------------------------------------
insert into plm.opa_property (licensed_property_id, property_name, first_seen_at, last_seen_at)
select o.licensed_property_id,
       min(o.property_name),
       min(coalesce(o.first_seen_at, o.imported_at, now())),
       max(coalesce(o.last_seen_at, o.imported_at, now()))
from plm.opa_property_character o
group by o.licensed_property_id
on conflict (licensed_property_id) do nothing;

insert into plm.opa_character (character_id, character_name, first_seen_at, last_seen_at)
select o.character_id,
       min(o.character_name),
       min(coalesce(o.first_seen_at, o.imported_at, now())),
       max(coalesce(o.last_seen_at, o.imported_at, now()))
from plm.opa_property_character o
group by o.character_id
on conflict (character_id) do nothing;

-- Carry across any property resolution already recorded on the flat table. As of
-- 2026-08-13 every row is 'unresolved', so this is a no-op guard against losing work if
-- that changes before the migration is applied.
update plm.opa_property p
set core_property_id = src.property_id,
    resolution_status = 'resolved',
    resolved_at = coalesce(src.resolved_at, now()),
    resolved_by = coalesce(src.resolved_by, 'migration:20260814040000'),
    resolution_reason = src.resolution_reason,
    updated_at = now()
from (
  select licensed_property_id, min(property_id) property_id, min(resolved_at) resolved_at,
         min(resolved_by) resolved_by, min(resolution_reason) resolution_reason
  from plm.opa_property_character
  where property_id is not null
  group by licensed_property_id
) src
where src.licensed_property_id = p.licensed_property_id
  and p.core_property_id is null;

-- ---------------------------------------------------------------------------
-- 4. Make the flat table a real link table.
--
-- The pair is already unique in the data; assert it as a constraint so a future load
-- cannot reintroduce duplicates, then point both sides at the entity tables.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.opa_property_character'::regclass
      and conname = 'plm_opa_property_character_pair_key'
  ) then
    alter table plm.opa_property_character
      add constraint plm_opa_property_character_pair_key
      unique (licensed_property_id, character_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.opa_property_character'::regclass
      and conname = 'plm_opa_property_character_property_fk'
  ) then
    alter table plm.opa_property_character
      add constraint plm_opa_property_character_property_fk
      foreign key (licensed_property_id) references plm.opa_property(licensed_property_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'plm.opa_property_character'::regclass
      and conname = 'plm_opa_property_character_character_fk'
  ) then
    alter table plm.opa_property_character
      add constraint plm_opa_property_character_character_fk
      foreign key (character_id) references plm.opa_character(character_id)
      on delete restrict;
  end if;
end $$;

create index if not exists plm_opa_property_character_character_idx
  on plm.opa_property_character (character_id);

comment on table plm.opa_property_character is
  'Disney OPA property-to-character LINK table. Do not delete it: 609 characters belong to '
  'more than one property, so this many-to-many relationship exists nowhere else. Entity '
  'detail now lives in plm.opa_property and plm.opa_character. The property_name, '
  'character_name and property_id columns here are DEPRECATED duplicates kept only until '
  'the Disney loader stops writing them; read the entity tables instead.';

comment on column plm.opa_property_character.property_name is
  'DEPRECATED duplicate of plm.opa_property.property_name. Do not read. Removed once the '
  'Disney loader stops writing it.';
comment on column plm.opa_property_character.character_name is
  'DEPRECATED duplicate of plm.opa_character.character_name. Do not read. Removed once the '
  'Disney loader stops writing it.';
comment on column plm.opa_property_character.property_id is
  'DEPRECATED duplicate of plm.opa_property.core_property_id. Resolve on the entity table.';
comment on column plm.opa_property_character.brand_property_id is
  'Stays on the link row on purpose: 24 properties carry more than one brand_property_id, '
  'so it is not a property-level attribute.';

-- ---------------------------------------------------------------------------
-- 5. Prove the normalization before this migration is allowed to commit.
-- ---------------------------------------------------------------------------
do $$
declare
  v_pairs bigint; v_props bigint; v_chars bigint;
  v_src_props bigint; v_src_chars bigint; v_bad bigint;
begin
  select count(*) into v_pairs from plm.opa_property_character;
  select count(*) into v_props from plm.opa_property;
  select count(*) into v_chars from plm.opa_character;
  select count(distinct licensed_property_id), count(distinct character_id)
    into v_src_props, v_src_chars from plm.opa_property_character;

  if v_props <> v_src_props then
    raise exception 'opa normalize: property count mismatch (entity % vs source %)', v_props, v_src_props;
  end if;
  if v_chars <> v_src_chars then
    raise exception 'opa normalize: character count mismatch (entity % vs source %)', v_chars, v_src_chars;
  end if;

  -- No name was silently dropped by the min() aggregate.
  select count(*) into v_bad from (
    select licensed_property_id from plm.opa_property_character
    group by licensed_property_id having count(distinct property_name) > 1) x;
  if v_bad > 0 then
    raise exception 'opa normalize: % property ids carry more than one name; backfill would lose data', v_bad;
  end if;

  select count(*) into v_bad from (
    select character_id from plm.opa_property_character
    group by character_id having count(distinct character_name) > 1) y;
  if v_bad > 0 then
    raise exception 'opa normalize: % character ids carry more than one name; backfill would lose data', v_bad;
  end if;

  -- Every link still resolves on both sides.
  select count(*) into v_bad from plm.opa_property_character o
  where not exists (select 1 from plm.opa_property p where p.licensed_property_id = o.licensed_property_id)
     or not exists (select 1 from plm.opa_character c where c.character_id = o.character_id);
  if v_bad > 0 then
    raise exception 'opa normalize: % link rows have no entity row', v_bad;
  end if;

  raise notice 'opa normalize OK: % links, % properties, % characters', v_pairs, v_props, v_chars;
end $$;
