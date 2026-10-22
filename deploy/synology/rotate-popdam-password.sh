#!/bin/sh
# #179: rotate the Synology-local `popdam` password on THIS unit and move the
# synology-monitor agent to the new value. Run as root (sudo) on the NAS by
# deploy/synology/rotate-popdam-caller.sh; see
# docs/ops/179-popdam-nas-rotation-plan.md.
#
#   sh rotate-popdam-password.sh <probe|rotate|rollback> <secret-dir>
#
# <secret-dir> (0700, root or ai owned) holds `old` and `new`: bare values, no
# newline, 0600. Secrets are only read from files (curl --data-urlencode
# name@file, cat, printf builtin): never argv, never output. Output is status
# words and DSM error codes only.
#
# rotate   : stop agent, back up .env, set new, prove new accepted / old
#            refused, rewrite DSM_PASSWORD, recreate agent, prove it connects.
#            Any failure after the password may have changed rolls back.
# rollback : state-aware: whichever value DSM accepts, end on OLD with the
#            newest .env.bak.179-* restored and the agent connected.
set -u
[ $# = 2 ] || { echo "FAIL: usage"; exit 1; }
MODE=$1; S=$2
D=/volume1/docker/synology-monitor-agent
DC=/var/packages/ContainerManager/target/usr/bin/docker-compose
DK=/usr/local/bin/docker
API=https://localhost:5001/webapi/entry.cgi
SVC=synology-monitor-agent
C="/usr/bin/curl -sk --max-time 30"
PATH=/usr/sbin:/usr/bin:/sbin:/bin; export PATH
umask 077
trap 'shred -u "$S/json.auth" "$S/json.pw" "$S/env.rest" "$S/env.new" 2>/dev/null' EXIT INT TERM

die() { echo "FAIL: $*"; exit 1; }
digest() { tr -d '\n' < "$1" | sha256sum | cut -c1-12; }
perm() { stat -c %a "$1"; }

login() { # $1 = secret file; prints "SID SYNOTOKEN" or nothing
  r=$($C "$API" --data api=SYNO.API.Auth --data version=7 --data method=login \
    --data account=popdam --data-urlencode "passwd@$1" --data format=sid \
    --data session=webui --data enable_syno_token=yes)
  sid=$(echo "$r" | sed -n 's/.*"sid":"\([^"]*\)".*/\1/p')
  tok=$(echo "$r" | sed -n 's/.*"synotoken":"\([^"]*\)".*/\1/p')
  [ -n "$sid" ] && echo "$sid $tok"
}
logout() { $C "$API" --data api=SYNO.API.Auth --data version=7 --data method=logout --data "_sid=${1%% *}" >/dev/null 2>&1; return 0; }
accepts() { # $1 = secret file; 0 if DSM login succeeds
  s=$(login "$1"); [ -n "$s" ] || return 1; logout "$s"; return 0
}
setpw() { # $1 = current (auth) file, $2 = target file
  # Self-service change: SYNO.Core.User.PasswordConfirm v2 then
  # SYNO.Core.NormalUser v2 set (JSON-encoded values). SYNO.Core.User set
  # returns 105 for this account and is not used.
  sid=$(login "$1"); [ -n "$sid" ] || { echo "login refused"; return 2; }
  { printf '"'; cat "$1"; printf '"'; } > "$S/json.auth"
  { printf '"'; cat "$2"; printf '"'; } > "$S/json.pw"
  c=$($C "$API" -b "id=${sid%% *}" -H "X-SYNO-TOKEN: ${sid#* }" \
      --data api=SYNO.Core.User.PasswordConfirm --data version=2 --data method=auth \
      --data-urlencode "password@$S/json.auth" --data "_sid=${sid%% *}")
  ctok=$(echo "$c" | sed -n 's/.*"SynoConfirmPWToken":"\([^"]*\)".*/\1/p')
  if ! echo "$c" | grep -q '"success":true' || [ -z "$ctok" ]; then
    rm -f "$S/json.auth" "$S/json.pw"; logout "$sid"; echo "password confirm refused"; return 1
  fi
  r=$($C "$API" -b "id=${sid%% *}" -H "X-SYNO-TOKEN: ${sid#* }" -H "X-SYNO-CONFIRM-PW-TOKEN: $ctok" \
      --data api=SYNO.Core.NormalUser --data version=2 --data method=set \
      --data-urlencode "old_password@$S/json.auth" --data-urlencode "password@$S/json.pw" \
      --data "_sid=${sid%% *}" --data "SynoConfirmPWToken=$ctok")
  rm -f "$S/json.auth" "$S/json.pw"; logout "$sid"
  echo "$r" | grep -q '"success":true' && return 0
  echo "set response: code $(echo "$r" | sed -n 's/.*"code":\([0-9]*\).*/\1/p')"; return 1
}
agent_up() { # recreate and wait for a clean DSM connection (json-file logs)
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (cd "$D" && $DC up -d --force-recreate "$SVC" >/dev/null 2>&1) || { echo "compose up failed"; return 1; }
  i=0; while [ $i -lt 36 ]; do
    sleep 5; i=$((i+1))
    l=$($DK logs --since "$start" "$SVC" 2>&1)
    echo "$l" | grep -q "Connected to DSM API" && return 0
    # Wrong value → stop early, before the agent's retries add DSM failures.
    if [ "$(echo "$l" | grep -cE 'DSM login attempt [0-9]+ failed')" -ge 2 ]; then
      $DK stop "$SVC" >/dev/null 2>&1; echo "agent login failed"; return 1; fi
  done; echo "agent not connected in 180 s"; return 1
}
container_env_is() { # running container env DSM_PASSWORD digest equals $1's
  [ "$($DK inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$SVC" | grep '^DSM_PASSWORD=' | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$1")" ]
}
env_install() { # $1 = file whose content becomes .env (temp + rename)
  cp "$1" "$D/.env.tmp179" && chown root:root "$D/.env.tmp179" && chmod 600 "$D/.env.tmp179" \
    && sync && mv -f "$D/.env.tmp179" "$D/.env"
}
env_rewrite() { # $1 = secret file to install as DSM_PASSWORD
  [ "$(grep -c '^DSM_PASSWORD=' "$D/.env")" = 1 ] || { echo "env: DSM_PASSWORD count"; return 1; }
  grep '^DSM_PASSWORD=' "$D/.env" | grep -q "[\"'$(printf '\r')]" && { echo "env: quoted/CR line"; return 1; }
  [ -z "$(tail -c1 "$D/.env")" ] || { echo "env: no trailing newline"; return 1; }
  grep -v '^DSM_PASSWORD=' "$D/.env" > "$S/env.rest"
  { cat "$S/env.rest"; printf 'DSM_PASSWORD='; cat "$1"; printf '\n'; } > "$S/env.new"
  grep -v '^DSM_PASSWORD=' "$S/env.new" | cmp -s - "$S/env.rest" || { echo "env: other lines changed"; return 1; }
  [ "$(grep '^DSM_PASSWORD=' "$S/env.new" | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$1")" ] || { echo "env: digest"; return 1; }
  env_install "$S/env.new" || { echo "env: install"; return 1; }
  (cd "$D" && $DC config -q >/dev/null 2>&1) || { echo "env: compose config"; return 1; }
}
restore_old() { # end state OLD everywhere; $1 = backup file holding OLD
  $DK stop "$SVC" >/dev/null 2>&1
  [ "$(grep '^DSM_PASSWORD=' "$1" | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$S/old")" ] || { echo "backup does not hold old"; return 1; }
  if accepts "$S/new"; then
    setpw "$S/new" "$S/old" || { echo "BREAK-GLASS needed: reset to old refused"; return 1; }
  fi
  accepts "$S/old" || { echo "BREAK-GLASS needed: old not accepted"; return 1; }
  env_install "$1" || { echo "restore .env failed"; return 1; }
  agent_up && container_env_is "$S/old"
}

# --- input checks ---
for b in "$DC" "$DK" /usr/bin/curl /usr/bin/sha256sum /usr/bin/flock /usr/bin/stat /usr/bin/cmp; do [ -x "$b" ] || die "missing $b"; done
# Agent log strings pinned to u2giants/synology-monitor apps/agent/cmd/agent/main.go
# ("Connected to DSM API" after loginWithRetry; "DSM login attempt %d failed").
[ -d "$S" ] && [ "$(perm "$S")" = 700 ] || die "secret dir must be 0700"
for f in old new; do
  [ -s "$S/$f" ] || die "$f empty"; [ "$(perm "$S/$f")" = 600 ] || die "$f must be 0600"
  [ "$(wc -l < "$S/$f")" = 0 ] || die "$f has a newline"
  LC_ALL=C grep -q '["\\[:cntrl:]]' "$S/$f" && die "$f needs JSON escaping"
done
[ "$(digest "$S/old")" != "$(digest "$S/new")" ] || die "new equals old"
install -d -m 700 -o root /run/rotate-popdam && exec 9>/run/rotate-popdam/lock && flock -n 9 || die "another run holds the lock"

case $MODE in
probe)
  # Reconcile: which value does DSM accept? At most one failed login each.
  echo "OK probe $(hostname) old=$(accepts "$S/old" && echo accepted || echo refused) new=$(accepts "$S/new" && echo accepted || echo refused)";;
