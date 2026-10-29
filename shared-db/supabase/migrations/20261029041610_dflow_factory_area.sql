-- DesignFlow factory area, #4708 / claim #4749
-- derived-from: 20260722004500
-- Owner rulings (Albert Hazan): 2026-10-25 "a factory record needs a party type
-- (factory vs trading company) and a link from a trading company to the
-- factories it represents; blank represented-by means POP deals directly";
-- 2026-10-25 future fields "orders completed" and "problem on order";
-- 2026-10-25 product categories from the owner's 22-category list;
-- 2026-10-27 the owner's review workbook is the truth (reps, logins, kept rows).
-- Structure only. The rows (kept factories, categories, reps, logins) are a
-- curated Master Data load from the owner's private workbook, not this file.

begin;

alter table core.factory
  add column if not exists party_type text
    constraint factory_party_type_check check (party_type in ('factory', 'trading_company', 'both')),
  add column if not exists designflow_vendor_id integer,
  add column if not exists trade_name text,
  add column if not exists orders_completed integer
    constraint factory_orders_completed_check check (orders_completed >= 0),
  add column if not exists orders_with_problem integer
    constraint factory_orders_with_problem_check check (orders_with_problem >= 0);

create unique index if not exists factory_designflow_vendor_id_key
  on core.factory (designflow_vendor_id) where designflow_vendor_id is not null;

comment on column core.factory.party_type is
  'Owner ruling 2026-10-25: factory, trading_company or both. Null = not reviewed.';
comment on column core.factory.designflow_vendor_id is
  'DesignFlow vendor id this factory was reviewed from (owner workbook 2026-10-27).';
comment on column core.factory.trade_name is 'Trade name the owner uses for this party.';
comment on column core.factory.orders_completed is 'Owner ruling 2026-10-25: orders completed. Empty until a source fills it.';
comment on column core.factory.orders_with_problem is 'Owner ruling 2026-10-25: orders with a problem. Empty until a source fills it.';

create table if not exists core.product_category (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table core.product_category is 'Owner product-category list (2026-10-25), used to tag factories.';

create table if not exists core.factory_product_category (
  factory_id uuid not null references core.factory(id) on delete cascade,
  product_category_id uuid not null references core.product_category(id) on delete restrict,
  rank smallint not null check (rank between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (factory_id, product_category_id),
  unique (factory_id, rank)
);
comment on table core.factory_product_category is 'Up to five product categories per factory, in the owner''s order.';

create table if not exists core.factory_representation (
  trading_company_id uuid not null references core.factory(id) on delete cascade,
  factory_id uuid not null references core.factory(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trading_company_id, factory_id),
  check (trading_company_id <> factory_id)
);
create index if not exists factory_representation_factory_idx on core.factory_representation (factory_id);
comment on table core.factory_representation is
  'Trading company -> factory it represents. No row = POP deals with the factory directly.';

create table if not exists core.factory_rep (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references core.factory(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_id, name)
);
comment on table core.factory_rep is 'Named sales reps POP deals with at a factory.';

create table if not exists core.factory_vendor_login (
  designflow_login_id integer primary key,
  factory_id uuid not null references core.factory(id) on delete cascade,
  person text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists factory_vendor_login_factory_idx on core.factory_vendor_login (factory_id);
comment on table core.factory_vendor_login is
  'DesignFlow vendor logins the owner kept (2026-10-27), and the factory each belongs to. Emails: administrators only.';

alter table core.product_category enable row level security;
revoke all on core.product_category from anon;
grant select on core.product_category to authenticated;
grant all on core.product_category to service_role;
drop policy if exists admin_write on core.product_category;
create policy admin_write on core.product_category for all to authenticated
  using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));

drop policy if exists shared_read on core.product_category;
create policy shared_read on core.product_category for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

alter table core.factory_product_category enable row level security;
revoke all on core.factory_product_category from anon;
grant select on core.factory_product_category to authenticated;
grant all on core.factory_product_category to service_role;
drop policy if exists admin_write on core.factory_product_category;
create policy admin_write on core.factory_product_category for all to authenticated
  using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));

drop policy if exists shared_read on core.factory_product_category;
create policy shared_read on core.factory_product_category for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

alter table core.factory_representation enable row level security;
revoke all on core.factory_representation from anon;
grant select on core.factory_representation to authenticated;
grant all on core.factory_representation to service_role;
drop policy if exists admin_write on core.factory_representation;
create policy admin_write on core.factory_representation for all to authenticated
  using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));

drop policy if exists shared_read on core.factory_representation;
create policy shared_read on core.factory_representation for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

alter table core.factory_rep enable row level security;
revoke all on core.factory_rep from anon;
grant select on core.factory_rep to authenticated;
grant all on core.factory_rep to service_role;
drop policy if exists admin_write on core.factory_rep;
create policy admin_write on core.factory_rep for all to authenticated
  using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));

drop policy if exists shared_read on core.factory_rep;
create policy shared_read on core.factory_rep for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

