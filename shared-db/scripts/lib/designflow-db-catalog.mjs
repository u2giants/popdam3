// Pure SQL construction and proof validation. Connection-target verification belongs
// to the caller: a literal project reference in SQL cannot prove database identity.
export const PRODUCTION_PROJECT_REF = 'qsllyeztdwjgirsysgai';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES']);
const REASONS = new Set(['missing_namespace', 'missing_relation', 'missing_column', 'missing_role', 'missing_privilege', 'missing_schema_usage']);

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || Buffer.byteLength(value, 'utf8') > 63) {
    throw new TypeError(`${label} must be a PostgreSQL identifier`);
  }
  return value;
}

function validateContracts(contracts) {
  if (!Array.isArray(contracts)) throw new TypeError('contracts must be an array');
  return contracts.map((contract, index) => {
    record(contract, ['schema', 'relation', 'columns', 'privileges'], `contract ${index}`);
    const schema = identifier(contract.schema, 'schema');
    const relation = identifier(contract.relation, 'relation');
    if (!Array.isArray(contract.columns)) throw new TypeError('columns must be an array');
    const columns = contract.columns.map(column => identifier(column, 'column'));
    if (new Set(columns).size !== columns.length) throw new TypeError('duplicate columns');
    if (!Array.isArray(contract.privileges)) throw new TypeError('privileges must be an array');
    const seenRoles = new Set();
    const privileges = contract.privileges.map(entry => {
      record(entry, ['role', 'privileges'], 'role privilege entry');
      const role = identifier(entry.role, 'role');
      if (seenRoles.has(role)) throw new TypeError('duplicate role');
      seenRoles.add(role);
      if (!Array.isArray(entry.privileges)) throw new TypeError('role privileges must be an array');
      const values = entry.privileges.map(value => {
        if (!PRIVILEGES.has(value)) throw new TypeError('unsupported privilege');
        return value;
      });
      if (new Set(values).size !== values.length) throw new TypeError('duplicate privileges');
      return { role, privileges: values };
    });
    return { schema, relation, columns, privileges };
  });
}

