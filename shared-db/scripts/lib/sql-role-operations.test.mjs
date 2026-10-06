import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  canonicalRoleName,
  validateRoleClaimTarget,
  normalizeRoleClaim,
  extractRoleOperations,
  roleCollisionKeys,
  roleOwnershipDependencies,
  findDynamicRoleMutations,
  assertNoDynamicRoleMutations,
  RoleExtractionError,
  RoleClaimError,
} from './sql-role-operations.mjs'

test('membership grantors preserve exact identity through literal and executed SQL', () => {
  for (const statement of ['GRANT a TO b WITH ADMIN TRUE, INHERIT FALSE, SET TRUE GRANTED BY "Two  Spaces";', 'REVOKE ADMIN OPTION FOR a FROM b GRANTED BY "Two  Spaces" CASCADE;']) {
    for (const sql of [statement, `DO $$ BEGIN EXECUTE '${statement}'; END $$;`]) {
      const operations = extractRoleOperations(sql).operations
      assert.equal(operations[0].grantor, '"Two  Spaces"')
      assert.deepEqual(roleCollisionKeys(sql), ['role a', 'role b'])
    }
  }
  assert.equal(extractRoleOperations('GRANT a TO b GRANTED BY c; GRANT a TO b GRANTED BY d;').operations.length, 2)
})

test('implicit or unsupported membership grantors refuse partial role accounting', () => {
  for (const grantor of ['CURRENT_USER', 'CURRENT_ROLE', 'SESSION_USER', 'core.worker', 'U&"worker"', 'x'.repeat(64)]) {
    for (const sql of [`GRANT a TO b GRANTED BY ${grantor};`, `REVOKE a FROM b GRANTED BY ${grantor};`]) {
      assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
      assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
    }
  }
  assert.equal(extractRoleOperations('GRANT a TO b GRANTED BY "current_user";').operations[0].grantor, 'current_user')
})

test('unsupported full role names never become ASCII prefixes in membership or authorization', () => {
  for (const role of ['bé', 'β', 'core.worker', 'U&"worker"', 'x'.repeat(64)]) {
    for (const statement of [`GRANT a TO ${role};`, `GRANT ${role} TO a;`, `REVOKE a FROM b, ${role};`, `CREATE ROLE a IN ROLE ${role};`, `CREATE ROLE a ADMIN ${role};`, `ALTER GROUP a ADD USER ${role};`, `CREATE SCHEMA s AUTHORIZATION ${role};`, `CREATE SCHEMA AUTHORIZATION ${role};`, `CREATE DATABASE d OWNER ${role};`]) {
      for (const sql of [statement, `DO $$ BEGIN EXECUTE '${statement}'; END $$;`]) {
        assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
        assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
        assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError, sql)
      }
    }
  }
  assert.equal(canonicalRoleName('"a\0b"'), null)
  assert.throws(() => validateRoleClaimTarget('"a\0b"'), RoleClaimError)
})

test('implicit roles in CREATE ROLE options and legacy group membership refuse', () => {
  for (const actor of ['CURRENT_USER', 'CURRENT_ROLE', 'SESSION_USER', 'PUBLIC']) {
    for (const sql of [`CREATE ROLE worker IN ROLE ${actor};`, `CREATE ROLE worker ADMIN ${actor};`, `ALTER GROUP worker ADD USER ${actor};`]) assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
  }
})

test('unaccountable ownership object names cannot hide an exact role dependency', () => {
  for (const statement of ['ALTER TABLE core.β OWNER TO worker;', 'ALTER FUNCTION core.β() OWNER TO worker;', 'ALTER TABLE core.β OWNER TO CURRENT_USER;']) {
    for (const sql of [statement, `DO $$ BEGIN EXECUTE '${statement}'; END $$;`]) {
      assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError)
      assert.throws(() => roleCollisionKeys(sql), RoleExtractionError)
    }
  }
})

test('quoted role text containing ALTER ROLE ALL does not trigger a global mutation refusal', () => {
  for (const statement of ['CREATE ROLE "ALTER ROLE ALL";', 'ALTER ROLE "ALTER ROLE ALL" NOLOGIN;', 'DROP ROLE "ALTER ROLE ALL";']) {
    assert.deepEqual(roleCollisionKeys(statement), ['role "ALTER ROLE ALL"'])
    assert.deepEqual(roleCollisionKeys(`DO $$ BEGIN EXECUTE '${statement}'; END $$;`), ['role "ALTER ROLE ALL"'])
  }
  assert.throws(() => roleCollisionKeys('ALTER ROLE ALL SET search_path = public;'), RoleExtractionError)
})

// ---------------------------------------------------------------------------
// Exact global role identity — quoted case preserved, unquoted folded,
// schema-qualified refused. Roles are cluster-global: one name, no schema.
// ---------------------------------------------------------------------------
test('exact global role identity preserves quoted case and folds unquoted', () => {
  assert.equal(canonicalRoleName('pm_jev_triage_worker'), 'pm_jev_triage_worker')
  assert.equal(canonicalRoleName('MyRole'), 'myrole') // unquoted folds to lowercase
  assert.equal(canonicalRoleName('myrole'), 'myrole')
  assert.equal(canonicalRoleName('"myrole"'), 'myrole') // quoted-lowercase == unquoted
  assert.equal(canonicalRoleName('"MyRole"'), '"MyRole"') // quoted case preserved
  assert.equal(canonicalRoleName('"PM_JEV_TRIAGE_WORKER"'), '"PM_JEV_TRIAGE_WORKER"')
  assert.equal(canonicalRoleName('"a""b"'), '"a""b"') // internal quote unescaped, then re-quoted
})

