-- derived-from: none
--
-- Issue #3036 - add the product-type reader result columns to plm.item.
-- Structural prerequisite for the product-type reader (#3024,
-- plan_product_type_reader.md). Owner ruling 2026-09-16: these live on our own
-- product table plm.item, never on coldlion.item_header.
--
-- Structure only. All columns are nullable with no default and no backfill;
-- nothing writes them until the reader work lands. Existing grants and RLS on
-- plm.item are table-level and cover the new columns unchanged.
--
-- Additive per AGENTS.md section 4 rule 3.

alter table plm.item
  add column product_type text null,
  add column product_construction text null,
  add column product_material text null,
  add column product_treatment text null,
  add column product_type_status text null
    constraint item_product_type_status_check
    check (product_type_status in ('accepted', 'unreadable', 'placeholder')),
  add column product_type_rules_version text null,
  add column product_type_read_at timestamptz null;

comment on column plm.item.product_type is
  'Physical product a merchant would name (e.g. Storage Toy Chest), computed by the product-type reader.';
comment on column plm.item.product_construction is
  'Construction or shape stated for the product (e.g. Stretched, Collapsible), computed by the product-type reader.';
comment on column plm.item.product_material is
  'Material stated in the item description only, computed by the product-type reader.';
comment on column plm.item.product_treatment is
  'Embellishment stated for the product (e.g. Glitter, Foil, LED), computed by the product-type reader.';
comment on column plm.item.product_type_status is
  'Whether the product-type reader could read the item: accepted, unreadable, or placeholder.';
comment on column plm.item.product_type_rules_version is
  'Product-type reader rules version that produced the product_type values.';
comment on column plm.item.product_type_read_at is
  'When the product-type reader computed the product_type values.';
