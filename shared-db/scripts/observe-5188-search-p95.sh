#!/usr/bin/env bash
# Read-only p95 observation for shared-db outcome #5188.
#
# Times hts_rag_search_rulings on production with the clock taken INSIDE the
# database (one SELECT per sample), connecting as the migration administrator —
# the function's owner, whose EXECUTE the restricted Management-API role lacks.
#
# Two workloads are measured, because the live assertion's "ruling search p95
# stays under 300 ms" is the design's classification benchmark
# (designflow-backend#254, design docs §5-§6), which queries with CANDIDATE
# CHAPTERS (pass 1). Full-corpus queries (pass 2, what a no-chapters call does)
# are recorded as context and do NOT gate. No writes: every statement is one
# SELECT. Emits observation.json for the application-side publisher
# (popcre/designflow-backend shared-db-5188-proof), which verifies it and
# republishes the outcome envelope; the app repository never receives a
# database credential.
set -euo pipefail

PROJECT_REF="qsllyeztdwjgirsysgai"
WORK_ISSUE=5188
P95_BUDGET_MS=300
SAMPLES=20
OUT_DIR="${RUNNER_TEMP:-/tmp}/shared-db-5188-observation"
mkdir -p "$OUT_DIR"

# query text | candidate chapters (blank = full corpus)
CASES=(
  "ceramic decorative article|69"
  "toys principally designed for amusement|95"
  "textile made up article|63"
  "furniture designed to be placed on the floor|94"
  "containers of heading 4202|42"
  "porcelain tableware|69"
  "festive article|95"
  "mixtures and combinations of materials|39"
  "parts and accessories|84"
  "incomplete unfinished article|87"
  "packing materials|46"
  "classification of sets|63"
)

LINK_DIR="$(mktemp -d)"
cd "$LINK_DIR"
supabase link --project-ref "$PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" >/dev/null 2>&1
POOLER_URL="$(cat "$LINK_DIR/supabase/.temp/pooler-url")"
POOLER_HOSTPORT="${POOLER_URL#*@}"
POOLER_HOSTPORT="${POOLER_HOSTPORT%%/*}"
CONNINFO="host=${POOLER_HOSTPORT%%:*} port=${POOLER_HOSTPORT##*:} dbname=postgres user=postgres.${PROJECT_REF} sslmode=require"
[[ -n "${SUPABASE_DB_PASSWORD:-}" ]] || { echo "SUPABASE_DB_PASSWORD is empty"; exit 1; }
CONNINFO="$CONNINFO password=${SUPABASE_DB_PASSWORD}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

SCOPED_FILE="$OUT_DIR/scoped.txt"
CORPUS_FILE="$OUT_DIR/corpus.txt"
: > "$SCOPED_FILE"
: > "$CORPUS_FILE"

for ((i = 0; i < SAMPLES; i++)); do
  ENTRY="${CASES[$((i % ${#CASES[@]}))]}"
  PHRASE="${ENTRY%%|*}"
  CHAPTERS="${ENTRY##*|}"
  ESCAPED="${PHRASE//\'/\'\'}"

  # Pass 1 shape: candidate chapters, the classifier's real workload.
  MS="$(psql "$CONNINFO" -X -At -v ON_ERROR_STOP=1 -c \
    "select round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2)
       from (select clock_timestamp() as t0) s,
            lateral (select count(*) from hts_rag.hts_rag_search_rulings('${ESCAPED}', array['${CHAPTERS}'])) r")"
  [[ "$MS" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "scoped sample $i produced no timing: $MS"; exit 1; }
  echo "$MS" >> "$SCOPED_FILE"

  # Pass 2 shape: full corpus, recorded as context only.
  MS="$(psql "$CONNINFO" -X -At -v ON_ERROR_STOP=1 -c \
    "select round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2)
       from (select clock_timestamp() as t0) s,
            lateral (select count(*) from hts_rag.hts_rag_search_rulings('${ESCAPED}')) r")"
  [[ "$MS" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "corpus sample $i produced no timing: $MS"; exit 1; }
  echo "$MS" >> "$CORPUS_FILE"
done

STATS="$(node -e '
const fs = require("node:fs");
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const read = (f) => fs.readFileSync(f, "utf8").trim().split(/\s+/).map(Number).sort((a, b) => a - b);
const s = read(process.argv[1]); const c = read(process.argv[2]);
console.log(pct(s, 50), pct(s, 95), pct(c, 50), pct(c, 95));
' "$SCOPED_FILE" "$CORPUS_FILE")"
read -r SCOPED_P50 SCOPED_P95 CORPUS_P50 CORPUS_P95 <<<"$STATS"

OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "ruling search scoped p50=${SCOPED_P50}ms p95=${SCOPED_P95}ms | full-corpus p50=${CORPUS_P50}ms p95=${CORPUS_P95}ms | n=${SAMPLES} (server-side, migration admin)"
if awk -v p95="$SCOPED_P95" -v budget="$P95_BUDGET_MS" 'BEGIN { exit !(p95 < budget) }'; then :; else
  echo "chapter-scoped ruling search p95 ${SCOPED_P95}ms is not under ${P95_BUDGET_MS}ms"; exit 1
fi

node -e '
const fs = require("node:fs");
const path = require("node:path");
const [outDir, workIssue, observedAt, sp50, sp95, cp50, cp95, n, budget, repo, runId, sha] = process.argv.slice(1);
const observation = {
  schema_version: 1, kind: "search-p95-observation",
  work_issue: Number(workIssue), environment: "production", result: "passed",
  observed_at: observedAt,
  p50_ms: Number(sp50), p95_ms: Number(sp95),
  corpus_p50_ms: Number(cp50), corpus_p95_ms: Number(cp95),
  samples: Number(n), budget_ms: Number(budget), workload: "chapter-scoped pass 1 (classifier benchmark)",
  producer: { repository: repo, run_id: Number(runId), commit_sha: String(sha).toLowerCase() },
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "observation.json"), JSON.stringify(observation, null, 2) + "\n");
console.log(`observation.json written with observed_at=${observedAt}`);
' "$OUT_DIR" "$WORK_ISSUE" "$OBSERVED_AT" "$SCOPED_P50" "$SCOPED_P95" "$CORPUS_P50" "$CORPUS_P95" \
  "$SAMPLES" "$P95_BUDGET_MS" "${GITHUB_REPOSITORY:-popcre/shared-db}" "${GITHUB_RUN_ID:-0}" "${GITHUB_SHA:-0}"