test('quoted role whitespace stays exact in SQL operations and claims', () => {
  assert.deepEqual(roleCollisionKeys('create role "My  Role";'), ['role "My  Role"'])
  assert.deepEqual(roleCollisionKeys('create role "My Role";'), ['role "My Role"'])
  assert.notDeepEqual(roleCollisionKeys('create role "My  Role";'), roleCollisionKeys('create role "My Role";'))
  assert.equal(normalizeRoleClaim('role "My  Role"'), 'role "My  Role"')
  assert.equal(normalizeRoleClaim('role "My Role"'), 'role "My Role"')
})

test('comment markers inside quoted role names are identifier text', () => {
  assert.deepEqual(roleCollisionKeys('create role "a--b";'), ['role "a--b"'])
  assert.deepEqual(roleCollisionKeys('create role "a/*b*/c";'), ['role "a/*b*/c"'])
  assert.deepEqual(roleCollisionKeys('do $$ begin create role "a--b"; end $$;'), ['role "a--b"'])
})

test('a broad schema claim is not a reservation on a global role', () => {
  // Schema-qualified names are not single global roles.
  assert.equal(canonicalRoleName('public.pm_jev_triage_worker'), null)
  assert.equal(canonicalRoleName('schema.role'), null)
  assert.equal(canonicalRoleName(''), null)
  assert.equal(canonicalRoleName('   '), null)
  assert.equal(canonicalRoleName('1bad'), null)
  // The role key namespace is distinct from the schema key namespace.
  assert.deepEqual(roleCollisionKeys('create role shared'), ['role shared'])
  assert.notDeepEqual(roleCollisionKeys('create role shared'), ['schema shared'])
})

// ---------------------------------------------------------------------------
// Claim support: `role <name>` is a valid exact global claim.
// ---------------------------------------------------------------------------
test('role claims normalize to exact global identity and reject bad forms', () => {
  assert.equal(normalizeRoleClaim('role pm_jev_triage_worker'), 'role pm_jev_triage_worker')
  assert.equal(normalizeRoleClaim('  role   MyRole '), 'role myrole')
  assert.equal(normalizeRoleClaim('role "MyRole"'), 'role "MyRole"')
  assert.equal(validateRoleClaimTarget('pm_jev_triage_worker'), 'pm_jev_triage_worker')
  assert.throws(() => normalizeRoleClaim('role public.worker'), RoleClaimError) // schema-qualified
  assert.throws(() => normalizeRoleClaim('role'), RoleClaimError) // no target
  assert.throws(() => normalizeRoleClaim('table core.x'), RoleClaimError) // wrong kind
  assert.throws(() => validateRoleClaimTarget('a.b'), RoleClaimError)
})

// ---------------------------------------------------------------------------
// CREATE / ALTER / DROP ROLE extraction.
// ---------------------------------------------------------------------------
test('create, alter and drop role are each accounted on the exact role', () => {
  const ops = extractRoleOperations(`
    create role worker nologin;
    alter role worker nologin;
    drop role worker;
  `).operations
  const actions = ops.map((o) => `${o.action}:${o.target}`).sort()
  assert.deepEqual(actions, ['alter:worker', 'create:worker', 'drop:worker'])
  assert.deepEqual(roleCollisionKeys('create role worker nologin;'), ['role worker'])
})

test('drop role lists emit one operation per name', () => {
  const ops = extractRoleOperations('drop role if exists a, b, "C";').operations
  assert.deepEqual(ops.map((o) => o.target).sort(), ['"C"', 'a', 'b'])
})

test('USER and GROUP spellings are the same role command and are not skipped', () => {
  assert.deepEqual(roleCollisionKeys('create user worker;'), ['role worker'])
  assert.deepEqual(roleCollisionKeys('alter group worker nologin;'), ['role worker'])
  assert.deepEqual(roleCollisionKeys('drop user worker;'), ['role worker'])
})

test('USER MAPPING and empty quoted identifiers invent no role', () => {
  for (const sql of [
    'create user mapping for alice server srv;',
    'drop user mapping if exists for alice server srv;',
    'alter user mapping for alice server srv options (add a b);',
  ]) {
    assert.deepEqual(extractRoleOperations(sql).operations, [])
    assert.deepEqual(roleCollisionKeys(sql), [])
  }
  assert.equal(canonicalRoleName('""'), null)
  assert.throws(() => roleCollisionKeys('create role "";'), RoleExtractionError)
  assert.throws(() => extractRoleOperations('create role "";'), RoleExtractionError)
  assert.deepEqual(roleCollisionKeys("do $$ begin execute 'create user mapping for alice server srv'; end $$;"), [])
})

