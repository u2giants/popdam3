-- Path-derived attributes: stage / customer / program inferred from the NAS folder layout.
-- Anchor folder: "____New Structure" under Decor/Character Licensed.
--   stage   = the folder directly under "____New Structure" (set for ALL files there)
--   customer/program = only reliable in the "In Development / Customer Adopted" branch (v1 scope)
-- (Backfill of existing rows was run separately after this DDL via batched UPDATEs; new
--  rows are populated by the triggers below.)

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS customer text,
  ADD COLUMN IF NOT EXISTS program text;

ALTER TABLE public.style_groups
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS customer text,
  ADD COLUMN IF NOT EXISTS program text;

CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  segs text[];
  idx  int;
  s    text;
  c1   text;
  cust text := NULL;
  prog text := NULL;
BEGIN
  IF p_path IS NULL OR p_path = '' THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  segs := string_to_array(p_path, '/');
  idx  := array_position(segs, '____New Structure');
  IF idx IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  s := NULLIF(segs[idx + 1], '');
  IF s IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  -- Customer / program are only reliably encoded in the "In Development / Customer Adopted" branch.
  IF s = 'In Development' AND segs[idx + 2] = 'Customer Adopted' THEN
    c1 := NULLIF(segs[idx + 3], '');
    IF c1 IS NULL THEN
      cust := NULL; prog := NULL;
    ELSIF c1 = '_FINISHED' THEN
      -- wrapper bucket: _FINISHED / <Customer>_finished / <Program> / <SKU>
      cust := NULLIF(regexp_replace(COALESCE(segs[idx + 4], ''), '_finished$', '', 'i'), '');
      prog := NULLIF(segs[idx + 5], '');
    ELSIF left(c1, 1) = '_' THEN
      -- status buckets (_NOT APPROVED, _REJECTED, _No Customer, _NOT SUBMITTED): no real customer
      cust := NULL; prog := NULL;
    ELSE
      cust := c1;
      prog := NULLIF(segs[idx + 4], '');
    END IF;

    -- Guard: the program slot must be a real program folder, not the SKU folder or a file.
    IF prog IS NOT NULL THEN
      IF prog ~ '\.[A-Za-z0-9]+$' THEN
        prog := NULL;  -- looks like a filename
      ELSIF prog !~ '[[:space:]]' AND prog ~ '^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$' AND length(prog) >= 8 THEN
        prog := NULL;  -- looks like a SKU code (no program folder present)
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_asset_path_attrs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.relative_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_sg_path_attrs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.folder_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_path_attrs ON public.assets;
CREATE TRIGGER trg_set_path_attrs
  BEFORE INSERT OR UPDATE OF relative_path ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_asset_path_attrs();

DROP TRIGGER IF EXISTS trg_set_path_attrs ON public.style_groups;
CREATE TRIGGER trg_set_path_attrs
  BEFORE INSERT OR UPDATE OF folder_path ON public.style_groups
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_sg_path_attrs();

CREATE INDEX IF NOT EXISTS idx_assets_stage    ON public.assets (stage);
CREATE INDEX IF NOT EXISTS idx_assets_customer ON public.assets (customer);
CREATE INDEX IF NOT EXISTS idx_assets_program  ON public.assets (program);
CREATE INDEX IF NOT EXISTS idx_assets_program_trgm  ON public.assets USING gin (program gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_customer_trgm ON public.assets USING gin (customer gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sg_stage    ON public.style_groups (stage);
CREATE INDEX IF NOT EXISTS idx_sg_customer ON public.style_groups (customer);
CREATE INDEX IF NOT EXISTS idx_sg_program  ON public.style_groups (program);

-- Facet options for the customer / program filter combos (group-level counts).
CREATE OR REPLACE FUNCTION public.get_path_facets(p_customer text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', customer, 'count', cnt) ORDER BY customer)
      FROM (
        SELECT customer, count(*) AS cnt
        FROM style_groups
        WHERE customer IS NOT NULL
        GROUP BY customer
      ) c
    ), '[]'::jsonb),
    'programs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', program, 'count', cnt) ORDER BY program)
      FROM (
        SELECT program, count(*) AS cnt
        FROM style_groups
        WHERE program IS NOT NULL
          AND (p_customer IS NULL OR customer = p_customer)
        GROUP BY program
      ) p
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_path_facets(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.infer_path_attrs(text) TO anon, authenticated;
