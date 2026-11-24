-- popcre/shared-db#6995 (C2 window): signed-in reads of core.character timed out
-- (8 s) because policy shared_read evaluated app.has_any_role(...) once per row.
-- Wrap it in a scalar subselect so Postgres runs it once per query (InitPlan).
-- Identical role list, command (SELECT) and role (authenticated); nothing else changes.
-- Scope: every core.* shared_read policy whose qual was exactly the un-wrapped
-- call (35 tables, listed from production pg_policies 2026-11-24 4:20 PM EST).
-- Tables already wrapped (artist, creative_designer, ...) and packaging_type are untouched.
-- Each table is guarded so a database without that table or policy (from-empty CI) is skipped.

do $initplan$
begin
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'character' and policyname = 'shared_read') then
    alter policy shared_read on core."character" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'character_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."character_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'contact' and policyname = 'shared_read') then
    alter policy shared_read on core."contact" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'contact_company' and policyname = 'shared_read') then
    alter policy shared_read on core."contact_company" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'customer' and policyname = 'shared_read') then
    alter policy shared_read on core."customer" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'customer_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."customer_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'factory' and policyname = 'shared_read') then
    alter policy shared_read on core."factory" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'factory_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."factory_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'factory_product_category' and policyname = 'shared_read') then
    alter policy shared_read on core."factory_product_category" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'factory_rep' and policyname = 'shared_read') then
    alter policy shared_read on core."factory_rep" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'factory_representation' and policyname = 'shared_read') then
    alter policy shared_read on core."factory_representation" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'franchise' and policyname = 'shared_read') then
    alter policy shared_read on core."franchise" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'franchise_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."franchise_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'licensor' and policyname = 'shared_read') then
    alter policy shared_read on core."licensor" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'licensor_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."licensor_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'merch_group' and policyname = 'shared_read') then
    alter policy shared_read on core."merch_group" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'product_category' and policyname = 'shared_read') then
    alter policy shared_read on core."product_category" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'product_material' and policyname = 'shared_read') then
    alter policy shared_read on core."product_material" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'product_subtype' and policyname = 'shared_read') then
    alter policy shared_read on core."product_subtype" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'product_type' and policyname = 'shared_read') then
    alter policy shared_read on core."product_type" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property' and policyname = 'shared_read') then
    alter policy shared_read on core."property" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_alias' and policyname = 'shared_read') then
    alter policy shared_read on core."property_alias" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_character_associations' and policyname = 'shared_read') then
    alter policy shared_read on core."property_character_associations" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_character_source_edge' and policyname = 'shared_read') then
    alter policy shared_read on core."property_character_source_edge" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_franchise' and policyname = 'shared_read') then
    alter policy shared_read on core."property_franchise" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_franchise_source_edge' and policyname = 'shared_read') then
    alter policy shared_read on core."property_franchise_source_edge" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_site_path' and policyname = 'shared_read') then
    alter policy shared_read on core."property_site_path" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_style_guide' and policyname = 'shared_read') then
    alter policy shared_read on core."property_style_guide" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'property_style_guide_source_edge' and policyname = 'shared_read') then
    alter policy shared_read on core."property_style_guide_source_edge" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'sku_ref' and policyname = 'shared_read') then
    alter policy shared_read on core."sku_ref" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'style_guide' and policyname = 'shared_read') then
    alter policy shared_read on core."style_guide" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'style_guide_character' and policyname = 'shared_read') then
    alter policy shared_read on core."style_guide_character" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'style_guide_character_source_edge' and policyname = 'shared_read') then
    alter policy shared_read on core."style_guide_character_source_edge" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'taxonomy_owner_ruling' and policyname = 'shared_read') then
    alter policy shared_read on core."taxonomy_owner_ruling" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'core' and tablename = 'vendor_contact' and policyname = 'shared_read') then
    alter policy shared_read on core."vendor_contact" using ((select app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role])));
  end if;
end $initplan$;