test('ALTER ROLE ALL refuses its non-exact global target in every extractor', () => {
  // ALTER ROLE ALL touches every role at once: there is no exact target, so a
  // silent empty result from any extractor would be a false clear. The old
  // expectation (extractRoleOperations returning []) hid exactly that; all
  // three extractors share one fail-closed core now.
  assert.throws(() => roleCollisionKeys('alter role all set work_mem=1;'), RoleExtractionError)
  assert.throws(() => extractRoleOperations('alter role all set work_mem=1;'), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies('alter role all set work_mem=1;'), RoleExtractionError)
  assert.deepEqual(roleCollisionKeys('alter role "all" set work_mem=1;'), ['role all'])
  for (const alias of ['user', 'group']) {
    assert.throws(() => roleCollisionKeys(`alter ${alias} all set work_mem=1;`), RoleExtractionError)
    assert.throws(() => extractRoleOperations(`alter ${alias} all set work_mem=1;`), RoleExtractionError)
    assert.throws(() => roleOwnershipDependencies(`alter ${alias} all set work_mem=1;`), RoleExtractionError)
  }
})

// ---------------------------------------------------------------------------
// Rename: BOTH identities reserved, but never aliased into one.
// ---------------------------------------------------------------------------
test('rename reserves both old and new identities and keeps them independent', () => {
  const ops = extractRoleOperations('alter role old_name rename to new_name;').operations
  assert.equal(ops.length, 1)
  assert.deepEqual({ action: ops[0].action, from: ops[0].from, to: ops[0].to }, { action: 'rename', from: 'old_name', to: 'new_name' })
  // Both are reserved (would collide with any other write to either)…
  assert.deepEqual(roleCollisionKeys('alter role old_name rename to new_name;'), ['role new_name', 'role old_name'])
  // …but they remain two DISTINCT identities (no alias collapse): only the new
  // name overlaps with a separate `create role new_name`, never the old name.
  const c1 = roleCollisionKeys('alter role old_name rename to new_name;')
  const c2 = roleCollisionKeys('create role new_name;')
  assert.deepEqual(c1.filter((k) => c2.includes(k)), ['role new_name'])
  assert.deepEqual(roleCollisionKeys('create role old_name;').filter((k) => c2.includes(k)), [])
})

// ---------------------------------------------------------------------------
// Membership GRANT/REVOKE — connects distinct roles, never merges them.
// ---------------------------------------------------------------------------
test('membership grant/revoke account every named role and keep them distinct', () => {
  const g = extractRoleOperations('grant worker to app_group;').operations
  assert.equal(g.length, 1)
  assert.equal(g[0].action, 'grant_membership')
  assert.deepEqual(g[0].members, ['worker'])
  assert.deepEqual(g[0].grantees, ['app_group'])
  // Both roles reserved…
  assert.deepEqual(roleCollisionKeys('grant worker to app_group;'), ['role app_group', 'role worker'])
  // …yet independent: `grant a to b` and `create role a` collide on `role a` only.
  const mKeys = roleCollisionKeys('grant worker to app_group;')
  const aKeys = roleCollisionKeys('create role worker;')
  assert.deepEqual(mKeys.filter((k) => aKeys.includes(k)), ['role worker'])
  assert.deepEqual(roleCollisionKeys('revoke worker from app_group;').sort(), ['role app_group', 'role worker'])
})

test('multi-role membership lists account each role once', () => {
  const keys = roleCollisionKeys('grant r1, r2 to g1, g2;')
  assert.deepEqual(keys, ['role g1', 'role g2', 'role r1', 'role r2'])
})

test('legacy ALTER GROUP and CREATE ROLE IN ROLE membership reserve both sides', () => {
  assert.deepEqual(roleCollisionKeys('alter group g add user u, v;'), ['role g', 'role u', 'role v'])
  assert.deepEqual(roleCollisionKeys('alter group g drop user u;'), ['role g', 'role u'])
  assert.deepEqual(roleCollisionKeys('create role x in role y;'), ['role x', 'role y'])
  assert.deepEqual(roleCollisionKeys('create role x in group y, z;'), ['role x', 'role y', 'role z'])
})

test('CREATE ROLE ROLE/ADMIN/USER options account the linked role', () => {
  // IN ROLE / IN GROUP is not the only membership spelling: bare ROLE, ADMIN
  // and USER options are all valid PostgreSQL that link their list to the
  // created role. Each linked name must be accounted, exactly like IN ROLE.
  assert.deepEqual(roleCollisionKeys('create role x role y;'), ['role x', 'role y'])
  assert.deepEqual(roleCollisionKeys('create role x admin y, z;'), ['role x', 'role y', 'role z'])
  assert.deepEqual(roleCollisionKeys('create role x user y;'), ['role x', 'role y'])
  assert.deepEqual(roleCollisionKeys('create user u admin v;'), ['role u', 'role v'])
  assert.deepEqual(roleCollisionKeys('create role x in role y admin z;'), ['role x', 'role y', 'role z'])
  const ops = extractRoleOperations('create role x admin y;').operations
  assert.deepEqual(ops.map((o) => `${o.action}:${o.target}`).sort(), ['create:x', 'grant_membership:x y'])
})

