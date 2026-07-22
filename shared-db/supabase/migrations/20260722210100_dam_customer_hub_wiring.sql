-- Wire all PopDAM customer lists onto the curated core.customer hub.
--
-- Background: DAM stores "customer" as free text in public.style_groups,
-- public.assets and public.style_tracker_rows, and builds its pickers/filters
-- from those strings. The canonical dam.style_group / dam.asset tables (which
-- carry a real company_id FK) are empty; the app runs on the public.* tables.
-- Reconciliation (docs/dam-customer-reconciliation.md): 92% of rows map to an
-- active hub customer by exact/alias match. This migration:
--   1. adds a durable customer_id FK to public.style_groups + public.assets,
--   2. adds the three real retailers missing from the hub (CVS/Costco/Meijer,
--      Albert-ruled "potential"),
--   3. seeds curated aliases (typos/variants + Four Seasons->4SGM, BCF->Burlington,
--      Goldenlink, Desperate Signs, Stock+HomeGoods user-error -> TJX),
--   4. sets display_name on active hub customers that only had ugly ERP names,
--   5. backfills customer_id via a single reusable resolver, deliberately leaving
--      Albert-ruled non-customers (Stallion, Stock, Multicustomer, Licensor
--      Requests, Nissan, NONE) and multi-customer comma cells UNLINKED,
--   6. exposes a curated customers-with-assets facet RPC for the Library filter.
--
-- Customer identity is never guessed: only exact/alias/explicit-prefix matches
-- link; everything else stays null and visibly free text for manual selection.
--
-- The assets backfill updates a large existing table; keep the longer allowance
-- local to this migration transaction rather than changing a database-wide
-- statement timeout.
set local statement_timeout = '10min';

-- 1. Durable FK columns -------------------------------------------------------
alter table public.style_groups
  add column if not exists customer_id uuid references core.customer(id) on delete set null;
alter table public.assets
  add column if not exists customer_id uuid references core.customer(id) on delete set null;

comment on column public.style_groups.customer_id is
  'Canonical customer (core.customer). Labels come from api.dam_customer_list; the legacy free-text customer column is retained for provenance only.';
comment on column public.assets.customer_id is
  'Canonical customer (core.customer). Labels come from api.dam_customer_list; the legacy free-text customer column is retained for provenance only.';

create index if not exists style_groups_customer_id_idx
  on public.style_groups (customer_id) where customer_id is not null;
create index if not exists assets_customer_id_idx
  on public.assets (customer_id) where customer_id is not null;

-- 2. Add the real retailers missing from the hub (Albert: "potential") --------
insert into core.customer (name, display_name, status, is_potential)
select v.name, v.name, 'potential'::app.entity_status, true
from (values ('CVS'), ('Costco'), ('Meijer')) as v(name)
where not exists (
  select 1 from core.customer c
  where lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(v.name), '\s+', ' ', 'g'))
);

-- 3. Curated aliases: free-text variant -> canonical hub customer -------------
-- Resolve each target by an unambiguous existing name/display_name so we never
-- hard-code a uuid. Insert only when that exact alias is not already present.
with seed(alias, target) as (
  values
    ('Kohl''s',              'KOHLS'),
    ('Books-a-Million',      'Books A Million'),
    ('Books-A-Million',      'Books A Million'),
    ('BAM',                  'Books A Million'),
    ('Sams Club',            'Sam''s Club'),
    ('Hobby Lobbby',         'HOBBY LOBBY LLC'),
    ('Barnes and Noble',     'Barnes & Noble'),
    ('Beall''s Outlets',     'BEALL''S OUTLET STORES INC'),
    ('5 Below',              'Five Below'),
    ('DD''s',                'DD''S DISCOUNT SUPPLIERS'),
    ('dd''s',                'DD''S DISCOUNT SUPPLIERS'),
    ('DD',                   'DD''S DISCOUNT SUPPLIERS'),
    ('Ollie''s',             'OLLIE''S BARGAIN OUTLET INC'),
    ('Christmas Tree Shops', 'CHRISTMAS TREE SHOPS INC'),
    ('Spirit of Halloween',  'Spirit Halloween'),
    ('Spirit Halloween Christmas', 'Spirit Halloween'),
    ('Spirit of Christmas',  'Spirit Halloween'),
    ('Gabriel Bros',         'Gabes'),
    ('Shoppers Worlds',      'SW GROUP-SHOPPERS WORLD'),
    ('IKONICK',              'IKONICK.COM'),
    ('Rooms 2 Go',           'Rooms to Go'),
    ('TJMaxx',               'TJX'),
    ('TJX Giftables',        'TJX'),
    ('BCF',                  'Burlington'),
    ('Ltd Commodities',      'LTD COMMODITIES LLC'),
    ('Bed Bath and Beyond',  'BED BATH & BEYOND'),
    ('Goldenlink',           'Golden Link Inc. DBA Only In Theatres'),
    ('Desperate Signs',      'Desperate Enterprises Billing'),
    ('Four Seasons',         'FOUR SEASONS GENERAL MERCH'),
    ('Stock, HomeGoods',     'TJX')
),
resolved as (
  select distinct on (
    c.id,
    lower(regexp_replace(trim(s.alias), '\s+', ' ', 'g'))
  ) s.alias, c.id as customer_id
  from seed s
  join core.customer c
    on lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(s.target), '\s+', ' ', 'g'))
  order by c.id, lower(regexp_replace(trim(s.alias), '\s+', ' ', 'g')), s.alias
)
insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
select r.customer_id, r.alias,
       'other', 'popdam3',
       'Seeded 2026-07-22 to link legacy DAM free-text customer values to the hub.'
