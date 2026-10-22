#!/bin/sh
# #179: rotate the Synology-local `popdam` password on THIS unit and move the
# synology-monitor agent to the new value. Run as root (sudo) on the NAS.
#
#   sh rotate-popdam-password.sh <rehearse|rotate|rollback> <secret-dir>
#
# <secret-dir> (0700) holds `old` and, for rotate/rollback, `new`: the bare
# values, no trailing newline. Secrets are only ever read from those files
# (curl --data-urlencode name@file, printf builtin); never argv, never output.
# rehearse : DSM login with old, SYNO.Core.User set to the SAME old value, login again.
# rotate   : stop agent, back up .env, set new, prove new accepted / old refused,
#            rewrite DSM_PASSWORD, recreate agent, prove it connects. Any failure
#            after the password change rolls this unit back automatically.
# rollback : set the password back to old (authenticating with new), restore the
#            newest .env.bak.179-* and recreate the agent.
set -u
MODE=$1; S=$2
D=/volume1/docker/synology-monitor-agent
DC=/var/packages/ContainerManager/target/usr/bin/docker-compose
DK=/usr/local/bin/docker
API=https://localhost:5001/webapi/entry.cgi
SVC=synology-monitor-agent
umask 077

die() { echo "FAIL: $*"; exit 1; }
digest() { tr -d '\n' < "$1" | sha256sum | cut -c1-12; }
login() { # $1 = secret file; prints "SID TOKEN" or nothing
  r=$(curl -sk "$API" --data api=SYNO.API.Auth --data version=7 --data method=login \
    --data account=popdam --data-urlencode "passwd@$1" --data format=sid --data session=webui --data enable_syno_token=yes)
  sid=$(echo "$r" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')
  tok=$(echo "$r" | sed -n 's/.*"synotoken":"\([^"]*\)".*/\1/p')
  [ -n "$sid" ] && echo "$sid $tok"
}
logout() { curl -sk "$API" --data api=SYNO.API.Auth --data version=7 --data method=logout --data "_sid=${1%% *}" >/dev/null; }
setpw() { # $1 = auth secret file, $2 = target secret file
  sid=$(login "$1"); [ -n "$sid" ] || return 2
  # SYNO.Core.NormalUser (self-service change) takes JSON-encoded values; values with " or \ are refused.
  grep -q '["\\]' "$2" && { logout "$sid"; echo "value needs JSON escaping"; return 1; }
  grep -q '["\\]' "$1" && { logout "$sid"; echo "value needs JSON escaping"; return 1; }
  { printf '"'; cat "$1"; printf '"'; } > "$S/json.auth"
  { printf '"'; cat "$2"; printf '"'; } > "$S/json.pw"
  # DSM 7.2: sensitive account changes need a fresh password confirmation.
  c=$(curl -sk "$API" -b "id=${sid%% *}" -H "X-SYNO-TOKEN: ${sid#* }" --data api=SYNO.Core.User.PasswordConfirm \
      --data version=2 --data method=auth --data-urlencode "password@$S/json.auth" --data "_sid=${sid%% *}")
  echo "$c" | grep -q '"success":true' || { logout "$sid"; echo "password confirm refused"; return 1; }
  ctok=$(echo "$c" | sed -n 's/.*"SynoConfirmPWToken":"\([^"]*\)".*/\1/p')
  r=$(curl -sk "$API" -b "id=${sid%% *}" -H "X-SYNO-TOKEN: ${sid#* }" -H "X-SYNO-CONFIRM-PW-TOKEN: ${ctok:-}" --data api=SYNO.Core.NormalUser --data version=2 --data method=set \
      --data-urlencode "old_password@$S/json.auth" --data-urlencode "password@$S/json.pw" --data "_sid=${sid%% *}" \
      --data "SynoConfirmPWToken=${ctok:-}")
  rm -f "$S/json.pw" "$S/json.auth"; logout "$sid"
  echo "$r" | grep -q '"success":true' && return 0
  echo "set response: $(echo "$r" | cut -c1-200)"; return 1
}
agent_up() { # recreate and wait for a clean DSM connection
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (cd "$D" && $DC up -d --force-recreate "$SVC" >/dev/null 2>&1) || return 1
  i=0; while [ $i -lt 36 ]; do
    sleep 5; i=$((i+1))
    l=$($DK logs --since "$start" "$SVC" 2>&1)
    if echo "$l" | grep -q "Connected to DSM API"; then
      [ "$(echo "$l" | grep -cE 'DSM login attempt [0-9]+ failed|Failed to login')" = 0 ] && return 0 || return 1
    fi
  done; return 1
}
env_rewrite() { # $1 = secret file to install as DSM_PASSWORD
  [ "$(grep -c '^DSM_PASSWORD=' "$D/.env")" = 1 ] || return 1
  grep -v '^DSM_PASSWORD=' "$D/.env" > "$S/env.rest" || return 1
  { cat "$S/env.rest"; printf 'DSM_PASSWORD='; cat "$1"; printf '\n'; } > "$S/env.new"
  grep -v '^DSM_PASSWORD=' "$S/env.new" | cmp -s - "$S/env.rest" || return 1
  [ "$(grep '^DSM_PASSWORD=' "$S/env.new" | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$1")" ] || return 1
  cat "$S/env.new" > "$D/.env" && chown root:root "$D/.env" && chmod 600 "$D/.env"
  rm -f "$S/env.rest" "$S/env.new"
  (cd "$D" && $DC config -q >/dev/null 2>&1)
}
container_env_ok() { # running container env holds $1's value
  [ "$($DK inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$SVC" | grep '^DSM_PASSWORD=' | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$1")" ]
}

[ -s "$S/old" ] || die "old secret file empty"
case $MODE in
rehearse)
  setpw "$S/old" "$S/old" || die "rehearsal set failed"
  sid=$(login "$S/old"); [ -n "$sid" ] || die "login after rehearsal failed"; logout "$sid"
  echo "OK rehearse $(hostname)";;