test('privilege grants are never mistaken for role membership', () => {
  // `on` before the connector ⇒ privilege grant, not membership.
  assert.deepEqual(roleCollisionKeys('grant select on table t to r;'), [])
  assert.deepEqual(roleCollisionKeys('grant all on schema s to r;'), [])
  assert.deepEqual(roleCollisionKeys('revoke insert on table t from r;'), [])
  assert.deepEqual(extractRoleOperations('grant select on table t to r;').operations, [])
})

test('special grantees and privilege keywords never become role names', () => {
  assert.deepEqual(roleCollisionKeys('grant select, insert to public;'), [])
  assert.deepEqual(roleCollisionKeys('revoke all from current_user;'), [])
})

test('membership with an implicit or reserved counterpart refuses partial accounting', () => {
  for (const sql of ['GRANT worker TO PUBLIC;', 'REVOKE worker FROM PUBLIC;', 'GRANT worker TO CURRENT_USER;', 'REVOKE worker FROM CURRENT_ROLE;', 'GRANT PUBLIC TO worker;', 'GRANT worker TO app_group, CURRENT_USER;']) {
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError)
    assert.throws(() => extractRoleOperations(sql), RoleExtractionError)
  }
  assert.deepEqual(roleCollisionKeys('grant all to worker;'), [])
})

test('membership with two implicit actors refuses literal and executed SQL', () => {
  for (const member of ['CURRENT_USER', 'CURRENT_ROLE', 'SESSION_USER']) {
    for (const grantee of ['CURRENT_USER', 'CURRENT_ROLE', 'SESSION_USER']) {
      for (const statement of [`GRANT ${member} TO ${grantee};`, `REVOKE ${member} FROM ${grantee};`]) {
        for (const sql of [statement, `DO $$ BEGIN EXECUTE '${statement}'; END $$;`]) {
          for (const extract of [extractRoleOperations, roleCollisionKeys, roleOwnershipDependencies]) assert.throws(() => extract(sql), RoleExtractionError, sql)
        }
      }
    }
  }
})

test('quoted names that spell keywords remain real roles', () => {
  assert.deepEqual(roleCollisionKeys('grant "select" to worker;'), ['role select', 'role worker'])
  assert.deepEqual(roleCollisionKeys('grant member to "PUBLIC";'), ['role "PUBLIC"', 'role member'])
  assert.deepEqual(roleOwnershipDependencies('alter table t owner to "current_user";').map((d) => d.role), ['current_user'])
})

// ---------------------------------------------------------------------------
// Same-role conflicts and distinct-role independence.
// ---------------------------------------------------------------------------
test('same role conflicts across spellings; distinct roles stay independent', () => {
  const sameA = roleCollisionKeys('create role a;')
  const sameB = roleCollisionKeys('alter role a nologin;')
  assert.deepEqual(sameA, ['role a'])
  assert.deepEqual(sameB, ['role a'])
  assert.deepEqual(sameA.filter((k) => sameB.includes(k)), ['role a']) // SAME role ⇒ conflict
  const distinct = roleCollisionKeys('create role a; create role b;')
  assert.deepEqual(distinct, ['role a', 'role b'])
  const other = roleCollisionKeys('create role c;')
  assert.deepEqual(distinct.filter((k) => other.includes(k)), []) // distinct ⇒ independent
})

// ---------------------------------------------------------------------------
// Ownership dependencies — recorded, but NEVER an exclusive write on the role.
// ---------------------------------------------------------------------------
test('function/table ownership is a dependency on the role, not a write to it', () => {
  const sql = 'alter function pim.worker() owner to pm_jev_triage_worker; alter table pim.triage owner to pm_jev_triage_worker;'
  const deps = roleOwnershipDependencies(sql)
  assert.equal(deps.length, 2)
  assert.deepEqual(deps.map((d) => `${d.ownerKind}:${d.role}`).sort(), ['function:pm_jev_triage_worker', 'table:pm_jev_triage_worker'])
  // CRITICAL: the role is NOT reserved as an exclusive write.
  assert.deepEqual(roleCollisionKeys(sql), [])
  // Two migrations that each own a different object to the same role do not
  // collide with each other on that role.
  const k1 = roleCollisionKeys('alter function a() owner to shared;')
  const k2 = roleCollisionKeys('alter table b owner to shared;')
  assert.deepEqual(k1.filter((x) => k2.includes(x)), [])
})

test('ownership dependency does not collide with a role write, but is still recorded', () => {
  // A drop of the role is a write; the dependency is not. A consumer can pair
  // them to detect "drop a role an object depends on" without the dependency
  // itself reserving the role.
  assert.deepEqual(roleCollisionKeys('drop role shared;'), ['role shared'])
  assert.deepEqual(roleCollisionKeys('alter table t owner to shared;'), [])
  assert.equal(roleOwnershipDependencies('alter table t owner to shared;')[0].role, 'shared')
})

test('bare schema authorization and equals-sign database owner are dependencies', () => {
  for (const [sql, expectedKind, expectedRole] of [
    ['create schema authorization r;', 'schema', 'r'],
    ['create schema if not exists authorization r;', 'schema', 'r'],
    ['create database d owner = r;', 'database', 'r'],
    ['create database d with owner = r;', 'database', 'r'],
    ['alter table if exists t owner to r;', 'table', 'r'],
    ['alter function if exists f() owner to r;', 'function', 'r'],
  ]) {
    assert.deepEqual(roleCollisionKeys(sql), [], sql)
    assert.deepEqual(roleOwnershipDependencies(sql).map((d) => `${d.ownerKind}:${d.role}`), [`${expectedKind}:${expectedRole}`], sql)
  }
  assert.throws(() => roleOwnershipDependencies('create schema authorization current_user;'), RoleExtractionError)
})

