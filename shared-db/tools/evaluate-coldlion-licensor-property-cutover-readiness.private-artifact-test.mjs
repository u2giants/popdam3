// Offline tests for the thin readiness composer.
//
// Scope discipline: these cover ONLY the new logic (target authorization, the
// row-by-row identity gate, and the composition rules). Pagination, freshness,
// hashes, malformed CLI output, duplicate keys, and unexplained differences stay
// covered by the existing Phase 6 suites — this file must not fork them.

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  PRODUCTION_AUTHORIZATION_VARIABLE,
  buildReadinessProbeSql,
  evaluateReadiness,
  resolveTargetAuthorization,
} from "./evaluate-coldlion-licensor-property-cutover-readiness.mjs";
import {
  APPROVED_MAPPING_PATH,
  loadWidenedApprovedMapping,
  validateWidenedApprovedMapping,
} from "./coldlion-paramount-five-approved-mapping.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT = {
  hash: APPROVED_HASH,
  count: APPROVED_COUNT,
  distinct_canonical: APPROVED_DISTINCT,
};

const ZERO_DIFFS = {
  missing: 0,
  extra: 0,
  cross_typed: 0,
  changed_uuid: 0,
  duplicate_input_key: 0,
  duplicate_source_ref: 0,
  link_mismatch: 0,
  canonical_missing: 0,
};

function greenProbe(overrides = {}) {
  return {
    ok: true,
    health: { ok: true, issues: [] },
    identity: {
      pass: true,
      approved_count: APPROVED_COUNT,
      approved_distinct_canonical: APPROVED_DISTINCT,
      recomputed_mapping_hash: APPROVED_HASH,
      expected_contract_ok: true,
      actual_coldlion_source_refs: APPROVED_COUNT,
      difference_counts: { ...ZERO_DIFFS },
      differences: {},
      blocking_reasons: [],
    },
    latest_observation: {
      id: "c72852e3-428b-4716-abcb-823bac769505",
      pass: true,
      is_drill: false,
      unexplained_diff_count: 0,
    },
    circuit_breaker: { lane: "coldlion_licensor_property", state: "closed" },
    breaker_enforcement: {
      expected_count: 9,
      installed_count: 9,
      enabled_count: 9,
      all_enforced: true,
      missing_or_disabled: [],
    },
    open_critical_alerts: 0,
    open_alert_sample: [],
    ...overrides,
  };
}

function previewAuth() {
  return resolveTargetAuthorization([], {});
}

function evaluateGreen(probeOverrides = {}) {
  return evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: greenProbe(probeOverrides),
  });
}

function identityWith(diffOverrides, extra = {}) {
  const base = greenProbe();
  return {
    ...base,
    identity: {
      ...base.identity,
      pass: false,
      difference_counts: { ...ZERO_DIFFS, ...diffOverrides },
      ...extra,
    },
  };
}

test("widened artifact is fingerprinted and admits only the Paramount five", () => {
  const { doc, expected } = loadWidenedApprovedMapping();
  assert.deepEqual(expected, CONTRACT);
  assert.equal(doc.mappings.length, 552);
  const admitted = doc.mappings.filter((m) => ["AM1","AM2","MGM","WND","EP"].includes(m.mg_code));
  assert.equal(admitted.length, 10);
  assert.deepEqual(new Set(admitted.map((m) => m.division_code)), new Set(["CW001","SP001"]));
  assert.deepEqual(
    Object.fromEntries(admitted.map((m) => [`${m.division_code}/${m.mg_code}`,m.canonical_id])),
    Object.fromEntries(["CW001","SP001"].flatMap((division) => [
      [`${division}/AM1`,"b288be08-a859-4d92-b1ef-23b4e305ed26"],
      [`${division}/AM2`,"2ebcdc69-88c9-4565-813b-9ce30a2b880f"],
      [`${division}/MGM`,"336e0dac-2001-4a8b-be89-04b1620587ce"],
      [`${division}/WND`,"85fa1834-6094-41d0-94c1-24dddf9c8d8b"],
      [`${division}/EP`,"c1e2ba88-b5c3-4ed2-9ed3-7d4f75ec8230"],
    ])),
  );

  const original = JSON.parse(readFileSync(new URL(
    "../docs/verification/coldlion-licensor-property-phase4-20260725/approved-mapping.json",
    import.meta.url,
  ), "utf8"));
  const newByKey = new Map(doc.mappings.map((m) => [
    `${m.company_code}/${m.division_code}/${m.mg_type_code}/${m.mg_code}`,
    `${m.entity_type}|${m.canonical_id}`,
  ]));
  for (const m of original.mappings) {
    const key = `${m.company_code}/${m.division_code}/${m.mg_type_code}/${m.mg_code}`;
    assert.equal(newByKey.get(key), `${m.entity_type}|${m.canonical_id}`,
      `historical approved mapping changed at ${key}`);
  }

  const tampered = JSON.parse(readFileSync(APPROVED_MAPPING_PATH, "utf8"));
  tampered.mappings.at(-1).canonical_id = "00000000-0000-4000-8000-000000000000";
  assert.throws(() => validateWidenedApprovedMapping(tampered), /fingerprint\/count contract/);
});

