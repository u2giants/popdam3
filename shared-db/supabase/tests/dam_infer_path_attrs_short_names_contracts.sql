begin;

-- u2giants/popdam3#963 Phase 3.1: infer_path_attrs table-driven contract.
do $$
declare
  b constant text := 'Decor/Character Licensed/____New Structure/';
  c record;
  got jsonb;
begin
  for c in select * from (values
    -- unchanged long-name behaviour
    (b||'In Development/Customer Adopted/Ross/Ross Wall 2026/PQE8QMVAV01/f.psd', 'In Development', 'Ross', 'Ross Wall 2026'),
    (b||'In Development/Customer Adopted/_FINISHED/Ross_finished/Wall/SKU1/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'In Development/Customer Adopted/_NOT APPROVED/Ross/Wall/f.psd', 'In Development', null, null),
    (b||'In Development/Customer Adopted/Ross/PQE8QMVAV01/f.psd', 'In Development', 'Ross', null),
    (b||'In Development/Customer Adopted/Ross/f.psd', 'In Development', 'Ross', null),
    (b||'Concept Approved Designs/Ross/Wall/f.psd', 'Concept Approved Designs', null, null),
    ('Other/Ross/Wall/f.psd', null, null, null),
    -- short names
    (b||'In Dev/Cust Adopted/Ross/Wall/SKU/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'In Dev/Cust Adopted/Ross/2026/Wall/SKU/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'In Dev/Customer Adopted/Ross/Wall/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'In Development/Cust Adopted/Ross/Wall/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'In Dev/Cust Adopted/_FINISHED/Ross_finished/Wall/SKU/f.psd', 'In Development', 'Ross', 'Wall'),
    (b||'Concept Approved/Ross/Wall/f.psd', 'Concept Approved Designs', null, null),
    (b||'In Dev/Cust Adopted/_FINISHED/Ross/Wall/SKU/f.psd', 'In Development', 'Ross', 'Wall'),
    -- year folders
    (b||'In Development/Customer Adopted/Ross/2026/Ross Wall 2026/PQE8QMVAV01/f.psd', 'In Development', 'Ross', 'Ross Wall 2026'),
    (b||'In Development/Customer Adopted/Ross/2026/PQE8QMVAV01/f.psd', 'In Development', 'Ross', null),
    (b||'In Development/Customer Adopted/Ross/2026/f.psd', 'In Development', 'Ross', null),
    (b||'In Development/Customer Adopted/Ross/2026', 'In Development', 'Ross', null),
    (b||'In Development/Customer Adopted/_FINISHED/Ross_finished/2025/Wall/f.psd', 'In Development', 'Ross', 'Wall')
  ) v(p, st, cu, pr) loop
    got := public.infer_path_attrs(c.p);
    if got->>'stage' is distinct from c.st or got->>'customer' is distinct from c.cu
       or got->>'program' is distinct from c.pr then
      raise exception 'infer_path_attrs(%) = %, expected % / % / %', c.p, got, c.st, c.cu, c.pr;
    end if;
  end loop;
end $$;

rollback;