test('exact EXECUTEd ownership literals match their static dependencies', () => {
  for (const [literal, dynamic] of [
    ['create database d owner = r;', "do $$ begin execute 'create database d owner = r'; end $$;"],
    ['create database d with owner = r;', "do $$ begin execute 'create database d with owner = r'; end $$;"],
    ['create schema if not exists authorization r;', "do $$ begin execute 'create schema if not exists authorization r'; end $$;"],
  ]) {
    assert.deepEqual(roleOwnershipDependencies(dynamic), roleOwnershipDependencies(literal), dynamic)
    assert.deepEqual(roleCollisionKeys(dynamic), [], dynamic)
  }
  for (const sql of [
    "do $$ begin execute format('alter table t owner to %I', r); end $$;",
    "do $$ begin execute format('create schema authorization %I', r); end $$;",
    "do $$ begin execute format('create database d with owner = %I', r); end $$;",
  ]) {
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
    assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
    assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError, sql)
  }
})

test('ownership dependency recognizes ONLY and nested function argument types', () => {
  assert.deepEqual(roleOwnershipDependencies('alter table only t owner to r;').map((d) => d.role), ['r'])
  assert.deepEqual(roleOwnershipDependencies('alter function f(numeric(10,2)) owner to r;').map((d) => d.role), ['r'])
})

test('owner to CURRENT_USER records no named role dependency', () => {
  assert.throws(() => roleOwnershipDependencies('alter table t owner to current_user;'), RoleExtractionError)
})

// ---------------------------------------------------------------------------
// Literal DO handling — role DDL inside a top-level DO block is migration-time.
// ---------------------------------------------------------------------------
test('literal role DDL inside a DO block is extracted', () => {
  const sql = `do $$
  begin
    create role designflow_hts_prod_worker nologin;
    alter role designflow_hts_prod_worker nologin;
  end $$;`
  const keys = roleCollisionKeys(sql)
  assert.deepEqual(keys, ['role designflow_hts_prod_worker'])
  const ops = extractRoleOperations(sql).operations.map((o) => o.action).sort()
  assert.deepEqual(ops, ['alter', 'create'])
})

// ---------------------------------------------------------------------------
// Dynamic role mutations are REFUSED (fail closed), never skipped.
// ---------------------------------------------------------------------------
test('dynamic role DDL hidden in an EXECUTE/format string fails closed', () => {
  const sql = `do $$
  begin
    execute format('create role %I', 'sneaky');
  end $$;`
  const found = findDynamicRoleMutations(sql)
  assert.equal(found.length, 1)
  assert.match(found[0].text, /create role/i)
  assert.throws(() => assertNoDynamicRoleMutations(sql), RoleExtractionError)
  assert.throws(() => roleCollisionKeys(sql), RoleExtractionError) // refuse, not "clear"
})

test('nested dollar-quoted dynamic role SQL keeps exact targets and refuses unknown ones', () => {
  assert.deepEqual(roleCollisionKeys('do $$ begin execute $sql$create role dynamic_worker$sql$; end $$;'), ['role dynamic_worker'])
  const unknown = 'do $$ begin execute format($sql$create role %I$sql$, role_name); end $$;'
  assert.equal(findDynamicRoleMutations(unknown).length, 1)
  assert.throws(() => roleCollisionKeys(unknown), RoleExtractionError)
})

test('dynamic role DDL in a concatenated EXECUTE string fails closed', () => {
  const sql = `do $$ begin execute 'alter role ' || quote_ident(r) || ' nologin'; end $$;`
  assert.throws(() => roleCollisionKeys(sql), RoleExtractionError)
  assert.throws(() => extractRoleOperations(sql), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError)
  const split = `do $$ begin execute 'alter ' || 'role ' || quote_ident(r) || ' nologin'; end $$;`
  assert.throws(() => roleCollisionKeys(split), RoleExtractionError)
  const mixed = `do $$ begin execute 'alter role fixed nologin'; execute 'create ' || 'role ' || quote_ident(r); end $$;`
  assert.throws(() => roleCollisionKeys(mixed), RoleExtractionError)
})

test('dynamic membership DDL with exact targets is accounted', () => {
  const sql = `do $$ begin execute 'grant worker to app_group'; end $$;`
  assert.deepEqual(roleCollisionKeys(sql), ['role app_group', 'role worker'])
})