rotate)
  [ "$(wc -c < "$S/new")" = 32 ] && LC_ALL=C grep -qxE '[A-Za-z0-9]+' "$S/new" && grep -q '[0-9]' "$S/new" \
    || die "new must be 32 chars [A-Za-z0-9] with a digit"
  accepts "$S/old" || die "old not accepted; unit not in expected state"
  # .env shape checks before anything changes.
  [ -z "$(tail -c1 "$D/.env")" ] || die "env: no trailing newline"
  [ "$(grep -c '^DSM_PASSWORD=' "$D/.env")" = 1 ] || die "env: DSM_PASSWORD count"
  grep '^DSM_PASSWORD=' "$D/.env" | grep -q "[\"'$(printf '\r')]" && die "env: quoted/CR line"
  TS=$(date -u +%Y%m%dT%H%M%SZ); B="$D/.env.bak.179-$TS"
  cp -p "$D/.env" "$B" && [ "$(perm "$B")" = 600 ] || die "backup"
  $DK stop "$SVC" >/dev/null 2>&1
  [ "$($DK inspect -f '{{.State.Running}}' "$SVC")" = false ] || { agent_up; die "agent stop"; }
  if ! setpw "$S/old" "$S/new"; then
    # The response may be lost after DSM applied it: probe before claiming.
    if accepts "$S/new"; then echo "STEP set applied despite error"; else
      agent_up || echo "agent restart on unchanged unit failed"; die "password set refused; unit unchanged (old still accepted: $(accepts "$S/old" && echo yes || echo no))"; fi
  fi
  echo "STEP password set"
  ok=1
  accepts "$S/new" && echo "STEP new accepted" || ok=0
  [ $ok = 1 ] && { accepts "$S/old" && ok=0 || echo "STEP old refused"; }
  [ $ok = 1 ] && { env_rewrite "$S/new" && echo "STEP env rewritten" || ok=0; }
  [ $ok = 1 ] && { agent_up && container_env_is "$S/new" && echo "STEP agent connected" || ok=0; }
  if [ $ok = 1 ]; then echo "OK rotate $(hostname) backup=$(basename "$B")"; exit 0; fi
  echo "ROLLBACK starting"
  restore_old "$B" && die "rotation failed; unit rolled back to old, agent connected"
  die "rotation failed; rollback incomplete";;
rollback)
  B=; for f in $(ls -1t "$D"/.env.bak.179-* 2>/dev/null); do
    [ "$(grep '^DSM_PASSWORD=' "$f" | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-12)" = "$(digest "$S/old")" ] && { B=$f; break; }
  done; [ -n "$B" ] || die "no backup holding old"
  $DK stop "$SVC" >/dev/null 2>&1
  restore_old "$B" || die "rollback incomplete"
  echo "OK rollback $(hostname)";;
*) die "mode";;
esac
