# DAM semantic-search relevance & performance baseline — 2026-10-19

**Source:** `8654e2c6` worktree `mimo/issue97-dam-semantic-20261019`  
**Target:** live `dam-search-ai` on production `qsllyeztdwjgirsysgai`  
**Role:** administrator tester (authenticated). Keyword mode (`search-modes` → `dam: keyword`).  
**Judgments:** private suite in protected evidence dir (real IDs not in this file).  
**Synthetic fixtures:** `src/test/fixtures/semantic-search-cases.json` (40 cases, 10/view).

## Keyword baseline — aggregate (no licensed identifiers)

| Case class | Queries | p50 warm | p95 / timeout | Notes |
|---|---:|---:|---:|---|
| Paraphrase (rarer terms) | 4 | ~2.3s | 3.4s | OK under 8s |
| Multi-attribute / broad tags | 3 | ~7.6s | 7.7s | near ceiling |
| Exact common character (spider-man, stitch) | 2 | — | **>8s timeout** | breaches 8s viewer ceiling |
| Broad tag (wall art canvas) | 1 | — | **>8s timeout** | breaches ceiling |
| Style-group character (stitch) | 1 | — | **>8s timeout (503)** | same |
| No-match token | 1 | 1.8s | — | **BUG: returns 40 rows** — expected 0 |
| Restricted filter (psd + glitter) | 1 | 3.6s | — | filter applied |
| Style-group holiday | 1 | 4.7s | — | OK |

Warm repeat of a common 3k-hit query: 1.5s / 1.6s / 3.0s after first hit. Cold first-hit 2.3–3.6s.

## Gate status vs plan §9 step 2

| Gate | Status | Evidence |
|---|---|---|
| 100% exact identifiers in top 5 | **not yet scored** | semantic not enabled; keyword exact common terms **time out** |
| Paraphrase NDCG@10 semantic ≥ +10% rel (or +0.10 abs) | **pending semantic** | keyword paraphrase baseline recorded in private suite |
| No overall NDCG@10 regression | pending | |
| No known wrong-property in top 5 | pending | |
| Performance: warm p95 ≤3s / cold ≤6s / statements <8s | **FAIL on common terms** | spider-man / stitch / wall-art-canvas exceed 8s |
| No-match returns empty | **FAIL** | nonsense token returns 40 rows |

## Performance defect (must fix before activation)

High-document-frequency terms breach the function's own `statement_timeout='8s'`. This is not a semantic issue — it is the existing keyword path. Remediation belongs with the query-shape shared-db change (candidate limits, better indexes, or summary path). Do not raise the timeout.

## No-match pollution

A token with no corpus presence still returns 40 rows. Suspect `expand_dam_search_queries` / substring ILIKE on title/path/customer/program. Must be root-caused in the same canonical function change; labeled negative set depends on it.

## Next

1. Freeze private expected IDs for paraphrase/exact/alias cases (done in evidence dir; pre-labeled before any semantic scores).
2. Shared-db claim: fix (a) semantic 20k-before-filters, (b) no embedding-model predicate, (c) summary lost on empty page, (d) group/asset rollup parity, (e) no-match pollution + common-term latency — all inside `search_dam_documents` / helpers only.
3. After #96 release artifact: resume embed checkpoint, re-score semantic, run full gate table.
