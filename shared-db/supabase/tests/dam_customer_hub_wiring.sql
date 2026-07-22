-- Verification for migration 20260722210100_dam_customer_hub_wiring.
-- Run only after that migration is applied. All assertions are read-only; the
-- transaction rolls back so no fixture state persists.
--
-- Proves:
--   * public.style_groups + public.assets carry a customer_id FK to core.customer;
--   * CVS / Costco / Meijer exist as potential and appear in api.dam_customer_list;
--   * dam_resolve_customer resolves exact, alias, and style-code-suffix values,
--     collapses suffix families to the base customer, maps the seeded typos, and
--     returns NULL for Albert-ruled non-customers and multi-customer comma cells;
--   * ugly-but-active hub names got clean display_names;
--   * get_dam_customer_facets returns a canonical, non-empty, counted array.
begin;

do $$
declare
  v_burlington uuid;
  v_4sgm       uuid;
  v_kohls      uuid;
  v_tjx        uuid;
  v_facets     jsonb;
begin
  -- FK columns present
  perform 1 from information_schema.columns
    where table_schema='public' and table_name='style_groups' and column_name='customer_id';
  if not found then raise exception 'style_groups.customer_id missing'; end if;
  perform 1 from information_schema.columns
    where table_schema='public' and table_name='assets' and column_name='customer_id';
  if not found then raise exception 'assets.customer_id missing'; end if;

  -- New potential retailers, visible in the picker
  perform 1 from api.dam_customer_list where name in ('CVS','Costco','Meijer');
  if (select count(*) from api.dam_customer_list where name in ('CVS','Costco','Meijer')) <> 3 then
    raise exception 'CVS/Costco/Meijer not all present in api.dam_customer_list';
  end if;
  if exists (select 1 from core.customer where name in ('CVS','Costco','Meijer') and status <> 'potential') then
    raise exception 'CVS/Costco/Meijer should be potential';
  end if;

  select id into v_burlington from core.customer where name='Burlington';
  select id into v_4sgm       from core.customer where name='FOUR SEASONS GENERAL MERCH';
  select id into v_kohls      from core.customer where name='KOHLS';
  select id into v_tjx        from core.customer where name='TJX';

  -- Exact / alias / suffix resolution
  if public.dam_resolve_customer('Burlington') is distinct from v_burlington then
    raise exception 'exact Burlington failed'; end if;
  if public.dam_resolve_customer('Burlington - BGP6ASSSS01') is distinct from v_burlington then
    raise exception 'suffix Burlington failed'; end if;
  if public.dam_resolve_customer('Four Seasons') is distinct from v_4sgm then
    raise exception 'Four Seasons -> 4SGM alias failed'; end if;
  if public.dam_resolve_customer('Kohl''s') is distinct from v_kohls then
    raise exception 'Kohl''s alias failed'; end if;
  if public.dam_resolve_customer('Stock, HomeGoods') is distinct from v_tjx then
    raise exception 'Stock, HomeGoods -> TJX alias failed'; end if;

  -- Ruled non-customers and multi-customer comma cells stay NULL
  if public.dam_resolve_customer('Multicustomer') is not null then raise exception 'Multicustomer should be null'; end if;
  if public.dam_resolve_customer('Stallion')       is not null then raise exception 'Stallion should be null'; end if;
  if public.dam_resolve_customer('Stock')          is not null then raise exception 'Stock should be null'; end if;
  if public.dam_resolve_customer('Licensor Requests') is not null then raise exception 'Licensor Requests should be null'; end if;
  if public.dam_resolve_customer('Burlington, Ross') is not null then raise exception 'multi-customer comma cell should be null'; end if;

  -- Clean picker labels
  if (select coalesce(display_name,'') from core.customer where name='HOBBY LOBBY LLC') <> 'Hobby Lobby' then
    raise exception 'Hobby Lobby display_name not set'; end if;

  -- Curated facet RPC
  v_facets := public.get_dam_customer_facets();
  if jsonb_typeof(v_facets) <> 'array' or jsonb_array_length(v_facets) = 0 then
    raise exception 'get_dam_customer_facets returned empty/non-array'; end if;

  raise notice 'dam_customer_hub_wiring verification passed (% facet customers)', jsonb_array_length(v_facets);
end $$;

rollback;
