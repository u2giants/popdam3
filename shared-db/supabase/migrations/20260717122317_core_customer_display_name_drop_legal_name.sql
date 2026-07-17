-- core.customer: add display_name (short name for dropdowns) and drop the unused
-- legal_name column.
--
-- Why display_name: legal/ERP names are too long for pickers (e.g.
-- "AMARILLO FURNITURE EXCHANGE & MATTRESSES"). display_name is a short label,
-- populated for active + potential customers only; the serving layer shows
-- coalesce(display_name, name).
--
-- Why drop legal_name: it is null in all 929 rows and no view or function reads it
-- (verified). It only mattered as the first arg of normalized_name's generation
-- expression, coalesce(legal_name, name) -- a no-op while legal_name is null. We
-- rebuild normalized_name to derive from name alone (identical values, verified:
-- 0 rows change) so the column can be dropped cleanly.
--
-- normalized_name is a generated column feeding two indexes and the customer
-- matching in plm.import_coldlion_customers/import_master_data, so it is dropped
-- and recreated with its indexes rather than altered in place.

alter table core.customer add column display_name text;

drop index core.core_company_normalized_name_idx;
drop index core.core_customer_normalized_name_trgm_idx;
alter table core.customer drop column normalized_name;
alter table core.customer drop column legal_name;
alter table core.customer add column normalized_name text
  generated always as (lower(regexp_replace(name, '\s+', ' ', 'g'))) stored;
create index core_company_normalized_name_idx on core.customer using btree (normalized_name);
create index core_customer_normalized_name_trgm_idx on core.customer using gin (normalized_name extensions.gin_trgm_ops);

comment on column core.customer.display_name is
  'Short, human-friendly name for dropdowns/pickers. Nullable; populated for active + potential customers only. Serving layer should show coalesce(display_name, name).';
