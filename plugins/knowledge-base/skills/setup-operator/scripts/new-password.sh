#!/bin/sh
grep -q __KB_PASSWORD__ /w/settings.local.json || exit 3
p=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32)
printf '%s' "$p" >/tmp/pw
printf 's/__KB_PASSWORD__/%s/\n' "$p" >/tmp/sed
neo4j-admin dbms set-initial-password @/tmp/pw >/dev/null || exit 4
sed -f /tmp/sed /w/settings.local.json >/tmp/settings || exit 5
cat /tmp/settings >/w/settings.local.json