test('a command fragmented across concatenation never false-clears', () => {
  // The verb itself is split across `||`, so no single fragment is
  // verb-leading. Every exported extractor must refuse rather than report
  // "touches no role".
  const split = `do $$ begin execute 'c' || 'reate' || ' rol' || 'e x'; end $$;`
  assert.equal(findDynamicRoleMutations(split).filter((f) => f.kind === 'fragmented-execute').length, 1)
  assert.throws(() => roleCollisionKeys(split), RoleExtractionError)
  assert.throws(() => extractRoleOperations(split), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies(split), RoleExtractionError)
  // Same for fragments inside a format payload and inside dollar quoting.
  const fragFormat = `do $$ begin execute format('cre' || 'ate role %I', r); end $$;`
  assert.throws(() => roleCollisionKeys(fragFormat), RoleExtractionError)
  assert.throws(() => extractRoleOperations(fragFormat), RoleExtractionError)
  const fragDollar = `do $$ begin execute $a$cre$a$ || $b$ate role x$b$; end $$;`
  assert.throws(() => roleCollisionKeys(fragDollar), RoleExtractionError)
  assert.throws(() => extractRoleOperations(fragDollar), RoleExtractionError)
  // Two adjacent fully-literal statements still resolve without cross-talk.
  assert.deepEqual(roleCollisionKeys(`do $$ begin execute 'create role a'; execute 'select 1'; end $$;`), ['role a'])
})

test('mixed single-quoted and dollar-quoted EXECUTE fragments refuse', () => {
  for (const sql of [
    "do $$ begin execute 'cre' || $a$ate role x$a$; end $$;",
    "do $$ begin execute $a$cre$a$ || 'ate role x'; end $$;",
    "do $$ begin execute 'gra' || $a$nt worker to app$a$; end $$;",
  ]) {
    assert.ok(findDynamicRoleMutations(sql).some((item) => item.kind === 'fragmented-execute'), sql)
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
    assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
    assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError, sql)
  }
})

test('format placeholders within or before a role verb never false-clear', () => {
  for (const sql of [
    "do $$ begin execute format('cre%ste role x', 'a'); end $$;",
    "do $$ begin execute format('%screate role x', ''); end $$;",
    "do $$ begin execute format('%s role x', 'create'); end $$;",
    "do $$ begin execute format('cre%s' || $a$te role x$a$, 'a'); end $$;",
    "do $$ begin execute 'cre' || chr(97) || $a$te role x$a$; end $$;",
  ]) {
    assert.ok(findDynamicRoleMutations(sql).length > 0, sql)
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
    assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
    assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError, sql)
  }
})

test('a complete-looking prefix cannot clear a concatenated role target', () => {
  for (const sql of [
    `do $$ begin execute 'create role x' || '_suffix'; end $$;`,
    `do $$ begin execute 'create role x' || suffix; end $$;`,
    `do $$ begin execute 'create role x'::text || '_suffix'; end $$;`,
    `do $$ begin execute 'grant worker to app' || '_group'; end $$;`,
    `do $$ begin execute 'alter table t owner to app' || '_owner'; end $$;`,
    `do $$ begin execute format('create role x%s', suffix); end $$;`,
    `do $$ begin execute format('create role x%1$s', suffix); end $$;`,
    `do $$ begin execute format('alter table t owner to app%s', suffix); end $$;`,
  ]) {
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
    assert.throws(() => extractRoleOperations(sql), RoleExtractionError, sql)
    assert.throws(() => roleOwnershipDependencies(sql), RoleExtractionError, sql)
  }
})

test('a safely quoted setting value preserves the exact historical role target', () => {
  const sql = `do $$ begin execute 'alter role authenticator set pgrst.db_schemas = '
    || quote_literal('public, graphql_public'); end $$;`
  assert.deepEqual(roleCollisionKeys(sql), ['role authenticator'])
  assert.deepEqual(extractRoleOperations(sql).operations.map((op) => op.target), ['authenticator'])
  assert.deepEqual(roleOwnershipDependencies(sql), [])
  // Unknown expressions and identifiers in the suffix do not meet the narrow
  // quote_literal exception, even though the first fragment looks complete.
  assert.throws(() => roleCollisionKeys(`do $$ begin execute 'alter role authenticator set pgrst.db_schemas = ' || suffix; end $$;`), RoleExtractionError)
})

test('known-literal EXECUTE resolves identically in every extractor', () => {
  // An EXECUTEd exact literal means what it says, in operations, keys, and
  // (empty) dependencies alike — the checked-in authenticator shape.
  const sql = `do $$ begin execute 'alter role authenticator nologin'; end $$;`
  assert.deepEqual(roleCollisionKeys(sql), ['role authenticator'])
  assert.deepEqual(extractRoleOperations(sql).operations.map((o) => `${o.action}:${o.target}`), ['alter:authenticator'])
  assert.deepEqual(roleOwnershipDependencies(sql), [])
  assert.deepEqual(extractRoleOperations(sql).dynamicRefusals, [])
  // A placeholder literal has no exact target: every extractor refuses it.
  const unknown = `do $$ begin execute format('create role %I', r); end $$;`
  assert.throws(() => roleCollisionKeys(unknown), RoleExtractionError)
  assert.throws(() => extractRoleOperations(unknown), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies(unknown), RoleExtractionError)
  // Dollar-quoted format payloads refuse the same way — never silent-empty.
  const dollarUnknown = 'do $$ begin execute format($f$create role %I$f$, r); end $$;'
  assert.throws(() => roleCollisionKeys(dollarUnknown), RoleExtractionError)
  assert.throws(() => extractRoleOperations(dollarUnknown), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies(dollarUnknown), RoleExtractionError)
  // A membership literal with an unparseable side must not lose its named role.
  const halfKnown = `do $$ begin execute 'grant %I to app'; end $$;`
  assert.throws(() => roleCollisionKeys(halfKnown), RoleExtractionError)
  assert.throws(() => extractRoleOperations(halfKnown), RoleExtractionError)
  // SELECT is reserved and this malformed SQL has no exact membership result.
  // INSERT is a valid role name, so an executed ambiguous mixture must refuse.
  const keywordOnly = `do $$ begin execute 'grant select, insert to public'; end $$;`
  assert.throws(() => roleCollisionKeys(keywordOnly), RoleExtractionError)
  assert.throws(() => extractRoleOperations(keywordOnly), RoleExtractionError)
})

