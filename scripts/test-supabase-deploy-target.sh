#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard="$repo_root/scripts/verify-supabase-deploy-target.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
cd "$test_dir"

expect_refusal() {
  if "$@" >output 2>&1; then
    echo "Expected target verification to refuse" >&2
    exit 1
  fi
  grep -q 'Refusing Supabase deployment' output
}

expect_refusal env -u SUPABASE_PROJECT_ID bash "$guard" configured
expect_refusal env SUPABASE_PROJECT_ID=ryltkzzernhwnojzouyb bash "$guard" configured
env SUPABASE_PROJECT_ID=qsllyeztdwjgirsysgai bash "$guard" configured
expect_refusal env SUPABASE_PROJECT_ID=qsllyeztdwjgirsysgai bash "$guard" linked

mkdir -p supabase/.temp
printf '%s\n' ryltkzzernhwnojzouyb >supabase/.temp/project-ref
expect_refusal env SUPABASE_PROJECT_ID=qsllyeztdwjgirsysgai bash "$guard" linked
printf '%s\n' qsllyeztdwjgirsysgai >supabase/.temp/project-ref
env SUPABASE_PROJECT_ID=qsllyeztdwjgirsysgai bash "$guard" linked

echo 'Supabase deployment target guard: 6 cases passed'
