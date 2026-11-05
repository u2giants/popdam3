-- Claim #5742 (work issue #5745; u2giants/popdam3#804 cause 6).
-- Installs pg_repack 1.5.2 so the governed table-repack maintenance operation
-- can rewrite public.assets online (heap 2,024 MB for ~260 MB of live rows,
-- which turns every DAM search visibility probe into a disk read).
-- Installing the extension changes no application table, row or privilege;
-- the repack itself runs only through scripts/table_repack_maintenance.py.
create extension if not exists pg_repack;

do $$
begin
  if (select extversion from pg_extension where extname = 'pg_repack') is distinct from '1.5.2' then
    raise exception 'pg_repack 1.5.2 required, found %',
      (select extversion from pg_extension where extname = 'pg_repack');
  end if;
end $$;

-- The repack schema is maintenance machinery, never an API surface.
revoke all on schema repack from public;
revoke all on schema repack from anon, authenticated;
revoke all on all functions in schema repack from public, anon, authenticated;
revoke all on all tables in schema repack from public, anon, authenticated;
