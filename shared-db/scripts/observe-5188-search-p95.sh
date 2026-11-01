#!/usr/bin/env bash
# Read-only p95 observation for shared-db outcome #5188.
#
# Times hts_rag_search_rulings on production with the clock taken INSIDE the
# database (one SELECT per sample), connecting as the migration administrator —
# the function's owner, whose EXECUTE the restricted Management-API role lacks.
# No writes: every statement is a single SELECT. Emits observation.json for the
# application-side publisher (popcre/designflow-backend shared-db-5188-proof),
# which verifies it and republishes the outcome envelope; the app repository
# never receives a database credential.
set -euo pipefail

PROJECT_REF="qsllyeztdwjgirsysgai"
WORK_ISSUE=5188
P95_BUDGET_MS=300
SAMPLES=40
OUT_DIR="${RUNNER_TEMP:-/tmp}/shared-db-5188-observation"
mkdir -p "$OUT_DIR"

QUERIES=(
  "ceramic decorative article"
  "toys principally designed for amusement"
  "textile made up article"
  "furniture designed to be placed on the floor"
  "containers of heading 4202"
  "porcelain tableware"
  "festive article"
  "mixtures and combinations of materials"
  "parts and accessories"
  "incomplete unfinished article"
  "packing materials"
  "classification of sets"
)

LINK_DIR="$(mktemp -d)"
cd "$LINK_DIR"
supabase link --project-ref "$PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" >/dev/null
POOLER_URL="$(cat "$LINK_DIR/supabase/.temp/pooler-url")"
# The pooler (transaction mode) authenticates `postgres.<project-ref>` and the
# linked URL carries no password; psql reads the password from PGPASSWORD. Build
# the conninfo explicitly so the pooler-required user form is never dependent on
# whatever the linked URL happens to contain.
POOLER_HOSTPORT="${POOLER_URL#*@}"
POOLER_HOSTPORT="${POOLER_HOSTPORT%%/*}"
CONNINFO="host=${POOLER_HOSTPORT%%:*} port=${POOLER_HOSTPORT##*:} dbname=postgres user=postgres.${PROJECT_REF} sslmode=require"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

TIMINGS_FILE="$OUT_DIR/timings.txt"
: > "$TIMINGS_FILE"
for ((i = 0; i < SAMPLES; i++)); do
  PHRASE="${QUERIES[$((i % ${#QUERIES[@]}))]}"
  MS="$(psql "$CONNINFO" -X -At -v ON_ERROR_STOP=1 -c \
    "select round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 2)
       from (select clock_timestamp() as t0) s,
            lateral (select count(*) from hts_rag.hts_rag_search_rulings('${PHRASE//\'/\'\'}')) r")"
  [[ "$MS" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "sample $i produced no timing: $MS"; exit 1; }
  echo "$MS" >> "$TIMINGS_FILE"
done

read -r P50 P95 N <<<"$(node -e '
const fs = require("node:fs");
const sorted = fs.readFileSync(process.argv[1], "utf8").trim().split(/\s+/).map(Number).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
console.log(pct(50), pct(95), sorted.length);
' "$TIMINGS_FILE")"

OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "ruling search p50=${P50}ms p95=${P95}ms n=${N} (server-side, migration admin)"
if awk -v p95="$P95" -v budget="$P95_BUDGET_MS" 'BEGIN { exit !(p95 < budget) }'; then :; else
  echo "ruling search p95 ${P95}ms is not under ${P95_BUDGET_MS}ms"; exit 1
fi

node -e '
const fs = require("node:fs");
const path = require("node:path");
const [outDir, workIssue, observedAt, p50, p95, n, budget, repo, runId, sha] = process.argv.slice(1);
const observation = {
  schema_version: 1, kind: "search-p95-observation",
  work_issue: Number(workIssue), environment: "production", result: "passed",
  observed_at: observedAt, p50_ms: Number(p50), p95_ms: Number(p95),
  samples: Number(n), budget_ms: Number(budget),
  producer: { repository: repo, run_id: Number(runId), commit_sha: String(sha).toLowerCase() },
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "observation.json"), JSON.stringify(observation, null, 2) + "\n");
console.log(`observation.json written with observed_at=${observedAt}`);
' "$OUT_DIR" "$WORK_ISSUE" "$OBSERVED_AT" "$P50" "$P95" "$N" "$P95_BUDGET_MS" \
  "${GITHUB_REPOSITORY:-popcre/shared-db}" "${GITHUB_RUN_ID:-0}" "${GITHUB_SHA:-0}"