export function productionCatalogQuery(contracts) {
  const literal = JSON.stringify(validateContracts(contracts)).replaceAll("'", "''");
  return `BEGIN READ ONLY;
WITH required_contracts AS (
  SELECT requested.*
  FROM jsonb_to_recordset('${literal}'::jsonb)
    AS requested(schema text, relation text, columns jsonb, privileges jsonb)
), required_relations AS (
  SELECT requested.*, namespace.oid AS namespace_oid, relation.oid AS relation_oid
  FROM required_contracts AS requested
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = requested.schema
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid AND relation.relname = requested.relation
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
), required_columns AS (
  SELECT requested.*, required_column.name AS column_name, attribute.attnum
  FROM required_relations AS requested
  CROSS JOIN LATERAL jsonb_array_elements_text(requested.columns) AS required_column(name)
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = requested.relation_oid AND attribute.attname = required_column.name
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
), required_roles AS (
  SELECT requested.*, entry.role, entry.privileges AS role_privileges, named_role.oid AS role_oid
  FROM required_relations AS requested
  CROSS JOIN LATERAL jsonb_to_recordset(requested.privileges) AS entry(role text, privileges jsonb)
  LEFT JOIN pg_catalog.pg_roles AS named_role ON named_role.rolname = entry.role
), required_privileges AS (
  SELECT requested.*, requested_privilege.name AS privilege
  FROM required_roles AS requested
  CROSS JOIN LATERAL jsonb_array_elements_text(requested.role_privileges) AS requested_privilege(name)
), failure_rows AS (
  SELECT schema, relation, NULL::text AS column_name, NULL::text AS role,
    NULL::text AS privilege, 'missing_namespace'::text AS reason
  FROM required_relations WHERE namespace_oid IS NULL
  UNION ALL
  SELECT schema, relation, NULL, NULL, NULL, 'missing_relation'
  FROM required_relations WHERE namespace_oid IS NOT NULL AND relation_oid IS NULL
  UNION ALL
  SELECT schema, relation, column_name, NULL, NULL, 'missing_column'
  FROM required_columns WHERE relation_oid IS NOT NULL AND attnum IS NULL
  UNION ALL
  SELECT schema, relation, NULL, role, NULL, 'missing_role'
  FROM required_roles WHERE role_oid IS NULL
  UNION ALL
  SELECT schema, relation, NULL, role, NULL, 'missing_schema_usage'
  FROM required_roles
  WHERE CASE WHEN role_oid IS NULL OR namespace_oid IS NULL THEN false
    ELSE NOT pg_catalog.has_schema_privilege(role_oid, namespace_oid, 'USAGE') END
  UNION ALL
  SELECT schema, relation, NULL, role, privilege, 'missing_privilege'
  FROM required_privileges
  WHERE CASE
    WHEN role_oid IS NULL OR relation_oid IS NULL THEN false
    WHEN privilege = 'SELECT' AND jsonb_array_length(columns) > 0 THEN false
    ELSE NOT pg_catalog.has_table_privilege(role_oid, relation_oid, privilege)
  END
  UNION ALL
  SELECT requested.schema, requested.relation, required_column.name, requested.role,
    requested.privilege, 'missing_privilege'
  FROM required_privileges AS requested
  CROSS JOIN LATERAL jsonb_array_elements_text(requested.columns) AS required_column(name)
  LEFT JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = requested.relation_oid AND attribute.attname = required_column.name
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
  WHERE CASE
    WHEN requested.privilege <> 'SELECT' OR requested.role_oid IS NULL
      OR requested.relation_oid IS NULL OR attribute.attnum IS NULL THEN false
    ELSE NOT pg_catalog.has_column_privilege(requested.role_oid, requested.relation_oid, attribute.attnum, 'SELECT')
  END
), failures AS (
  SELECT DISTINCT jsonb_strip_nulls(jsonb_build_object(
    'schema', schema, 'relation', relation, 'column', column_name,
    'role', role, 'privilege', privilege, 'reason', reason
  )) AS failure
  FROM failure_rows
)
SELECT jsonb_build_object(
  'production_project_ref', '${PRODUCTION_PROJECT_REF}',
  'failures', COALESCE((SELECT jsonb_agg(failure ORDER BY failure::text) FROM failures), '[]'::jsonb),
  'checked_contracts', (SELECT count(*) FROM required_contracts)
) AS production_catalog_proof;
COMMIT;`;
}

export function verifyCatalogProof(contracts, actualRows) {
  const expected = validateContracts(contracts);
  record(actualRows, ['production_project_ref', 'failures', 'checked_contracts'], 'catalog proof');
  if (actualRows.production_project_ref !== PRODUCTION_PROJECT_REF) throw new Error('Wrong production target');
  if (!Number.isSafeInteger(actualRows.checked_contracts) || actualRows.checked_contracts !== expected.length) {
    throw new Error('Catalog proof contract count mismatch');
  }
  if (!Array.isArray(actualRows.failures)) throw new TypeError('Catalog proof failures must be an array');
  for (const failure of actualRows.failures) {
    if (!failure || typeof failure !== 'object' || Array.isArray(failure)) throw new TypeError('Malformed catalog failure');
    const keys = Reflect.ownKeys(failure);
    if (keys.some(key => !['schema', 'relation', 'column', 'role', 'privilege', 'reason'].includes(key))
        || !['schema', 'relation', 'reason'].every(key => keys.includes(key))) {
      throw new TypeError('Malformed catalog failure fields');
    }
    identifier(failure.schema, 'failure schema');
    identifier(failure.relation, 'failure relation');
    if (keys.includes('column')) identifier(failure.column, 'failure column');
    if (keys.includes('role')) identifier(failure.role, 'failure role');
    if (keys.includes('privilege') && !PRIVILEGES.has(failure.privilege)) throw new TypeError('Invalid failure privilege');
    if (!REASONS.has(failure.reason)) throw new TypeError('Invalid failure reason');
  }
  if (actualRows.failures.length) {
    const error = new Error(`Production catalog requirements failed (${actualRows.failures.length})`);
    error.failures = structuredClone(actualRows.failures);
    throw error;
  }
  return { production_project_ref: PRODUCTION_PROJECT_REF, failures: [], checked_contracts: expected.length };
}
