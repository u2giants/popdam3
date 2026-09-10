#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; cd "$ROOT"; export AI_TASK_GATES_DIR="$TMP/state"; failures=0; passes=0
pass(){ passes=$((passes + 1)); printf 'PASS: %s\n' "$1"; }; fail(){ printf 'FAIL: %s\n' "$1" >&2; failures=$((failures + 1)); }
expect_class(){ local path="$1" expected="$2" label="$3" actual; printf '%s\n' "$path" > "$TMP/paths"; actual="$(ai-task-gates explain --json --paths-from "$TMP/paths" | jq -r '.observed_class')"; if [ "$actual" = "$expected" ]; then pass "$label"; else fail "$label (expected $expected, got $actual)"; fi; }
expect_class README.md prose 'ordinary documentation uses the prose fast path'
expect_class src/App.tsx ui-live-workflow 'browser behavior requires authenticated visual proof'
expect_class AGENTS.md reviewer-safety 'agent rulebook receives protected full treatment'
expect_class .ai-devops/task-gates.json reviewer-safety 'task-gate policy protects itself'
expect_class .github/workflows/publish-frontend.yml deployment 'release workflow is protected deployment work'
expect_class apps/worker/src/index.ts deployment 'Railway worker is protected deployment work'
expect_class apps/bridge-agent/src/index.ts deployment 'NAS agent is protected deployment work'
expect_class supabase/functions/admin-api/index.ts deployment 'edge function is protected deployment work'
expect_class shared-db/supabase/migrations/fixture.sql shared-db 'vendored database structure retains the governed route'
expect_class supabase/migrations/fixture.sql shared-db 'historical app migration path retains the governed route'
expect_class src/integrations/supabase/types.ts shared-db 'generated database contract retains the governed route'
fixture="$TMP/popdam3"; git -C "$TMP" init --quiet popdam3; git -C "$fixture" config user.name 'Task Gate Test'; git -C "$fixture" config user.email 'task-gate-test@example.invalid'; git -C "$fixture" remote add origin https://github.com/example/popdam-task-gate-fixture.git
mkdir -p "$fixture/.ai-devops"; cp "$ROOT/.ai-devops/task-gates.json" "$fixture/.ai-devops/task-gates.json"; git -C "$fixture" add .ai-devops/task-gates.json; git -C "$fixture" commit --quiet -m baseline
( cd "$fixture"; ai-task-gates start --class code --base HEAD >/dev/null; mkdir -p supabase/migrations; printf '%s\n' '-- fixture' > supabase/migrations/fixture.sql )
assert_blocked(){ local label="$1"; shift; local output rc; set +e; output="$(cd "$fixture" && ai-task-gates check --before ship "$@" 2>&1)"; rc=$?; set -e; if [ "$rc" -eq 3 ]; then pass "$label"; else fail "$label (exit $rc: $output)"; fi; }
assert_blocked 'shared-db scope escalation refuses shipping'; assert_blocked 'acknowledgement cannot bypass protected database work' --acknowledge 'fixture acknowledgement'; assert_blocked 'owner request cannot bypass protected database work' --owner-request 'fixture owner request'
( cd "$fixture"; rm -rf supabase; mkdir -p tools; printf '%s\n' 'export const fixture = true;' > tools/fixture.ts; ai-task-gates start --class code --base HEAD >/dev/null; ai-task-gates check --before ship >/dev/null ); pass 'valid code flow proceeds to shipping checks'
cp "$fixture/.ai-devops/task-gates.json" "$TMP/policy.backup.json"; rm -f "$fixture/.ai-devops/task-gates.json"; printf '%s\n' 'fixtures/task-gates/governed-data/fixture.json' > "$TMP/rollback-path"; without_policy="$(cd "$fixture" && ai-task-gates explain --json --paths-from "$TMP/rollback-path" | jq -r '.observed_class')"; cp "$TMP/policy.backup.json" "$fixture/.ai-devops/task-gates.json"; with_policy="$(cd "$fixture" && ai-task-gates explain --json --paths-from "$TMP/rollback-path" | jq -r '.observed_class')"
if [ "$without_policy" = code ] && [ "$with_policy" = shared-db ] && cmp -s "$TMP/policy.backup.json" "$fixture/.ai-devops/task-gates.json"; then pass 'rollback removes database escalation and byte-exact restore reinstates it'; else fail "rollback positive control or policy restore failed (without $without_policy, with $with_policy)"; fi
if [ "$failures" -ne 0 ]; then printf '%s failure(s)\n' "$failures" >&2; exit 1; fi; printf '%s passed / 0 failed\n' "$passes"
