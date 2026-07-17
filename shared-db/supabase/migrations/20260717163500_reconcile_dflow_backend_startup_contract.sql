-- Canonicalize the legacy designflow-backend startup contract before the app
-- stops replaying sequelize.sync() and fire-and-forget DDL on every boot.
--
-- The full dflow schema was already captured by
-- 20260710135950_reconcile_dflow_baseline.sql. This migration therefore fails
-- loudly if that canonical structure has drifted, completes the two idempotent
-- data operations that still lived in app startup, and performs no destructive
-- cleanup.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
declare
  missing_tables text;
  mismatch record;
begin
  select string_agg(expected.table_name, ', ' order by expected.table_name)
    into missing_tables
  from unnest(array[
    'AdditionalUserEmail', 'AuditLog', 'FOBCountry', 'Factory',
    'GridAccessLevel', 'GridChildrenLayout', 'GridChildrenLayoutOrder',
    'GridLayout', 'GridViewState', 'RFQContainer', 'RFQGroup', 'RFQItem',
    'RFQItemDivision', 'RFQItemStatus', 'RFQStep', 'RFQVendor', 'RFQWhse',
    'RolePermissions', 'Roles', 'SeasonCode', 'StandardizedDetail',
    'StandardizedGroup', 'StandardizedProductElement',
    'StandardizedProductElementValue', 'StandardizedProductType',
    'StandardizedSize', 'StandardizedVendor', 'StandardizedVersion',
    'UDFComponent', 'UDFElement', 'UDFElementType', 'UDFGroup', 'UDFTable',
    'UIElements', 'age_group', 'ai_cache_events', 'app_settings', 'art_types',
    'artist_types', 'artists', 'auth_token', 'comments', 'companyCode',
    'customers', 'deliveryLocation', 'divisionCode', 'email_logs',
    'grid_cell_notes', 'itemAttachment', 'itemDepth', 'itemDetail',
    'itemHeader', 'itemSize', 'item_character_associations', 'licenseList',
    'merchGroup', 'merchGroupHeaders', 'properties_and_characters',
    'property_character_associations', 'quote_auth_token',
    'user_notification', 'users', 'vendor', 'vendorGroup'
  ]) as expected(table_name)
  left join information_schema.tables actual
    on actual.table_schema = 'dflow'
   and actual.table_name = expected.table_name
  where actual.table_name is null;

  if missing_tables is not null then
    raise exception 'dflow backend model tables are missing: %', missing_tables;
  end if;

  for mismatch in
    with expected(table_name, column_name, data_type, max_length) as (
      values
        ('RFQItem', 'rfqItem_duty_rate_equation', 'character varying', 500),
        ('customers', 'customers_logo', 'character varying', 500),
        ('comments', 'comment', 'character varying', 500),
        ('users', 'profile_photo', 'text', null::integer),
        ('users', 'graph_photo', 'text', null::integer),
        ('users', 'graph_photo_synced_at', 'timestamp with time zone', null::integer),
        ('vendor', 'vendor_profile_photo', 'text', null::integer),
        ('RFQItem', 'rfqItem_price_sales_snapshots', 'text', null::integer),
        -- Preserve the deployed canonical type. The old startup ADD used
        -- TIMESTAMPTZ but was always a no-op once this column existed.
        ('RFQItem', 'rfqItem_factories_step_at', 'timestamp without time zone', null::integer),
        ('RFQItem', 'rfqItem_source_item_id', 'integer', null::integer),
        ('RFQItem', 'rfqItem_source_item_num', 'character varying', 255),
        ('RFQItem', 'rfqItem_gen_fob_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_fob_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_mddp_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_mddp_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_poe_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_poe_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_whse_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_gen_whse_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_fob_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_fob_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_mddp_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_mddp_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_poe_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_poe_buyer_margin', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_whse_buyer_target', 'double precision', null::integer),
        ('RFQItem', 'rfqItem_lic_whse_buyer_margin', 'double precision', null::integer),
        ('RFQVendor', 'requote_requested', 'boolean', null::integer),
        ('RFQVendor', 'RFQVendor_archived', 'boolean', null::integer),
        ('RFQVendor', 'RFQVendor_archive_optout', 'boolean', null::integer),
        ('Factory', 'factory_country', 'character varying', 255),
        ('GridViewState', 'column_group_state', 'jsonb', null::integer)
    )
    select expected.*, actual.data_type as actual_type,
           actual.character_maximum_length as actual_max_length
    from expected
    left join information_schema.columns actual
      on actual.table_schema = 'dflow'
     and actual.table_name = expected.table_name
     and actual.column_name = expected.column_name
    where actual.column_name is null
       or actual.data_type <> expected.data_type
       or actual.character_maximum_length is distinct from expected.max_length
  loop
    raise exception 'dflow %.% definition mismatch: expected %(%), found %(%)',
      mismatch.table_name, mismatch.column_name, mismatch.data_type,
      mismatch.max_length, mismatch.actual_type, mismatch.actual_max_length;
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'dflow'
      and table_name = 'RFQItem'
      and column_name = 'rfqitem_price_sales_snapshots'
  ) then
    raise exception 'destructive cleanup deferred: dflow.RFQItem still has lowercase orphan rfqitem_price_sales_snapshots';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'ai_cache_events'
      and indexname = 'ai_cache_events_created_at_idx'
      and indexdef = 'CREATE INDEX ai_cache_events_created_at_idx ON dflow.ai_cache_events USING btree (created_at DESC)'
  ) then
    raise exception 'dflow.ai_cache_events_created_at_idx is missing or has drifted';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'ai_cache_events'
      and indexname = 'ai_cache_events_feature_created_at_idx'
      and indexdef = 'CREATE INDEX ai_cache_events_feature_created_at_idx ON dflow.ai_cache_events USING btree (feature, created_at DESC)'
  ) then
    raise exception 'dflow.ai_cache_events_feature_created_at_idx is missing or has drifted';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'grid_cell_notes'
      and indexname = 'grid_cell_notes_grid_row_col_uq'
      and indexdef = 'CREATE UNIQUE INDEX grid_cell_notes_grid_row_col_uq ON dflow.grid_cell_notes USING btree (grid_type, row_id, col_id)'
  ) then
    raise exception 'dflow.grid_cell_notes_grid_row_col_uq is missing or has drifted';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'grid_cell_notes'
      and indexname = 'grid_cell_notes_grid_type_idx'
      and indexdef = 'CREATE INDEX grid_cell_notes_grid_type_idx ON dflow.grid_cell_notes USING btree (grid_type)'
  ) then
    raise exception 'dflow.grid_cell_notes_grid_type_idx is missing or has drifted';
  end if;