rotate)
  [ -s "$S/new" ] || die "new secret file empty"
  [ "$(digest "$S/old")" != "$(digest "$S/new")" ] || die "new equals old"
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  $DK stop "$SVC" >/dev/null || die "agent stop"
  cp -p "$D/.env" "$D/.env.bak.179-$TS" || { agent_up; die "backup"; }
  if ! setpw "$S/old" "$S/new"; then agent_up; die "password set refused; unit unchanged"; fi
  echo "STEP password set"
  ok=1
  sid=$(login "$S/new"); [ -n "$sid" ] && logout "$sid" || ok=0
  [ $ok = 1 ] && echo "STEP new accepted"
  if [ $ok = 1 ]; then sid=$(login "$S/old"); [ -z "$sid" ] && echo "STEP old refused" || { logout "$sid"; ok=0; }; fi
  [ $ok = 1 ] && { env_rewrite "$S/new" && echo "STEP env rewritten" || ok=0; }
  [ $ok = 1 ] && { agent_up && container_env_ok "$S/new" && echo "STEP agent connected" || ok=0; }
  if [ $ok = 1 ]; then echo "OK rotate $(hostname) backup=.env.bak.179-$TS"; exit 0; fi
  echo "ROLLBACK starting"
  setpw "$S/new" "$S/old" || die "ROLLBACK password reset failed - use break-glass"
  cp -p "$D/.env.bak.179-$TS" "$D/.env"; chown root:root "$D/.env"; chmod 600 "$D/.env"
  agent_up && container_env_ok "$S/old" && die "rotation failed; unit rolled back to old, agent connected"
  die "rotation failed; password rolled back but agent not connected";;
rollback)
  [ -s "$S/new" ] || die "new secret file empty"
  B=$(ls -1t "$D"/.env.bak.179-* 2>/dev/null | head -1); [ -n "$B" ] || die "no backup"
  $DK stop "$SVC" >/dev/null
  setpw "$S/new" "$S/old" || die "reset failed - use break-glass"
  cp -p "$B" "$D/.env"; chown root:root "$D/.env"; chmod 600 "$D/.env"
  agent_up && container_env_ok "$S/old" || die "agent not connected after rollback"
  echo "OK rollback $(hostname)";;
*) die "mode";;
esac
