-- =====================================================================================
-- Issue #1163 contract tests — core.mg_category / core.mg_category_merch_group.
--
-- HOW TO RUN
--   Against PREVIEW ONLY, as a role that can read core.* and write these two tables
--   (the Supabase CLI's linked connection, or a psql / node-pg session):
--       \i supabase/tests/mg_category_taxonomy_contracts.sql
--
--   Run each `do $$ ... $$;` block as its own statement. Submitting the whole file as a
--   single multi-statement batch through the transaction pooler (port 6543) wraps the
--   blocks in one implicit transaction and can stall.
--
-- WHAT HOLDS UNCONDITIONALLY, AND WHAT IS CONDITIONAL
--   This file runs BOTH against preview/production (populated) and against the
--   from-empty ephemeral database in .github/workflows/database-contract-tests.yml,
--   which carries the SCHEMA of core."merchGroup" but not one row of it.
--     * STRUCTURE (sections A and B), the GRANTS (section A), and EVERY negative case
--       (section D) must pass on EVERY database, always. Section D no longer waits for
--       production rows to exist: it creates its OWN throwaway merchandise-group row and
--       category link inside a subtransaction that is ROLLED BACK, so the constraints are
--       genuinely FIRED on an empty database too. A constraint that nobody has watched
--       reject anything is not a proven constraint; asserting only that it appears in
--       pg_constraint proves the DDL ran, not that the rule holds.
--     * Only the MAPPINGS (section C) and the read contract (section E) need real
--       source rows. Where there are none, each is SKIPPED WITH AN EXPLICIT NOTICE naming
--       what was skipped and why. A skip is never silent and never counted as a pass.
--   NOTHING here is weakened to go green: on a populated database every one of these
--   assertions runs and must pass exactly as it did before.
--
-- WHY SECTION C IS A GRID AND NOT A LIST (this is the defect it was rewritten to catch)
--   The earlier version LEFT JOINed the authoritative product types to core."merchGroup"
--   and only complained when a product type resolved NOWHERE. A LEFT JOIN emits NO ROW
--   for a division that failed to match - it does not emit a NULL row. So a product type
--   that matched in CW001 and SP001 but was stored under a different description in EH001
--   still looked complete, and a 56-of-57 seed passed. Section C builds the expected GRID
--   and fails on any hole in it, naming the division.
--
-- WHY THE GRID IS DECLARED, NOT A UNIFORM CROSS JOIN
--   Division scope is DECLARED PER PRODUCT TYPE (`expected_divisions`). The 19 workbook
--   product types are declared in CW001, EH001 and SP001; ('Q','TBD storage') - added by
--   OWNER RULING on 2026-08-18 and mapped to Storage - is declared in CW001 ONLY, which
--   is where it actually exists as an active MG01 row. A uniform 20 x 3 cross join would
--   demand 'Q' in EH001 and SP001 and FAIL on correct data. Declaring the scope narrows
--   WHICH cells are expected; a declared cell that does not resolve still FAILS and still
--   names the division, so the grid fix is not weakened. The reverse case - a type
--   resolving in an UNDECLARED division - is reported as a NOTICE and is neither a pass
--   nor a fail, because the data is right and only the declaration is stale.
--
--   MerchGroup_Rework.xlsx does not yet carry 'Q'. It is a business-owned binary that
--   this repository does not edit; until the business updates it, the recorded owner
--   ruling in docs/business-rules/merchandise-and-product-taxonomy.md is the authority.
--
-- WHY `is_active`
--   The migration seeds only ACTIVE MG01 rows, so this file counts and joins only ACTIVE
--   MG01 rows. Using a different population here than the migration uses would let the
--   test agree with a seed that had matched something else entirely.
--

-- WHAT IT ASSERTS
--   A. The objects exist, with the constraint that makes acceptance check 3 real, and the
--      grants are least-privilege: anon has nothing, authenticated may SELECT and may NOT
--      INSERT/UPDATE/DELETE, service_role may read.
--   B. The seven categories exist exactly once each (acceptance check 1).
--   C. Every DECLARED (authoritative product type, division) cell resolves to the right
--      category in THAT division, and the total link count equals the number of declared
--      cells - derived from the declaration, never hard-coded (checks 2, 4, 6).
--   D. Negative cases (acceptance check 6), all fired for real against a throwaway
--      fixture: a second category for one product-type row is REJECTED, a duplicate
--      mapping is REJECTED, a mapping to a non-existent merchandise-group row is
--      REJECTED, a mapping to a non-existent category is REJECTED, a blank category code
--      is REJECTED, and duplicate category codes/names are REJECTED.
--   E. The documented read contract returns category + MG01 code + MG01 product-type name
--      for every authoritative product type, counted from the declaration rather than
--      from a literal (acceptance check 5).
--
--   No assertion reads supabase_migrations.schema_migrations. This repo has shipped a
--   migration that recorded a clean ledger row while its object did nothing, so "it
--   applied" is not accepted here as evidence of anything.
--
-- SIDE EFFECTS
--   None survive. Section D creates one throwaway core."merchGroup" row (mg_id
--   -987654322, an explicit negative id that cannot collide with the identity sequence)
--   plus its category link, exercises the constraints against them, and then unwinds the
--   whole thing by raising a sentinel exception inside a plpgsql sub-block - a plpgsql
--   BEGIN ... EXCEPTION block is a real subtransaction, so catching the sentinel rolls
--   back every row the block inserted. The block then PROVES the rollback happened rather
--   than assuming it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- A + B + C + E
-- -------------------------------------------------------------------------------------
do $$
declare
  v_pass integer := 0;
  v_fail integer := 0;
  v_n    integer;
  v_txt  text;
  v_source_rows integer;
  v_links integer;
  v_declared_cells integer;
  v_types integer;
  v_undeclared text;
  r      record;
begin
  -- Is there any source data on this database at all? Sections C and E are meaningless
  -- without it; sections A and B are asserted regardless. See the header.
  select count(*) into v_source_rows
  from core."merchGroup" where "mgTypeCode" = '01' and is_active is true;

  raise notice '=== A. OBJECT EXISTENCE ===';
  foreach v_txt in array array['core.mg_category', 'core.mg_category_merch_group'] loop
    if to_regclass(v_txt) is null then
      v_fail := v_fail + 1; raise notice 'FAIL table missing: %', v_txt;
    else
      v_pass := v_pass + 1; raise notice 'PASS table exists: % (oid %)', v_txt, to_regclass(v_txt)::oid;
    end if;
  end loop;

  -- The constraint IS acceptance check 3. If it is absent the whole design is decorative.
  select count(*) into v_n
  from pg_constraint
  where conname = 'mg_category_merch_group_one_category_per_mg_row'
    and conrelid = 'core.mg_category_merch_group'::regclass
    and contype = 'u';
  if v_n = 1 then
    v_pass := v_pass + 1;
    raise notice 'PASS unique constraint on merch_group_mg_id exists (one category per merchandise-group ROW)';
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL unique constraint mg_category_merch_group_one_category_per_mg_row missing';
  end if;

  -- The link must be a real foreign key onto the merchandise-group row identity.
  select count(*) into v_n
  from pg_constraint
  where conrelid = 'core.mg_category_merch_group'::regclass
    and contype = 'f'
    and confrelid = 'core."merchGroup"'::regclass;
  if v_n = 1 then
    v_pass := v_pass + 1; raise notice 'PASS foreign key to core."merchGroup"(mg_id) exists';
  else
    v_fail := v_fail + 1; raise notice 'FAIL no foreign key from mg_category_merch_group to core."merchGroup"';
  end if;

  -- RLS must be on, and anon/public must have nothing.
  foreach v_txt in array array['mg_category', 'mg_category_merch_group'] loop
    select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relname = v_txt and c.relrowsecurity;
    if v_n = 1 then
      v_pass := v_pass + 1; raise notice 'PASS RLS enabled on core.%', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL RLS NOT enabled on core.%', v_txt;
    end if;

    if has_table_privilege('anon', 'core.' || quote_ident(v_txt), 'SELECT') then
      v_fail := v_fail + 1; raise notice 'FAIL anon can SELECT core.%', v_txt;
    else
      v_pass := v_pass + 1; raise notice 'PASS anon cannot SELECT core.%', v_txt;
    end if;

    -- The read grant the applications actually depend on.
    if has_table_privilege('authenticated', 'core.' || quote_ident(v_txt), 'SELECT') then
      v_pass := v_pass + 1; raise notice 'PASS authenticated can SELECT core.%', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL authenticated cannot SELECT core.%', v_txt;
    end if;

    -- AND authenticated must NOT be able to WRITE. These are structural reference rows
    -- maintained by migration. Postgres checks the grant BEFORE RLS, so the absence of
    -- these three privileges - not the policy wording - is what actually stops a browser
    -- session writing. Same assertion as core_licensor_alias_contracts.sql F3.
    if has_table_privilege('authenticated', 'core.' || quote_ident(v_txt), 'INSERT')
       or has_table_privilege('authenticated', 'core.' || quote_ident(v_txt), 'UPDATE')
       or has_table_privilege('authenticated', 'core.' || quote_ident(v_txt), 'DELETE') then
      v_fail := v_fail + 1;
      raise notice 'FAIL authenticated has INSERT/UPDATE/DELETE on core.%', v_txt;
    else
      v_pass := v_pass + 1;
      raise notice 'PASS authenticated cannot INSERT/UPDATE/DELETE core.%', v_txt;
    end if;

    -- anon must have no write path either.
    if has_table_privilege('anon', 'core.' || quote_ident(v_txt), 'INSERT')
       or has_table_privilege('anon', 'core.' || quote_ident(v_txt), 'UPDATE')
       or has_table_privilege('anon', 'core.' || quote_ident(v_txt), 'DELETE') then
      v_fail := v_fail + 1;
      raise notice 'FAIL anon has INSERT/UPDATE/DELETE on core.%', v_txt;
    else
      v_pass := v_pass + 1;
      raise notice 'PASS anon cannot INSERT/UPDATE/DELETE core.%', v_txt;
    end if;

    -- service_role is the role that actually maintains these rows (it also has BYPASSRLS).
    if has_table_privilege('service_role', 'core.' || quote_ident(v_txt), 'SELECT') then
      v_pass := v_pass + 1; raise notice 'PASS service_role can SELECT core.%', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL service_role cannot SELECT core.%', v_txt;
    end if;

    -- With RLS on, a missing policy is a table nobody can read. Both must be present.
    select count(*) into v_n
    from pg_policies
    where schemaname = 'core' and tablename = v_txt
      and policyname in ('shared_read', 'admin_write');
    if v_n = 2 then
      v_pass := v_pass + 1; raise notice 'PASS core.% carries both shared_read and admin_write', v_txt;
    else
      v_fail := v_fail + 1;
      raise notice 'FAIL core.% has % of the 2 expected policies (shared_read, admin_write)', v_txt, v_n;
    end if;

    -- The columns the read contract and the link both depend on.
    select count(*) into v_n
    from information_schema.columns
    where table_schema = 'core' and table_name = v_txt
      and column_name in (
        case v_txt when 'mg_category' then 'code' else 'mg_category_id' end,
        case v_txt when 'mg_category' then 'name' else 'merch_group_mg_id' end,
        case v_txt when 'mg_category' then 'sort_order' else 'source' end,
        'id', 'created_at', 'updated_at'
      );
    if v_n = 6 then
      v_pass := v_pass + 1; raise notice 'PASS core.% carries its 6 contract columns', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL core.% carries % of its 6 contract columns', v_txt, v_n;
    end if;
  end loop;

  -- The foreign key onto core.mg_category, so a link can never point at nothing.
  select count(*) into v_n
  from pg_constraint
  where conrelid = 'core.mg_category_merch_group'::regclass
    and contype = 'f'
    and confrelid = 'core.mg_category'::regclass;
  if v_n = 1 then
    v_pass := v_pass + 1; raise notice 'PASS foreign key to core.mg_category(id) exists';
  else
    v_fail := v_fail + 1; raise notice 'FAIL no foreign key from mg_category_merch_group to core.mg_category';
  end if;

  -- The two unique indexes that keep the category list itself clean.
  foreach v_txt in array array['mg_category_code_key', 'mg_category_name_key',
                              'mg_category_merch_group_category_idx'] loop
    select count(*) into v_n
    from pg_class i join pg_namespace n on n.oid = i.relnamespace
    where n.nspname = 'core' and i.relname = v_txt and i.relkind = 'i';
    if v_n = 1 then
      v_pass := v_pass + 1; raise notice 'PASS index core.% exists', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL index core.% missing', v_txt;
    end if;
  end loop;

  raise notice '=== B. THE SEVEN CATEGORIES EXIST EXACTLY ONCE (acceptance check 1) ===';
  foreach v_txt in array array['WALL','TABLETOP','CLOCK','STORAGE','WORKSPACE','FLOOR','GARDEN'] loop
    select count(*) into v_n from core.mg_category where code = v_txt;
    if v_n = 1 then
      v_pass := v_pass + 1; raise notice 'PASS category % exists exactly once', v_txt;
    else
      v_fail := v_fail + 1; raise notice 'FAIL category % found % times', v_txt, v_n;
    end if;
  end loop;

  select count(*) into v_n from core.mg_category;
  if v_n = 7 then
    v_pass := v_pass + 1; raise notice 'PASS exactly 7 categories total';
  else
    v_fail := v_fail + 1; raise notice 'FAIL expected 7 categories, found %', v_n;
  end if;

  raise notice '=== C. EVERY DECLARED CATEGORY-TO-MG01 CELL, PER DIVISION (checks 2, 4, 6) ===';
  if v_source_rows = 0 then
    raise notice 'SKIP C: core."merchGroup" holds NO ACTIVE mgTypeCode ''01'' rows on this '
      'database, so there is nothing for the authoritative product types to resolve '
      'against and the migration correctly seeded no link rows. This section is SKIPPED, '
      'NOT passed. It runs and must pass on preview and production.';
  else
  for r in
    -- The authoritative list carries its own DIVISION SCOPE. The 19 workbook product
    -- types are declared in all three divisions; ('Q','TBD storage') - OWNER RULING
    -- 2026-08-18, Storage - is declared in CW001 ONLY, because that is where it exists.
    -- The grid is the UNNEST of that declaration, never a uniform cross join.
    with authoritative (mg_code, mg_desc, category_code, expected_divisions) as (
      values
        ('A','Stretched/Box','WALL',array['CW001','EH001','SP001']),
        ('B','Framed','WALL',array['CW001','EH001','SP001']),
        ('C','Plaque','WALL',array['CW001','EH001','SP001']),
        ('D','Functional','WALL',array['CW001','EH001','SP001']),
        ('E','Other Wall','WALL',array['CW001','EH001','SP001']),
        ('F','Block','TABLETOP',array['CW001','EH001','SP001']),
        ('G','Box','TABLETOP',array['CW001','EH001','SP001']),
        ('H','Photo Frames','TABLETOP',array['CW001','EH001','SP001']),
        ('J','Object','TABLETOP',array['CW001','EH001','SP001']),
        ('K','Other tabletop','TABLETOP',array['CW001','EH001','SP001']),
        ('M','Clocks','CLOCK',array['CW001','EH001','SP001']),
        ('N','Soft storage','STORAGE',array['CW001','EH001','SP001']),
        ('P','Hard storage','STORAGE',array['CW001','EH001','SP001']),
        ('R','Other storage','STORAGE',array['CW001','EH001','SP001']),
        ('Q','TBD storage','STORAGE',array['CW001']),
        ('S','Stationery org','WORKSPACE',array['CW001','EH001','SP001']),
        ('T','Desk acc','WORKSPACE',array['CW001','EH001','SP001']),
        ('U','Other workspace','WORKSPACE',array['CW001','EH001','SP001']),
        ('V','Floor coverings','FLOOR',array['CW001','EH001','SP001']),
        ('W','Garden','GARDEN',array['CW001','EH001','SP001'])
    ),
    declared as (
      select a.mg_code, a.mg_desc, a.category_code,
             upper(btrim(u.division_code)) as division_key
      from authoritative a
      cross join lateral unnest(a.expected_divisions) as u(division_code)
    ),
    active_mg01 as (
      select
        mg.mg_id,
        upper(btrim(coalesce(mg."divisionCode_fk", ''))) as division_key,
        coalesce(
          nullif(btrim(mg."divisionCode_fk"), ''),
          'division_id ' || coalesce(mg."divisionCode_id_fk"::text, '(null)')
        ) as division_label,
        upper(btrim(mg.mg_code)) as code_key,
        lower(btrim(mg.mg_desc)) as desc_key
      from core."merchGroup" mg
      where mg."mgTypeCode" = '01' and mg.is_active is true
    ),
    graded as (
      select d.division_key, d.mg_code, d.mg_desc, d.category_code,
             m.mg_id, c.code as actual_category
      from declared d
      left join active_mg01 m
        on m.division_key = d.division_key
       and m.code_key = upper(d.mg_code)
       and m.desc_key = lower(d.mg_desc)
      left join core.mg_category_merch_group l on l.merch_group_mg_id = m.mg_id
      left join core.mg_category c on c.id = l.mg_category_id
    )
    select
      g.mg_code,
      g.mg_desc,
      g.category_code,
      count(*)                                                      as expected_cells,
      count(*) filter (where g.mg_id is not null)                   as matched_cells,
      count(*) filter (where g.actual_category = g.category_code)   as correct_cells,
      coalesce(
        string_agg(distinct g.division_key || ' (' ||
          case
            when g.mg_id is null then 'no active MG01 row'
            when g.actual_category is null then 'row ' || g.mg_id || ' not linked'
            else 'row ' || g.mg_id || ' -> ' || g.actual_category
          end || ')', ', ')
          filter (where g.actual_category is distinct from g.category_code),
        '') as bad_divisions
    from graded g
    group by g.mg_code, g.mg_desc, g.category_code
    order by g.mg_code
  loop
    if r.correct_cells = r.expected_cells then
      v_pass := v_pass + 1;
      raise notice 'PASS % % -> % in all % declared division(s)',
        r.mg_code, r.mg_desc, r.category_code, r.expected_cells;
    else
      -- Names the exact division(s). This is the assertion that a 56-of-57 seed fails,
      -- and declaring the scope does not soften it: a DECLARED cell that is missing is
      -- still a FAIL naming the division.
      v_fail := v_fail + 1;
      raise notice 'FAIL % % -> % resolved in % of % declared division(s); wrong or missing in: %',
        r.mg_code, r.mg_desc, r.category_code, r.correct_cells, r.expected_cells,
        r.bad_divisions;
    end if;
  end loop;

  -- TOTAL SHAPE, DERIVED FROM THE DECLARATION rather than hard-coded. Today this is
  -- 19 types x 3 divisions + 'Q' in CW001 = 58 declared cells; neither 58 nor 19 nor 3
  -- is written down as an expectation anywhere - change a declared scope and the
  -- expectation moves with it.
  with authoritative (mg_code, mg_desc, category_code, expected_divisions) as (
    values
      ('A','Stretched/Box','WALL',array['CW001','EH001','SP001']),
      ('B','Framed','WALL',array['CW001','EH001','SP001']),
      ('C','Plaque','WALL',array['CW001','EH001','SP001']),
      ('D','Functional','WALL',array['CW001','EH001','SP001']),
      ('E','Other Wall','WALL',array['CW001','EH001','SP001']),
      ('F','Block','TABLETOP',array['CW001','EH001','SP001']),
      ('G','Box','TABLETOP',array['CW001','EH001','SP001']),
      ('H','Photo Frames','TABLETOP',array['CW001','EH001','SP001']),
      ('J','Object','TABLETOP',array['CW001','EH001','SP001']),
      ('K','Other tabletop','TABLETOP',array['CW001','EH001','SP001']),
      ('M','Clocks','CLOCK',array['CW001','EH001','SP001']),
      ('N','Soft storage','STORAGE',array['CW001','EH001','SP001']),
      ('P','Hard storage','STORAGE',array['CW001','EH001','SP001']),
      ('R','Other storage','STORAGE',array['CW001','EH001','SP001']),
      ('Q','TBD storage','STORAGE',array['CW001']),
      ('S','Stationery org','WORKSPACE',array['CW001','EH001','SP001']),
      ('T','Desk acc','WORKSPACE',array['CW001','EH001','SP001']),
      ('U','Other workspace','WORKSPACE',array['CW001','EH001','SP001']),
      ('V','Floor coverings','FLOOR',array['CW001','EH001','SP001']),
      ('W','Garden','GARDEN',array['CW001','EH001','SP001'])
  ),
  declared as (
    select a.mg_code, a.mg_desc, a.category_code,
           upper(btrim(u.division_code)) as division_key
    from authoritative a
    cross join lateral unnest(a.expected_divisions) as u(division_code)
  ),
  linked as (
    select
      upper(btrim(coalesce(mg."divisionCode_fk", ''))) as division_key,
      coalesce(
        nullif(btrim(mg."divisionCode_fk"), ''),
        'division_id ' || coalesce(mg."divisionCode_id_fk"::text, '(null)')
      ) as division_label,
      upper(btrim(mg.mg_code)) as code_key,
      lower(btrim(mg.mg_desc)) as desc_key
    from core.mg_category_merch_group l
    join core."merchGroup" mg on mg.mg_id = l.merch_group_mg_id
    where mg."mgTypeCode" = '01' and mg.is_active is true
  )
  select
    (select count(*) from declared),
    (select count(*) from authoritative),
    (select count(*) from linked l
       where exists (select 1 from declared d
                     where d.division_key = l.division_key
                       and upper(d.mg_code) = l.code_key
                       and lower(d.mg_desc) = l.desc_key)),
    (select string_agg(distinct l.division_label || ' / ' || l.code_key || ' ' || l.desc_key,
                       '; ')
       from linked l
       join authoritative a
         on upper(a.mg_code) = l.code_key and lower(a.mg_desc) = l.desc_key
       where not exists (select 1 from declared d
                         where d.division_key = l.division_key
                           and upper(d.mg_code) = l.code_key
                           and lower(d.mg_desc) = l.desc_key))
  into v_declared_cells, v_types, v_links, v_undeclared;

  if v_links = v_declared_cells then
    v_pass := v_pass + 1;
    raise notice 'PASS % active-MG01 link rows fill all % declared cells (% product types)',
      v_links, v_declared_cells, v_types;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL % of % declared (product type, division) cells carry a link row',
      v_links, v_declared_cells;
  end if;

  -- THE REVERSE FINDING, reported and never counted as a pass or a fail. An authoritative
  -- product type resolving in an UNDECLARED division is correct data with a stale
  -- declaration, not a defect: the row was found and carries its authoritative category.
  -- Failing here would break every replay over a legitimate business expansion, whereas a
  -- MISSING declared cell silently drops that division out of every category filter - so
  -- only the missing side fails. See the migration header for the full rationale.
  if v_undeclared is not null then
    raise notice 'NOTICE: authoritative product types resolve in undeclared divisions: %. '
      'Data is correct and categorised; widen expected_divisions in a follow-up governed '
      'migration.', v_undeclared;
  end if;

  end if;

  -- The whole point of the unique constraint, restated as data: no product-type row may
  -- appear under two categories. These two hold on an EMPTY table as well (0 offenders),
  -- so they stay unconditional.
  select count(*) into v_n
  from (
    select merch_group_mg_id
    from core.mg_category_merch_group
    group by merch_group_mg_id
    having count(distinct mg_category_id) > 1
  ) d;
  if v_n = 0 then
    v_pass := v_pass + 1; raise notice 'PASS no product type belongs to two categories';
  else
    v_fail := v_fail + 1; raise notice 'FAIL % product types belong to more than one category', v_n;
  end if;

  -- Nothing may be linked to an MG row that is not MG01.
  select count(*) into v_n
  from core.mg_category_merch_group l
  join core."merchGroup" mg on mg.mg_id = l.merch_group_mg_id
  where coalesce(mg."mgTypeCode", '') <> '01';
  if v_n = 0 then
    v_pass := v_pass + 1; raise notice 'PASS every linked merchandise-group row is mgTypeCode 01';
  else
    v_fail := v_fail + 1; raise notice 'FAIL % linked rows are not mgTypeCode 01', v_n;
  end if;

  raise notice '=== E. READ CONTRACT (acceptance check 5) ===';
  if v_source_rows = 0 then
    raise notice 'SKIP E: no mgTypeCode ''01'' source rows on this database, so the read '
      'contract has nothing to return. SKIPPED, not passed.';
  else
  select count(distinct (category_code, mg01_code, mg01_product_type)) into v_n
  from (
    select
      cat.code   as category_code,
      mg.mg_code as mg01_code,
      mg.mg_desc as mg01_product_type
    from core.mg_category_merch_group link
    join core.mg_category cat on cat.id = link.mg_category_id
    join core."merchGroup" mg  on mg.mg_id = link.merch_group_mg_id
    where cat.is_active
  ) contract;
  -- The expectation is the number of AUTHORITATIVE PRODUCT TYPES (20 today), taken from
  -- the same declaration section C used - not a literal. A product type appears once per
  -- division as a ROW but collapses to ONE (category, code, description) triple here.
  if v_types is null then
    v_fail := v_fail + 1;
    raise notice 'FAIL E cannot evaluate: the authoritative product-type count was never '
      'computed, which means section C did not run. Investigate rather than trusting this file.';
  elsif v_n = v_types then
    v_pass := v_pass + 1;
    raise notice 'PASS read contract yields exactly % distinct category/MG01 code/product-type triples',
      v_types;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL read contract yielded % distinct triples, expected % (one per authoritative product type)',
      v_n, v_types;
  end if;
  end if;

  raise notice '--- % passed / % failed ---', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'Issue #1163 contract tests FAILED: % failures', v_fail;
  end if;
end;
$$;

-- -------------------------------------------------------------------------------------
-- D. NEGATIVE CASES - invalid and duplicate mappings must be REJECTED.
--    Each attempt is expected to raise; if it does NOT raise, that is the failure.
--
--    EVERY case here runs on EVERY database, including the from-empty CI one. There are
--    no skips left in this section.
--
--    D1, D2 and D4 need a real merchandise-group row to act on. They used to look for a
--    seeded production row and SKIP when there was none - which meant CI, the only place
--    these tests run automatically, never once watched the unique constraint reject
--    anything. It only checked that the constraint was listed in pg_constraint. So these
--    three now build their OWN throwaway fixture: one core."merchGroup" row with an
--    explicit negative mg_id (the column is GENERATED ALWAYS AS IDENTITY, hence
--    OVERRIDING SYSTEM VALUE, and a negative id cannot collide with the sequence) plus one
--    category link. Everything is created inside a plpgsql BEGIN ... EXCEPTION block,
--    which is a real subtransaction: raising the sentinel error at the end of the block
--    rolls back every row it inserted, while the plpgsql pass/fail counters (ordinary
--    variables, not table rows) survive. The block then PROVES the rollback rather than
--    trusting it.
-- -------------------------------------------------------------------------------------
do $$
declare
  v_pass integer := 0;
  v_fail integer := 0;
  v_cat_wall uuid;
  v_cat_clock uuid;
  v_fixture_mg constant integer := -987654322;
  v_leftover integer;
begin
  select id into v_cat_wall  from core.mg_category where code = 'WALL';
  select id into v_cat_clock from core.mg_category where code = 'CLOCK';
  if v_cat_wall is null or v_cat_clock is null then
    raise exception 'Issue #1163 negative cases cannot run: the WALL/CLOCK categories are '
      'missing, which section B should already have failed on.';
  end if;

  begin
    -- --- fixture ------------------------------------------------------------------
    insert into core."merchGroup"
      (mg_id, mg_code, mg_desc, "mgTypeCode", is_active, "divisionCode_fk")
    overriding system value
    values (v_fixture_mg, 'ZZ', 'issue 1163 throwaway fixture', '01', true, 'ZZ999');

    insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
    values (v_cat_wall, v_fixture_mg);
    v_pass := v_pass + 1;
    raise notice 'PASS D0: a first category link for a product-type row is accepted';

    -- D1: the SAME merchandise-group row, a SECOND category -> must be rejected.
    begin
      insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
      values (v_cat_clock, v_fixture_mg);
      v_fail := v_fail + 1;
      raise notice 'FAIL D1: a product-type row was allowed into a second category';
    exception when unique_violation then
      v_pass := v_pass + 1;
      raise notice 'PASS D1: second category for the same product-type row rejected '
        '(unique_violation actually fired)';
    end;

    -- D2: an exact duplicate of the existing mapping -> must be rejected.
    begin
      insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
      values (v_cat_wall, v_fixture_mg);
      v_fail := v_fail + 1;
      raise notice 'FAIL D2: duplicate mapping was accepted';
    exception when unique_violation then
      v_pass := v_pass + 1;
      raise notice 'PASS D2: duplicate mapping rejected (unique_violation actually fired)';
    end;

    -- D4: a mapping to a category that does not exist -> must be rejected.
    -- Free the fixture row first so the unique constraint cannot be what rejects it; the
    -- foreign key must be the thing that fires.
    delete from core.mg_category_merch_group where merch_group_mg_id = v_fixture_mg;
    begin
      insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
      values ('00000000-0000-0000-0000-000000000000'::uuid, v_fixture_mg);
      v_fail := v_fail + 1;
      raise notice 'FAIL D4: mapping to a non-existent category was accepted';
    exception when foreign_key_violation then
      v_pass := v_pass + 1;
      raise notice 'PASS D4: mapping to a non-existent category rejected '
        '(foreign_key_violation actually fired)';
    end;

    -- Unwind the fixture. SQLSTATE ZZ163 is a private code chosen so that only this
    -- handler can catch it and no real database error can be mistaken for it.
    raise exception using errcode = 'ZZ163',
      message = 'issue #1163 fixture rollback sentinel';
  exception
    when sqlstate 'ZZ163' then
      raise notice 'INFO: D1/D2/D4 fixture rolled back (subtransaction unwound)';
    when others then
      -- Never swallow a real error: report it and let the file fail.
      raise;
  end;

  -- PROVE the rollback rather than assuming it. If either row survived, this test just
  -- polluted the database and must say so.
  select count(*) into v_leftover from core."merchGroup" where mg_id = v_fixture_mg;
  if v_leftover = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS D-cleanup: the throwaway merchandise-group row did not survive';
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL D-cleanup: throwaway merchandise-group row % SURVIVED', v_fixture_mg;
  end if;

  select count(*) into v_leftover
  from core.mg_category_merch_group where merch_group_mg_id = v_fixture_mg;
  if v_leftover = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS D-cleanup: the throwaway category link did not survive';
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL D-cleanup: throwaway category link SURVIVED';
  end if;

  -- D3: mapping to a merchandise-group row that does not exist -> must be rejected.
  begin
    insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id)
    values (v_cat_wall, -987654321);
    v_fail := v_fail + 1;
    raise notice 'FAIL D3: mapping to a non-existent merchandise-group row was accepted';
    delete from core.mg_category_merch_group where merch_group_mg_id = -987654321;
  exception when foreign_key_violation then
    v_pass := v_pass + 1;
    raise notice 'PASS D3: mapping to a non-existent merchandise-group row rejected';
  end;

  -- D5: a blank category code -> must be rejected.
  begin
    insert into core.mg_category (code, name) values ('   ', 'Blank code');
    v_fail := v_fail + 1;
    raise notice 'FAIL D5: a blank category code was accepted';
    delete from core.mg_category where name = 'Blank code';
  exception when check_violation then
    v_pass := v_pass + 1;
    raise notice 'PASS D5: blank category code rejected';
  end;

  -- D6: a duplicate category code -> must be rejected.
  begin
    insert into core.mg_category (code, name) values ('WALL', 'Wall again');
    v_fail := v_fail + 1;
    raise notice 'FAIL D6: a duplicate category code was accepted';
    delete from core.mg_category where name = 'Wall again';
  exception when unique_violation then
    v_pass := v_pass + 1;
    raise notice 'PASS D6: duplicate category code rejected';
  end;

  -- D7: a duplicate category NAME differing only by case -> must be rejected.
  begin
    insert into core.mg_category (code, name) values ('WALL_ALT', ' wall ');
    v_fail := v_fail + 1;
    raise notice 'FAIL D7: a case/whitespace-variant duplicate category name was accepted';
    delete from core.mg_category where code = 'WALL_ALT';
  exception when unique_violation then
    v_pass := v_pass + 1;
    raise notice 'PASS D7: case/whitespace-variant duplicate category name rejected';
  end;

  raise notice '--- % passed / % failed ---', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'Issue #1163 negative-case tests FAILED: % failures', v_fail;
  end if;
end;
$$;
