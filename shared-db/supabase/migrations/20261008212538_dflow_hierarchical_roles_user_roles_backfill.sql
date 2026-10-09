-- =====================================================================================
-- Issue #4106 (popcre/designflow-frontend#288 chunk 1 / #289) — DesignFlow
-- hierarchical role tree, user_roles membership, additive backfill.
--
-- Claim: #4107. Reserved version 20261008212538.
--
-- WHY: DesignFlow has six hardcoded roles and one `users.level` string. The owner
-- (Albert Hazan, 2026-10-08) locked a categorized tree (admin as super-role;
-- design / production / sales / vendors categories with named leaves), multi-
-- membership on leaves only, category→leaf inheritance, and this hard rule:
-- "nobody loses access they already have, unless you explicitly say so."
-- "i want no one to move."
--
-- ADDITIVE ONLY. Nobody is moved. Nobody loses access. `users.level` values are
-- never modified. Old RolePermissions rows are never deleted or rewritten.
--
-- Tree (exact names, including `trading co.`):
--   admin                          super
--   ├── design                     category
--   │   ├── creative designer      leaf
--   │   ├── technical designer     leaf
--   │   └── project manager        leaf
--   ├── production                 category
--   │   ├── sourcing               leaf
--   │   ├── production coordinator leaf
--   │   └── QC                     leaf
--   ├── sales                      category
--   │   ├── salesperson            leaf
--   │   └── sales assistant        leaf
--   └── vendors                    category
--       ├── factory                leaf
--       └── trading co.            leaf
--
-- Existing `dflow."Roles"` rows reused where the name already matches the tree
-- (admin → super; production / sales → category). Remaining legacy names
-- (designer, sourcing_manager) stay as leaves under their category so nothing
-- disappears. New names are inserted. People hold leaves only via `dflow.user_roles`.
--
-- Backfill from `lower(trim(users.level))`:
--   admin            → admin
--   designer         → creative designer + technical designer + project manager
--   production       → production coordinator + QC
--   sales            → salesperson + sales assistant
--   sourcing_manager → sourcing
--   vendor           → factory
-- Unknown / null / blank level values abort the migration (listed in the exception).
--
-- RolePermissions: `RoleId` may already target any `dflow."Roles"` row, so after
-- the seed it can reference a category OR a leaf. The `UserId` per-user override
-- path (Sample QC model) is untouched. Role-level rows (`UserId IS NULL`) are
-- copied onto the matching category (sourcing_manager → `sourcing` leaf). Per-user
-- rows are left in place and keep working through the override path.
--
-- Live production read 2026-10-08 ~5:30 PM EDT (qsllyeztdwjgirsysgai):
--   Roles: 5 rows (admin, sales, designer, production, sourcing_manager) — no vendor row.
--   users.level (52 users, 0 null/blank): admin 8, designer 21, production 11,
--     sales 8, sourcing_manager 4.
--   RolePermissions: 8 rows, ALL per-user (UserId set); 0 role-level rows; 0 orphans.
--
-- Not here: app-repo DDL, moving people, deleting `users.level`, production
-- promotion (shared-db workflow owns it).
-- =====================================================================================

-- derived-from: none

set lock_timeout = '5s';
set statement_timeout = '5min';

-- ------------------------------------------------------------------------------
-- 1. Fail-loud pre-checks (trust boundary: migration of access)
-- ------------------------------------------------------------------------------

do $$
declare
  orphan_ids text;
  unknown_levels text;
  bad_shape text;
  dup_names text;
