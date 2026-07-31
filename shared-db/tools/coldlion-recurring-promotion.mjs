// The GUARDED RECURRING PROMOTION CONTRACT for the ColdLion Licensor/Property feed
// (accelerated plan Step 7A item 3).
//
// WHAT PROBLEM THIS SOLVES
// -----------------------
// Steps 1-7 built a ONE-TIME 542-row link. A recurring feed has to answer a harder
// question every single day: ColdLion just sent me a row — may I change anything in
// `core.*` because of it, and if so exactly what? Getting that wrong is how a
// slow-moving master-data feed quietly corrupts every consuming application.
//
// THE FIELD-OWNERSHIP SPLIT IS THE WHOLE DESIGN
// --------------------------------------------
// ColdLion OWNS  : its source identity (company, division, mgTypeCode, mgCode), its
//                  source code, and its source descriptive value (mgDesc).
// Supabase OWNS  : canonical UUIDs, core.property.licensor_id (the parent edge), and
//                  lifecycle status. ColdLion's API does not supply the parent edge or
//                  any active/inactive flag, so it can never be their author. This is
//                  not a preference for DesignFlow; the facts are simply absent
//                  upstream.
//
// Consequences that are enforced, not merely documented:
//   * ColdLion's current descriptive truth is ALWAYS recorded in the provenance layer
//     (core.taxonomy_source_ref.source_name / .source_code) for every valid linked row.
//     That is where provenance belongs (AGENTS.md §4.1) and it never overloads the
//     curated display name.
//   * The CURATED display name core.licensor.name / core.property.name is changed only
//     by ONE explicitly approved deterministic rule (below), and every decision — applied
//     or not — writes an audit row.
//   * Absence from ColdLion is never delete and never inactivate. Presence is never
//     activate. A new ColdLion record is never auto-created canonically.
//
// THE ONE APPROVED DETERMINISTIC NAME RULE
// ----------------------------------------
//   coldlion_source_name_normalized_equivalent_v1
//
// Apply the ColdLion source name over the curated display name if and only if the two
// names are the SAME NAME PRESENTED DIFFERENTLY — identical after normalization
// (casefold, collapse whitespace, "&" -> "and", strip punctuation). So
// "BATMAN" -> "Batman" and "TOM AND JERRY" -> "Tom & Jerry" are applied; they cannot
// change which entity a row means.
//
// If the normalized forms DIFFER, the row QUARANTINES as `source_name_divergence` and
// the curated name is left alone. This is the deliberate hard line. A normalized-different
// name is indistinguishable, from the payload alone, between a legitimate ERP rename and
// a re-pointed code — and a re-pointed code is precisely the `FR` class of bug that can
// attach a ColdLion *property* to the FRIENDS TV *licensor*. Auto-applying it would let a
// single upstream keystroke silently relabel a canonical row that thousands of items,
// style guides, and saved links depend on. ColdLion's new value is still captured in the
// provenance layer, so nothing is lost — a human simply confirms the identity first.
//
// Everything in this module is PURE: no network, no database, no clock. That is what
// makes the contract testable row by row, which is the only way to prove a compensating
// pair of errors (one missing + one extra) cannot pass as "counts match".

export const PROMOTION_RULE_ID = "coldlion_source_name_normalized_equivalent_v1";
export const PROMOTION_MODE = "promote_source_owned";
export const HUMAN_RESPONSE_OWNER = "Albert Hazan";

/** Fields ColdLion may cause to change, anywhere. Nothing else is promotable. */
export const SOURCE_OWNED_FIELDS = Object.freeze([
  "core.taxonomy_source_ref.source_name",
  "core.taxonomy_source_ref.source_code",
  "core.licensor.name",
  "core.property.name",
]);

/**
 * Fields ColdLion may NEVER change. An attempt to name one of these in a promotion
 * payload is not a quarantine — it is a protected-invariant violation that trips the
 * circuit breaker and fails the whole run before any canonical row is touched.
 */
