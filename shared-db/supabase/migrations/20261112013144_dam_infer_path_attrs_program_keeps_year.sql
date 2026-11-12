-- derived-from: 20261111215610
-- u2giants/popdam3#963 Phase 3.4 search gate follow-up (claim popcre/shared-db#6076).
-- 20261111215610 made program the folder after a year folder. Before, program
-- was the year itself, so "Dollar General 2027" matched every file under the
-- year folder; ~15.9k files whose program folder omits the year stopped
-- matching. Append the year when the program name lacks it (plan O5 allows a
-- derived program). Everything else is unchanged from 20261111215610.
CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  segs text[];
  idx  int;
  s    text;
  c1   text;
  cust text := NULL;
  prog text := NULL;
  pidx int  := NULL;
  yr   text := NULL;
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
  -- Folder name is an input; stored stage is the canonical business term.
  IF s = 'In Dev' THEN
    s := 'In Development';
  ELSIF s = 'Concept Approved' THEN
    s := 'Concept Approved Designs';
  END IF;

  IF s = 'In Development' AND segs[idx + 2] IN ('Customer Adopted', 'Cust Adopted') THEN
    c1 := NULLIF(segs[idx + 3], '');
    IF c1 IS NULL THEN
      cust := NULL; prog := NULL;
    ELSIF c1 = '_FINISHED' THEN
      -- wrapper bucket: _FINISHED / <Customer>_finished / <Program> / <SKU>
      cust := NULLIF(regexp_replace(COALESCE(segs[idx + 4], ''), '_finished$', '', 'i'), '');
      pidx := idx + 5;
    ELSIF left(c1, 1) = '_' THEN
      -- status buckets (_NOT APPROVED, _REJECTED, _No Customer, _NOT SUBMITTED): no real customer
      cust := NULL; prog := NULL;
    ELSE
      cust := c1;
      pidx := idx + 4;
    END IF;

    IF pidx IS NOT NULL THEN
      prog := NULLIF(segs[pidx], '');
      -- Year folder (<Customer>/2026/<Program>/...): program is the next folder.
      IF prog ~ '^20[0-9]{2}$' THEN
        yr   := prog;
        prog := NULLIF(segs[pidx + 1], '');
      END IF;
    END IF;

    -- Guard: the program slot must be a real program folder, not the SKU folder or a file.
    IF prog IS NOT NULL THEN
      IF prog ~ '\.[A-Za-z0-9]+$' THEN
        prog := NULL;  -- looks like a filename
      ELSIF prog !~ '[[:space:]]' AND prog ~ '^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$' AND length(prog) >= 8 THEN
        prog := NULL;  -- looks like a SKU code (no program folder present)
      END IF;
    END IF;
    -- Keep the year searchable: a program under a year folder whose own name
    -- lacks that year gets it appended ("Dollar General Harvest Coir 2027").
    IF yr IS NOT NULL AND prog IS NOT NULL AND position(yr in prog) = 0 THEN
      prog := prog || ' ' || yr;
    END IF;
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$function$;
