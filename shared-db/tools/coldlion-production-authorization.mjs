// Explicit, testable production authorization for the ColdLion licensor/property
// WRITE runners.
//
// WHY THIS EXISTS
// ---------------
// Both write runners were hard preview-only:
//   * sync-coldlion-licensors-properties.mjs refuses --apply unless the linked
//     project is preview;
//   * run-coldlion-licensor-property-phase4.mjs additionally refuses an approved
//     mapping whose `target` is anything but preview — and the frozen approved
//     artifact is stamped `"target": "rjyboqwcdzcocqgmsyel"`.
//
// That was correct while Phase 6 was preview-only. But the Step 7 production
// package told an operator to run exactly those two commands against production,
// where they would abort. A Codex review on 2026-07-28 caught it.
//
// The danger was never the abort. It was the abort landing MID-WINDOW, with the
// migrations already applied, and an operator under time pressure reaching for
// `--force`, editing a guard, or hand-writing SQL to finish the job. A guard that
// fails at the worst possible moment invites the exact bypass it exists to stop.
//
// So production becomes a first-class, explicitly authorized mode with the same
// triple lock the readiness evaluator already uses — never an accident, never a
// single stray flag, and never something an operator has to defeat:
//
//   1. --production
//   2. --production-authorized
//   3. --project-ref qsllyeztdwjgirsysgai   (spelled out in full)
//   4. COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true
//
// All four. Any one missing blocks, and the error names precisely what is absent.
// With none of them, behaviour is byte-for-byte the previous preview-only
// behaviour — that is deliberate, so every existing guard test still means what it
// meant before.

export const PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel";
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";
export const PRODUCTION_AUTHORIZATION_VARIABLE =
  "COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED";

/**
 * Resolve whether a production write is requested, and whether it is fully
 * authorized. Pure.
 *
 * @returns {{requested: boolean, authorized: boolean, missing: string[], blocking_reason: string|null}}
 */
export function resolveProductionAuthorization(argv = [], env = {}) {
  const args = new Set(argv);
  const requested = args.has("--production");
  const refIndex = argv.indexOf("--project-ref");
  const explicitRef = refIndex >= 0 ? argv[refIndex + 1] ?? null : null;

  if (!requested) {
    // A --project-ref naming production without --production is a red flag, not a
    // convenience. Refuse rather than quietly running against preview.
    if (explicitRef === PRODUCTION_PROJECT_REF) {
      return {
        requested: false,
        authorized: false,
        missing: ["--production"],
        blocking_reason:
          `--project-ref ${PRODUCTION_PROJECT_REF} was given without --production; refusing an ambiguous target`,
      };
    }
    return { requested: false, authorized: false, missing: [], blocking_reason: null };
  }

  const missing = [];
  if (!args.has("--production-authorized")) missing.push("--production-authorized");
  if (explicitRef !== PRODUCTION_PROJECT_REF) {
    missing.push(`--project-ref ${PRODUCTION_PROJECT_REF}`);
  }
  if (env[PRODUCTION_AUTHORIZATION_VARIABLE] !== "true") {
    missing.push(`${PRODUCTION_AUTHORIZATION_VARIABLE}=true`);
  }

  if (missing.length > 0) {
    return {
      requested: true,
      authorized: false,
      missing,
      blocking_reason:
        `production write requires the exact separate authorization: missing ${missing.join(", ")}`,
    };
  }
  return { requested: true, authorized: true, missing: [], blocking_reason: null };
}

/**
 * Target assertion for a ColdLion WRITE runner.
 *
 * With no production flags this delegates to the runner's existing preview-only
 * assertion, unchanged. With full production authorization it requires a `--linked`
 * session whose linked project is exactly production.
 *
 * @param {object} opts
 * @param {Function} opts.assertPreviewApplyTarget the runner's existing preview guard
 */
export function assertColdlionApplyTarget({
  apply,
  linked,
  connString,
  linkedProjectRef = null,
  argv = [],
  env = {},
  assertPreviewApplyTarget,
}) {
  const auth = resolveProductionAuthorization(argv, env);

  if (!auth.requested) {
    if (auth.blocking_reason) throw new Error(`Refusing: ${auth.blocking_reason}`);
    return assertPreviewApplyTarget({ apply, linked, connString, linkedProjectRef });
  }

  if (!auth.authorized) {
    throw new Error(`Refusing --production: ${auth.blocking_reason}`);
  }

  if (!apply) return; // dry runs never write anywhere

  // Production writes go through `supabase link` only. A raw DATABASE_URL is an
  // unreviewable target and is refused outright.
  if (connString) {
    throw new Error(
      "Refusing an authorized production write with DATABASE_URL/SUPABASE_DB_URL set; use --linked to the verified production project only",
    );
  }
  if (!linked) {
    throw new Error("Refusing an authorized production write without --linked");
  }
  if (linkedProjectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Refusing --production: linked Supabase project is ${linkedProjectRef || "unknown"}, not ${PRODUCTION_PROJECT_REF}`,
    );
  }
}

/** Human-readable banner so the target is impossible to miss in a run log. */
export function describeAuthorizedTarget(argv = [], env = {}) {
  const auth = resolveProductionAuthorization(argv, env);
  return auth.requested && auth.authorized
    ? `PRODUCTION ${PRODUCTION_PROJECT_REF} (explicitly authorized)`
    : `preview ${PREVIEW_PROJECT_REF}`;
}