test('ownership changes inside resolved literal dynamic SQL stay visible', () => {
  // An EXECUTEd exact ownership statement is not a write (keys stay empty,
  // exactly like the literal path) but its dependency must be visible through
  // every extractor that reports dependencies.
  const sql = `do $$ begin execute 'alter table t owner to r'; end $$;`
  assert.deepEqual(roleCollisionKeys(sql), [])
  assert.deepEqual(roleOwnershipDependencies(sql).map((d) => `${d.ownerKind}:${d.role}`), ['table:r'])
  const full = extractRoleOperations(sql)
  assert.deepEqual(full.operations, [])
  assert.equal(full.ownershipDependencies.length, 1)
  assert.deepEqual(full.dynamicRefusals, [])
  // Implicit or reserved counterparts cannot be partially accounted.
  const grantDyn = `do $$ begin execute 'grant worker to public'; end $$;`
  assert.throws(() => roleCollisionKeys(grantDyn), RoleExtractionError)
  // OWNER TO CURRENT_USER has no fixed identity and must refuse.
  const self = `do $$ begin execute 'alter table t owner to current_user'; end $$;`
  assert.throws(() => roleCollisionKeys(self), RoleExtractionError)
  assert.throws(() => roleOwnershipDependencies(self), RoleExtractionError)
  // A non-executed ownership lookalike is refused, like role-DDL prose.
  assert.throws(() => roleCollisionKeys(`comment on table t is 'alter table x owner to r'`), RoleExtractionError)
})

test('existing dynamic ALTER ROLE authenticator migration has an exact key', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20260621151419_crm_rls_realtime.sql', import.meta.url), 'utf8')
  assert.deepEqual(roleCollisionKeys(migration), ['role authenticator'])
})

test('every checked-in migration remains accountable by the role helper', () => {
  const folder = new URL('../../supabase/migrations/', import.meta.url)
  for (const name of readdirSync(folder).filter((file) => file.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, folder), 'utf8')
    assert.doesNotThrow(() => roleCollisionKeys(sql), name)
    // The other extractors share the same fail-closed core: read the full
    // operation/dependency shape too, attributing any refusal to the file
    // instead of masking it.
    assert.doesNotThrow(() => extractRoleOperations(sql), name)
    assert.doesNotThrow(() => roleOwnershipDependencies(sql), name)
  }
})

test('prose that merely mentions grant/role is not a dynamic role mutation', () => {
  // Mid-sentence prose and privilege-shaped text must not trip the refusal.
  assert.deepEqual(findDynamicRoleMutations(`comment on table t is 'roles do not grant read on their own'`), [])
  assert.deepEqual(findDynamicRoleMutations(`do $$ begin raise notice 'create a role for auditing'; end $$;`), [])
  assert.deepEqual(findDynamicRoleMutations(`do $$ begin raise notice 'we create role x for audit later'; end $$;`), [])
  assert.deepEqual(findDynamicRoleMutations(`do $$ begin execute 'grant select on t to r'; end $$;`), []) // privilege, not membership
  // No dynamic mutation ⇒ the literal path is clean.
  assert.deepEqual(roleCollisionKeys(`comment on table t is 'we create role x for audit later'`), [])
})

test('a string holding an exact role DDL statement is refused as dynamic', () => {
  // A string whose content IS a role statement is indistinguishable from SQL
  // that would be EXECUTEd; fail closed rather than guess it is prose.
  assert.throws(() => roleCollisionKeys(`comment on table t is 'create role x'`), RoleExtractionError)
})

test('role DDL written literally inside a function body is deferred, not a migration axis', () => {
  // Consistent with the collision parser blanking function bodies: a role DDL in
  // a non-DO body runs at call time, not migration time.
  const sql = `create function f() returns void language plpgsql as $fn$ begin perform 1; end $fn$;`
  assert.deepEqual(findDynamicRoleMutations(sql), [])
  assert.deepEqual(roleCollisionKeys(sql), [])
})

// ---------------------------------------------------------------------------
// No synthetic evidence, no count caps.
// ---------------------------------------------------------------------------
test('empty / non-role SQL yields no operations and no fabricated keys', () => {
  assert.deepEqual(roleCollisionKeys('select 1;'), [])
  assert.deepEqual(extractRoleOperations('create table t();').operations, [])
  assert.deepEqual(roleOwnershipDependencies('create table t();'), [])
})

test('many distinct roles are all tracked with no cap', () => {
  const many = Array.from({ length: 50 }, (_, i) => `create role r${i};`).join(' ')
  const keys = roleCollisionKeys(many)
  assert.equal(keys.length, 50)
  assert.deepEqual(keys, Array.from({ length: 50 }, (_, i) => `role r${i}`).sort())
})

