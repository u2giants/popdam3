// PRODUCTION-LANE readiness checks for the recurring ColdLion feed
// (accelerated plan Step 7A item 5).
//
// These are the checks the readiness evaluator adds so that production readiness cannot
// go green until the recurring lane genuinely exists and is genuinely still disabled. They
// are pure functions over text/objects the caller reads, so they are unit-testable without
// a database, a network call, or a GitHub API token.
//
// THE SUBTLE ONE: "the enable variable is intentionally OFF"
// ---------------------------------------------------------
// Step 7A requires readiness to FAIL if COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED is
// already true *before approval*. A naive "the variable must be false" rule would then make
// readiness permanently red the moment Step 8 legitimately enables it — which would train
// whoever is on call to ignore a red readiness gate, the single most dangerous outcome here.
//
// So the rule is conditional on a DURABLE approval record: with no approval artifact the
// variable must be off; with one, either state is acceptable and the artifact is reported.
// That keeps the gate meaningful in both phases instead of crying wolf in the second.

export const PRODUCTION_ENABLE_VARIABLE = "COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED";
export const PRODUCTION_WORKFLOW_PATH =
  ".github/workflows/coldlion-licensor-property-production.yml";
export const REQUIRED_PRODUCTION_SECRET_NAMES = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD_PRODUCTION",
  "COLDLION_API_KEY",
]);
export const PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai";
export const PREVIEW_PROJECT_REF = "rjyboqwcdzcocqgmsyel";

/**
 * Scripts exempt from the four-part WRITE authorization because they cannot write.
 *
 * Keep this list TINY. A script named here MUST be incapable of writing to a database,
 * and the exemption is only safe while paired with the `--apply` refusal enforced below
 * and in the workflow contract test.
 *
 * MIRRORED, DELIBERATELY, in tools/coldlion-licensor-property-production-workflow.test.mjs.
 * The contract test re-states the rule instead of importing it, so that a mistake in this
 * module cannot silently excuse itself in the test that is supposed to catch it.
 */
export const READ_ONLY_GUARD_SCRIPTS = Object.freeze(["check-supabase-link-state.mjs"]);

/**
 * Parse EVERY `node tools/<script>.mjs ...` invocation out of workflow text, one entry
 * per invocation, keyed on the SCRIPT NAME.
 *
 * ============================================================================
 * WHY THIS IS NOT A ONE-LINE REGEX -- it closes a real bypass (found in review,
 * 2026-08-07, before this ever ran against production).
 * ============================================================================
 * The previous version matched the script name followed by a greedy "rest of line"
 * (`[^\n]` star, global) and then asked
 * whether the matched TEXT contained the guard's name. Two problems compounded:
 *
 *   1. `[^\n]*` is greedy to end of line, and matchAll is non-overlapping. So TWO
 *      invocations on ONE line collapse into a SINGLE match string.
 *   2. The exemption test was a substring check over that whole string.
 *
 * Together they meant:
 *
 *     node tools/check-supabase-link-state.mjs --expect-ref="$X" && \
 *       node tools/sync-coldlion-licensors-properties.mjs --apply
 *
 * parsed as ONE "call" whose text contains the guard's name, so the WRITE RUNNER on
 * the same line INHERITED THE READ-ONLY EXEMPTION and escaped the authorization check
 * entirely. A single `&&` would have defeated the whole gate.
 *
 * The fix is to stop reasoning about lines. The regex below captures the script name
 * explicitly and stops each invocation's argument text at the NEXT `node tools/`, so
 * chained invocations are separate entries and the exemption is decided by the script
 * that was actually invoked -- never by what happens to sit beside it.
 */
export function parseRunnerCalls(text) {
  // (?:(?!node tools\/)[^\n])*  -- consume args, but stop before the next invocation
  // and never cross a newline.
  const CALL = /node tools\/([a-z0-9-]+\.mjs)((?:(?!node tools\/)[^\n])*)/g;
  return [...String(text ?? "").matchAll(CALL)].map((m) => ({
    script: m[1],
    args: m[2].replace(/\s+/g, " ").trim(),
    raw: `node tools/${m[1]}${m[2]}`.replace(/\s+/g, " ").trim(),
  }));
}

function check(name, pass, detail, blockingReason = null) {
  return { name, pass: Boolean(pass), detail, blocking_reason: pass ? null : blockingReason };
}

