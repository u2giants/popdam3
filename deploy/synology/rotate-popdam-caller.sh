#!/bin/bash
# #179: run rotate-popdam-password.sh on one NAS unit from hetz.
#
#   rotate-popdam-caller.sh <edgesynology1|edgesynology2> <probe|rotate|rollback> <staging-item-id>
#
# Values come from 1Password with `op read` straight into 0600 files in a
# 0700 temp dir (never argv, env, or output). They reach the NAS by scp into a
# fresh 0700 dir in ai's home; the ai sudo value is the only thing on the
# remote sudo's stdin. The remote dir is removed in the same ssh command, and
# again by a cleanup ssh if that command was cut off.
set -euo pipefail
set +x
[ $# = 3 ] || { echo "FAIL: usage"; exit 1; }
H=$1; MODE=$2; STAGING=$3
case $MODE in probe|agentcheck|rotate|rollback) ;; *) echo "FAIL: mode"; exit 1 ;; esac
[[ $STAGING =~ ^[a-z0-9]{26}$ ]] || { echo "FAIL: staging item id"; exit 1; }
case $H in
  edgesynology1) OLD_ITEM=gtwd6lf6ntwxolpbj5rvfno5xy; AI_ITEM="edgesynology1 NAS - ai service account" ;;
  edgesynology2) OLD_ITEM=fkyspggksudrz6uw3iwqfcim2u; AI_ITEM="edgesynology2 NAS - ai service account" ;;
  *) echo "FAIL: host"; exit 1 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
# Unique per run, so two callers can never share or delete each other's dir.
RD=/var/services/homes/ai/.r179-$(date -u +%Y%m%dT%H%M%SZ)-$$
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -l ai "$H")
umask 077
T=$(mktemp -d "${TMPDIR:-/tmp}/r179.XXXXXX")
cleanup() { "${SSH[@]}" "rm -rf $RD" >/dev/null 2>&1 || true; shred -u "$T"/* 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT INT TERM

op read -n "op://vibe_coding/$OLD_ITEM/password" > "$T/old"
op read -n "op://vibe_coding/$STAGING/password" > "$T/new"
op read -n "op://vibe_coding/$AI_ITEM/password" > "$T/sudo"
for f in old new sudo; do [ -s "$T/$f" ] || { echo "FAIL: $f empty"; exit 1; }; done
# Transport (proven 2026-10-21): hetz ~/.ssh config key for each unit with
# `-l ai` (edge2 :1904, edge1 :22; addresses live in ~/.ssh/config and the
# hashed scripts/nas_known_hosts) and `scp -O`
# (legacy SCP protocol; SFTP is off on these units, -O does not need it).

"${SSH[@]}" "mkdir -m 700 $RD"
scp -q -O -o BatchMode=yes -o ConnectTimeout=15 -o User=ai \
  "$T/old" "$T/new" "$HERE/rotate-popdam-password.sh" "ai@$H:$RD/"
# Root takes ownership before running anything, so ai cannot swap files
# between staging and execution; the script's hash is checked as root.
SH=$(sha256sum "$HERE/rotate-popdam-password.sh" | cut -c1-64)
shred -u "$T/old" "$T/new"

# sudo -S reads the first stdin line; the script never reads stdin.
set +e
"${SSH[@]}" "sudo -S -p '' sh -c 'chown -R root:root $RD && chmod 700 $RD && chmod 600 $RD/old $RD/new $RD/rotate-popdam-password.sh && [ \"\$(sha256sum $RD/rotate-popdam-password.sh | cut -c1-64)\" = $SH ] || { echo \"FAIL: staged files\"; exit 1; }; ROTATE_SETPW=${ROTATE_SETPW:-api} sh $RD/rotate-popdam-password.sh $MODE $RD; rc=\$?; shred -u $RD/old $RD/new 2>/dev/null; rm -rf $RD; exit \$rc'; rc=\$?; sudo -k; exit \$rc" \
  < "$T/sudo" > "$T/out" 2>&1
rc=$?
set -e
shred -u "$T/sudo"
# Status words only; refuse to print anything that is not one. If
# other_lines > 0, rerun the failing step by hand with output to a root 0600
# file on the NAS and inspect it there by grep for known error words.
W='^(STEP|OK|FAIL|ROLLBACK|BREAK-GLASS|set response|password confirm|login refused|env:|agent |compose |restore |backup )'
grep -E "$W" "$T/out" || true
echo "rc=$rc other_lines=$(grep -cvE "$W" "$T/out")"
exit $rc