export const PROTECTED_FIELDS = Object.freeze([
  "core.licensor.id",
  "core.property.id",
  "core.property.licensor_id",
  "core.licensor.status",
  "core.property.status",
  "core.licensor.code",
  "core.property.code",
]);

export const QUARANTINE_REASONS = Object.freeze([
  "new_source_record",
  "missing_source_record",
  "ambiguous_match",
  "cross_typed",
  "code_collision",
  "cross_division_collision",
  "wrong_type",
  "rekeyed_record",
  "parentless_record",
  "source_name_divergence",
]);

// =====================================================================================
// Typed natural key — NEVER code alone
// =====================================================================================

/**
 * The full typed source key. mgCode alone is ambiguous by design in ColdLion: `FR` is a
 * licensor in our database and a *property* in ColdLion, and merch-group codes are unique
 * only within (division, mgTypeCode). Every resolution in this module goes through this
 * function, so "match on code" is not expressible.
 */
export function typedKey(row) {
  return [row?.company, row?.division, row?.mgTypeCode, row?.mgCode]
    .map((v) => (v ?? "").toString().trim())
    .join("/");
}

export function isCompleteTypedKey(row) {
  const parts = [row?.company, row?.division, row?.mgTypeCode, row?.mgCode].map((v) =>
    (v ?? "").toString().trim(),
  );
  if (parts.some((p) => p === "")) return false;
  return /^[0-9]{2}$/.test(parts[2]);
}

// =====================================================================================
// The approved deterministic name rule
// =====================================================================================

// The accent-folding map. It is spelled out as an explicit pair of equal-length strings
// rather than derived from Unicode normalization because the SAME map has to exist in
// PostgreSQL (as translate(...)) inside
// supabase/migrations/20260729230000_coldlion_licensor_property_recurring_promotion.sql.
// The `unaccent` extension is NOT installed in this database, so a Unicode-derived
// normalization in JavaScript could not be reproduced in SQL — and the promotion function
// treats ANY disagreement between the runner's plan and its own independent SQL
// recomputation as a fail-closed abort. Two implementations that must agree exactly are
// only safe if they are character-for-character the same table.
//
// Anything NOT in this map (ligatures, sharp s, CJK, symbols) is collapsed to a space by
// the final punctuation pass in BOTH languages, so the two sides still agree.
export const ACCENT_FOLD_FROM =
  "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳ";
export const ACCENT_FOLD_TO =
  "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzsOoUuAaIiOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYy";

const ACCENT_FOLD = new Map(
  [...ACCENT_FOLD_FROM].map((ch, i) => [ch, [...ACCENT_FOLD_TO][i]]),
);

/**
 * Normalization used ONLY to decide "is this the same name presented differently?".
 * It is never used as a matching key on its own and never stored as a name.
 *
 * Must stay byte-for-byte equivalent to plm.coldlion_normalize_name(text) in SQL.
 */
