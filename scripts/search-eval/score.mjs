// Pure scoring for the search test set. No network and no data here: this repo is public,
// so the judged cases live in the private database (admin_config SEARCH_EVAL_SET_V1).

const TOP = 10;

/** Score one search of one case. `judged` = { relevant: [], irrelevant: [], must_find: [] }. */
export function scoreSearch(testCase, judged, hits, { error = null, total = hits.length, ms = 0 } = {}) {
  const relevant = new Set(judged?.relevant ?? []);
  const irrelevant = new Set(judged?.irrelevant ?? []);
  const top = hits.slice(0, TOP);
  const relTop = top.filter((id) => relevant.has(id)).length;
  const badTop = top.filter((id) => irrelevant.has(id)).length;
  const unjudgedTop = top.length - relTop - badTop;
  const mustFind = judged?.must_find ?? [];
  const found = mustFind.filter((id) => hits.includes(id)).length;
  const row = {
    id: testCase.id,
    kind: testCase.kind,
    total,
    ms,
    error,
    returned: hits.length,
    relevant_top10: relTop,
    irrelevant_top10: badTop,
    unjudged_top10: unjudgedTop,
    must_find: mustFind.length,
    must_found: found,
    first_relevant_rank: hits.findIndex((id) => relevant.has(id)) + 1 || null,
  };
  row.pass = passes(testCase, row, judged);
  return row;
}

function passes(testCase, row, judged) {
  if (row.error) return false;
  if (testCase.expect_empty) return row.total === 0;
  if (testCase.kind === "code" && testCase.exact) return row.first_relevant_rank === 1;
  if (judged?.expected_total && row.total < judged.expected_total * 0.5) return false;
  if (row.relevant_top10 === 0) return false;
  const judgedTop = row.relevant_top10 + row.irrelevant_top10;
  if (judgedTop > 0 && row.relevant_top10 / judgedTop < 0.5) return false;
  if (row.must_find > 0 && row.must_found / row.must_find < 0.5) return false;
  return true;
}

/** Roll rows up by test kind plus an overall line. */
export function summarize(rows) {
  const group = (items) => {
    const judged = items.reduce((n, r) => n + r.relevant_top10 + r.irrelevant_top10, 0);
    const rel = items.reduce((n, r) => n + r.relevant_top10, 0);
    const shown = items.reduce((n, r) => n + Math.min(r.returned, TOP), 0);
    const unjudged = items.reduce((n, r) => n + r.unjudged_top10, 0);
    const must = items.reduce((n, r) => n + r.must_find, 0);
    const found = items.reduce((n, r) => n + r.must_found, 0);
    const times = items.map((r) => r.ms).sort((a, b) => a - b);
    return {
      cases: items.length,
      passed: items.filter((r) => r.pass).length,
      errors: items.filter((r) => r.error).length,
      precision_top10: judged ? round(rel / judged) : null,
      must_find_recall: must ? round(found / must) : null,
      unjudged_share: shown ? round(unjudged / shown) : 0,
      p50_ms: times[Math.floor(times.length * 0.5)] ?? 0,
      p95_ms: times[Math.floor(times.length * 0.95)] ?? 0,
    };
  };
  const byKind = {};
  for (const kind of [...new Set(rows.map((r) => r.kind))].sort()) {
    byKind[kind] = group(rows.filter((r) => r.kind === kind));
  }
  return { overall: group(rows), by_kind: byKind };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/** Warn when so many results are unjudged that the score cannot be trusted as is. */
export function trustWarning(summary) {
  return summary.overall.unjudged_share > 0.3
    ? `More than 30% of top results are unjudged (${summary.overall.unjudged_share}); judge them before comparing scores.`
    : null;
}