alter table core.factory_vendor_login enable row level security;
revoke all on core.factory_vendor_login from anon;
grant select on core.factory_vendor_login to authenticated;
grant all on core.factory_vendor_login to service_role;
drop policy if exists admin_write on core.factory_vendor_login;
create policy admin_write on core.factory_vendor_login for all to authenticated
  using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));


drop trigger if exists set_updated_at on core.product_category;
create trigger set_updated_at before update on core.product_category
  for each row execute function app.set_updated_at();
drop trigger if exists set_updated_at on core.factory_rep;
create trigger set_updated_at before update on core.factory_rep
  for each row execute function app.set_updated_at();
drop trigger if exists set_updated_at on core.factory_vendor_login;
create trigger set_updated_at before update on core.factory_vendor_login
  for each row execute function app.set_updated_at();

-- Merging two factories (DB Data Admin) must carry the new link rows, or the
-- loser's delete would cascade them away. Body is 20260722004500's (matches live)
-- plus the block marked #4708 (verified against production 2026-10-29).
create or replace function core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean default true)
 returns void
 language plpgsql
 security definer
 set search_path to 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
as $function$
declare
  v_loser_name text;
  v_loser_display text;
  v_loser core.factory%rowtype;
begin
  if p_loser = p_survivor then
    raise exception 'merge_factory: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.factory where id = p_survivor) then
    raise exception 'merge_factory: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.factory where id = p_loser;
  if not found then
    raise exception 'merge_factory: loser % does not exist.', p_loser;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 1));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 1));

  perform core.reconcile_merge_extension_row('crm.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.factory_ext', 'factory_id', p_loser, p_survivor);

  delete from core.vendor_contact lc
  where lc.factory_id = p_loser
    and exists (
      select 1 from core.vendor_contact sc
      where sc.factory_id = p_survivor
        and sc.contact_id is not distinct from lc.contact_id
        and sc.role is not distinct from lc.role
    );
  update core.vendor_contact set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_alias la
  where la.factory_id = p_loser
    and exists (
      select 1 from core.factory_alias sa
      where sa.factory_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.factory_alias set factory_id = p_survivor where factory_id = p_loser;

  update core.factory_source_ref set factory_id = p_survivor where factory_id = p_loser;

  update crm.opportunity set factory_id = p_survivor where factory_id = p_loser;
  update pim.product set factory_id = p_survivor where factory_id = p_loser;
  update pim.product_sample set factory_id = p_survivor where factory_id = p_loser;
  update plm.erp_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.production_order set factory_id = p_survivor where factory_id = p_loser;
  update plm.rfq_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.style_tracker_item_bridge set factory_id = p_survivor where factory_id = p_loser;

  -- #4708: owner-reviewed fields fill survivor gaps; link rows move and dedupe.
  select * into v_loser from core.factory where id = p_loser;
  update core.factory set designflow_vendor_id = null where id = p_loser;
  update core.factory s set
    designflow_vendor_id = coalesce(s.designflow_vendor_id, v_loser.designflow_vendor_id),
    party_type = coalesce(s.party_type, v_loser.party_type),
    trade_name = coalesce(s.trade_name, v_loser.trade_name),
    orders_completed = coalesce(s.orders_completed, v_loser.orders_completed),
    orders_with_problem = coalesce(s.orders_with_problem, v_loser.orders_with_problem)
  where s.id = p_survivor;

  insert into core.factory_rep (factory_id, name)
  select p_survivor, name from core.factory_rep where factory_id = p_loser
  on conflict (factory_id, name) do nothing;
  delete from core.factory_rep where factory_id = p_loser;

  update core.factory_vendor_login set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_representation
  where (trading_company_id = p_loser and factory_id = p_survivor)
     or (trading_company_id = p_survivor and factory_id = p_loser);
  insert into core.factory_representation (trading_company_id, factory_id)
  select p_survivor, factory_id from core.factory_representation where trading_company_id = p_loser
  on conflict do nothing;
  insert into core.factory_representation (trading_company_id, factory_id)
  select trading_company_id, p_survivor from core.factory_representation where factory_id = p_loser
  on conflict do nothing;
  delete from core.factory_representation where trading_company_id = p_loser or factory_id = p_loser;

  -- Survivor's categories keep their ranks; the loser's extra ones follow, up to five.
  insert into core.factory_product_category (factory_id, product_category_id, rank)
  select p_survivor, l.product_category_id,
         (select coalesce(max(rank), 0) from core.factory_product_category where factory_id = p_survivor)
           + row_number() over (order by l.rank)
  from core.factory_product_category l
  where l.factory_id = p_loser
    and not exists (select 1 from core.factory_product_category s
                    where s.factory_id = p_survivor and s.product_category_id = l.product_category_id)
  order by l.rank
  limit greatest(0, 5 - (select count(*) from core.factory_product_category where factory_id = p_survivor));
  delete from core.factory_product_category where factory_id = p_loser;

  if p_alias_loser_name then
    insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged factory ' || p_loser
    on conflict (factory_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged factory ' || p_loser
      on conflict (factory_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.factory where id = p_loser;
end;
$function$;

commit;