begin
  select string_agg(p."Id"::text, ', ' order by p."Id")
    into orphan_ids
  from dflow."RolePermissions" p
  left join dflow."Roles" r on r."Id" = p."RoleId"
  where p."RoleId" is not null
    and r."Id" is null;

  if orphan_ids is not null then
    raise exception 'ABORT: RolePermissions orphan RoleId rows: %', orphan_ids;
  end if;

  select string_agg(distinct label, ', ' order by label)
    into unknown_levels
  from (
    select coalesce(level, '<NULL>') as label
    from dflow.users
    where level is null
       or trim(level) = ''
       or lower(trim(level)) not in (
            'admin', 'designer', 'production', 'sales', 'sourcing_manager', 'vendor'
          )
  ) bad;

  if unknown_levels is not null then
    raise exception 'ABORT: unknown users.level values (normalize or map these first): %', unknown_levels;
  end if;

  -- Exact object checks (mandatory review item 3). Every dependency column's
  -- full shape — data_type AND nullability — is asserted, not merely existence.
  -- A pre-existing wrong-typed or wrong-nullable column must fail loudly.
  select string_agg(detail, '; ' order by detail)
    into bad_shape
  from (
    select e.table_schema || '.' || e.table_name || '.' || e.column_name
           || ' expected ' || e.data_type || '/' || e.is_nullable
           || ', found '
           || coalesce(c.data_type || '/' || c.is_nullable, 'MISSING') as detail
    from (values
      ('dflow', 'Roles',           'Id',        'integer',            'NO'),
      ('dflow', 'Roles',           'Name',      'character varying',  'NO'),
      ('dflow', 'RolePermissions', 'Id',        'integer',            'NO'),
      ('dflow', 'RolePermissions', 'RoleId',    'integer',            'NO'),
      ('dflow', 'RolePermissions', 'UserId',    'integer',            'YES'),
      ('dflow', 'RolePermissions', 'ElementId', 'integer',            'NO'),
      ('dflow', 'RolePermissions', 'Access',    'boolean',            'NO'),
      ('dflow', 'users',           'id',        'integer',            'NO'),
      ('dflow', 'users',           'email',     'character varying',  'YES'),
      ('dflow', 'users',           'level',     'character varying',  'YES')
    ) as e(table_schema, table_name, column_name, data_type, is_nullable)
    left join information_schema.columns c
      on c.table_schema = e.table_schema
     and c.table_name = e.table_name
     and c.column_name = e.column_name
    where c.column_name is null
       or c.data_type is distinct from e.data_type
       or c.is_nullable is distinct from e.is_nullable
  ) mismatches;

  if bad_shape is not null then
    raise exception 'ABORT: dependency column shape mismatch: %', bad_shape;
  end if;

  -- F5: duplicate "Name" values make the forward UNIQUE index fail opaquely.
  -- Fail loud with the duplicate names listed before any DDL runs.
  select string_agg(name || ' (x' || cnt::text || ')', ', ' order by name)
    into dup_names
  from (
    select "Name" as name, count(*) as cnt
    from dflow."Roles"
    group by "Name"
    having count(*) > 1
  ) dups;

  if dup_names is not null then
    raise exception 'ABORT: duplicate dflow."Roles"."Name" values (roles_name_uidx cannot be created): %', dup_names;
  end if;
end
$$;

-- ------------------------------------------------------------------------------
-- 2. Roles tree shape (additive columns on the existing table)
-- ------------------------------------------------------------------------------

alter table dflow."Roles"
  add column if not exists kind text
    not null default 'leaf',
  add column if not exists parent_id integer,
  add column if not exists is_active boolean not null default true;

-- Shape-assert the columns this migration adds (not just the pre-existing
-- dependencies): a pre-existing wrong-typed column kept by IF NOT EXISTS must
-- fail loudly, not silently corrupt the hierarchy.
do $$
declare
  bad_shape text;
begin
  select string_agg(detail, '; ' order by detail)
    into bad_shape
  from (
    select e.column_name
           || ' expected ' || e.data_type || '/' || e.is_nullable
           || ', found '
           || coalesce(c.data_type || '/' || c.is_nullable, 'MISSING') as detail
    from (values
      ('kind',      'text',    'NO'),
      ('parent_id', 'integer', 'YES'),
      ('is_active', 'boolean', 'NO')
    ) as e(column_name, data_type, is_nullable)
    left join information_schema.columns c
      on c.table_schema = 'dflow'
     and c.table_name = 'Roles'
     and c.column_name = e.column_name
    where c.column_name is null
       or c.data_type is distinct from e.data_type
       or c.is_nullable is distinct from e.is_nullable
  ) mismatches;

  if bad_shape is not null then
    raise exception 'ABORT: dflow."Roles" added-column shape mismatch: %', bad_shape;
  end if;
end
$$;

alter table dflow."Roles" drop constraint if exists roles_parent_id_fkey;
alter table dflow."Roles"
  add constraint roles_parent_id_fkey
  foreign key (parent_id)
  references dflow."Roles"("Id")
  on update cascade
  on delete set null;

alter table dflow."Roles" drop constraint if exists roles_kind_check;
alter table dflow."Roles"
  add constraint roles_kind_check
  check (kind in ('super', 'category', 'leaf'));

