#!/usr/bin/env bash
# Launch the Supabase MCP server with SUPABASE_ACCESS_TOKEN injected into the
# child env only. Desktop Code sessions spawn MCP servers without the .bashrc
# token export, so resolve it here. Order: existing env -> Supabase CLI token
# file -> 1Password (vibe_coding / "Supabase CLI Personal Access Token").
# Never echoes the token.
set -euo pipefail
server=(npx -y @supabase/mcp-server-supabase@latest "$@")

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && "${SUPABASE_ACCESS_TOKEN}" != '${SUPABASE_ACCESS_TOKEN}' ]]; then
  exec "${server[@]}"
fi
unset SUPABASE_ACCESS_TOKEN

token_file="${SUPABASE_ACCESS_TOKEN_FILE:-$HOME/.supabase/access-token}"
if [[ -s "$token_file" ]]; then
  SUPABASE_ACCESS_TOKEN="$(tr -d '\r\n' < "$token_file")"
  export SUPABASE_ACCESS_TOKEN
  exec "${server[@]}"
fi

if command -v op >/dev/null 2>&1; then
  refs="$(mktemp)"; trap 'rm -f "$refs"' EXIT
  printf 'SUPABASE_ACCESS_TOKEN=op://vibe_coding/Supabase CLI Personal Access Token/credential\n' > "$refs"
  op run --env-file="$refs" -- "${server[@]}"
  exit $?
fi

echo "supabase-mcp: no SUPABASE_ACCESS_TOKEN, no $token_file, no op CLI" >&2
exit 1
