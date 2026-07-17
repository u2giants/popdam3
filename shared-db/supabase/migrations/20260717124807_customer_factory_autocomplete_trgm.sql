-- Trigram indexes so customer + vendor (factory) pickers can do fast type-ahead
-- server-side filtering as the user types (ILIKE '%term%' / similarity).
-- Customer name + alias are already trigram-indexed; add the two gaps:
--   * core.customer.display_name (new short dropdown label)
--   * core.factory.name (vendor picker had no trigram index at all)

create index if not exists core_customer_display_name_trgm_idx
  on core.customer using gin (lower(display_name) extensions.gin_trgm_ops);

create index if not exists core_factory_name_trgm_idx
  on core.factory using gin (lower(name) extensions.gin_trgm_ops);