test("#1177 forward atomically widens health pins and the recurring promotion gate", () => {
  const sql = readFileSync(new URL(
    "../supabase/migrations/20260825050407_coldlion_paramount_five_approved_gate.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /phase4_preview has % of 7 required live pins/);
  assert.match(sql, /v_pre_snap:=plm\.compute_taxonomy_immutability_snapshot\(\)/);
  assert.match(sql, /property_count'\)::integer<>\(v_pre_snap->>'property_count'\)::integer\+5/);
  for (const metric of ["taxonomy_source_ref_count", "coldlion_source_ref_count", "linked_property_count"]) {
    assert.match(sql, new RegExp(`${metric}'\\)::integer<>\\(v_pre_snap->>'${metric}'\\)::integer\\+10`));
  }
  assert.match(sql, /from issue_1177_locked_pins locked/);
  assert.doesNotMatch(sql, /post-#1177 baseline counts are not exactly/i);
  for (const metric of ["property_uuid_hash", "property_status_hash", "parent_edge_hash"]) {
    assert.match(sql, new RegExp(`v_snap->>'${metric}'`));
  }
  assert.match(sql, /pg_get_functiondef\('plm\.promote_coldlion_source_owned\(jsonb,jsonb,boolean\)'::regprocedure\)/);
  assert.match(sql, /09e18e47d67181b06483d6cf4454e053/);
  assert.match(sql, /'''552'''/);
  assert.match(sql, /'''276'''/);
  assert.doesNotMatch(sql, /(?<!extensions\.)digest\s*\(/i);
  assert.match(sql, /revoke all on function plm\.promote_coldlion_source_owned\(jsonb,jsonb,boolean\)\s+from public,anon,authenticated,service_role/i);
});

test("#1177 mirror establishment is exact insert-or-validate, never overwrite", () => {
  const sql = readFileSync(new URL(
    "../supabase/migrations/20260825050407_coldlion_paramount_five_approved_gate.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /foreach v_division in array array\['CW001','SP001'\]/i);
  assert.match(sql, /insert into plm\.merch_group_header[\s\S]*on conflict\(company_code,division_code,mg_type_code\) do nothing/i);
  assert.doesNotMatch(sql, /on conflict\(company_code,division_code,mg_type_code\) do update/i);
  assert.match(sql, /required_semantic_parent_for_owner_approved_typed_identity/i);
  assert.match(sql, /header is absent, ambiguous, or has a non-Property meaning after exact establish-or-validate; refusing overwrite/i);
  assert.match(sql, /insert into plm\.erp_property[\s\S]*on conflict\(company_code,division_code,mg_type_code,mg_code\) do nothing/i);
  assert.doesNotMatch(sql, /on conflict\(company_code,division_code,mg_type_code,mg_code\) do update/i);
  assert.match(sql, /after exact header validation; refusing/i);
  assert.match(sql, /e\.property_id is not null or e\.resolution_status<>'unresolved'/i);
  assert.match(sql, /does not have exactly two unresolved, name-matching CW001\/SP001 typed rows; refusing/i);
});

test("widened validator refuses malformed typed rows and a stale environment target", () => {
  const original = JSON.parse(readFileSync(APPROVED_MAPPING_PATH, "utf8"));
  assert.throws(() => validateWidenedApprovedMapping({ ...original, target: "deleted-preview-ref" }),
    /header is missing or unauthorized/);
  const malformed = structuredClone(original);
  malformed.mappings[0].canonical_id = "not-a-uuid";
  assert.throws(() => validateWidenedApprovedMapping(malformed), /invalid typed row/);
});

// ---------------------------------------------------------------------------
// 1. Green case
// ---------------------------------------------------------------------------

test("preview_composes_existing_green_results", () => {
  const report = evaluateGreen();
  assert.equal(report.ready, true);
  assert.equal(report.target, "preview");
  assert.equal(report.human_response_owner, "Albert Hazan");
  assert.deepEqual(report.blocking_reasons, []);
  // It must actually compose the EXISTING tools' evidence, not just its own check.
  assert.ok(report.passed.includes("phase6_sync_health_is_green"));
  assert.ok(
    report.passed.includes("latest_nondrill_comparison_passed_with_zero_unexplained_differences"),
  );
  assert.ok(report.passed.includes("all_552_typed_source_rows_resolve_to_approved_uuids"));
  assert.ok(report.passed.includes("circuit_breaker_is_closed"));
});

// ---------------------------------------------------------------------------
// 2. Production authorization
// ---------------------------------------------------------------------------

test("production_requires_exact_authorization", () => {
  // Default target is preview and needs nothing extra.
  assert.deepEqual(resolveTargetAuthorization([], {}), {
    target: "preview",
    authorized: true,
    blocking_reason: null,
  });

  // The flag alone is never enough.
  const flagOnly = resolveTargetAuthorization(["--production"], {});
  assert.equal(flagOnly.authorized, false);
  assert.match(flagOnly.blocking_reason, /COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=true/);
  assert.match(flagOnly.blocking_reason, new RegExp(PRODUCTION_PROJECT_REF));
  assert.match(flagOnly.blocking_reason, /--production-authorized/);

  // Two of three still blocks.
  const twoOfThree = resolveTargetAuthorization(
    ["--production", "--production-authorized", "--project-ref", PRODUCTION_PROJECT_REF],
    {},
  );
  assert.equal(twoOfThree.authorized, false);

  // A wrong project ref blocks even with the variable set.
  const wrongRef = resolveTargetAuthorization(
    ["--production", "--production-authorized", "--project-ref", PREVIEW_PROJECT_REF],
    { [PRODUCTION_AUTHORIZATION_VARIABLE]: "true" },
  );
  assert.equal(wrongRef.authorized, false);

  // All three present authorizes (this session never supplies them).
  const full = resolveTargetAuthorization(
    ["--production", "--production-authorized", "--project-ref", PRODUCTION_PROJECT_REF],
    { [PRODUCTION_AUTHORIZATION_VARIABLE]: "true" },
  );
  assert.deepEqual(full, { target: "production", authorized: true, blocking_reason: null });

  // A preview run pointed at a non-preview ref blocks.
  const strayRef = resolveTargetAuthorization(["--project-ref", PRODUCTION_PROJECT_REF], {});
  assert.equal(strayRef.authorized, false);

  // An unauthorized target blocks the whole report even when every probe is green.
  const report = evaluateReadiness({
    authorization: resolveTargetAuthorization(["--production"], {}),
    mappingContract: CONTRACT,
    probe: greenProbe(),
  });
  assert.equal(report.ready, false);
  assert.ok(report.blocked.includes("production_requires_exact_authorization"));
});

// ---------------------------------------------------------------------------
// 3. Identity proof — the whole point of this command
// ---------------------------------------------------------------------------

test("all_552_typed_source_rows_resolve_to_approved_uuids", () => {
  const report = evaluateGreen();
  const identityCheck = report.checks.find(
    (c) => c.name === "all_552_typed_source_rows_resolve_to_approved_uuids",
  );
  assert.equal(identityCheck.pass, true);
  assert.equal(identityCheck.detail.approved_count, APPROVED_COUNT);
  assert.equal(identityCheck.detail.approved_distinct_canonical, APPROVED_DISTINCT);
  assert.equal(identityCheck.detail.recomputed_mapping_hash, APPROVED_HASH);

  // A wrong recomputed hash blocks even when every difference bucket is zero.
  const wrongHash = evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: identityWith({}, { pass: true, recomputed_mapping_hash: "0".repeat(32) }),
  });
  assert.equal(wrongHash.ready, false);
  assert.ok(wrongHash.blocked.includes("all_552_typed_source_rows_resolve_to_approved_uuids"));
});

test("missing_ambiguous_or_different_mapping_blocks", () => {
  const cases = [
    ["missing", { missing: 1 }],
    ["extra", { extra: 1 }],
    ["cross_typed", { cross_typed: 1 }],
    ["changed_uuid", { changed_uuid: 1 }],
    ["duplicate_input_key", { duplicate_input_key: 1 }],
    ["duplicate_source_ref", { duplicate_source_ref: 1 }],
    ["link_mismatch", { link_mismatch: 1 }],
    ["canonical_missing", { canonical_missing: 1 }],
  ];

  for (const [label, diffs] of cases) {
    const report = evaluateReadiness({
      authorization: previewAuth(),
      mappingContract: CONTRACT,
      probe: identityWith(diffs),
    });
    assert.equal(report.ready, false, `${label} must block readiness`);
    assert.ok(
      report.blocked.includes("all_552_typed_source_rows_resolve_to_approved_uuids"),
      `${label} must block the identity check`,
    );
    // The reason must NAME the failing bucket — a generic "not ready" is useless
    // to the person who has to respond.
    assert.ok(
      report.blocking_reasons.some((r) => r.includes(`${label}=1`)),
      `${label} must be named in the blocking reason, got ${JSON.stringify(report.blocking_reasons)}`,
    );
  }
});

test("row_counts_without_identity_proof_never_pass", () => {
  // Every count and hash correct, but NO per-row identity payload at all.
  const noIdentity = evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: greenProbe({ identity: null }),
  });
  assert.equal(noIdentity.ready, false);
  assert.ok(noIdentity.blocked.includes("row_counts_without_identity_proof_never_pass"));

  // Identity present but the difference buckets are absent — still blocked.
  const partial = evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: greenProbe({
      identity: {
        pass: true,
        approved_count: APPROVED_COUNT,
        approved_distinct_canonical: APPROVED_DISTINCT,
        recomputed_mapping_hash: APPROVED_HASH,
        expected_contract_ok: true,
      },
    }),
  });
  assert.equal(partial.ready, false);
  assert.ok(partial.blocked.includes("row_counts_without_identity_proof_never_pass"));

  // A difference bucket present but non-numeric (a truncated CLI cell) is malformed,
  // not "zero".
  const malformed = evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: identityWith({ missing: "n/a" }, { pass: true }),
  });
  assert.equal(malformed.ready, false);
  assert.ok(malformed.blocked.includes("row_counts_without_identity_proof_never_pass"));

  // No probe at all fails closed.
  const noProbe = evaluateReadiness({
    authorization: previewAuth(),
    mappingContract: CONTRACT,
    probe: null,
  });
  assert.equal(noProbe.ready, false);
  assert.ok(noProbe.blocked.includes("database_probe_returned_parseable_result"));
});