// ---------------------------------------------------------------------------
// Real-world shape: the four NOLOGIN roles from migration 20260911210709.
// ---------------------------------------------------------------------------
test('the four NOLOGIN least-privilege roles are each reserved distinctly', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20260911210709_hts_rag_shared_schema_least_privilege_roles.sql', import.meta.url), 'utf8')
  const keys = roleCollisionKeys(sql)
  assert.deepEqual(keys, [
    'role designflow_hts_alsand_runtime',
    'role designflow_hts_alsand_worker',
    'role designflow_hts_prod_runtime',
    'role designflow_hts_prod_worker',
  ])
  // A claim for ONE of them must be a valid exact global role…
  assert.equal(normalizeRoleClaim('role designflow_hts_prod_worker'), 'role designflow_hts_prod_worker')
  // …and a second migration touching the SAME role collides, while a distinct
  // role does not.
  const same = roleCollisionKeys('alter role designflow_hts_prod_worker nologin;')
  assert.deepEqual(same.filter((k) => keys.includes(k)), ['role designflow_hts_prod_worker'])
  const distinct = roleCollisionKeys('create role pm_jev_triage_worker;')
  assert.deepEqual(distinct.filter((k) => keys.includes(k)), [])
})


test('quoted identifier contents never create phantom command or membership keys', () => {
  for (const name of ['x alter role z', 'x grant a to b', 'x role member', 'x; role y', 'x--b', 'x/*b*/']) {
    assert.deepEqual(roleCollisionKeys(`CREATE ROLE "${name}";`), [`role "${name}"`])
  }
})

test('valid numbered dollar tags retain literal DO role writes and executed strings', () => {
  assert.deepEqual(roleCollisionKeys('DO $do1$ BEGIN CREATE ROLE "Worker"; END $do1$;'), ['role "Worker"'])
  assert.deepEqual(roleCollisionKeys('DO $do1$ BEGIN EXECUTE $sql2$CREATE ROLE worker$sql2$; END $do1$;'), ['role worker'])
  assert.deepEqual(roleCollisionKeys('EXECUTE $sql2$CREATE ROLE worker$sql2$;'), ['role worker'])
})

test('computed command prefix with a role placeholder refuses instead of silently clearing', () => {
  for (const text of ["DO $$ BEGIN EXECUTE format(command_name || ' ROLE %I', name); END $$;", "DO $$ BEGIN EXECUTE command_name || ' ROLE ' || quote_ident(name); END $$;"]) {
    assert.throws(() => roleCollisionKeys(text), RoleExtractionError)
  }
})

test('comment and dollar markers in executed literals stay quoted and nested comments hide no code', () => {
  assert.deepEqual(roleCollisionKeys(`DO $$ BEGIN EXECUTE 'CREATE ROLE "a--b"'; END $$;`), ['role "a--b"'])
  assert.deepEqual(roleCollisionKeys('/* outer /* CREATE ROLE phantom; */ still comment */ CREATE ROLE actual;'), ['role actual'])
  assert.deepEqual(roleCollisionKeys(`SELECT 'DO $tag$ CREATE ROLE phantom; $tag$'; CREATE ROLE actual;`), ['role actual'])
})


test('unquoted nonreserved keyword roles retain exact membership and ownership identities', () => {
  for (const name of ['role','set','reset','insert','update','delete','truncate','trigger','usage','connect','temp','temporary','execute','alter']) {
    assert.deepEqual(roleCollisionKeys(`GRANT ${name} TO worker;`), [`role ${name}`, 'role worker'].sort(), name)
    assert.deepEqual(roleCollisionKeys(`REVOKE ${name} FROM worker;`), [`role ${name}`, 'role worker'].sort(), name)
    assert.deepEqual(roleOwnershipDependencies(`ALTER TABLE core.t OWNER TO ${name};`).map((dep) => dep.role), [name], name)
    assert.deepEqual(roleCollisionKeys(`CREATE ROLE worker IN ROLE ${name};`), [`role ${name}`, 'role worker'].sort(), name)
  }
})

test('membership option revocation accounts for admin inherit and set options', () => {
  for (const option of ['ADMIN','INHERIT','SET']) {
    assert.deepEqual(roleCollisionKeys(`REVOKE ${option} OPTION FOR worker FROM recipient;`), ['role recipient','role worker'])
  }
})


test('unsupported or truncating role token spellings refuse instead of aliasing an ASCII prefix', () => {
  for (const sql of ['CREATE ROLE core.worker;', 'CREATE ROLE caf\u00e9;', 'CREATE ROLE U&"worker";', 'DROP ROLE first, core.worker;', `CREATE ROLE "${'a'.repeat(64)}";`, `GRANT "${'a'.repeat(64)}" TO worker;`, `ALTER TABLE core.t OWNER TO "${'a'.repeat(64)}";`]) {
    assert.throws(() => roleCollisionKeys(sql), RoleExtractionError, sql)
  }
  assert.equal(canonicalRoleName('"' + 'a'.repeat(64) + '"'), null)
  assert.deepEqual(roleCollisionKeys('DROP ROLE "a;b", second;'), ['role "a;b"','role second'])
})