export function normalizeName(value) {
  return [...String(value ?? "")]
    .map((ch) => ACCENT_FOLD.get(ch) ?? ch)
    .join("")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * @returns {{decision: "apply"|"unchanged"|"quarantine", rule: string, reason: string|null}}
 */
export function decideNamePromotion(canonicalName, sourceName) {
  const source = String(sourceName ?? "").trim();
  const canonical = String(canonicalName ?? "").trim();

  if (source === "") {
    return {
      decision: "quarantine",
      rule: PROMOTION_RULE_ID,
      reason: "source_name_divergence",
      detail: "ColdLion sent a blank descriptive value; a blank never overwrites a curated name",
    };
  }
  if (source === canonical) {
    return { decision: "unchanged", rule: PROMOTION_RULE_ID, reason: null, detail: "identical" };
  }
  if (normalizeName(source) === normalizeName(canonical)) {
    return {
      decision: "apply",
      rule: PROMOTION_RULE_ID,
      reason: null,
      detail: "normalized-equivalent presentation change (same name, different casing/spacing/punctuation)",
    };
  }
  return {
    decision: "quarantine",
    rule: PROMOTION_RULE_ID,
    reason: "source_name_divergence",
    detail:
      "ColdLion's descriptive value is not a presentation variant of the curated name; a human must confirm this is a rename and not a re-pointed code before the curated name changes",
  };
}

// =====================================================================================
// Protected-invariant refusal (fail closed BEFORE any canonical write)
// =====================================================================================

/**
 * Any field named in a promotion payload that is not source-owned is a protected-invariant
 * violation. Returns the violations; a non-empty result must trip the breaker and abort.
 */
export function findProtectedFieldViolations(payloadRows = []) {
  const violations = [];
  for (const row of Array.isArray(payloadRows) ? payloadRows : []) {
    for (const field of Object.keys(row?.proposed_fields ?? {})) {
      if (PROTECTED_FIELDS.includes(field)) {
        violations.push({ key: typedKey(row), field, attempted: row.proposed_fields[field] });
      } else if (!SOURCE_OWNED_FIELDS.includes(field)) {
        violations.push({ key: typedKey(row), field, attempted: row.proposed_fields[field] });
      }
    }
  }
  return violations;
}

// =====================================================================================
// The whole-cycle plan
// =====================================================================================

/**
 * Build the deterministic promotion plan for one recurring cycle. Pure.
 *
 * @param {object} input
 * @param {Array} input.sourceRows   this cycle's ColdLion rows:
 *   {company, division, mgTypeCode, mgCode, entityType, name}
 * @param {Array} input.linkedRows   the approved links currently in the database:
 *   {company, division, mgTypeCode, mgCode, entityType, canonical_id, canonical_name,
 *    canonical_code, canonical_status, canonical_licensor_id, source_ref_name}
 * @returns {{
 *   mode: string, rule: string, promotions: Array, unchanged: Array,
 *   quarantines: Array, protected_violations: Array, refuse: boolean,
 *   counts: Record<string, number>
 * }}
 */
export function planRecurringPromotion({ sourceRows = [], linkedRows = [] } = {}) {
  const promotions = [];
  const unchanged = [];
  const quarantines = [];

  const quarantine = (row, reason, detail, extra = {}) => {
    quarantines.push({ key: typedKey(row), entity_type: row?.entityType ?? null, reason, detail, ...extra });
  };

  // --- index the approved links by FULL typed key (never by code) --------------------
  const linkedByKey = new Map();
  const linkedByCanonical = new Map();
  for (const l of linkedRows) {
    const k = typedKey(l);
    if (!linkedByKey.has(k)) linkedByKey.set(k, []);
    linkedByKey.get(k).push(l);
    const cid = l?.canonical_id ?? null;
    if (cid) {
      if (!linkedByCanonical.has(cid)) linkedByCanonical.set(cid, []);
      linkedByCanonical.get(cid).push(l);
    }
  }

  // --- index this cycle's source rows, detecting duplicate/colliding keys -----------
  const sourceByKey = new Map();
  for (const s of sourceRows) {
    const k = typedKey(s);
    if (!sourceByKey.has(k)) sourceByKey.set(k, []);
    sourceByKey.get(k).push(s);
  }

  // WHAT IS AND IS NOT A COLLISION — corrected 2026-07-29 by the preview rehearsal.
  //
  // The first version of this rule quarantined any canonical row reachable from more than
  // one typed key. Running it against preview quarantined 542 of 542 rows — the ENTIRE
  // feed — because multi-key fan-in is the approved design, not a fault: Albert's approved
  // Phase 4 mapping deliberately points 542 ColdLion source rows at 271 canonical rows.
  // The same property legitimately exists under CW001 and SP001, and both keys mean the
  // same canonical entity.
  //
  // The real hazard is not fan-in. It is fan-in where the source rows DISAGREE about the
  // name, because then promotion would have to pick a winner — and picking a winner is
  // exactly the silent corruption this whole workstream exists to prevent. So a collision
  // is fan-in PLUS conflicting source names.
  const collidingCanonicalIds = new Map(); // canonical_id -> {reason, keys}
  for (const [canonicalId, rows] of linkedByCanonical) {
    const distinctKeys = [...new Set(rows.map((r) => typedKey(r)))];
    if (distinctKeys.length <= 1) continue;

    const proposedNames = new Set(
      distinctKeys
        .flatMap((k) => sourceByKey.get(k) ?? [])
        .map((s) => normalizeName(s.name)),
    );
    if (proposedNames.size <= 1) continue; // approved fan-in, all agreeing — not a fault

    const withoutDivision = new Set(
      distinctKeys.map((k) => {
        const [company, , mgTypeCode, mgCode] = k.split("/");
        return [company, mgTypeCode, mgCode].join("/");
      }),
    );
    const divisionsDiffer = new Set(distinctKeys.map((k) => k.split("/")[1])).size > 1;
    collidingCanonicalIds.set(canonicalId, {
      reason:
        withoutDivision.size === 1 && divisionsDiffer
          ? "cross_division_collision"
          : "code_collision",
      keys: distinctKeys,
      names: [...proposedNames],
    });
  }

  const seenSourceKeys = new Set();

  for (const source of sourceRows) {
    const key = typedKey(source);
    seenSourceKeys.add(key);

    if (!isCompleteTypedKey(source)) {
      quarantine(source, "wrong_type", "incomplete or malformed typed key (company/division/two-digit mgTypeCode/mgCode all required)");
      continue;
    }
    if (source.entityType !== "licensor" && source.entityType !== "property") {
      quarantine(source, "wrong_type", `resolved entity meaning is "${source.entityType ?? "(none)"}", not licensor/property — the (division, mgTypeCode) header does not denote a licensed entity`);
      continue;
    }

    const dupes = sourceByKey.get(key) ?? [];
    if (dupes.length > 1) {
      const distinctNames = new Set(dupes.map((d) => String(d.name ?? "")));
      quarantine(source, distinctNames.size > 1 ? "ambiguous_match" : "code_collision",
        `the same typed key arrived ${dupes.length} times in one snapshot`);
      continue;
    }

    const links = linkedByKey.get(key) ?? [];
    if (links.length === 0) {
      // Never auto-create a canonical licensor or property. A brand-new ColdLion record
      // is business news that needs review, not an insert.
      quarantine(source, "new_source_record",
        "ColdLion sent a record with no approved canonical link; canonical rows are never auto-created");
      continue;
    }
    if (links.length > 1 || new Set(links.map((l) => l.canonical_id)).size > 1) {
      quarantine(source, "ambiguous_match",
        `the typed key resolves to ${new Set(links.map((l) => l.canonical_id)).size} canonical rows`);
      continue;
    }

    const link = links[0];

    if (link.entityType !== source.entityType) {
      quarantine(source, "cross_typed",
        `ColdLion says this is a ${source.entityType} but the approved link points at a ${link.entityType} canonical row`,
        { canonical_id: link.canonical_id });
      continue;
    }

    const collision = collidingCanonicalIds.get(link.canonical_id);
    if (collision) {
      quarantine(
        source,
        collision.reason,
        `canonical row ${link.canonical_id} is fed by ${collision.keys.length} typed keys that propose DIFFERENT names (${collision.names.join(" | ")}); promotion will not pick a winner`,
        { canonical_id: link.canonical_id, colliding_keys: collision.keys },
      );
      continue;
    }

    // Re-key check. The canonical code is NOT ColdLion's to rewrite: applications hold
    // saved references to it. A source code that no longer matches means the row was
    // re-keyed upstream, which is a review item, never an update.
    if (String(link.canonical_code ?? "") !== String(source.mgCode ?? "")) {
      quarantine(source, "rekeyed_record",
        `canonical code "${link.canonical_code}" no longer equals ColdLion mgCode "${source.mgCode}"`,
        { canonical_id: link.canonical_id });
      continue;
    }

    if (source.entityType === "property" && !link.canonical_licensor_id) {
      quarantine(source, "parentless_record",
        "canonical property has no licensor parent; the parent edge is Supabase-curated and must be fixed before promotion",
        { canonical_id: link.canonical_id });
      continue;
    }

    // ---- provenance is ALWAYS refreshed for a valid linked row --------------------
    const provenanceFields = {};
    if (String(link.source_ref_name ?? "") !== String(source.name ?? "")) {
      provenanceFields["core.taxonomy_source_ref.source_name"] = source.name;
    }

    // ---- curated display name: the one approved deterministic rule ----------------
    const nameDecision = decideNamePromotion(link.canonical_name, source.name);

    if (nameDecision.decision === "quarantine") {
      quarantine(source, nameDecision.reason, nameDecision.detail, {
        canonical_id: link.canonical_id,
        canonical_name: link.canonical_name,
        source_name: source.name,
        // ColdLion's truth is still recorded in provenance even while the curated name
        // is held for review, so nothing upstream is lost.
        provenance_fields: provenanceFields,
      });
      continue;
    }

    const canonicalField = source.entityType === "licensor" ? "core.licensor.name" : "core.property.name";
    const proposed_fields = { ...provenanceFields };
    if (nameDecision.decision === "apply") proposed_fields[canonicalField] = source.name;

    if (Object.keys(proposed_fields).length === 0) {
      unchanged.push({ key, entity_type: source.entityType, canonical_id: link.canonical_id });
      continue;
    }

    promotions.push({
      key,
      entity_type: source.entityType,
      canonical_id: link.canonical_id,
      rule: nameDecision.rule,
      rule_detail: nameDecision.detail,
      curated_name_changed: nameDecision.decision === "apply",
      old_values: {
        [canonicalField]: link.canonical_name ?? null,
        "core.taxonomy_source_ref.source_name": link.source_ref_name ?? null,
      },
      proposed_fields,
    });
  }

  // --- rows we have an approved link for that ColdLion did NOT send this cycle -------
  // Absence is NEVER delete and NEVER inactivate. It is a review item, full stop.
  for (const [key, links] of linkedByKey) {
    if (seenSourceKeys.has(key)) continue;
    const link = links[0];
    quarantines.push({
      key,
      entity_type: link.entityType ?? null,
      reason: "missing_source_record",
      detail:
        "an approved-linked record was absent from this ColdLion snapshot; absence never deletes, inactivates, or unlinks a canonical row",
      canonical_id: link.canonical_id,
    });
  }

  const protectedViolations = findProtectedFieldViolations(promotions);

  return {
    mode: PROMOTION_MODE,
    rule: PROMOTION_RULE_ID,
    human_response_owner: HUMAN_RESPONSE_OWNER,
    promotions,
    unchanged,
    quarantines,
    protected_violations: protectedViolations,
    // Fail closed: a protected violation aborts the ENTIRE cycle before any canonical
    // write, so a run can never leave a partially promoted canonical layer behind.
    refuse: protectedViolations.length > 0,
    counts: {
      source_rows: sourceRows.length,
      linked_rows: linkedRows.length,
      promotions: promotions.length,
      curated_name_changes: promotions.filter((p) => p.curated_name_changed).length,
      unchanged: unchanged.length,
      quarantines: quarantines.length,
      protected_violations: protectedViolations.length,
    },
  };
}

/**
 * Idempotency proof helper: a plan whose promotions list is empty (everything unchanged
 * or already quarantined) means a second identical cycle changes nothing.
 */
export function isNoOpCycle(plan) {
  return Boolean(plan) && plan.refuse === false && plan.promotions.length === 0;
}