/**
 * @param {object} input
 * @param {string|null} input.workflowText   contents of the production workflow, or null if absent
 * @param {string[]}    input.registeredCrons cron strings parsed from the workflow
 * @param {Record<string,string>} input.scheduleMap the production schedule map
 * @param {string|null} input.enableVariable  current value of the enable variable ("true"/"false"/null)
 * @param {string[]}    input.approvalArtifacts durable Step 8 approval artifact paths (empty = unapproved)
 * @param {boolean}     input.promotionContractOk the promotion module's field allowlists are intact
 * @param {object|null} input.promotionObjects  database presence of the promotion function/tables
 */
export function evaluateProductionLaneReadiness({
  workflowText = null,
  registeredCrons = [],
  scheduleMap = {},
  enableVariable = null,
  approvalArtifacts = [],
  promotionContractOk = false,
  promotionObjects = null,
} = {}) {
  const checks = [];

  // --- 1. the production workflow must exist and target only production ---------------
  const workflowExists = typeof workflowText === "string" && workflowText.length > 0;
  checks.push(
    check(
      "production_workflow_exists",
      workflowExists,
      { path: PRODUCTION_WORKFLOW_PATH },
      `${PRODUCTION_WORKFLOW_PATH} is missing; a one-time link run is not a recurring feed and readiness must not pass without the recurring lane`,
    ),
  );

  if (workflowExists) {
    const targetsProductionOnly =
      workflowText.includes(`PRODUCTION_PROJECT_REF: ${PRODUCTION_PROJECT_REF}`) &&
      workflowText.includes("environment: production") &&
      /Refusing: the production workflow linked PREVIEW/.test(workflowText) &&
      !/project-ref\s+"?\$\{\{\s*(inputs|vars)\./.test(workflowText);
    checks.push(
      check(
        "production_workflow_targets_only_production",
        targetsProductionOnly,
        { production_project_ref: PRODUCTION_PROJECT_REF },
        "the production workflow does not pin the production ref, use the production environment, and refuse a preview link with a non-injectable ref",
      ),
    );

    // --- 2. schedule map must be valid and match the workflow -------------------------
    const mapKeys = Object.keys(scheduleMap).sort();
    const cronKeys = [...registeredCrons].map((c) => String(c).trim()).sort();
    const armsPresent = Object.entries(scheduleMap).every(([cron, job]) =>
      new RegExp(`"${cron.replace(/\*/g, "\\*")}"\\)\\s*JOB=${job}`).test(workflowText),
    );
    const noWallClock = !/date -u \+%[HM]|HOUR=\$\(|MINUTE=\$\(/.test(workflowText);
    const scheduleOk =
      mapKeys.length > 0 &&
      JSON.stringify(mapKeys) === JSON.stringify(cronKeys) &&
      armsPresent &&
      noWallClock;
    checks.push(
      check(
        "production_schedule_map_is_valid",
        scheduleOk,
        { mapped: mapKeys, registered: cronKeys, case_arms_present: armsPresent, no_wall_clock: noWallClock },
        "the production schedule map, the workflow's registered crons, and its case arms disagree — or lane selection could fall back to wall-clock time, which lets a delayed runner pick the wrong job",
      ),
    );

    // --- 3. every required secret NAME must be wired ----------------------------------
    const missingSecrets = REQUIRED_PRODUCTION_SECRET_NAMES.filter(
      (name) => !workflowText.includes(`secrets.${name}`),
    );
    checks.push(
      check(
        "all_required_production_secret_names_are_wired",
        missingSecrets.length === 0,
        { required: [...REQUIRED_PRODUCTION_SECRET_NAMES] },
        `the production workflow does not reference secret name(s): ${missingSecrets.join(", ")}`,
      ),
    );

    // --- 4. every write runner call carries the four-part authorization ---------------
    const folded = workflowText.replace(/\\\r?\n\s*/g, " ");
    const calls = parseRunnerCalls(folded);

    // READ-ONLY GUARDS ARE EXEMPT FROM THE WRITE AUTHORIZATION, AND ONLY THESE.
    //
    // The four-part authorization exists to stop an UNAUTHORISED WRITE. A script that
    // cannot write has nothing to authorise, and demanding `--production-authorized`
    // from a guard would mean either weakening the guard or bolting write-shaped flags
    // onto something that must never write -- both worse than an explicit exemption.
    //
    // The list is deliberately TINY and is matched on the SCRIPT NAME parsed out of each
    // invocation -- never on a substring of the surrounding text. See parseRunnerCalls
    // for the bypass that substring matching allowed. Adding to this list is a real
    // decision: a script named here MUST be incapable of writing, which is why the
    // exemption is paired below with a hard refusal of `--apply`. Without that pairing
    // the list would be a hole -- "call it a guard, then pass --apply".
    const isReadOnlyGuard = (c) => READ_ONLY_GUARD_SCRIPTS.includes(c.script);

    const writeCalls = calls.filter((c) => !isReadOnlyGuard(c));
    const unauthorized = writeCalls.filter(
      (c) =>
        !/--production\b/.test(c.raw) ||
        !/--production-authorized\b/.test(c.raw) ||
        !/--project-ref "\$PRODUCTION_PROJECT_REF"/.test(c.raw),
    );
    checks.push(
      check(
        "every_production_runner_call_has_four_part_authorization",
        writeCalls.length > 0 && unauthorized.length === 0,
        { runner_calls: writeCalls.length, read_only_guard_calls: calls.length - writeCalls.length },
        `${unauthorized.length} production runner call(s) are missing part of the four-part authorization`,
      ),
    );

    // The exemption above is only safe while an exempt script cannot write. Enforce that.
    const guardCallsThatApply = calls.filter((c) => isReadOnlyGuard(c) && /--apply\b/.test(c.raw));
    checks.push(
      check(
        "read_only_guard_calls_never_apply",
        guardCallsThatApply.length === 0,
        { read_only_guard_scripts: [...READ_ONLY_GUARD_SCRIPTS] },
        `${guardCallsThatApply.length} call(s) claim the read-only guard exemption while passing --apply`,
      ),
    );

    // --- 5. it must skip loudly, never degrade -----------------------------------------
    const failsLoud =
      /::warning title=ColdLion production feed is DISABLED::/.test(workflowText) &&
      /NO preview fallback/.test(workflowText) &&
      !/continue-on-error/.test(workflowText);
    checks.push(
      check(
        "disabled_lane_skips_loudly_without_fallback",
        failsLoud,
        null,
        "the production workflow does not skip loudly, or it could degrade silently to preview/dry-run/continue-on-error",
      ),
    );
  }

  // --- 6. the enable variable must be intentionally OFF before approval ---------------
  const approved = Array.isArray(approvalArtifacts) && approvalArtifacts.length > 0;
  const enabled = String(enableVariable ?? "") === "true";
  checks.push(
    check(
      "production_enable_variable_is_intentionally_off_before_approval",
      approved ? true : !enabled,
      { variable: PRODUCTION_ENABLE_VARIABLE, value: enableVariable ?? "(absent)", approved, approval_artifacts: approvalArtifacts },
      `${PRODUCTION_ENABLE_VARIABLE} is "true" but no durable Step 8 approval artifact exists. Enabling the recurring production lane is a named production action that requires Albert Hazan's explicit approval of the exact project, migrations, modes, schedules, secrets, window and rollback.`,
    ),
  );

  // --- 7. the recurring promotion contract itself -------------------------------------
  checks.push(
    check(
      "recurring_promotion_contract_passes",
      promotionContractOk === true,
      null,
      "the recurring promotion contract is not intact: the source-owned field allowlist and the protected-field list must both be present and disjoint",
    ),
  );

  const objectsOk =
    promotionObjects &&
    typeof promotionObjects === "object" &&
    Boolean(promotionObjects.promote_function) &&
    Boolean(promotionObjects.audit_table) &&
    Boolean(promotionObjects.quarantine_table) &&
    Boolean(promotionObjects.normalize_function);
  checks.push(
    check(
      "recurring_promotion_objects_exist_in_the_database",
      objectsOk,
      promotionObjects ?? null,
      "the promotion function, its normalizer, and the append-only audit/quarantine tables are not all present in the target database (checking the migration ledger is not enough — verify the objects)",
    ),
  );

  return checks;
}

/** Convenience: does the promotion module still expose a safe, disjoint field split? */
export function promotionContractIsIntact({ sourceOwned = [], protectedFields = [] } = {}) {
  if (!Array.isArray(sourceOwned) || !Array.isArray(protectedFields)) return false;
  if (sourceOwned.length === 0 || protectedFields.length === 0) return false;
  const overlap = sourceOwned.filter((f) => protectedFields.includes(f));
  if (overlap.length > 0) return false;
  // The parent edge and status must be protected, always.
  for (const must of [
    "core.property.licensor_id",
    "core.licensor.status",
    "core.property.status",
  ]) {
    if (!protectedFields.includes(must)) return false;
  }
  return true;
}
