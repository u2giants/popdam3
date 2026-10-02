-- =====================================================================================
-- Issue #3891 (#3882 child 2b) - repoint two foreign keys off the frozen schema
-- designflow_frozen_20260710 onto the live dflow parents the DesignFlow Cloud SQL
-- cutover loads.
--
-- Claim: #3892. Reserved version 20261002161522. Supersedes the FK part of closed
-- PR #3391; the frozen-schema drop itself stays on #2110 and is NOT done here.
--
-- STRUCTURE ONLY. Each FK is dropped and re-added under the same name, same column,
-- same NO ACTION / NO ACTION behaviour; only the referenced table changes. Live
-- check 2026-10-02 on production and preview: 0 of 2,276 plm.art_piece_attachment
-- rows and 0 of 4 app."RolePermissions" rows lack a parent in dflow. Each FK is
-- added NOT VALID and then validated in this same file; an orphan written before
-- apply makes VALIDATE fail and the whole file roll back. DROP CONSTRAINT still
-- takes ACCESS EXCLUSIVE on each child table until commit (2,276 and 4 rows), and
-- ADD locks the dflow parent; only the VALIDATE step itself is the weaker lock.
--
-- Parent identity (read-only, 2026-10-02, production and preview): every frozen
-- parent the children use matches its dflow row on every field except the
-- superseded art_source_id/updated_at/updated_by (art) and the live-only
-- app_role_id (roles); 0 mismatches. Both child columns already carry an index.
--
-- A precondition block refuses to run unless both FKs are exactly today's
-- definition (child column, frozen parent, parent column, NO ACTION actions,
-- NOT DEFERRABLE, MATCH SIMPLE). The re-created FKs keep all of those.
--
-- Ordering: this must be applied in production before the #2110 frozen-schema
-- drop, which is then free to run; after that drop no reverse repoint exists.
-- =====================================================================================

-- derived-from: none

do $pre$
declare r record;
begin
  for r in select * from (values
    ('plm.art_piece_attachment', 'art_piece_attachment_art_piece_id_fkey', 'art_piece_id', 'designflow_frozen_20260710.art_piece', 'id'),
    ('app."RolePermissions"', 'RolePermissions_RoleId_fkey', 'RoleId', 'designflow_frozen_20260710."Roles"', 'Id')
  ) v(t, n, col, p, pc)
  loop
    if not exists (
      select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1] and ca.attname = r.col
      join pg_catalog.pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1] and pa.attname = r.pc
      where c.contype = 'f' and c.conrelid = pg_catalog.to_regclass(r.t) and c.conname = r.n
        and c.confrelid = pg_catalog.to_regclass(r.p)
        and c.confupdtype = 'a' and c.confdeltype = 'a'
        and not c.condeferrable and not c.condeferred and c.confmatchtype = 's'
        and array_length(c.conkey, 1) = 1 and array_length(c.confkey, 1) = 1
    ) then
      raise exception '3891: % on % is not the expected current definition', r.n, r.t;
    end if;
  end loop;
end
$pre$;

alter table plm.art_piece_attachment drop constraint art_piece_attachment_art_piece_id_fkey;
alter table plm.art_piece_attachment add constraint art_piece_attachment_art_piece_id_fkey
  foreign key (art_piece_id) references dflow.art_piece(id) not valid;
alter table plm.art_piece_attachment validate constraint art_piece_attachment_art_piece_id_fkey;

alter table app."RolePermissions" drop constraint "RolePermissions_RoleId_fkey";
alter table app."RolePermissions" add constraint "RolePermissions_RoleId_fkey"
  foreign key ("RoleId") references dflow."Roles"("Id") not valid;
alter table app."RolePermissions" validate constraint "RolePermissions_RoleId_fkey";
