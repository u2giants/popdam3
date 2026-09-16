#!/bin/sh
# Revoke the temporary passwordless docker access granted by
# ai-docker-sudo-enable.sh. Needs no password: the grant allows exactly this
# removal, so the AI session can close its own window when the work is done.
#
#   sh /volume1/docker/popdam/ai-docker-sudo-disable.sh
set -e
F=/etc/sudoers.d/ai-docker

if [ ! -f "$F" ]; then
  echo "ALREADY REVOKED on $(hostname) - $F is not present"
  exit 0
fi

sudo -n /bin/rm -f /etc/sudoers.d/ai-docker

if [ -f "$F" ]; then
  echo "FAIL: $F still present on $(hostname); revoke it manually with: sudo rm -f $F"
  exit 1
fi

# Prove the access is actually gone rather than trusting the file removal.
if sudo -n /usr/local/bin/docker ps >/dev/null 2>&1; then
  echo "FAIL: passwordless docker still works on $(hostname) - another grant exists"
  exit 1
fi

echo "REVOKED on $(hostname) - passwordless docker access is gone"
