MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
MATCH (d:Doc {kb: $kb, path: $path})
CALL (d) {
  MATCH p = (n:Doc {kb: $kb})-[:SUPERSEDES*0..]->(d) RETURN n, -length(p) AS distance
  UNION
  MATCH p = (d)-[:SUPERSEDES*1..]->(n:Doc {kb: $kb}) RETURN n, length(p) AS distance
}
WITH n, min(distance) AS distance ORDER BY distance, n.path
RETURN apoc.convert.toJson({path: n.path, type: n.type, title: n.title, status: n.status, distance: distance}) AS json;
