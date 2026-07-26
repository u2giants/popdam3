// Shared Phase 6 preview-only target guards for GitHub Actions / local apply.
// Re-exports ColdLion runner guards and adds DesignFlow-facing constants.
// Never prints secret values.

export const PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel";
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";

export const COLDLION_SOURCE_NAME = "coldlion_licensors_properties_api";
export const DESIGNFLOW_SOURCE_SYSTEM = "designflow_plm";
export const DESIGNFLOW_SOURCE_NAME = "plm_master_data_api";
export const COMPARISON_SOURCE_NAME = "coldlion_designflow_daily_comparison";
export const HEALTH_SOURCE_NAME = "coldlion_designflow_sync_health";

// Phase 4 approved link pins (must match SQL migration constants).
export const EXPECTED_COLDLION_REFS = 542;
export const EXPECTED_LINKED_LICENSORS = 38;
export const EXPECTED_LINKED_PROPERTIES = 504;

export function describeTarget(connString, { linked = false } = {}) {
  if (linked) return "supabase --linked (preview project resolved by `supabase link`)";
  if (!connString) return "none (dry-run; set DATABASE_URL or pass --linked to apply)";
  try {
    const u = new URL(connString);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}:${u.port || "(default)"}${u.pathname}`;
  } catch {
    return "unparseable DATABASE_URL (credentials hidden)";
  }
}

export function resolveRunMode(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const linked = args.has("--linked");
  const forceFail = args.has("--force-fail");
  const connString = env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? null;
  return {
    apply,
    linked,
    forceFail,
    willWriteDb: apply,
    connString,
    target: describeTarget(connString, { linked }),
  };
}

export function assertPreviewApplyTarget({ apply, linked, connString, linkedProjectRef = null }) {
  if (!apply) return;

  if (linked && connString) {
    throw new Error(
      "Refusing --apply with both --linked and DATABASE_URL/SUPABASE_DB_URL; choose one explicit preview target",
    );
  }
  if (linked) {
    if (linkedProjectRef !== PREVIEW_PROJECT_REF) {
      throw new Error(
        `Refusing --apply: linked Supabase project is ${linkedProjectRef || "unknown"}, not required preview ${PREVIEW_PROJECT_REF}`,
      );
    }
    return;
  }
  if (!connString) {
    throw new Error(
      "Refusing --apply without a database target; pass --linked to the verified preview project or provide its DATABASE_URL",
    );
  }

  let parsed;
  try {
    parsed = new URL(connString);
  } catch {
    throw new Error("Refusing --apply with an unparseable DATABASE_URL");
  }
  const identity = `${parsed.username} ${parsed.hostname}`;
  if (identity.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing --apply to production project ${PRODUCTION_PROJECT_REF}; Phase 6 is preview-only`,
    );
  }
  if (!identity.includes(PREVIEW_PROJECT_REF)) {
    throw new Error(
      `Refusing --apply: DATABASE_URL does not identify required preview project ${PREVIEW_PROJECT_REF}`,
    );
  }
}

/** Refuse any env that clearly points at production even before apply. */
export function assertNoProductionEnv(env = process.env) {
  const blob = [
    env.DATABASE_URL,
    env.SUPABASE_DB_URL,
    env.SUPABASE_PROJECT_REF,
    env.PROJECT_REF,
  ]
    .filter(Boolean)
    .join(" ");
  if (blob.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing: environment references production project ${PRODUCTION_PROJECT_REF}`,
    );
  }
}
