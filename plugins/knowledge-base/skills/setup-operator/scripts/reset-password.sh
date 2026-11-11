#!/bin/bash
grep -q __KB_PASSWORD__ /w/settings.local.json || exit 3
/startup/docker-entrypoint.sh neo4j >/tmp/neo4j.log 2>&1 &
server=$!
for _ in $(seq 90); do
  (echo >/dev/tcp/127.0.0.1/7687) 2>/dev/null && break
  sleep 2
done
(echo >/dev/tcp/127.0.0.1/7687) 2>/dev/null || exit 6
p=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32)
printf "ALTER USER neo4j SET PASSWORD '%s' CHANGE NOT REQUIRED;\n" "$p" >/tmp/password.cypher
printf 's/__KB_PASSWORD__/%s/\n' "$p" >/tmp/sed
cypher-shell -d system -f /tmp/password.cypher >/dev/null || exit 4
sed -f /tmp/sed /w/settings.local.json >/tmp/settings || exit 5
cat /tmp/settings >/w/settings.local.json
kill "$server"
wait "$server"
exit 0