create unique index if not exists roles_name_uidx
  on dflow."Roles" ("Name");

-- F2: ON CONFLICT ("Name") needs a real UNIQUE arbiter. `create unique index
-- if not exists` silently keeps a pre-existing same-named but non-unique or
-- wrong-column index; verify the arbiter actually exists before any ON CONFLICT
-- ("Name") fires.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'dflow' and tablename = 'Roles'
      and indexname = 'roles_name_uidx'
      and indexdef ilike '%unique%'
      and indexdef like '%("Name")%'
  ) and not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.constraint_schema = kcu.constraint_schema
    where tc.table_schema = 'dflow' and tc.table_name = 'Roles'
      and tc.constraint_type in ('UNIQUE', 'PRIMARY KEY')
      and kcu.column_name = 'Name'
  ) then
    raise exception 'ABORT: no UNIQUE arbiter on dflow."Roles"("Name"); ON CONFLICT ("Name") cannot resolve';
  end if;
end
$$;

comment on column dflow."Roles".kind is
  'Hierarchy node kind: super (admin, outside categories), category, or leaf. People hold leaves only.';
comment on column dflow."Roles".parent_id is
  'Parent role Id for category→leaf (and legacy leaf) hierarchy. NULL for super and category roots.';
comment on column dflow."Roles".is_active is
  'Soft retire flag. Default true. This migration never turns a role off.';

-- ------------------------------------------------------------------------------
-- 3. Classify existing rows, then seed the locked tree (exact names)
-- ------------------------------------------------------------------------------

-- Roots first (design and vendors are new; production / sales / admin already exist).
insert into dflow."Roles" ("Name", kind, parent_id, is_active)
values
  ('design',  'category', null, true),
  ('vendors', 'category', null, true)
on conflict ("Name") do update
  set kind = excluded.kind,
      is_active = excluded.is_active;

update dflow."Roles"
set kind = 'super',
    parent_id = null,
    is_active = true
where "Name" = 'admin';

update dflow."Roles"
set kind = 'category',
    parent_id = null,
    is_active = true
where "Name" in ('production', 'sales');

-- Legacy names that are not in the locked leaf set stay as leaves under their
-- category so no historical RolePermissions row loses its role.
update dflow."Roles" r
set kind = 'leaf',
    parent_id = c."Id",
    is_active = true
from dflow."Roles" c
where r."Name" = 'designer'
  and c."Name" = 'design';

update dflow."Roles" r
set kind = 'leaf',
    parent_id = c."Id",
    is_active = true
from dflow."Roles" c
where r."Name" = 'sourcing_manager'
  and c."Name" = 'production';

-- Locked leaves (exact strings — including `trading co.` and `QC`).
insert into dflow."Roles" ("Name", kind, parent_id, is_active)
select v.leaf_name, 'leaf', c."Id", true
from (
  values
    ('design',     'creative designer'),
    ('design',     'technical designer'),
    ('design',     'project manager'),
    ('production', 'sourcing'),
    ('production', 'production coordinator'),
    ('production', 'QC'),
    ('sales',      'salesperson'),
    ('sales',      'sales assistant'),
    ('vendors',    'factory'),
    ('vendors',    'trading co.')
) as v(category_name, leaf_name)
join dflow."Roles" c on c."Name" = v.category_name
on conflict ("Name") do update
  set kind = excluded.kind,
      parent_id = excluded.parent_id,
      is_active = excluded.is_active;

-- ------------------------------------------------------------------------------
-- 4. user_roles membership (people hold leaves / the admin super-role only)
-- ------------------------------------------------------------------------------

