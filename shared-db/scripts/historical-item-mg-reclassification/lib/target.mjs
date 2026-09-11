// Target proof.
//
// Plan section 11: "Production target proof expires after any intervening tool
// call, reconnect, or turn." Nothing in this repository can enforce a human's
// turn boundary, so the guard enforced here is the mechanical half: the project
// ref is derived from the connection string that is about to be used, compared
// with an explicitly stated expectation, and re-derived immediately before DML
// from the SAME live connection. A ref is never inferred from a document, a
// remembered value, or a target name.

/**
 * Extract a Supabase project ref from a Postgres connection string.
 *
 * Both shapes Supabase hands out are supported:
 *   - direct:  db.<ref>.supabase.co
 *   - pooler:  user postgres.<ref> @ aws-*.pooler.supabase.com
 *
 * @returns {string|null}
 */
export function projectRefFromConnectionString(uri) {
  if (typeof uri !== 'string' || uri === '') return null;
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  const host = parsed.hostname ?? '';
  const direct = /^db\.([a-z0-9]{20})\.supabase\.(co|com|net)$/i.exec(host);
  if (direct) return direct[1];
  const user = decodeURIComponent(parsed.username ?? '');
  const pooled = /^postgres\.([a-z0-9]{20})$/i.exec(user);
  if (pooled) return pooled[1];
  return null;
}

/**
 * Refuse unless the connection about to be used is the expected project.
 *
 * `expectedRef` must be supplied explicitly by the caller. There is deliberately
 * no built-in target-name to project-ref table: a literal ref copied out of a
 * plan document is exactly the mistake this guard exists to prevent.
 */
export function assertTarget({ target, connectionString, expectedRef }) {
  if (target !== 'preview' && target !== 'production') {
    throw new Error(`REFUSED: unknown target "${target}"; expected preview or production`);
  }
  if (!expectedRef) {
    throw new Error('REFUSED: --expect-project-ref is required; the target name alone is not proof');
  }
  const actual = projectRefFromConnectionString(connectionString);
  if (!actual) {
    throw new Error(
      'REFUSED: could not derive a Supabase project ref from the connection string',
    );
  }
  if (actual !== expectedRef) {
    throw new Error(
      `REFUSED: target proof failed. connection resolves to project "${actual}", `
      + `expected "${expectedRef}"`,
    );
  }
  return actual;
}

/**
 * Second, live half of the proof, run on the open connection immediately before
 * DML. `system_identifier` is unique per Postgres cluster, so recording it makes
 * a preview/production mix-up detectable in the evidence after the fact, and
 * comparing it aborts the batch before any write when it moves.
 */
export async function readLiveIdentity(client) {
  const { rows } = await client.query(
    'select current_database() as db, (select system_identifier from pg_control_system()) as system_identifier',
  );
  return { database: rows[0].db, system_identifier: String(rows[0].system_identifier) };
}

export function assertLiveIdentity(observed, expected) {
  if (!expected) return observed;
  if (String(observed.system_identifier) !== String(expected)) {
    throw new Error(
      `REFUSED: live cluster identity ${observed.system_identifier} does not match the `
      + `expected ${expected}; the connection is not the authorized database`,
    );
  }
  return observed;
}
