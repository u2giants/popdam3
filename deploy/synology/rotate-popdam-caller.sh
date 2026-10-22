#!/bin/bash
# #179: run rotate-popdam-password.sh on one NAS unit from hetz.
#
#   rotate-popdam-caller.sh <edgesynology1|edgesynology2> <rotate|rollback> <staging-item-id>
#
# Values come from 1Password with `op read` straight into 0600 files in a
# 0700 temp dir (never argv, env, or output). They reach the NAS by scp into a
# fresh 0700 dir in ai's home; the ai sudo value is the only thing on the
# remote sudo's stdin. The remote dir is removed in the same ssh command, and
# again by a cleanup ssh if that command was cut off.
set -euo pipefail
set +x
H=$1; MODE=$2; STAGING=$3
case $H in
  edgesynology1) OLD_ITEM=gtwd6lf6ntwxolpbj5rvfno5xy; AI_ITEM="edgesynology1 NAS - ai service account" ;;
  edgesynology2) OLD_ITEM=fkyspggksudrz6uw3iwqfcim2u; AI_ITEM="edgesynology2 NAS - ai service account" ;;
  *) echo "FAIL: host"; exit 1 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
RD=/var/services/homes/ai/.r179
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -l ai "$H")
umask 077
T=$(mktemp -d "${TMPDIR:-/tmp}/r179.XXXXXX")
cleanup() { "${SSH[@]}" "rm -rf $RD" >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT INT TERM

op read -n "op://vibe_coding/$OLD_ITEM/password" > "$T/old"
op read -n "op://vibe_coding/$STAGING/password" > "$T/new"
op read -n "op://vibe_coding/$AI_ITEM/password" > "$T/sudo"
for f in old new sudo; do [ -s "$T/$f" ] || { echo "FAIL: $f empty"; exit 1; }; done

"${SSH[@]}" "rm -rf $RD && mkdir -m 700 $RD"
scp -q -O -o BatchMode=yes -o ConnectTimeout=15 -o User=ai \
  "$T/old" "$T/new" "$HERE/rotate-popdam-password.sh" "ai@$H:$RD/"
"${SSH[@]}" "chmod 600 $RD/old $RD/new"
rm -f "$T/old" "$T/new"

# sudo -S reads the first stdin line; the script never reads stdin.
set +e
"${SSH[@]}" "sudo -S -p '' sh $RD/rotate-popdam-password.sh $MODE $RD; rc=\$?; sudo -k; rm -rf $RD; exit \$rc" \
  < "$T/sudo" > "$T/out" 2>&1
rc=$?
set -e
rm -f "$T/sudo"
# Status words only; refuse to print anything that is not one.
grep -E '^(STEP|OK|FAIL|ROLLBACK|BREAK-GLASS|set response|password confirm|login refused|env:|agent |compose |restore )' "$T/out" || true
echo "rc=$rc other_lines=$(grep -cvE '^(STEP|OK|FAIL|ROLLBACK|BREAK-GLASS|set response|password confirm|login refused|env:|agent |compose |restore )' "$T/out")"
exit $rc
