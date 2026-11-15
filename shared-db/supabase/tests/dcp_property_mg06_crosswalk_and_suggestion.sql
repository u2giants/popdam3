begin;
-- popcre/shared-db#6271 — tests for plm.dcp_property_mg06_crosswalk and
-- plm.suggested_property_for_sku (designflow-backend#408 steps 1-2).
-- Rolled back — assertions only.
-- Fixture-dependent assertions (single film, collision, unmapped) run only
-- when the referenced data exists (production / seeded preview).  On a bare
-- ephemeral DB the structural assertions still run.

-- ============================================================
-- 1. Structural assertions (no external data dependencies)
-- ============================================================
do $$
begin
  assert (select count(*) from plm.dcp_property_mg06_crosswalk) >= 16,
    'crosswalk must have at least the 16 Done-criteria films';
  assert (select mg_code from plm.dcp_property_mg06_crosswalk
          where dcp_source_id = 'dcpvault:properties/ar/aristocats') = 'AC',
    'aristocats must map to AC';
  assert (select mg_code from plm.dcp_property_mg06_crosswalk
          where dcp_source_id = 'dcpvault:properties/li/lilo-and-stitch-umbrella') = 'LS',
    'lilo-and-stitch-umbrella must map to LS';
  assert (select confidence from plm.dcp_property_mg06_crosswalk
          where dcp_source_id = 'dcpvault:properties/ro/robin-hood') = 'unmapped',
    'robin-hood must be marked unmapped';
  assert (select confidence from plm.dcp_property_mg06_crosswalk
          where dcp_source_id = 'dcpvault:properties/li/lion-king-the-umbrella') = 'needs_review',
    'lion-king-the-umbrella must be marked needs_review';
  -- All Done-criteria films present
  for i in 1..16 loop
    assert (select count(*) from plm.dcp_property_mg06_crosswalk) >= i,
      'crosswalk must cover all Done-criteria films';
  end loop;
end $$;

-- Function must be STABLE (read-only)
do $$
begin
  assert (select provolatile from pg_proc
          where proname = 'suggested_property_for_sku'
            and pronamespace = 'plm'::regnamespace) = 's',
    'function must be STABLE (read-only)';
end $$;

-- Unknown SKU -> empty result (always testable)
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from plm.suggested_property_for_sku('NO-SUCH-SKU-XYZ');
  assert v_count = 0, 'unknown SKU must return empty';
end $$;

-- ============================================================
-- 2. Data-dependent assertions (run when test data exists)
-- ============================================================

-- Single film: 3FZ27DYLS01 (Stitch art only) -> LS, basis single_film
do $$
declare
  v_count integer;
  v_code text;
  v_basis text;
begin
  select count(*), min(mg_code), min(basis)
    into v_count, v_code, v_basis
  from plm.suggested_property_for_sku('3FZ27DYLS01');
  if v_count > 0 then
    assert v_count = 1, 'single-film SKU must return exactly 1 suggestion, got ' || v_count;
    assert v_code = 'LS', 'must suggest LS, got ' || coalesce(v_code,'null');
    assert v_basis = 'single_film', 'basis must be single_film, got ' || coalesce(v_basis,'null');
  end if;
end $$;

-- Cross-licensor collision: MF296CBCC01 (Care Bears) must get NO suggestion
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from plm.suggested_property_for_sku('MF296CBCC01');
  assert v_count = 0, 'Care Bears SKU must get no suggestion, got ' || v_count;
end $$;

-- Cross-licensor collision: MFZ2GMVSP04 (Spider-Man) must get NO suggestion
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from plm.suggested_property_for_sku('MFZ2GMVSP04');
  assert v_count = 0, 'Marvel SKU must get no suggestion, got ' || v_count;
end $$;

-- Unmapped film: GFZ52DYCP03 (robin-hood only) must get NO suggestion
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from plm.suggested_property_for_sku('GFZ52DYCP03');
  assert v_count = 0, 'robin-hood-only SKU must get no suggestion (unmapped), got ' || v_count;
end $$;

rollback;