test("tampered_approved_mapping_contract_blocks", () => {
  for (const contract of [
    null,
    { ...CONTRACT, hash: "d41d8cd98f00b204e9800998ecf8427e" }, // md5 of the EMPTY set
    { ...CONTRACT, count: APPROVED_COUNT + 2 },
    { ...CONTRACT, distinct_canonical: 270 },
  ]) {
    const report = evaluateReadiness({
      authorization: previewAuth(),
      mappingContract: contract,
      probe: greenProbe(),
    });
    assert.equal(report.ready, false);
    assert.ok(report.blocked.includes("approved_mapping_contract_is_the_frozen_552_set"));
  }
});

// ---------------------------------------------------------------------------
// 4. Composition of the existing Phase 6 signals
// ---------------------------------------------------------------------------

test("unhealthy_or_failed_comparison_blocks_readiness", () => {
  const unhealthy = evaluateGreen({ health: { ok: false, issues: ["stale coldlion run"] } });
  assert.equal(unhealthy.ready, false);
  assert.ok(unhealthy.blocked.includes("phase6_sync_health_is_green"));

  const failedCompare = evaluateGreen({
    latest_observation: { id: "x", pass: false, is_drill: false, unexplained_diff_count: 3 },
  });
  assert.equal(failedCompare.ready, false);
  assert.ok(
    failedCompare.blocked.includes(
      "latest_nondrill_comparison_passed_with_zero_unexplained_differences",
    ),
  );

  // A DRILL observation must never satisfy the comparison gate.
  const drillOnly = evaluateGreen({
    latest_observation: { id: "d", pass: true, is_drill: true, unexplained_diff_count: 0 },
  });
  assert.equal(drillOnly.ready, false);
});

