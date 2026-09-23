#!/bin/sh
# Revoke the temporary passwordless docker access granted by
# ai-docker-sudo-enable.sh. Needs no password: the grant allows exactly this
# removal, so the AI session can close its own window when the work is done.
#
#   sh /volume1/docker/popdam/ai-docker-sudo-disable.sh
#
# /etc/sudoers.d is root-only (0750), so this account cannot test for the file
# directly; attempt the removal and then prove the access is gone.
F=/etc/sudoers.d/ai-docker

sudo -n /bin/rm -f "$F" >/dev/null 2>&1

# Prove the access is actually gone rather than trusting the file removal.
if sudo -n /usr/local/bin/docker ps >/dev/null 2>&1; then
  echo "FAIL: passwordless docker still works on $(hostname) - revoke manually with: sudo rm -f $F"
  exit 1
fi

echo "REVOKED on $(hostname) - passwordless docker access is gone"