create table if not exists dflow.user_roles (
  user_id    integer not null references dflow.users(id) on delete cascade,
  role_id    integer not null references dflow."Roles"("Id") on delete cascade,
  granted_by integer references dflow.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

comment on table dflow.user_roles is
  'Multi-role membership. People hold leaf roles (and the admin super-role) only, never categories. Composite PK blocks duplicate grants.';
comment on column dflow.user_roles.granted_by is
  'User id of the grantor. NULL for the additive migration backfill.';

create index if not exists user_roles_role_id_idx
  on dflow.user_roles (role_id);

-- F3: if dflow.user_roles pre-existed, `create table if not exists` keeps its
-- columns. Assert every column's exact shape before the backfill depends on it.
-- F2: ON CONFLICT (user_id, role_id) needs the composite PK as arbiter; assert
-- it here, BEFORE the insert that uses it (not only in post-checks).
do $$
declare
  bad_shape text;
begin
  select string_agg(detail, '; ' order by detail)
    into bad_shape
  from (
    select e.column_name
           || ' expected ' || e.data_type || '/' || e.is_nullable
           || ', found '
           || coalesce(c.data_type || '/' || c.is_nullable, 'MISSING') as detail
    from (values
      ('user_id',    'integer',   'NO'),
      ('role_id',    'integer',   'NO'),
      ('granted_by', 'integer',   'YES'),
      ('granted_at', 'timestamp with time zone', 'NO')
    ) as e(column_name, data_type, is_nullable)
    left join information_schema.columns c
      on c.table_schema = 'dflow'
     and c.table_name = 'user_roles'
     and c.column_name = e.column_name
    where c.column_name is null
       or c.data_type is distinct from e.data_type
       or c.is_nullable is distinct from e.is_nullable
  ) mismatches;

  if bad_shape is not null then
    raise exception 'ABORT: dflow.user_roles column shape mismatch: %', bad_shape;
  end if;

  if not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'dflow' and tc.table_name = 'user_roles'
      and tc.constraint_type = 'PRIMARY KEY'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.ordinal_position) = array['user_id', 'role_id']
  ) then
    raise exception 'ABORT: dflow.user_roles PK is not (user_id, role_id); ON CONFLICT (user_id, role_id) cannot resolve';
  end if;
end
$$;

-- ------------------------------------------------------------------------------
-- 5. Backfill from users.level (case-normalized; values themselves untouched)
-- ------------------------------------------------------------------------------

insert into dflow.user_roles (user_id, role_id, granted_by, granted_at)
select u.id, r."Id", null, now()
from dflow.users u
join (
  values
    ('admin',            'admin'),
    ('designer',         'creative designer'),
    ('designer',         'technical designer'),
    ('designer',         'project manager'),
    ('production',       'production coordinator'),
    ('production',       'QC'),
    ('sales',            'salesperson'),
    ('sales',            'sales assistant'),
    ('sourcing_manager', 'sourcing'),
    ('vendor',           'factory')
) as map(old_level, leaf_name)
  on map.old_level = lower(trim(u.level))
join dflow."Roles" r on r."Name" = map.leaf_name
on conflict (user_id, role_id) do nothing;

-- ------------------------------------------------------------------------------
-- 6. Copy role-level RolePermissions onto categories (sourcing_manager → sourcing)
-- ------------------------------------------------------------------------------

-- Role-level rows only (`UserId IS NULL`). Per-user rows (Sample QC model) stay
-- on their existing row and keep working through the UserId override path —
-- copying those onto a category would hand the flag to everyone in the category.
--
-- Idempotency guard: ON CONFLICT cannot fire here because every inserted row has
-- UserId = NULL and the unique arbiter treats NULLs as distinct. Use NOT EXISTS
-- with Access comparison so a retry is a clean no-op.

-- F6: two role-level rows on the same (source role, ElementId) with different
-- Access are legal under the NULL-distinct unique arbiters. Any copy would be
-- an arbitrary pick. Abort rather than silently drop one.
do $$
declare
  conflicting_source text;
  conflicting_target text;
begin
  select string_agg(detail, '; ' order by detail)
    into conflicting_source
  from (
    select source."Name" || ' ElementId=' || p."ElementId"::text
           || ' Access values: ' || string_agg(p."Access"::text, ',' order by p."Access") as detail
    from dflow."RolePermissions" p
    join dflow."Roles" source on source."Id" = p."RoleId"
    where p."UserId" is null
    group by source."Name", p."ElementId"
    having count(distinct p."Access") > 1
  ) dup;

  if conflicting_source is not null then
    raise exception 'ABORT: role-level RolePermissions with conflicting Access on same (role, ElementId) — copy would be an arbitrary pick: %', conflicting_source;
  end if;

  -- F6: an existing target row with the same ElementId but different Access
  -- would silently swallow the source row via the NOT EXISTS guard. Abort
  -- rather than drop.
  select string_agg(detail, '; ' order by detail)
    into conflicting_target
  from (
    select source."Name" || '→' || target."Name"
           || ' ElementId=' || p."ElementId"::text
           || ' source.Access=' || p."Access"::text
           || ' target.Access=' || x."Access"::text as detail
    from dflow."RolePermissions" p
    join dflow."Roles" source on source."Id" = p."RoleId"
    join dflow."Roles" target
      on target."Name" = case source."Name"
           when 'designer'         then 'design'
           when 'vendor'           then 'vendors'
           when 'sourcing_manager' then 'sourcing'
           when 'production'       then 'production'
           when 'sales'            then 'sales'
         end
    join dflow."RolePermissions" x
      on x."RoleId" = target."Id"
     and x."UserId" is null
     and x."ElementId" = p."ElementId"
     and x."Access" is distinct from p."Access"
    where p."UserId" is null
      and target."Name" is distinct from source."Name"
  ) clash;

  if conflicting_target is not null then
    raise exception 'ABORT: target RolePermissions row with conflicting Access — source row would be silently dropped: %', conflicting_target;
  end if;
