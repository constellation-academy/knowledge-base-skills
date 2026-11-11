MATCH (n) WITH collect(DISTINCT n.kb) AS kbs, count(CASE WHEN n.kb IS NULL THEN 1 END) AS unstamped
CALL apoc.util.validate(unstamped > 0 OR any(k IN kbs WHERE k <> $kb), 'refusing: the store does not hold only KB %s (other KBs: %s, unstamped nodes: %s)', [$kb, apoc.text.join([k IN kbs WHERE k <> $kb], ', '), toString(unstamped)])
MATCH (d:Doc {kb: $kb, path: $path})
CALL (d) {
  MATCH (d)-[:REFERENCES]->(o:Doc {kb: $kb}) RETURN o, 'out' AS direction
  UNION
  MATCH (d)<-[:REFERENCES]-(o:Doc {kb: $kb}) RETURN o, 'in' AS direction
}
WITH o, direction ORDER BY direction DESC, o.path
RETURN apoc.convert.toJson({path: o.path, type: o.type, title: o.title, status: o.status, direction: direction}) AS json;