end
$$;

-- Restart-safe one-time backfill retained from the old startup path. It only
-- fills blank values where a linked vendor supplies a nonblank country.
with ranked_country as (
  select factory_id_fk,
         vendor_country as country,
         row_number() over (
           partition by factory_id_fk
           order by count(*) desc, vendor_country
         ) as rank
  from dflow.vendor
  where factory_id_fk is not null
    and vendor_country is not null
    and vendor_country <> ''
  group by factory_id_fk, vendor_country
)
update dflow."Factory" as factory
set factory_country = ranked_country.country
from ranked_country
where ranked_country.rank = 1
  and ranked_country.factory_id_fk = factory.id
  and (factory.factory_country is null or factory.factory_country = '');

-- Stable seed. UIElements does not have a unique constraint on Name, so the
-- guarded insert deliberately matches the legacy business key.
insert into dflow."UIElements" ("Name", "Type", "ParentId")
select 'rfq_buyer_margin', 'Tab', null
where not exists (
  select 1 from dflow."UIElements" where "Name" = 'rfq_buyer_margin'
);

-- Preserve the explicit Adam Dweck access decision from the legacy startup
-- path. If that user is absent in an environment, this is a safe no-op.
insert into dflow."RolePermissions" ("RoleId", "UserId", "ElementId", "Access")
select role."Id", app_user.id, element."Id", true
from dflow."users" as app_user
join dflow."Roles" as role on role."Name" = app_user.level
join dflow."UIElements" as element on element."Name" = 'rfq_buyer_margin'
where app_user.email = 'adweck@popcre.com'
on conflict ("RoleId", "UserId", "ElementId")
do update set "Access" = excluded."Access";

do $$
begin
  if (select count(*) from dflow."UIElements" where "Name" = 'rfq_buyer_margin') <> 1 then
    raise exception 'dflow.UIElements must contain exactly one rfq_buyer_margin row';
  end if;

  if exists (select 1 from dflow.users where email = 'adweck@popcre.com')
     and not exists (
       select 1
       from dflow."RolePermissions" permission
       join dflow.users app_user on app_user.id = permission."UserId"
       join dflow."UIElements" element on element."Id" = permission."ElementId"
       where app_user.email = 'adweck@popcre.com'
         and element."Name" = 'rfq_buyer_margin'
         and permission."Access" is true
     ) then
    raise exception 'Adam Dweck is missing the rfq_buyer_margin grant';
  end if;
end
$$;
