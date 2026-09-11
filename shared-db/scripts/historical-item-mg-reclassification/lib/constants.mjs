// Shared constants for the guarded historical MG01-MG03 reclassification.
//
// The May 14, 2025 boundary is LOCKED (plan §8). It is defined once, here, and
// every module imports it. No flag, environment variable or CLI argument may
// move it; `assertCutoff()` below exists so that a future edit that tries to
// parameterise it fails a test instead of silently widening the write set.

/** Items created strictly BEFORE this instant are historical. */
export const HISTORICAL_CUTOFF_ISO = '2025-05-14T00:00:00';

/** The six item fields this project is ever allowed to write. */
export const WRITABLE_FIELDS = Object.freeze([
  'udf_merchgroup01',
  'udf_merchgroup02',
  'udf_merchgroup03',
  'udf_merchgroup01_id',
  'udf_merchgroup02_id',
  'udf_merchgroup03_id',
]);

/** `core."merchGroup"."mgTypeCode"` values for MG01, MG02 and MG03. */
export const MG_TYPE_CODES = Object.freeze({ mg01: '01', mg02: '02', mg03: '03' });

/**
 * Machine-readable abstention reasons. Every non-writable source row carries
 * exactly one of these. A row is NEVER emitted as writable with a warning.
 */
export const ABSTAIN = Object.freeze({
  NOT_LEVEL_3: 'NOT_LEVEL_3',
  BLANK_PROPOSAL: 'BLANK_PROPOSAL',
  NO_LIVE_TARGET: 'NO_LIVE_TARGET',
  AMBIGUOUS_TARGET: 'AMBIGUOUS_TARGET',
  SOURCE_IDENTITY_BLANK: 'SOURCE_IDENTITY_BLANK',
  DIVISION_UNRESOLVED: 'DIVISION_UNRESOLVED',
  DIVISION_ENCODING_CONFLICT: 'DIVISION_ENCODING_CONFLICT',
  DIVISION_MISMATCH: 'DIVISION_MISMATCH',
  NULL_TARGET_DATE: 'NULL_TARGET_DATE',
  NON_HISTORICAL_TARGET: 'NON_HISTORICAL_TARGET',
  TAXONOMY_MISSING: 'TAXONOMY_MISSING',
  TAXONOMY_INACTIVE: 'TAXONOMY_INACTIVE',
  TAXONOMY_AMBIGUOUS: 'TAXONOMY_AMBIGUOUS',
  TAXONOMY_PARENT_MISMATCH: 'TAXONOMY_PARENT_MISMATCH',
  TAXONOMY_DIVISION_CONFLICT: 'TAXONOMY_DIVISION_CONFLICT',
  SOURCE_DIGEST_DRIFT: 'SOURCE_DIGEST_DRIFT',
});

/**
 * Fail closed if anything tries to move the locked boundary.
 * @param {string} cutoff
 */
export function assertCutoff(cutoff) {
  if (cutoff !== HISTORICAL_CUTOFF_ISO) {
    throw new Error(
      `REFUSED: the May 14, 2025 cutoff is locked by plan §8 and may not be changed (got ${cutoff})`,
    );
  }
  return cutoff;
}
