#!/usr/bin/env bash
set -euo pipefail

expected_ref=qsllyeztdwjgirsysgai
mode="${1:-}"

if [[ "$mode" != configured && "$mode" != linked ]]; then
  echo "Expected configured or linked target verification mode" >&2
  exit 2
fi

if [[ "${SUPABASE_PROJECT_ID:-}" != "$expected_ref" ]]; then
  echo "Refusing Supabase deployment: configured project is not the approved production project" >&2
  exit 1
fi

if [[ "$mode" == linked ]]; then
  linked_ref_file=supabase/.temp/project-ref
  if [[ ! -f "$linked_ref_file" ]]; then
    echo "Refusing Supabase deployment: linked project reference is missing" >&2
    exit 1
  fi
  linked_ref="$(<"$linked_ref_file")"
  if [[ "$linked_ref" != "$expected_ref" ]]; then
    echo "Refusing Supabase deployment: linked project is not the approved production project" >&2
    exit 1
  fi
fi
