set -e
D=/volume1/mac/_469_rotest
mkdir -p "$D"
echo readable-before-lock > "$D/readtest.txt"
chattr +i "$D"
echo "LSATTR_AFTER:"
lsattr -d "$D"
echo "ROOT_WRITE_PROBE:"
if touch "$D/probe.txt" 2>/tmp/_469_probe_err; then
  echo WRITE_UNEXPECTEDLY_OK
  rm -f "$D/probe.txt"
else
  echo WRITE_BLOCKED_OK
  cat /tmp/_469_probe_err
fi
echo "ROOT_SH_WRITE_PROBE:"
if sh -c "echo x > $D/probe2.txt" 2>/tmp/_469_probe2_err; then
  echo SH_WRITE_UNEXPECTEDLY_OK
  rm -f "$D/probe2.txt"
else
  echo SH_WRITE_BLOCKED_OK
  cat /tmp/_469_probe2_err
fi
echo "READ_PROBE:"
cat "$D/readtest.txt"
echo "DIR_LISTING:"
ls -la "$D"
