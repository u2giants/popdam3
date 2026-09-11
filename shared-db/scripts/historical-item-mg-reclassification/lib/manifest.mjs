// Canonical manifest serialization and digest.
//
// The manifest digest is the approval object (plan section 8): Albert authorizes
// exactly one SHA-256, and any regenerated manifest invalidates it. That only
// works if serialization is byte-stable, so this module sorts keys recursively
// and sorts candidates by primary key. A defect of exactly this shape was found
// in the classifier on 2026-09-02 (section 9.1) and must not be reintroduced here.

import { createHash } from 'node:crypto';

/** Recursively sort object keys so JSON.stringify is order-independent. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

/** Deterministic JSON text for a manifest object. */
export function serializeManifest(manifest) {
  const copy = canonicalize(manifest);
  if (Array.isArray(copy.candidates)) {
    copy.candidates = [...copy.candidates].sort((a, b) => a.item_id_pk - b.item_id_pk);
  }
  if (Array.isArray(copy.abstentions)) {
    copy.abstentions = [...copy.abstentions].sort((a, b) => {
      const ka = `${a.reason}|${a.source_identity?.division}|${a.source_identity?.item_num}`;
      const kb = `${b.reason}|${b.source_identity?.division}|${b.source_identity?.item_num}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }
  return `${JSON.stringify(copy, null, 2)}\n`;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of the canonical serialization. */
export function manifestDigest(manifest) {
  return sha256(serializeManifest(manifest));
}

/**
 * Refuse any manifest whose contents contradict the locked rules, regardless of
 * how it was produced. This is deliberately duplicated from the builder: a
 * manifest handed to the executor may have come from another machine, another
 * session, or an edited file.
 */
export function assertManifestWritable(manifest) {
  const problems = [];
  if (!Array.isArray(manifest.candidates)) problems.push('candidates is not an array');
  for (const c of manifest.candidates ?? []) {
    if (!Number.isInteger(c.item_id_pk)) problems.push(`candidate without integer item_id_pk`);
    if (c.evidence?.level !== 3) {
      problems.push(`candidate ${c.item_id_pk} is not level 3 (level ${c.evidence?.level})`);
    }
    for (const f of ['udf_merchgroup01', 'udf_merchgroup02', 'udf_merchgroup03']) {
      if (!c.after?.[f]) problems.push(`candidate ${c.item_id_pk} has a blank ${f}`);
    }
    for (const f of ['udf_merchgroup01_id', 'udf_merchgroup02_id', 'udf_merchgroup03_id']) {
      if (!Number.isInteger(c.after?.[f])) {
        problems.push(`candidate ${c.item_id_pk} has a non-integer ${f}`);
      }
    }
    if (c.taxonomy?.mg02?.parent_id !== c.taxonomy?.mg01?.mg_id) {
      problems.push(`candidate ${c.item_id_pk} MG02 is not a child of its MG01`);
    }
    if (c.taxonomy?.mg03?.parent_id !== c.taxonomy?.mg02?.mg_id) {
      problems.push(`candidate ${c.item_id_pk} MG03 is not a child of its MG02`);
    }
  }
  const ids = (manifest.candidates ?? []).map((c) => c.item_id_pk);
  if (new Set(ids).size !== ids.length) problems.push('duplicate item_id_pk in candidates');
  if (problems.length) {
    throw new Error(`REFUSED: manifest is not writable:\n  - ${problems.join('\n  - ')}`);
  }
  return true;
}

/**
 * A production authorization is valid only for one digest against one target.
 * Preview authorization can never satisfy production (plan section 10, test 17).
 */
export function assertAuthorization({ target, expectedDigest, actualDigest, authorization }) {
  if (expectedDigest && expectedDigest !== actualDigest) {
    throw new Error(
      `REFUSED: manifest digest mismatch. expected ${expectedDigest}, actual ${actualDigest}`,
    );
  }
  if (target !== 'production') return true;
  if (!authorization) {
    throw new Error('REFUSED: production apply requires a production authorization artifact');
  }
  if (authorization.target !== 'production') {
    throw new Error(
      `REFUSED: authorization is for target "${authorization.target}", not production`,
    );
  }
  if (authorization.manifest_sha256 !== actualDigest) {
    throw new Error(
      `REFUSED: production authorization names manifest ${authorization.manifest_sha256}, `
      + `not ${actualDigest}`,
    );
  }
  return true;
}

/**
 * Bind a manifest to the database it is about to be executed against.
 *
 * A missing identity field is NOT "unconstrained": an unstamped manifest is
 * exactly what a preview-built plan looks like, and accepting it let a
 * preview digest be applied against production through the executor core.
 * All three fields must be present and must match the live connection.
 */
export function assertManifestBoundToTarget(manifest, { target, projectRef, cluster }) {
  if (!manifest.target) {
    throw new Error('REFUSED: the manifest does not name the target it was built against');
  }
  if (manifest.target !== target) {
    throw new Error(
      `REFUSED: the manifest was built against "${manifest.target}", not "${target}"`,
    );
  }
  if (!manifest.project_ref) {
    throw new Error('REFUSED: the manifest does not name the Supabase project it was built against');
  }
  if (manifest.project_ref !== projectRef) {
    throw new Error('REFUSED: the manifest was built against a different Supabase project');
  }
  if (!manifest.cluster_system_identifier) {
    throw new Error('REFUSED: the manifest does not name the Postgres cluster it was built against');
  }
  if (String(manifest.cluster_system_identifier) !== String(cluster)) {
    throw new Error('REFUSED: the manifest was built against a different Postgres cluster');
  }
  return true;
}
