// The cutoff-retirement gate (plan section 13).
//
// This module answers one question and nothing else: does the CURRENT live
// population satisfy every condition that would allow the temporary May 14, 2025
// cutoff to be retired? It never removes anything. Removing the cutoff is a
// structural change to `api.resolve_item_mg_category(integer)` and must be
// routed fresh through the shared-db orchestrator with Albert's explicit
// authorization, after this gate passes AND independent review.
//
// It is written to fail. As of 2026-09-03 there were 127 live rows with a null
// creation date, so condition 1 alone holds the gate closed.

export const RESIDUAL_CLASSES = Object.freeze([
  'null_or_conflicting_creation_date',
  'ambiguous_production_identity',
  'missing_production_identity',
  'taxonomy_conflict',
  'retired_division_ep001',
  'partial_level_2_or_1',
  'no_usable_product_description',
  'readable_product_without_mg01',
  'stale_source',
  'failed',
  'rollback_pending',
]);

/**
 * @param {object} m live measurements
 * @returns {{pass: boolean, failures: string[]}}
 */
export function evaluateRetirementGate(m) {
  const failures = [];
  const need = (cond, msg) => { if (!cond) failures.push(msg); };

  need(m.null_or_unresolved_creation_dates === 0,
    `condition 1: ${m.null_or_unresolved_creation_dates} live item(s) have a null or unresolved creation date`);
  need(m.historical_items === m.ledger_distinct_item_id_pk,
    `condition 2: ${m.historical_items} historical items but ${m.ledger_distinct_item_id_pk} distinct ledger entries`);
  need(m.historical_items_with_complete_agreeing_triplet === m.historical_items,
    `condition 3: ${m.historical_items - m.historical_items_with_complete_agreeing_triplet} historical item(s) lack an agreeing raw/normalized MG01-MG03 triplet`);
  need(m.historical_items_with_active_division_qualified_chain === m.historical_items,
    `condition 4: ${m.historical_items - m.historical_items_with_active_division_qualified_chain} historical item(s) do not resolve through an active division-qualified MG01-MG02-MG03 chain`);
  for (const cls of RESIDUAL_CLASSES) {
    const n = m.residuals?.[cls] ?? 0;
    need(n === 0, `condition 5: ${n} row(s) remain in residual class "${cls}"`);
  }
  need(m.reconciles_to_current_live_population === true,
    'condition 6: totals do not reconcile to the CURRENT live population');
  need(m.independent_review_confirmed === true && m.owner_authorized_retirement === true,
    'condition 7: independent review confirmation and Albert\'s explicit retirement authorization are both required');

  return { pass: failures.length === 0, failures };
}
