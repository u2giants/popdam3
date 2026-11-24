-- derived-from: 20261112024905
-- u2giants/popdam3#963 Phase 5: customer folders get Albert's short names
-- (customer-short-names_from_albert.csv, 2026-11-13). The stored customer value
-- stays the long folder name (plan D8), via dam.customer_folder_alias.
-- infer_path_attrs now reads a table, so it is STABLE (no index or generated
-- column uses it). Everything else is unchanged from 20261112024905.

create table dam.customer_folder_alias (
  folder_name text primary key,
  customer    text not null,
  constraint customer_folder_alias_differs check (folder_name <> customer)
);

comment on table dam.customer_folder_alias is
  'Short NAS customer folder name -> stored customer value (popdam3#963). Owner-chosen; '
  'read by public.infer_path_attrs so renamed folders keep the same customer.';

alter table dam.customer_folder_alias enable row level security;
revoke all on dam.customer_folder_alias from anon, authenticated;
grant select on dam.customer_folder_alias to authenticated;
grant all on dam.customer_folder_alias to service_role;
create policy customer_folder_alias_read on dam.customer_folder_alias
  for select to authenticated using (true);

insert into dam.customer_folder_alias (folder_name, customer) values
  ('4SGM', '4 Seasons'),
  ('Aldi', 'Aldi''s'),
  ('AtHome', 'At Home'),
  ('B-N', 'B&N'),
  ('BoxLunch', 'Box Lunch'),
  ('Desperate', 'Desperate Signs'),
  ('Dollar_General', 'Dollar General'),
  ('Dollar_Tree', 'Dollar Tree'),
  ('Family_Dollar', 'Family Dollar'),
  ('Five_Below', 'Five Below'),
  ('Forman', 'Forman Mills'),
  ('Hobby_Lobby', 'Hobby Lobby'),
  ('HotTopic', 'Hot Topic'),
  ('Kohls', 'Kohl''s'),
  ('RoomsToGo', 'Rooms To Go'),
  ('Sams_Club', 'Sams Club'),
  ('ShoppersWorld', 'Shoppers World'),
  ('Sobel', 'Sobel Westex'),
  ('Spencer', 'Spencer''s'),
  ('Spirit', 'Spirit Halloween Christmas'),
  ('VW', 'Variety Wholesalers');

CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path = ''
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
  ELSIF s IN ('Concept Approved', 'Concept_Approved') THEN
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

  -- Short customer folder names (popdam3#963) keep the stored customer value.
  IF cust IS NOT NULL THEN
    cust := COALESCE((SELECT a.customer FROM dam.customer_folder_alias a WHERE a.folder_name = cust), cust);
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$function$;