end
$$;

-- `select distinct` deduplicates exact-duplicate source rows; the pre-check
-- above aborts on conflicting Access, so no arbitrary pick can occur.
insert into dflow."RolePermissions" ("RoleId", "UserId", "ElementId", "Access")
select distinct target."Id", p."UserId", p."ElementId", p."Access"
from dflow."RolePermissions" p
join dflow."Roles" source on source."Id" = p."RoleId"
join dflow."Roles" target
  on target."Name" = case source."Name"
       when 'designer'         then 'design'
       when 'vendor'           then 'vendors'
       when 'sourcing_manager' then 'sourcing'
       when 'production'       then 'production'
       when 'sales'            then 'sales'
     end
where p."UserId" is null
  and target."Name" is distinct from source."Name"
  and not exists (
    select 1 from dflow."RolePermissions" x
    where x."RoleId" = target."Id"
      and x."UserId" is null
      and x."ElementId" = p."ElementId"
      and x."Access" = p."Access"
  );

-- production → production and sales → sales are name-identical: the existing
-- role-level rows already sit on the category row after the kind update above.
-- Nothing to copy. (Live 2026-10-08: zero role-level rows existed at all.)

-- ------------------------------------------------------------------------------
-- 7. Post-checks (the migration refuses to finish wrong)
-- ------------------------------------------------------------------------------

do $$
declare
  bad_tree text;
  bad_membership text;
  missing_tree text;
  wrong_grants text;
  bad_admin text;
  unreachable_copy text;
  unreachable_perms text;
