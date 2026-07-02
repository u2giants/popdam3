-- Canonical people lookup tables for design/art roles.
--
-- Seed data is sourced from designer_artist_proposed_in_place_cleanup.csv.
-- Rows with corrected_value = 'N/A' are intentionally excluded; those source
-- values should be blanked/nullified in later app-aware cleanup migrations.

create table if not exists core.creative_designer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creative_designer_name_not_blank check (btrim(name) <> ''),
  constraint creative_designer_name_unique unique (normalized_name)
);

create table if not exists core.technical_designer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technical_designer_name_not_blank check (btrim(name) <> ''),
  constraint technical_designer_name_unique unique (normalized_name)
);

create table if not exists core.freelance_designer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint freelance_designer_name_not_blank check (btrim(name) <> ''),
  constraint freelance_designer_name_unique unique (normalized_name)
);

create table if not exists core.artist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  status app.entity_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_name_not_blank check (btrim(name) <> ''),
  constraint artist_name_unique unique (normalized_name)
);

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'core.creative_designer'::regclass,
    'core.technical_designer'::regclass,
    'core.freelance_designer'::regclass,
    'core.artist'::regclass
  ]
  loop
    execute format('alter table %s enable row level security', t);
  end loop;
end $$;

do $$
declare
  t regclass;
begin
  foreach t in array array[
    'core.creative_designer'::regclass,
    'core.technical_designer'::regclass,
    'core.freelance_designer'::regclass,
    'core.artist'::regclass
  ]
  loop
    execute format(
      'drop policy if exists shared_read on %s',
      t
    );
    execute format(
      'create policy shared_read on %s for select to authenticated using ((select app.has_any_role(array[''administrator'', ''sales'', ''licensing'', ''designer'', ''viewer'', ''vendor'']::app.app_role[])))',
      t
    );

    execute format(
      'drop policy if exists admin_write on %s',
      t
    );
    execute format(
      'create policy admin_write on %s for all to authenticated using ((select app.has_role(''administrator''))) with check ((select app.has_role(''administrator'')))',
      t
    );

    execute format(
      'drop policy if exists service_role_write on %s',
      t
    );
    execute format(
      'create policy service_role_write on %s for all to service_role using (true) with check (true)',
      t
    );
  end loop;
end $$;

create trigger set_updated_at before update on core.creative_designer
  for each row execute function app.set_updated_at();

create trigger set_updated_at before update on core.technical_designer
  for each row execute function app.set_updated_at();

create trigger set_updated_at before update on core.freelance_designer
  for each row execute function app.set_updated_at();

create trigger set_updated_at before update on core.artist
  for each row execute function app.set_updated_at();

grant select on core.creative_designer to authenticated;
grant select on core.technical_designer to authenticated;
grant select on core.freelance_designer to authenticated;
grant select on core.artist to authenticated;

grant all on core.creative_designer to service_role;
grant all on core.technical_designer to service_role;
grant all on core.freelance_designer to service_role;
grant all on core.artist to service_role;

insert into core.creative_designer (name)
values
  ('Beckett Schiaparelli'),
  ('Deborah Salles'),
  ('Derrick Smith'),
  ('Eduarda Costa'),
  ('Erica Perestrelo'),
  ('James Ashley'),
  ('Jen Chaffier'),
  ('Leonard Boone'),
  ('Liz Parkin'),
  ('Malachi Cameron'),
  ('Marcel Zabolotniy'),
  ('Mauricio Casagrande'),
  ('Rodrigo Garcia'),
  ('Sarbani Ghosh'),
  ('Siyuan'),
  ('Steve Savitsky'),
  ('Tanisha Shah'),
  ('Theo Kim'),
  ('Vie Dionisio')
on conflict (normalized_name) do update
set name = excluded.name,
    status = 'active',
    updated_at = now();

insert into core.technical_designer (name)
values
  ('Alejandra Pinilla'),
  ('Angie Silva'),
  ('Anyela Agudelo'),
  ('Danilo Moreno'),
  ('Devon Swing'),
  ('Jessica Pinilla'),
  ('Lina Arcila'),
  ('Luis Herrera'),
  ('Marcela Arboleda'),
  ('Martina Cardoso'),
  ('Zarit Calderon')
on conflict (normalized_name) do update
set name = excluded.name,
    status = 'active',
    updated_at = now();

insert into core.freelance_designer (name)
values
  ('4 Seasons'),
  ('5 Seasons'),
  ('6 Seasons'),
  ('Caio'),
  ('Clifford Brown'),
  ('Gary Darzano'),
  ('German Bernales'),
  ('Ikonick'),
  ('Jeanette'),
  ('Liudmila'),
  ('Marianna Primo'),
  ('Mark Bertran'),
  ('Martin Aguilar'),
  ('Mike Wildeman'),
  ('Mukesh Chander'),
  ('Nvartz Vinoth'),
  ('Randi Sunshine'),
  ('Reilley'),
  ('Ricardo Azevedo'),
  ('Rivera'),
  ('Scott Johnson'),
  ('Stallion'),
  ('Thamires Suriano'),
  ('Tiffany Kezia'),
  ('Usama')
on conflict (normalized_name) do update
set name = excluded.name,
    status = 'active',
    updated_at = now();

insert into core.artist (name)
values
  ('Alex Tsaplin'),
  ('An Hryvtsova'),
  ('Anastasia'),
  ('Anastasiia Semenova'),
  ('Anna Lifesee'),
  ('Creative Market'),
  ('Daniyal'),
  ('Dario Crow'),
  ('Eldhose'),
  ('Elena Min'),
  ('Eli Ayuso'),
  ('Elias Garcia'),
  ('Faviel'),
  ('Germain'),
  ('Gopal'),
  ('Gustavo Pereira'),
  ('Habeeba Reda'),
  ('Hamza'),
  ('Hira Sarwar'),
  ('Irene Iryna Suprun'),
  ('Iryna Buzivska'),
  ('Julieta Gutnisky'),
  ('Kate Tshkun'),
  ('Ksenia Markevych'),
  ('Manish'),
  ('Mateus'),
  ('Miguel Dizon'),
  ('Munira'),
  ('Muraleedharan'),
  ('Natalia Makarenko'),
  ('Nataliia'),
  ('Nimesh Niyomal'),
  ('Octavio'),
  ('Omar'),
  ('Paulo Valdecantos'),
  ('Pavel'),
  ('Ralph Cifra'),
  ('Romain'),
  ('Ry Caluag'),
  ('Sagarika Sreenivas'),
  ('Shiva Krishna'),
  ('Shreyash'),
  ('Shweta'),
  ('Viktoriia'),
  ('Vinoth'),
  ('Vishal')
on conflict (normalized_name) do update
set name = excluded.name,
    status = 'active',
    updated_at = now();

comment on table core.creative_designer is 'Approved creative designer lookup values for app dropdowns. Seeded from the designer/artist cleanup sheet; N/A source values are excluded.';
comment on table core.technical_designer is 'Approved technical designer lookup values for app dropdowns. Seeded from the designer/artist cleanup sheet; N/A source values are excluded.';
comment on table core.freelance_designer is 'Approved freelance designer lookup values for app dropdowns. Seeded from the designer/artist cleanup sheet; N/A source values are excluded.';
comment on table core.artist is 'Approved artist lookup values for artwork attribution and app dropdowns. Seeded from the designer/artist cleanup sheet; N/A source values are excluded.';