from resolved r
where not exists (
  select 1 from core.customer_alias a
  where a.customer_id = r.customer_id
    and a.normalized_alias = lower(regexp_replace(trim(r.alias), '\s+', ' ', 'g'))
);

-- 4. Give ugly-but-active hub customers a clean picker label -------------------
update core.customer c set display_name = v.label
from (values
  ('HOBBY LOBBY LLC',                        'Hobby Lobby'),
  ('HOT TOPIC MERCHANDISCING INC',           'Hot Topic'),
  ('KOHLS',                                  'Kohl''s'),
  ('Golden Link Inc. DBA Only In Theatres',  'Goldenlink'),
  ('CHRISTMAS TREE SHOPS INC',               'Christmas Tree Shops'),
  ('Five Below',                             'Five Below'),
  ('Gabes',                                  'Gabes'),
  ('SW GROUP-SHOPPERS WORLD',                'Shoppers World'),
  ('Rooms to Go',                            'Rooms to Go'),
  ('Barnes & Noble',                         'Barnes & Noble')
) as v(name, label)
where c.name = v.name and (c.display_name is null or c.display_name = '');

-- 5. Reusable resolver + backfill --------------------------------------------
-- Maps a free-text customer string to a canonical customer id. Exact matches on
-- name/display_name/alias win; a longest explicit-prefix match (e.g.
-- "Burlington - BGP6ASSSS01") resolves style-code suffixes. Values containing a
-- comma are never prefix-matched, so multi-customer cells stay unlinked.
create or replace function public.dam_resolve_customer(p_text text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with n as (select lower(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g')) as t),
  nc as (
    select c.id,
      lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) as nname,
      lower(regexp_replace(trim(coalesce(c.display_name, '')), '\s+', ' ', 'g')) as dname
    from core.customer c
  ),
  na as (
    select a.customer_id as id, lower(regexp_replace(trim(a.alias), '\s+', ' ', 'g')) as aname
    from core.customer_alias a
  ),
  cand as (
    select nc.id, 100 as pri, length(nc.nname) as keylen from n, nc where nc.nname = n.t
    union all
    select nc.id, 100, length(nc.dname) from n, nc where nc.dname <> '' and nc.dname = n.t
    union all
    select na.id, 100, length(na.aname) from n, na where na.aname = n.t
    union all
    select nc.id, 50, length(nc.nname) from n, nc
      where position(',' in n.t) = 0 and length(nc.nname) >= 3
        and (n.t like nc.nname || ' %' or n.t like nc.nname || '-%')
    union all
    select nc.id, 50, length(nc.dname) from n, nc
      where position(',' in n.t) = 0 and nc.dname <> '' and length(nc.dname) >= 3
        and (n.t like nc.dname || ' %' or n.t like nc.dname || '-%')
    union all
    select na.id, 50, length(na.aname) from n, na
      where position(',' in n.t) = 0 and length(na.aname) >= 3
        and (n.t like na.aname || ' %' or n.t like na.aname || '-%')
  )
  select id from cand
  where (select t from n) <> ''
  order by pri desc, keylen desc
  limit 1
$function$;

comment on function public.dam_resolve_customer(text) is
  'Best-effort map of a legacy free-text DAM customer string to core.customer.id. Exact name/display/alias match, else longest explicit-prefix match; comma (multi-customer) values are never prefix-matched. Returns null when no confident match.';

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.style_groups
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_groups s
  set customer_id = m.customer_id
  from customer_map m
  where s.customer_id is null and s.customer = m.customer and m.customer_id is not null;

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.assets
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.assets a
  set customer_id = m.customer_id
  from customer_map m
  where a.customer_id is null and a.customer = m.customer and m.customer_id is not null;

-- Extend style_tracker_rows coverage using the new aliases. Suspend the audit
-- trigger so this backfill does not generate a customer-change event per row
-- (matches how the original 20260721143000 backfill ran before the trigger).
alter table public.style_tracker_rows disable trigger trg_style_tracker_row_audit;
with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer from public.style_tracker_rows
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_tracker_rows s
  set customer_id = m.customer_id
  from customer_map m
  where s.customer_id is null and s.customer = m.customer and m.customer_id is not null;
alter table public.style_tracker_rows enable trigger trg_style_tracker_row_audit;

-- 6. Curated Library filter facet — only hub customers that have DAM assets ----
create or replace function public.get_dam_customer_facets()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.label, 'count', f.cnt)
                            order by f.label), '[]'::jsonb)
  from (
    select d.id, coalesce(d.display_name, d.name) as label, count(*) as cnt
    from (
      select customer_id from public.style_groups where customer_id is not null
      union all
      select customer_id from public.assets where customer_id is not null
    ) u
    join api.dam_customer_list d on d.id = u.customer_id
    group by d.id, coalesce(d.display_name, d.name)
  ) f
$function$;

comment on function public.get_dam_customer_facets() is
  'Curated Library customer filter: active/potential hub customers (api.dam_customer_list) that have at least one DAM style_group or asset, with counts. Canonical labels; replaces the free-text get_path_facets customer list.';

grant execute on function public.dam_resolve_customer(text) to authenticated, service_role;
grant execute on function public.get_dam_customer_facets() to authenticated, service_role;

notify pgrst, 'reload schema';