begin
  -- F8 / identity-based admin check: the exact user IDs with level='admin' must
  -- be the exact user IDs holding the admin super-role (set equality, not counts).
  -- A missed admin plus an unexpected admin grant must both be caught.
  select string_agg(detail, '; ' order by detail)
    into bad_admin
  from (
    select coalesce(u.email, u.id::text || ' (no email)')
           || ' (level=' || coalesce(u.level, '<NULL>')
           || ', expected admin grant, MISSING)' as detail
    from dflow.users u
    where lower(trim(u.level)) = 'admin'
      and not exists (
        select 1 from dflow.user_roles ur
        join dflow."Roles" r on r."Id" = ur.role_id
        where ur.user_id = u.id and r."Name" = 'admin' and r.kind = 'super'
      )
    union all
    select coalesce(u.email, g.user_id::text || ' (no email)')
           || ' (level=' || coalesce(u.level, '<NULL>')
           || ', UNEXPECTED admin grant)' as detail
    from (
      select ur.user_id
      from dflow.user_roles ur
      join dflow."Roles" r on r."Id" = ur.role_id
      where r."Name" = 'admin' and r.kind = 'super'
    ) g
    left join dflow.users u on u.id = g.user_id
    where u.id is null
       or lower(trim(u.level)) is distinct from 'admin'
  ) admin_mismatch;

  if bad_admin is not null then
    raise exception 'ABORT: admin grant identity mismatch (not the same users): %', bad_admin;
  end if;

  -- H2: assert all 15 tree names plus the 2 retained legacy leaves are present
  -- (absent rows are invisible to the mis-typing check below).
  select string_agg(name, ', ' order by name)
    into missing_tree
  from (
    select unnest(array[
      'admin', 'design', 'production', 'sales', 'vendors',
      'creative designer', 'technical designer', 'project manager',
      'sourcing', 'production coordinator', 'QC',
      'salesperson', 'sales assistant',
      'factory', 'trading co.',
      'designer', 'sourcing_manager'
    ]) as name
  ) expected
  where not exists (
    select 1 from dflow."Roles" r where r."Name" = expected.name
  );

  if missing_tree is not null then
    raise exception 'ABORT: tree rows absent: %', missing_tree;
  end if;

  -- H3: verify admin and category rows have correct kind and no parent.
  select string_agg(name || ' (kind=' || coalesce(kind,'<NULL>') || ')', ', ' order by name)
    into bad_tree
  from (
    select r."Name" as name, r.kind
    from dflow."Roles" r
    where r."Name" in ('admin', 'design', 'production', 'sales', 'vendors')
      and not (
        (r."Name" = 'admin' and r.kind = 'super' and r.parent_id is null)
        or (r."Name" in ('design', 'production', 'sales', 'vendors')
            and r.kind = 'category' and r.parent_id is null)
      )
  ) wrong_kind;

  if bad_tree is not null then
    raise exception 'ABORT: admin/category rows mis-typed or parented: %', bad_tree;
  end if;

  -- H3 / F9: verify each leaf is parented to its correct category (not merely
  -- "has some parent"), including the two retained legacy leaves. The
  -- category→leaf inheritance the superset guarantee rests on requires exact
  -- parent identity.
  select string_agg(name || '→' || coalesce(parent_name, '<ORPHAN>'), ', ' order by name)
    into bad_tree
  from (
    select r."Name" as name, pr."Name" as parent_name
    from dflow."Roles" r
    left join dflow."Roles" pr on pr."Id" = r.parent_id
    where r.kind = 'leaf'
      and r."Name" in (
        'creative designer', 'technical designer', 'project manager',
        'sourcing', 'production coordinator', 'QC',
        'salesperson', 'sales assistant',
        'factory', 'trading co.',
        'designer', 'sourcing_manager'
      )
      and not (
        (r."Name" in ('creative designer', 'technical designer', 'project manager', 'designer')
         and pr."Name" = 'design')
        or (r."Name" in ('sourcing', 'production coordinator', 'QC', 'sourcing_manager')
            and pr."Name" = 'production')
        or (r."Name" in ('salesperson', 'sales assistant')
            and pr."Name" = 'sales')
        or (r."Name" in ('factory', 'trading co.')
            and pr."Name" = 'vendors')
      )
  ) wrong_parent;

  if bad_tree is not null then
    raise exception 'ABORT: leaf rows parented to wrong category: %', bad_tree;
  end if;

  select string_agg(coalesce(u.email, u.id::text || ' (no email)'), ', ' order by u.email)
    into bad_membership
  from dflow.user_roles ur
  join dflow."Roles" r on r."Id" = ur.role_id
  join dflow.users u on u.id = ur.user_id
  where r.kind = 'category';

  if bad_membership is not null then
    raise exception 'ABORT: membership on a category (people hold leaves only): %', bad_membership;
  end if;

  -- F8 / identity-based leaf grant check: each user must hold exactly the
  -- expected role names for their level (set equality in both directions,
  -- not counts). A user holding the right number of wrong leaves must fail;
  -- a pre-existing extra user_roles row must fail.
  select string_agg(detail, '; ' order by detail)
    into wrong_grants
  from (
    -- expected but missing
    select coalesce(u.email, u.id::text || ' (no email)')
           || ' (level=' || coalesce(u.level, '<NULL>')
           || ', missing ' || e.leaf_name || ')' as detail
    from dflow.users u
    join (values
      ('admin',            'admin'),
      ('designer',         'creative designer'),
      ('designer',         'technical designer'),
      ('designer',         'project manager'),
      ('production',       'production coordinator'),
      ('production',       'QC'),
      ('sales',            'salesperson'),
      ('sales',            'sales assistant'),
      ('sourcing_manager', 'sourcing'),
      ('vendor',           'factory')
    ) as e(old_level, leaf_name) on e.old_level = lower(trim(u.level))
    where not exists (
      select 1 from dflow.user_roles ur
      join dflow."Roles" r on r."Id" = ur.role_id
      where ur.user_id = u.id and r."Name" = e.leaf_name
    )
    union all
    -- unexpected extra grants
    select coalesce(u.email, u.id::text || ' (no email)')
           || ' (level=' || coalesce(u.level, '<NULL>')
           || ', unexpected ' || r."Name" || ')' as detail
    from dflow.user_roles ur
    join dflow."Roles" r on r."Id" = ur.role_id
    join dflow.users u on u.id = ur.user_id
    where (r.kind = 'leaf' or r."Name" = 'admin')
      and not exists (
        select 1 from (values
          ('admin',            'admin'),
          ('designer',         'creative designer'),
          ('designer',         'technical designer'),
          ('designer',         'project manager'),
          ('production',       'production coordinator'),
          ('production',       'QC'),
          ('sales',            'salesperson'),
          ('sales',            'sales assistant'),
          ('sourcing_manager', 'sourcing'),
          ('vendor',           'factory')
        ) as e(old_level, leaf_name)
        where e.old_level = lower(trim(u.level))
          and e.leaf_name = r."Name"
      )
  ) wrong_grant_rows;

  if wrong_grants is not null then
    raise exception 'ABORT: backfill grant identity mismatch (wrong leaf set for level): %', wrong_grants;
  end if;

  -- F7 / positive reachability of the RolePermissions copy: every role-level
  -- row's content must be present on its end-state target after the copy.
  -- Sources in the five-branch map must have a matching row on the mapped
  -- target; sources outside the map must sit on a known end-state role name.
  select string_agg(detail, '; ' order by detail)
    into unreachable_copy
  from (
    select p."Id"::text || ' (' || source."Name"
           || '→' || coalesce(m.target_name, '(self)')
           || ' ElementId=' || p."ElementId"::text
           || ' Access=' || p."Access"::text || ')' as detail
    from dflow."RolePermissions" p
    join dflow."Roles" source on source."Id" = p."RoleId"
    left join (values
      ('designer',         'design'),
      ('vendor',           'vendors'),
      ('sourcing_manager', 'sourcing'),
      ('production',       'production'),
      ('sales',            'sales')
    ) as m(source_name, target_name) on m.source_name = source."Name"
    where p."UserId" is null
      and (
        case
          when m.target_name is not null and m.target_name is distinct from source."Name"
            then not exists (
              select 1 from dflow."RolePermissions" x
              join dflow."Roles" t on t."Id" = x."RoleId"
              where t."Name" = m.target_name
                and x."UserId" is null
                and x."ElementId" = p."ElementId"
                and x."Access" = p."Access"
            )
          when m.target_name is not null
            then false  -- name-identical: already on its own target
          else source."Name" not in (
            'admin', 'design', 'production', 'sales', 'vendors',
            'creative designer', 'technical designer', 'project manager',
            'sourcing', 'production coordinator', 'QC',
            'salesperson', 'sales assistant',
            'factory', 'trading co.',
            'designer', 'sourcing_manager'
          )
        end
      )
  ) unreachable;

  if unreachable_copy is not null then
    raise exception 'ABORT: role-level RolePermissions not reachable on end-state target after copy: %', unreachable_copy;
  end if;

  -- F7 / positive reachability at the user level: every role-level permission a
  -- user could reach through their old level role must remain reachable via
  -- their new leaves, those leaves' parent categories, or the admin super-role.
  select string_agg(detail, '; ' order by detail)
    into unreachable_perms
  from (
    select coalesce(u.email, u.id::text || ' (no email)')
           || ' (level=' || coalesce(u.level, '<NULL>')
           || ', ElementId=' || p."ElementId"::text
           || ' Access=' || p."Access"::text || ')' as detail
    from dflow.users u
    join dflow."RolePermissions" p on p."UserId" is null
    join dflow."Roles" old_r on old_r."Id" = p."RoleId"
      and old_r."Name" = lower(trim(u.level))
    where not exists (
      select 1
      from dflow.user_roles ur
      join dflow."Roles" r on r."Id" = ur.role_id
      where ur.user_id = u.id
        and (
          (r."Name" = 'admin' and r.kind = 'super')
          or exists (
            select 1 from dflow."RolePermissions" x
            where x."UserId" is null
              and x."RoleId" in (r."Id", r.parent_id)
              and x."ElementId" = p."ElementId"
              and x."Access" = p."Access"
          )
        )
    )
  ) lost;

  if unreachable_perms is not null then
    raise exception 'ABORT: user lost reachable role-level permissions (superset violated): %', unreachable_perms;
  end if;
end
$$;
