#!/bin/sh
# Grant the `ahazan` account temporary passwordless docker access on this Synology,
# for one block of AI-run container work. Run it with sudo; it asks for the
# password once. Revoke it afterwards with ai-docker-sudo-disable.sh.
#
#   sudo sh /volume1/docker/popdam/ai-docker-sudo-enable.sh
#
# The grant is deliberately narrow in wording, but understand what it means:
# access to the Docker socket is equivalent to root on this box. That is why the
# previous grant was disabled on 2026-09-03. Keep the window short and always
# revoke when the block of work is finished.
set -e
F=/etc/sudoers.d/ai-docker
T=$(mktemp)

cat > "$T" <<'RULE'
# Temporary: AI session container work. Revoke with ai-docker-sudo-disable.sh.
ahazan ALL=(root) NOPASSWD: /usr/local/bin/docker
ahazan ALL=(root) NOPASSWD: /bin/rm -f /etc/sudoers.d/ai-docker
RULE

chmod 0440 "$T"
chown root:root "$T"

# Never install a sudoers file that does not parse - that can lock sudo out.
# DSM ships without visudo; there, validate by having sudo itself parse the
# installed set (below) and roll back if it cannot.
if command -v visudo >/dev/null 2>&1 && ! visudo -c -f "$T" >/dev/null 2>&1; then
  echo "FAIL: generated sudoers file did not validate; nothing was changed"
  rm -f "$T"
  exit 1
fi

cp -p "$T" "$F"
rm -f "$T"
chmod 0440 "$F"

if command -v visudo >/dev/null 2>&1; then
  CHECK="visudo -c"
else
  CHECK="sudo -l -U ahazan"
fi
if ! $CHECK >/dev/null 2>&1; then
  echo "FAIL: sudoers set did not validate after install; removing"
  rm -f "$F"
  exit 1
fi

echo "ENABLED $F on $(hostname)"
echo "Revoke when the block of work is done:"
echo "  sh /volume1/docker/popdam/ai-docker-sudo-disable.sh"
