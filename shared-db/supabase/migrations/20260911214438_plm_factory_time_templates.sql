-- Issue #2724: DesignFlow Production Tracking lead-time templates.
-- derived-from: none
--
-- plm."FactoryTime" becomes a named, described, tagged lead-time template, and
-- plm.product_type_factory_time assigns one template to each product type
-- (mgCategory + MG01 code + MG02 code). Rows are application data written by
-- designflow-tracking; this migration loads none.
--
-- Scope: plm only. designflow-tracking reads FactoryTime from plm
-- (config/table-schema-map.js). The dflow and dflow_prod copies are left
-- untouched.
--
-- The product type key has no division on purpose: production measurements in
-- #2724 show every active (MG01, MG02) pair belongs to exactly one mgCategory
-- and item division is unreliable. The app resolves a SKU against active
-- parent-linked merchGroup rows and treats anything other than one category as
-- "no product type".

BEGIN;

-- name becomes NOT NULL. The table held 0 rows on production when this was
-- written; refuse rather than invent names if that has changed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM plm."FactoryTime") THEN
    RAISE EXCEPTION 'plm."FactoryTime" already holds rows; template names cannot be invented by a migration (#2724)';
  END IF;
END $$;

ALTER TABLE plm."FactoryTime"
  ADD COLUMN name text,
  ADD COLUMN description text,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN updated_by text;

ALTER TABLE plm."FactoryTime"
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN product_subtype DROP NOT NULL,
  ALTER COLUMN resampling_days DROP DEFAULT;

ALTER TABLE plm."FactoryTime"
  ADD CONSTRAINT "FactoryTime_name_not_blank_check"
    CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "FactoryTime_tags_no_null_check"
    CHECK (array_position(tags, NULL) IS NULL),
  ADD CONSTRAINT "FactoryTime_days_nonnegative_check"
    CHECK (
      (sampling_days IS NULL OR sampling_days >= 0)
      AND (resampling_days IS NULL OR resampling_days >= 0)
      AND (mass_production_days IS NULL OR mass_production_days >= 0)
    );

CREATE UNIQUE INDEX factory_time_name_ci_key
  ON plm."FactoryTime" (lower(btrim(name)));

COMMENT ON COLUMN plm."FactoryTime".name IS
  'Template name shown in DesignFlow; unique ignoring case and surrounding spaces (#2724).';
COMMENT ON COLUMN plm."FactoryTime".description IS 'Optional template description (#2724).';
COMMENT ON COLUMN plm."FactoryTime".tags IS 'Free-text template tags; empty array when untagged (#2724).';
COMMENT ON COLUMN plm."FactoryTime".updated_by IS 'App user (email or id) who last edited the template (#2724).';
COMMENT ON COLUMN plm."FactoryTime".product_subtype IS
  'Informational only since #2724; nothing matches templates on it. Product types are assigned in plm.product_type_factory_time.';

CREATE TABLE plm.product_type_factory_time (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mg_category text NOT NULL,
  mg01_code text NOT NULL,
  mg02_code text NOT NULL,
  factory_time_id integer NOT NULL
    REFERENCES plm."FactoryTime"(id) ON DELETE RESTRICT,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  previous_factory_time_id integer,
  CONSTRAINT product_type_factory_time_product_type_key
    UNIQUE (mg_category, mg01_code, mg02_code),
  CONSTRAINT product_type_factory_time_key_trimmed_check
    CHECK (
      mg_category <> '' AND mg_category = btrim(mg_category)
      AND mg01_code <> '' AND mg01_code = btrim(mg01_code)
      AND mg02_code <> '' AND mg02_code = btrim(mg02_code)
    ),
  CONSTRAINT product_type_factory_time_assigned_by_not_blank_check
    CHECK (btrim(assigned_by) <> '')
);

CREATE INDEX product_type_factory_time_factory_time_id_idx
  ON plm.product_type_factory_time (factory_time_id);

COMMENT ON TABLE plm.product_type_factory_time IS
  'One lead-time template per DesignFlow product type (mgCategory, MG01, MG02), assigned by hand; many product types may share a template. Deleting an in-use template is refused (#2724).';
COMMENT ON COLUMN plm.product_type_factory_time.previous_factory_time_id IS
  'Template this assignment replaced at its latest reassignment; not a foreign key so retired templates can still be deleted.';

-- Same access model as plm."FactoryTime": the DesignFlow API connects as the
-- table owner. No browser or service-role access.
ALTER TABLE plm.product_type_factory_time ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE plm.product_type_factory_time FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