test("tripped_circuit_breaker_or_open_alert_blocks_readiness", () => {
  const tripped = evaluateGreen({
    circuit_breaker: {
      lane: "coldlion_licensor_property",
      state: "tripped",
      tripped_reason: "forced-failure drill",
    },
  });
  assert.equal(tripped.ready, false);
  assert.ok(tripped.blocked.includes("circuit_breaker_is_closed"));

  const alerting = evaluateGreen({ open_critical_alerts: 2 });
  assert.equal(alerting.ready, false);
  assert.ok(alerting.blocked.includes("no_unacknowledged_critical_alerts"));
});

// ---------------------------------------------------------------------------
// 5. Probe SQL shape
// ---------------------------------------------------------------------------

test("a_closed_breaker_on_an_unguarded_database_never_passes", () => {
  // The whole point: "state: closed" is meaningless if the triggers that do the
  // refusing have been dropped or disabled. A dropped trigger raises no error
  // and no alarm, so readiness has to be the thing that notices.
  const dropped = evaluateGreen({
    breaker_enforcement: {
      expected_count: 9,
      installed_count: 8,
      enabled_count: 8,
      all_enforced: false,
      missing_or_disabled: [
        { trigger: "coldlion_source_ref_breaker_guard", table: "core.taxonomy_source_ref", installed: false, enabled: false },
      ],
    },
  });
  assert.equal(dropped.ready, false);
  assert.ok(dropped.blocked.includes("circuit_breaker_enforcement_is_installed_and_enabled"));
  assert.ok(dropped.blocking_reasons.some((r) => r.includes("coldlion_source_ref_breaker_guard")));

  // Installed but DISABLED is just as unprotected as missing.
  const disabled = evaluateGreen({
    breaker_enforcement: {
      expected_count: 9,
      installed_count: 9,
      enabled_count: 7,
      all_enforced: false,
      missing_or_disabled: [
        { trigger: "coldlion_autotrip_on_critical_alert", table: "plm.taxonomy_sync_alert", installed: true, enabled: false },
      ],
    },
  });
  assert.equal(disabled.ready, false);

  // An unreadable status must block, never be treated as "fine".
  for (const bad of [null, undefined, {}, { all_enforced: "yes" }]) {
    const unknown = evaluateGreen({ breaker_enforcement: bad });
    assert.equal(unknown.ready, false, `${JSON.stringify(bad)} must block`);
    assert.ok(unknown.blocked.includes("circuit_breaker_enforcement_is_installed_and_enabled"));
  }
});

test("probe_sql_includes_the_enforcement_watchdog", () => {
  const sql = buildReadinessProbeSql({ mappings: [] }, CONTRACT);
  assert.ok(sql.includes("public.taxonomy_breaker_enforcement_status"));
});

test("probe_sql_is_one_preview_statement_and_leaks_no_production_ref", () => {
  const sql = buildReadinessProbeSql({ mappings: [] }, CONTRACT);
  assert.ok(sql.includes("public.verify_coldlion_approved_mapping_identity"));
  assert.ok(sql.includes("public.check_taxonomy_sync_health"));
  assert.ok(sql.includes("public.taxonomy_circuit_breaker_state"));
  assert.ok(sql.includes(PREVIEW_PROJECT_REF));
  assert.ok(!sql.includes(PRODUCTION_PROJECT_REF));
  // Exactly one terminating semicolon at statement level keeps `supabase db query`
  // returning a single parseable result cell.
  assert.equal(sql.trim().split(";").length - 1, 1);
});
