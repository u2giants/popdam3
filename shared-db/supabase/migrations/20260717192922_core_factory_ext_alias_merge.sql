-- core.factory vendor lineup support: short display labels, aliases, and merge helper.
--
-- This mirrors the already-shipped customer review machinery for vendors
-- (core.factory): display_name makes pickers human-friendly, factory_alias keeps
-- absorbed/legacy names searchable after merges, and merge_factory repoints the
-- current FK graph before deleting the losing canonical row.

alter table core.factory add column display_name text;

create index core_factory_display_name_trgm_idx
  on core.factory using gin (lower(display_name) extensions.gin_trgm_ops);

comment on column core.factory.display_name is
  'Short, human-friendly vendor name for dropdowns/pickers. Nullable; serving code should show coalesce(display_name, name).';

create table core.factory_alias (
  id               uuid primary key default gen_random_uuid(),
  factory_id       uuid not null references core.factory(id) on delete cascade,
  alias            text not null,
  normalized_alias text generated always as (lower(regexp_replace(alias, '\s+', ' ', 'g'))) stored,
  alias_type       text not null default 'other',
  source_system    text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint factory_alias_alias_not_blank check (length(btrim(alias)) > 0),
  constraint factory_alias_type_check check (
    alias_type in ('legacy_name','banner','dba','erp_name','abbreviation','other')
  )
);

create unique index factory_alias_factory_norm_key on core.factory_alias (factory_id, normalized_alias);
create index factory_alias_factory_idx on core.factory_alias (factory_id);
create index factory_alias_norm_idx on core.factory_alias (normalized_alias);
create index factory_alias_trgm_idx on core.factory_alias using gin (normalized_alias extensions.gin_trgm_ops);

create trigger set_updated_at before update on core.factory_alias
  for each row execute function app.set_updated_at();

alter table core.factory_alias enable row level security;

-- RLS mirrors core.factory exactly: admins write, shared roles read.
create policy admin_write on core.factory_alias
  for all to authenticated
  using (app.has_role('administrator'))
  with check (app.has_role('administrator'));

create policy shared_read on core.factory_alias
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

grant select on core.factory_alias to authenticated;
grant all on core.factory_alias to service_role;

comment on table core.factory_alias is
  'Alternate names a core.factory/vendor is known by (legacy names, DBAs, ERP spellings, abbreviations). Lets duplicate vendors be merged without losing searchable absorbed names; normalized_alias is trigram-indexed for fuzzy candidate search.';
comment on column core.factory_alias.alias_type is
  'legacy_name | banner | dba | erp_name | abbreviation | other';
comment on column core.factory_alias.source_system is
  'Where the alias came from: coldlion | designflow_plm | directus | manual | merge. Free text, not enforced.';

create or replace function core.merge_factory(
  p_loser uuid,
  p_survivor uuid,
  p_alias_loser_name boolean default true
) returns void
language plpgsql
security definer
set search_path = core, crm, pim, dam, plm, app, public
as $$
declare
  v_loser_name text;
  v_loser_display text;
begin
  if p_loser = p_survivor then
    raise exception 'merge_factory: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.factory where id=p_survivor) then
    raise exception 'merge_factory: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display from core.factory where id=p_loser;
  if not found then
    raise exception 'merge_factory: loser % does not exist.', p_loser;
  end if;

  -- Composite unique on (factory_id, contact_id, role): remove loser rows that
  -- would become duplicates of existing survivor rows, then move the rest.
  delete from core.vendor_contact lc
  where lc.factory_id=p_loser
    and exists (
      select 1
      from core.vendor_contact sc
      where sc.factory_id=p_survivor
        and sc.contact_id is not distinct from lc.contact_id
        and sc.role is not distinct from lc.role
    );
  update core.vendor_contact set factory_id=p_survivor where factory_id=p_loser;

  -- Aliases have a composite unique on (factory_id, normalized_alias).
  delete from core.factory_alias la where la.factory_id=p_loser
    and exists (select 1 from core.factory_alias sa where sa.factory_id=p_survivor and sa.normalized_alias=la.normalized_alias);
  update core.factory_alias set factory_id=p_survivor where factory_id=p_loser;

  -- Source refs are unique by source identity, not by factory.
  update core.factory_source_ref set factory_id=p_survivor where factory_id=p_loser;

  -- Plain FK columns currently referencing core.factory (enumerated 2026-07-17).
  update crm.opportunity                set factory_id=p_survivor where factory_id=p_loser;
  update pim.product                    set factory_id=p_survivor where factory_id=p_loser;
  update pim.product_sample             set factory_id=p_survivor where factory_id=p_loser;
  update plm.erp_vendor                 set factory_id=p_survivor where factory_id=p_loser;
  update plm.production_order           set factory_id=p_survivor where factory_id=p_loser;
  update plm.rfq_vendor                 set factory_id=p_survivor where factory_id=p_loser;
  update plm.style_tracker_item_bridge  set factory_id=p_survivor where factory_id=p_loser;

  -- Preserve absorbed names as aliases so search can still find the survivor.
  if p_alias_loser_name then
    insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged factory '||p_loser
    on conflict (factory_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge', 'display name from merged factory '||p_loser
      on conflict (factory_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.factory where id=p_loser;
end;
$$;

revoke all on function core.merge_factory(uuid,uuid,boolean) from public;
grant execute on function core.merge_factory(uuid,uuid,boolean) to service_role;
